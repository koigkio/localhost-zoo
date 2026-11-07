import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { renderFrame, strWidth, fit } from '../src/top.js';
import { createHandler, TOOLS } from '../src/mcp.js';
import { demoScan } from '../src/demo.js';
import { findEntry } from '../src/scan.js';

test('strWidth / fit handle emoji and truncation', () => {
  assert.equal(strWidth('🦝 zoo'), 6);
  assert.equal(strWidth('\x1b[1mbold\x1b[0m'), 4);
  assert.equal(fit('abc', 5), 'abc  ');
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.equal(strWidth(fit('🐳 redis:7 long name', 8)), 8);
});

test('zoo top frame fits the terminal and shows the essentials', () => {
  for (const [cols, rows] of [[120, 30], [80, 24], [50, 12]]) {
    const state = { data: demoScan(), selectedId: 'docker:3f9a1c2b7d4e', offset: 0, showSystem: false, filter: '', mode: 'list' };
    const lines = renderFrame(state, cols, rows);
    assert.ok(lines.length <= rows, `${lines.length} rows > ${rows}`);
    for (const l of lines) assert.ok(strWidth(l) <= cols, `line wider than ${cols}: ${l}`);
    const text = lines.join('\n');
    assert.match(text, /localhost zoo/);
    assert.match(text, /Open to the internet/);
  }
  const wide = renderFrame({ data: demoScan(), selectedId: null, showSystem: false, filter: '', mode: 'list' }, 140, 30).join('\n');
  for (const s of ['shop-frontend', ':5173', 'firewalled', 'INTERNET', 'redis:7']) assert.ok(wide.includes(s), s);
  const filtered = renderFrame({ data: demoScan(), showSystem: false, filter: 'postgres', mode: 'list' }, 140, 30).join('\n');
  assert.ok(filtered.includes('shop-db-1') && !filtered.includes('shop-frontend'));
  const confirm = demoScan().entries[0];
  assert.match(renderFrame({ data: demoScan(), selectedId: confirm.id, mode: 'confirm', confirm: { entry: confirm, force: false } }, 120, 30).join('\n'), /Stop shop-frontend/);
});

test('findEntry by id, pid and port', () => {
  const { entries } = demoScan();
  assert.equal(findEntry(entries, { id: 'docker:3f9a1c2b7d4e' }).container.name, 'shop-cache-1');
  assert.equal(findEntry(entries, { pid: 41210 }).project.name, 'shop-frontend');
  assert.equal(findEntry(entries, { port: 5432 }).container.name, 'shop-db-1');
  assert.equal(findEntry(entries, { id: 'pid:1' }), null);
});

test('MCP handler: initialize, tools, calls, errors', async () => {
  const handle = createHandler({ demo: true, version: '9.9.9' });
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.version, '9.9.9');
  const odd = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(odd.result.protocolVersion, '2025-06-18');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const tools = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).result.tools;
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(tools.find((t) => t.name === 'stop_server').annotations.destructiveHint, true);

  const call = async (name, args) => (await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).result;
  assert.match((await call('list_servers', {})).content[0].text, /shop-frontend/);
  assert.match((await call('who_is_on_port', { port: 1 })).content[0].text, /free/);
  assert.equal((await call('who_is_on_port', { port: 'x' })).isError, true);
  assert.match((await call('check_exposure', {})).content[0].text, /INTERNET\s+:6379/);

  const unknownTool = await handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(unknownTool.error.code, -32602);
  assert.equal((await handle({ jsonrpc: '2.0', id: 11, method: 'nope' })).error.code, -32601);
});

test('zoo mcp speaks newline-delimited JSON-RPC over stdio', async () => {
  const bin = new URL('../bin/localhost-zoo.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, 'mcp', '--demo'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write('this is not json\n');
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  await new Promise((r) => child.on('close', r));
  const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(msgs[0].result.serverInfo.name, 'localhost-zoo');
  assert.equal(msgs[1].error.code, -32700);
  assert.equal(msgs[2].result.tools.length, 4);
});
