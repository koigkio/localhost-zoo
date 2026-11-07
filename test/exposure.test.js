import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIp, parseUfw, ufwAllows, classify } from '../src/exposure.js';

test('isPublicIp', () => {
  for (const ip of ['8.8.8.8', '203.0.113.7', '2a01:4f8::1']) assert.ok(isPublicIp(ip), ip);
  for (const ip of ['10.0.0.5', '172.20.1.1', '192.168.1.209', '127.0.0.1', '100.64.0.1', '169.254.1.1', '198.18.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:192.168.0.1'])
    assert.ok(!isPublicIp(ip), ip);
});

const UFW = `Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80,443/tcp (Nginx Full)    ALLOW IN    Anywhere
8000:8100/tcp              ALLOW IN    Anywhere
3000                       ALLOW IN    10.0.0.0/8
5432                       DENY IN     Anywhere
53/udp                     ALLOW IN    Anywhere
22/tcp (v6)                ALLOW IN    Anywhere (v6)
`;

test('parseUfw + ufwAllows', () => {
  const fw = parseUfw(UFW);
  assert.equal(fw.active, true);
  assert.equal(fw.defaultIncoming, 'deny');
  assert.ok(ufwAllows(fw, 22));
  assert.ok(ufwAllows(fw, 443));
  assert.ok(ufwAllows(fw, 8050));
  assert.ok(!ufwAllows(fw, 3000), 'source-restricted rule does not open it to the internet');
  assert.ok(!ufwAllows(fw, 5432));
  assert.ok(!ufwAllows(fw, 53), 'udp rule does not open tcp');
  assert.ok(!ufwAllows(fw, 6379), 'default deny');
  assert.ok(ufwAllows(parseUfw('Status: inactive\n'), 6379));
  assert.equal(parseUfw('ERROR: You need to be root to run this script'), null);
});

test('classify', () => {
  const fw = parseUfw(UFW);
  const pub = { publicIps: ['203.0.113.7'], firewall: fw };
  const e = (bindings, extra = {}) => ({ bindings: bindings.map(([address, port]) => ({ address, port })), ...extra });

  assert.equal(classify(e([['127.0.0.1', 3000]]), pub).level, 'local');
  assert.equal(classify(e([['*', 22]]), pub).level, 'internet');
  assert.equal(classify(e([['*', 6379]]), pub).level, 'firewalled');
  // Docker publishes past ufw.
  const docker = classify(e([['*', 6379]], { container: { id: 'x' } }), pub);
  assert.equal(docker.level, 'internet');
  assert.match(docker.reason, /Docker/);
  // No public IP: at most "network".
  assert.equal(classify(e([['*', 22]]), { publicIps: [], firewall: null }).level, 'network');
  // Public IP, no firewall.
  assert.equal(classify(e([['*', 9000]]), { publicIps: ['203.0.113.7'], firewall: null }).level, 'internet');
  // Bound to a private address only.
  assert.equal(classify(e([['192.168.1.5', 9000]]), { publicIps: ['203.0.113.7'], firewall: null }).level, 'network');
  // Worst port wins, per-port levels kept.
  const mixed = classify(e([['127.0.0.1', 1], ['*', 22]]), pub);
  assert.equal(mixed.level, 'internet');
  assert.deepEqual(mixed.ports, { 1: 'local', 22: 'internet' });
});
