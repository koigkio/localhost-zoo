import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const bin = new URL('../bin/localhost-zoo.js', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('--version prints the package version', () => {
  assert.equal(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim(), pkg.version);
});

test('--help mentions every command', () => {
  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  for (const word of ['list', 'kill', 'disk', 'top', 'mcp', 'telegram', '--json', '--demo', '--version']) assert.ok(help.includes(word), word);
});
