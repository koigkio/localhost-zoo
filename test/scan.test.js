import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLsof, parseSs, splitAddress, parseEtime, detectFramework } from '../src/scan.js';

test('splitAddress handles v4, v6, wildcard and scoped addresses', () => {
  assert.deepEqual(splitAddress('127.0.0.1:3000'), { address: '127.0.0.1', port: 3000 });
  assert.deepEqual(splitAddress('*:5173'), { address: '*', port: 5173 });
  assert.deepEqual(splitAddress('[::1]:8080'), { address: '::1', port: 8080 });
  assert.deepEqual(splitAddress('[::]:22'), { address: '*', port: 22 });
  assert.deepEqual(splitAddress('127.0.0.53%lo:53'), { address: '127.0.0.53', port: 53 });
  assert.equal(splitAddress('garbage'), null);
});

test('parseLsof reads -FpcLn output', () => {
  const out = 'p123\ncnode\nLalice\nf20\nn*:3000\nf21\nn[::1]:3001\np456\ncPython\nLbob\nn127.0.0.1:8000\n';
  assert.deepEqual(parseLsof(out), [
    { pid: 123, command: 'node', user: 'alice', address: '*', port: 3000 },
    { pid: 123, command: 'node', user: 'alice', address: '::1', port: 3001 },
    { pid: 456, command: 'Python', user: 'bob', address: '127.0.0.1', port: 8000 },
  ]);
});

test('parseSs reads ss -ltnpH output, including multiple owners', () => {
  const out = [
    'LISTEN 0      511          0.0.0.0:3000      0.0.0.0:*    users:(("node",pid=901,fd=19))',
    'LISTEN 0      4096       127.0.0.53%lo:53    0.0.0.0:*',
    'LISTEN 0      128             [::]:80           [::]:*    users:(("nginx",pid=10,fd=6),("nginx",pid=11,fd=6))',
  ].join('\n');
  assert.deepEqual(parseSs(out), [
    { pid: 901, command: 'node', address: '*', port: 3000 },
    { pid: null, command: null, address: '127.0.0.53', port: 53 },
    { pid: 10, command: 'nginx', address: '*', port: 80 },
    { pid: 11, command: 'nginx', address: '*', port: 80 },
  ]);
});

test('parseEtime', () => {
  assert.equal(parseEtime('00:05'), 5);
  assert.equal(parseEtime('12:34'), 754);
  assert.equal(parseEtime('01:00:00'), 3600);
  assert.equal(parseEtime('2-03:00:01'), 2 * 86400 + 3 * 3600 + 1);
});

test('detectFramework', () => {
  assert.equal(detectFramework('node /app/node_modules/.bin/vite --port 5173'), 'Vite');
  assert.equal(detectFramework('python3 manage.py runserver'), 'Django');
  assert.equal(detectFramework('/usr/bin/python3 -m http.server 8000'), 'Python http.server');
  assert.equal(detectFramework('bash'), null);
});
