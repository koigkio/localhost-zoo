import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createBot, renderList, renderEntry, renderExposure, isValidToken, saveConfig, loadConfig, serviceUnit } from '../src/telegram.js';
import { demoScan, demoKill } from '../src/demo.js';

const FAKE_TOKEN = '123456789:' + 'A'.repeat(35); // shape of a token, not a real one
const OWNER = { id: 42, username: 'owner', first_name: 'Owner' };
const STRANGER = { id: 666, username: 'stranger' };

function harness({ ownerId } = {}) {
  const calls = [];
  const api = async (method, params) => { calls.push({ method, params }); return { message_id: calls.length }; };
  const config = { token: FAKE_TOKEN, ...(ownerId ? { ownerId, ownerName: '@owner' } : {}) };
  let saved = null;
  const stops = [];
  const bot = createBot({
    api, config, pairCode: 'Ab3dE6gH',
    save: async (c) => { saved = { ...c }; },
    getScan: async () => demoScan(),
    stop: async (e, o) => { stops.push([e.id, o.force]); return { ok: true, exited: true, how: 'test' }; },
  });
  const msg = (from, text) => bot.handleUpdate({ update_id: 1, message: { message_id: 1, from, chat: { id: from.id, type: 'private' }, text } });
  const tap = (from, data) => bot.handleUpdate({ update_id: 2, callback_query: { id: 'q', from, data, message: { message_id: 7, chat: { id: from.id } } } });
  const last = (method) => [...calls].reverse().find((c) => c.method === method)?.params;
  return { calls, config, get saved() { return saved; }, stops, msg, tap, last };
}

test('token shape check', () => {
  assert.ok(isValidToken(FAKE_TOKEN));
  for (const bad of ['', 'abc', '123:short', 'hello world']) assert.ok(!isValidToken(bad), bad);
});

test('pairing: wrong code is refused, right code makes the sender the only owner', async () => {
  const h = harness();
  await h.msg(OWNER, '/list');
  assert.match(h.last('sendMessage').text, /not paired/);
  await h.msg(STRANGER, '/start 00000000');
  assert.equal(h.config.ownerId, undefined);
  await h.msg(OWNER, '/start Ab3dE6gH');
  assert.equal(h.config.ownerId, 42);
  assert.equal(h.saved.ownerId, 42);
  assert.match(h.calls.find((c) => c.method === 'sendMessage' && /Paired/.test(c.params.text)).params.text, /answers only you/);
  // After pairing, the code is useless to anyone else.
  await h.msg(STRANGER, '/start Ab3dE6gH');
  assert.equal(h.config.ownerId, 42);
  assert.match(h.last('sendMessage').text, /private/);
});

test('strangers get nothing: no list, no buttons', async () => {
  const h = harness({ ownerId: 42 });
  await h.msg(STRANGER, '/list');
  assert.match(h.last('sendMessage').text, /private/);
  await h.tap(STRANGER, 'y:docker:3f9a1c2b7d4e');
  assert.equal(h.stops.length, 0);
  assert.equal(h.last('answerCallbackQuery').show_alert, true);
});

test('owner: list, details, confirm, stop', async () => {
  const h = harness({ ownerId: 42 });
  await h.msg(OWNER, '/list');
  const list = h.last('sendMessage');
  assert.equal(list.parse_mode, 'HTML');
  assert.match(list.text, /Open to the internet/);
  assert.match(list.text, /shop-cache-1/);
  const buttons = list.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'e:docker:3f9a1c2b7d4e'));
  for (const b of buttons) assert.ok(Buffer.byteLength(b.callback_data) <= 64);

  await h.tap(OWNER, 'e:docker:3f9a1c2b7d4e');
  const detail = h.last('editMessageText');
  assert.match(detail.text, /crypto-mining/);
  assert.match(detail.text, /127\.0\.0\.1:6379:6379/);

  await h.tap(OWNER, 's:docker:3f9a1c2b7d4e');
  assert.match(h.last('editMessageText').text, /Stop shop-cache-1/);
  assert.equal(h.stops.length, 0, 'nothing is stopped before confirming');

  await h.tap(OWNER, 'y:docker:3f9a1c2b7d4e');
  assert.deepEqual(h.stops, [['docker:3f9a1c2b7d4e', false]]);
  assert.match(h.last('answerCallbackQuery').text, /Released/);

  await h.tap(OWNER, 'Y:pid:41210');
  assert.deepEqual(h.stops[1], ['pid:41210', true]);
});

