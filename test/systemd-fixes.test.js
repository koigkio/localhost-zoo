import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCgroup, protectedReason, detectImage, detectFramework } from '../src/scan.js';
import { advise } from '../src/fixes.js';
import { parseUfw } from '../src/exposure.js';
import { stopEntry } from '../src/kill.js';

test('parseCgroup finds the systemd unit (v2, v1, user units, none)', () => {
  assert.deepEqual(parseCgroup('0::/system.slice/nginx.service\n'), { name: 'nginx.service', user: false });
  assert.deepEqual(parseCgroup('12:pids:/system.slice/x\n1:name=systemd:/system.slice/ml-api.service\n'), { name: 'ml-api.service', user: false });
  assert.deepEqual(parseCgroup('0::/user.slice/user-1000.slice/user@1000.service/app.slice/vite-dev.service'), { name: 'vite-dev.service', user: true });
  assert.equal(parseCgroup('0::/user.slice/user-1000.slice/session-3.scope'), null);
  assert.equal(parseCgroup('0::/system.slice/docker-abc.scope'), null);
  assert.equal(parseCgroup(''), null);
});

test('protectedReason guards SSH, Docker and init', () => {
  assert.match(protectedReason({ command: 'sshd', cmdline: 'sshd: /usr/sbin/sshd -D' }), /SSH/);
  assert.match(protectedReason({ command: 'x', unit: { name: 'ssh.service' } }), /SSH/);
  assert.match(protectedReason({ command: 'dockerd', cmdline: '/usr/bin/dockerd' }), /Docker/);
  assert.match(protectedReason({ pid: 1, command: 'systemd' }), /init/);
  assert.equal(protectedReason({ command: 'node', cmdline: 'node server.js', unit: { name: 'app.service' } }), null);
});

test('stopEntry refuses protected entries before touching anything', async () => {
  const r = await stopEntry({ pid: 999999, command: 'sshd', protected: 'This is the SSH server.' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Refusing/);
});

test('detectImage: real container images map to frameworks', () => {
  assert.equal(detectImage('redis:7'), 'Redis');
  assert.equal(detectImage('bitnami/postgresql:16'), 'PostgreSQL');
  assert.equal(detectImage('docker.elastic.co/elasticsearch/elasticsearch:8.15.0'), 'Elasticsearch');
  assert.equal(detectImage('mongo'), 'MongoDB');
  assert.equal(detectImage('mariadb:11'), 'MySQL');
  assert.equal(detectImage('ghcr.io/acme/api:latest'), null);
  assert.equal(detectFramework('/usr/bin/dockerd -H tcp://0.0.0.0:2375'), 'Docker API');
});

const fw = parseUfw('Status: active\nDefault: deny (incoming), allow (outgoing)\n\nTo  Action  From\n');
const net = { publicIps: ['203.0.113.7'], firewall: fw };
const exposure = (level, port) => ({ level, reason: 'x', ports: { [port]: level } });

test('advise: Docker gets compose and docker run fixes with the right ports', () => {
  const e = {
    kind: 'dev', framework: 'Redis', ports: [16379], cwd: '/home/dev/code/shop', project: { name: 'shop' },
    bindings: [{ address: '*', port: 16379, containerPort: 6379 }],
    container: { id: 'abc', name: 'shop-cache-1', image: 'redis:7', service: 'cache' },
    exposure: exposure('internet', 16379),
  };
  const a = advise(e, net);
  assert.match(a.risk, /crypto-mining/);
  assert.match(a.fixes[0].title, /~\/code\/shop\/docker-compose\.yml/);
  assert.match(a.fixes[0].cmd, /"127\.0\.0\.1:16379:6379"/);
  assert.match(a.fixes[1].cmd, /docker run -p 127\.0\.0\.1:16379:6379 redis:7/);
  assert.ok(a.fixes.some((f) => /ufw/.test(f.title)), 'explains why ufw did not help');
});

test('advise: processes get a framework-specific bind fix, ufw and a tunnel', () => {
  const e = { kind: 'dev', framework: 'Vite', ports: [5173], bindings: [{ address: '*', port: 5173 }], cmdline: 'vite --host', exposure: exposure('internet', 5173) };
  const a = advise(e, net);
  assert.match(a.fixes[0].cmd, /vite --host 127\.0\.0\.1 --port 5173/);
  assert.ok(a.fixes.some((f) => f.cmd === 'sudo ufw insert 1 deny 5173/tcp'));
  assert.ok(a.fixes.some((f) => /ssh -L 5173:localhost:5173/.test(f.cmd)));
  // No firewall at all: suggest turning one on, SSH first.
  const noFw = advise(e, { publicIps: ['203.0.113.7'], firewall: null });
  assert.ok(noFw.fixes.some((f) => /allow OpenSSH && sudo ufw enable/.test(f.cmd)));
});

test('advise: nothing for local, firewalled or system entries; softer wording for the LAN', () => {
  const base = { kind: 'dev', framework: 'Redis', ports: [6379], bindings: [{ address: '*', port: 6379 }], cmdline: 'redis-server' };
  assert.deepEqual(advise({ ...base, exposure: exposure('local', 6379) }, net), { risk: null, fixes: [] });
  assert.deepEqual(advise({ ...base, exposure: exposure('firewalled', 6379) }, net), { risk: null, fixes: [] });
  assert.deepEqual(advise({ ...base, kind: 'system', exposure: exposure('internet', 6379) }, net), { risk: null, fixes: [] });
  const lan = advise({ ...base, exposure: exposure('network', 6379) }, { publicIps: [], firewall: null });
  assert.match(lan.risk, /^If someone on your network/);
  assert.ok(!lan.fixes.some((f) => /ssh -L/.test(f.cmd)));
});
