import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDockerPorts, parseDockerPs, parseDockerUptime, isDockerProcess } from '../src/docker.js';

test('parseDockerPorts: published TCP ports, v4/v6 dedupe, ranges, unpublished skipped', () => {
  assert.deepEqual(parseDockerPorts('0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp'), [
    { address: '*', port: 5432, containerPort: 5432 },
  ]);
  assert.deepEqual(parseDockerPorts(':::6379->6379/tcp'), [{ address: '*', port: 6379, containerPort: 6379 }]);
  assert.deepEqual(parseDockerPorts('127.0.0.1:8000-8001->80-81/tcp, 9000/tcp, 0.0.0.0:53->53/udp'), [
    { address: '127.0.0.1', port: 8000, containerPort: 80 },
    { address: '127.0.0.1', port: 8001, containerPort: 81 },
  ]);
  assert.deepEqual(parseDockerPorts(''), []);
});

test('parseDockerPs reads names, images and compose labels', () => {
  const line = JSON.stringify({
    ID: '3f9a1c2b7d4e9999', Names: 'shop-cache-1', Image: 'redis:7', Command: '"docker-entrypoint.sh redis-server"',
    Status: 'Up 2 days', Ports: '0.0.0.0:6379->6379/tcp',
    Labels: 'com.docker.compose.project=shop,com.docker.compose.service=cache,com.docker.compose.project.working_dir=/home/dev/code/shop',
  });
  const [c] = parseDockerPs(line + '\nnot json\n');
  assert.equal(c.id, '3f9a1c2b7d4e');
  assert.equal(c.name, 'shop-cache-1');
  assert.equal(c.command, 'docker-entrypoint.sh redis-server');
  assert.deepEqual(c.compose, { project: 'shop', service: 'cache', workingDir: '/home/dev/code/shop' });
  assert.equal(c.bindings[0].port, 6379);
});

test('parseDockerUptime', () => {
  assert.equal(parseDockerUptime('Up 2 days (healthy)'), 2 * 86400);
  assert.equal(parseDockerUptime('Up About an hour'), 3600);
  assert.equal(parseDockerUptime('Up Less than a second'), 0);
  assert.equal(parseDockerUptime('Exited (0) 3 hours ago'), null);
});

test('isDockerProcess', () => {
  assert.ok(isDockerProcess('docker-proxy'));
  assert.ok(isDockerProcess('com.docker.backend'));
  assert.ok(!isDockerProcess('node', 'node server.js'));
});