test('owner: /port, bare number, /exposure, help', async () => {
  const h = harness({ ownerId: 42 });
  await h.msg(OWNER, '/port 6379');
  assert.match(h.last('sendMessage').text, /shop-cache-1/);
  await h.msg(OWNER, '1');
  assert.match(h.last('sendMessage').text, /is free/);
  await h.msg(OWNER, '/port nope');
  assert.match(h.last('sendMessage').text, /Usage/);
  await h.msg(OWNER, '/exposure');
  assert.match(h.last('sendMessage').text, /INTERNET/);
  await h.msg(OWNER, 'hello');
  assert.match(h.last('sendMessage').text, /\/list/);
});

test('renderers: protected entries have no Stop, HTML is escaped, size limits hold', () => {
  const d = demoScan();
  const sshd = d.entries.find((e) => e.command === 'sshd');
  const v = renderEntry(sshd);
  assert.match(v.text, /lock you out/);
  assert.ok(!v.reply_markup.inline_keyboard.flat().some((b) => /^[sS]:/.test(b.callback_data)));
  const tricky = { ...d.entries[0], cmdline: '<script>alert(1)</script>' };
  assert.ok(!renderEntry(tricky).text.includes('<script>'));
  for (const view of [renderList(d), renderList(d, { showSystem: true }), renderExposure(d), ...d.entries.map((e) => renderEntry(e))]) {
    assert.ok(view.text.length <= 4096);
  }
  assert.ok(demoKill(sshd).ok === false, 'demo also refuses protected entries');
});

test('config is saved with owner-only permissions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zoo-tg-'));
  const file = path.join(dir, 'sub', 'telegram.json');
  await saveConfig({ token: FAKE_TOKEN, ownerId: 1 }, file);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await loadConfig(file)).ownerId, 1);
  await rm(dir, { recursive: true, force: true });
});

test('systemd unit runs "zoo telegram" and restarts', () => {
  const unit = serviceUnit({ execPath: '/usr/bin/node', script: '/usr/lib/node_modules/localhost-zoo/bin/localhost-zoo.js', user: 'root', homeDir: '/root' });
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/usr\/lib\/node_modules\/localhost-zoo\/bin\/localhost-zoo\.js telegram/);
  assert.match(unit, /Restart=always/);
});

test('end to end: zoo telegram talks to a fake Telegram server, pairs and answers', async () => {
  const sent = [];
  const queue = [];
  let waiting = null;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const params = body ? JSON.parse(body) : {};
    const method = req.url.split('/').pop();
    assert.ok(req.url.startsWith(`/bot${FAKE_TOKEN}/`));
    const reply = (result) => res.end(JSON.stringify({ ok: true, result }));
    if (method === 'getMe') return reply({ id: 1, is_bot: true, username: 'zoo_test_bot' });
    if (method === 'getUpdates') {
      const take = () => reply(queue.splice(0).filter((u) => u.update_id >= (params.offset || 0)));
      if (queue.length) return take();
      waiting = take;
      setTimeout(() => { if (waiting === take) { waiting = null; reply([]); } }, 300);
      return;
    }
    if (method === 'sendMessage') sent.push(params);
    reply(true);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zoo-tg-e2e-'));
  const bin = new URL('../bin/localhost-zoo.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, 'telegram', '--demo'], {
    env: { ...process.env, XDG_CONFIG_HOME: dir, ZOO_TELEGRAM_TOKEN: FAKE_TOKEN, ZOO_TELEGRAM_API: `http://127.0.0.1:${server.address().port}` },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const until = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`timed out; output:\n${out}`);
  };
  try {
    await until(() => /\/start (\w{8})/.test(out));
    const code = out.match(/\/start (\w{8})/)[1];
    const push = (update) => { queue.push(update); if (waiting) { const w = waiting; waiting = null; w(); } };
    push({ update_id: 10, message: { message_id: 1, from: OWNER, chat: { id: 42, type: 'private' }, text: `/start ${code}` } });
    await until(() => sent.some((m) => /Paired/.test(m.text)) && sent.some((m) => /localhost zoo/.test(m.text)));
    const cfg = JSON.parse(await readFile(path.join(dir, 'localhost-zoo', 'telegram.json'), 'utf8'));
    assert.equal(cfg.ownerId, 42);
    assert.equal((await stat(path.join(dir, 'localhost-zoo', 'telegram.json'))).mode & 0o777, 0o600);
    push({ update_id: 11, message: { message_id: 2, from: STRANGER, chat: { id: 666, type: 'private' }, text: '/list' } });
    await until(() => sent.some((m) => m.chat_id === 666 && /private/.test(m.text)));
    assert.ok(!sent.some((m) => m.chat_id === 666 && /shop-cache/.test(m.text)), 'strangers never see the zoo');
  } finally {
    child.kill();
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
