// `zoo telegram` — the zoo in a Telegram chat: every process, who can reach it,
// how to fix it, and Stop buttons. Long polling, no dependencies, no open ports.
//
// Security: a bot answers anyone who finds it, so it is paired with exactly one
// owner. Setup prints a one-time code; the first private chat that sends
// "/start <code>" becomes the owner, and everybody else is turned away.

import { readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { scan, findEntry } from './scan.js';
import { demoScan, demoKill } from './demo.js';
import { stopEntry, entryLabel } from './kill.js';

export const DEFAULT_API = 'https://api.telegram.org';
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

// ---------- config (lives only on this machine) ----------

export function configPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'localhost-zoo', 'telegram.json');
}

export async function loadConfig(file = configPath()) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}

export async function saveConfig(cfg, file = configPath()) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
}

export const isValidToken = (t) => TOKEN_RE.test(String(t || '').trim());

// ---------- Bot API ----------

export class TelegramError extends Error {
  constructor(method, code, description) {
    super(`${method}: ${description} (${code})`);
    this.code = code;
    this.description = description;
  }
}

export function makeApi(token, apiBase = DEFAULT_API) {
  return async function api(method, params = {}, { timeoutMs = 40000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBase}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => ({ ok: false, error_code: res.status, description: res.statusText }));
      if (!body.ok) throw new TelegramError(method, body.error_code ?? res.status, body.description || 'request failed');
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------- rendering ----------

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ANIMALS = {
  PostgreSQL: '🐘', MySQL: '🐬', Redis: '🦊', MongoDB: '🐿', Elasticsearch: '🦌', Docker: '🐳', nginx: '🦬', Jupyter: '🪐', Storybook: '🦜',
  node: '🦖', deno: '🦕', bun: '🐰', python: '🐍', go: '🐹', rust: '🦀', ruby: '🐞', php: '🐘', java: '🦧', elixir: '🦄',
};
const animal = (e) => ANIMALS[e.framework] || ANIMALS[e.project?.lang] || (e.container ? '🐳' : e.kind === 'system' ? '🦉' : '🦝');
const nameOf = (e) => e.container?.name || e.project?.name || e.command || `pid ${e.pid}`;
const up = (s) => s == null ? '' : s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
const mem = (kb) => kb == null ? '' : kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
const home = (p) => (p || '').replace(/^\/(Users|home)\/[^/]+/, '~');
const REACH = { internet: '🌍 <b>INTERNET</b>', network: '🟡 network', firewalled: '🧱 firewalled', local: '🏠 local' };
const MAX_LIST = 30;

function header(d) {
  const net = d.network || {};
  const fw = net.firewall ? `${net.firewall.name} ${net.firewall.active ? 'active' : 'inactive'}` : 'no firewall detected';
  return `🖥 <b>${esc(d.host)}</b> · ${net.publicIps?.length ? `public IP ${esc(net.publicIps[0])} · ${esc(fw)}` : 'private network'}`;
}

export function renderList(d, { showSystem = false } = {}) {
  const dev = d.entries.filter((e) => e.kind === 'dev');
  const list = (showSystem ? d.entries : dev).slice(0, MAX_LIST);
  const lines = [`🦝 <b>localhost zoo</b>${d.demo ? ' <i>(demo)</i>' : ''}`, header(d)];
  const open = dev.filter((e) => e.exposure?.level === 'internet');
  if (open.length) {
    lines.push('', `⚠️ <b>Open to the internet:</b> ${open.map((e) => `${esc(nameOf(e))} ${e.ports.filter((p) => e.exposure.ports[p] === 'internet').map((p) => ':' + p).join(' ')}`).join(', ')}`);
  }
  lines.push('');
  if (!list.length) lines.push(showSystem ? 'Nothing is listening. 🦗' : 'No dev servers running. 🦗');
  for (const e of list) {
    const meta = [e.framework || e.project?.lang, e.unit?.name, e.container?.image && `🐳 ${e.container.image}`, e.uptimeSec != null && `up ${up(e.uptimeSec)}`, mem(e.rssKb)]
      .filter(Boolean).map(esc).join(' · ');
    lines.push(`${animal(e)} <b>${esc(nameOf(e))}</b>  <code>${e.ports.map((p) => ':' + p).join(' ')}</code>  ${REACH[e.exposure?.level || 'local']}`);
    if (meta) lines.push(`      ${meta}`);
  }
  const total = showSystem ? d.entries.length : dev.length;
  if (total > list.length) lines.push(`…and ${total - list.length} more`);
  const hidden = d.entries.length - dev.length;
  if (!showSystem && hidden) lines.push('', `<i>${hidden} system listener${hidden === 1 ? '' : 's'} hidden</i>`);
  lines.push('', '<i>Tap a server for details and Stop.</i>');

  const rows = list.map((e) => [{ text: `${animal(e)} ${nameOf(e)} ${e.ports.map((p) => ':' + p).join(' ')}`.slice(0, 60), callback_data: `e:${e.id}` }]);
  rows.push([
    { text: '🔄 Refresh', callback_data: showSystem ? 'L:1' : 'L:0' },
    { text: showSystem ? '🙈 Hide system' : '👁 Show system', callback_data: showSystem ? 'L:0' : 'L:1' },
    { text: '🌍 Exposure', callback_data: 'x' },
  ]);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}

export function renderEntry(e, { confirm = null } = {}) {
  const lines = [`${animal(e)} <b>${esc(nameOf(e))}</b>`];
  if (e.container) lines.push(`🐳 <code>${esc(e.container.image)}</code> · ${esc(e.container.status)} · container <code>${esc(e.container.id.slice(0, 12))}</code>`);
  else lines.push(`pid <code>${e.pid}</code> · ${esc(e.user || '?')}${e.unit ? ` · ⚙️ <code>${esc(e.unit.name)}</code>` : ''}`);
  const meta = [e.framework, !e.container && e.uptimeSec != null && `up ${up(e.uptimeSec)}`, mem(e.rssKb)].filter(Boolean).map(esc).join(' · ');
  if (meta) lines.push(meta);
  if (e.cwd && e.cwd !== '/') lines.push(`📁 <code>${esc(home(e.cwd))}</code>`);
  lines.push('');
  for (const p of e.ports) {
    const h = e.http?.[p];
    const level = e.exposure?.ports?.[p] || 'local';
    lines.push(`<code>:${p}</code> → ${REACH[level]}${h?.http ? ` · HTTP ${h.status}${h.title ? ` “${esc(h.title)}”` : ''}` : ''}`);
  }
  if (e.exposure && e.exposure.level !== 'local') lines.push(`<i>${esc(e.exposure.reason)}</i>`);
  if (e.exposure?.risk) lines.push('', `⚠️ ${esc(e.exposure.risk)}`);
  for (const f of e.exposure?.fixes || []) lines.push('', `🩹 <b>${esc(f.title)}</b>`, `<pre>${esc(f.cmd)}</pre>`);
  lines.push('', `<code>${esc(String(e.cmdline).slice(0, 400))}</code>`);
  if (e.protected) lines.push('', `🔒 ${esc(e.protected)}`);

  let rows;
  if (confirm) {
    lines.push('', `<b>${confirm === 'force' ? 'Force-stop' : 'Stop'} ${esc(entryLabel(e))}?</b>`);
    rows = [[
      { text: `✅ Yes, ${confirm === 'force' ? 'force-stop' : 'stop'} it`, callback_data: `${confirm === 'force' ? 'Y' : 'y'}:${e.id}` },
      { text: '✖ Cancel', callback_data: `e:${e.id}` },
    ]];
  } else {
    rows = [];
    if (!e.protected && !e.self) {
      const how = e.container ? 'docker stop' : e.unit ? 'systemctl stop' : 'SIGTERM';
      rows.push([{ text: `🛑 Stop (${how})`, callback_data: `s:${e.id}` }, { text: '💀 Force', callback_data: `S:${e.id}` }]);
    }
    rows.push([{ text: '« Back to the zoo', callback_data: 'L:0' }, { text: '🔄', callback_data: `e:${e.id}` }]);
  }
  return { text: lines.join('\n').slice(0, 4000), reply_markup: { inline_keyboard: rows } };
}

export function renderExposure(d) {
  const lines = ['🌍 <b>Who can reach this machine?</b>', header(d), ''];
  const rank = { internet: 0, network: 1, firewalled: 2 };
  const exposed = d.entries.filter((e) => e.exposure && e.exposure.level !== 'local')
    .sort((a, b) => rank[a.exposure.level] - rank[b.exposure.level]);
  if (!exposed.length) lines.push('✅ Everything listens on localhost only.');
  for (const e of exposed) {
    lines.push(`${REACH[e.exposure.level]}  <code>${e.ports.map((p) => ':' + p).join(' ')}</code>  ${animal(e)} <b>${esc(nameOf(e))}</b>`);
    lines.push(`<i>${esc(e.exposure.reason)}</i>`);
    if (e.exposure.risk) lines.push(`⚠️ ${esc(e.exposure.risk)}`);
    const fix = e.exposure.fixes?.[0];
    if (fix) lines.push(`🩹 ${esc(fix.title)}`, `<pre>${esc(fix.cmd)}</pre>`);
    lines.push('');
  }
  return { text: lines.join('\n').slice(0, 4000), reply_markup: { inline_keyboard: [[{ text: '« Back to the zoo', callback_data: 'L:0' }, { text: '🔄', callback_data: 'x' }]] } };
}

const HELP = [
  '🦝 <b>localhost zoo</b>: every server on this machine, right here.',
  '',
  '/list: what is running',
  '/exposure: what the internet can reach, and how to fix it',
  '/port 3000: who is on a port',
  '/help: this message',
  '',
  'Tap any server to see details and stop it.',
].join('\n');

// ---------- the bot ----------

/**
 * @param {{ api: Function, config: object, save: Function, getScan: Function, stop: Function, pairCode?: string, log?: Function }} o
 */
export function createBot({ api, config, save, getScan, stop, pairCode, log = () => {} }) {
  let failedPairs = 0;

  const send = (chatId, view) => api('sendMessage', { chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true, ...view });
  const edit = (msg, view) => api('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', disable_web_page_preview: true, ...view })
    .catch((err) => { if (!/not modified/i.test(err.description || '')) throw err; });

  async function onMessage(m) {
    const from = m.from || {};
    const text = (m.text || '').trim();
    const [cmdRaw, ...args] = text.split(/\s+/);
    const cmd = cmdRaw.replace(/@\w+$/, '').toLowerCase();

    if (!config.ownerId) {
      if (m.chat?.type !== 'private') return;
      if (cmd === '/start' && pairCode && args[0] === pairCode) {
        config.ownerId = from.id;
        config.ownerName = from.username ? `@${from.username}` : from.first_name || String(from.id);
        await save(config);
        log(`✔ Paired with ${config.ownerName}. Only this account can use the bot now.`);
        await send(m.chat.id, { text: `✅ Paired! This bot now answers only you.\n\n${HELP}` });
        return send(m.chat.id, renderList(await getScan()));
      }
      if (cmd === '/start' && args[0]) {
        failedPairs++;
        log(`✘ Wrong pairing code from ${from.username ? '@' + from.username : from.id} (${failedPairs}).`);
      }
      return send(m.chat.id, { text: '🔐 This zoo is not paired yet. Send <code>/start CODE</code> with the code shown in the terminal where <code>zoo telegram</code> runs.' });
    }

    if (from.id !== config.ownerId) {
      log(`⛔ Ignored a message from ${from.username ? '@' + from.username : from.id}.`);
      if (m.chat?.type === 'private') return send(m.chat.id, { text: '⛔ This zoo is private.' });
      return;
    }

    if (cmd === '/start' || cmd === '/list' || cmd === '/zoo') return send(m.chat.id, renderList(await getScan()));
    if (cmd === '/all') return send(m.chat.id, renderList(await getScan(), { showSystem: true }));
    if (cmd === '/exposure') return send(m.chat.id, renderExposure(await getScan({ probe: false })));
    if (cmd === '/port') {
      const port = Number(args[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return send(m.chat.id, { text: 'Usage: <code>/port 3000</code>' });
      const d = await getScan();
      const e = findEntry(d.entries, { port });
      return send(m.chat.id, e ? renderEntry(e) : { text: `✅ Port <code>${port}</code> is free.` });
    }
    if (/^\d{1,5}$/.test(cmd)) return onMessage({ ...m, text: `/port ${cmd}` }); // just "3000"
    return send(m.chat.id, { text: HELP });
  }

  async function onCallback(q) {
    const msg = q.message;
    if (!config.ownerId || q.from?.id !== config.ownerId) {
      return api('answerCallbackQuery', { callback_query_id: q.id, text: '⛔ This zoo is private.', show_alert: true });
    }
    const data = q.data || '';
    const [kind, ...rest] = data.split(':');
    const id = rest.join(':');
    let toast = '';

    if (kind === 'L') await edit(msg, renderList(await getScan(), { showSystem: id === '1' }));
    else if (kind === 'x') await edit(msg, renderExposure(await getScan({ probe: false })));
    else if (kind === 'e' || kind === 's' || kind === 'S') {
      const d = await getScan();
      const e = findEntry(d.entries, { id });
      if (!e) { toast = 'It is gone already.'; await edit(msg, renderList(d)); }
      else await edit(msg, renderEntry(e, { confirm: kind === 's' ? 'stop' : kind === 'S' ? 'force' : null }));
    } else if (kind === 'y' || kind === 'Y') {
      // Re-scan right before stopping, so a recycled PID is never hit.
      const d = await getScan({ probe: false });
      const e = findEntry(d.entries, { id });
      if (!e) toast = 'It is gone already.';
      else {
        const r = await stop(e, { force: kind === 'Y' });
        toast = r.ok ? (r.exited ? `Released ${entryLabel(e)} 🌿` : `Sent ${r.how}, still running. Try Force.`) : r.error;
        log(`${r.ok ? '🛑' : '✘'} ${config.ownerName || 'owner'}: ${entryLabel(e)} → ${r.ok ? r.how : r.error}`);
      }
      await edit(msg, renderList(await getScan()));
    }
    return api('answerCallbackQuery', { callback_query_id: q.id, ...(toast ? { text: toast.slice(0, 190), show_alert: toast.length > 60 } : {}) });
  }

  async function handleUpdate(u) {
    try {
      if (u.message) await onMessage(u.message);
      else if (u.callback_query) await onCallback(u.callback_query);
    } catch (err) {
      log(`✘ ${err.message}`);
    }
  }

  return { handleUpdate };
}

// ---------- CLI entry ----------

function askSecret(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf) => {
      for (const ch of buf.toString()) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); return resolve(value.trim()); }
        if (ch === '\x03') { stdout.write('\n'); process.exit(130); }
        if (ch === '\x7f' || ch === '\b') { if (value) { value = value.slice(0, -1); stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { value += ch; stdout.write('•'); }
      }
    };
    stdin.on('data', onData);
  });
}

export function serviceUnit({ execPath = process.execPath, script = process.argv[1], user = os.userInfo().username, homeDir = os.homedir() } = {}) {
  return `[Unit]
Description=localhost-zoo Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${execPath} ${script} telegram
Restart=always
RestartSec=5
User=${user}
Environment=HOME=${homeDir}

[Install]
WantedBy=multi-user.target
`;
}

export async function runTelegram({ demo = false, reset = false, sub = null } = {}) {
  const say = (s) => console.log(s);
  const file = configPath();

  if (sub === 'service') {
    say(serviceUnit());
    say(`# Save it and start it:\n#   zoo telegram service | sudo tee /etc/systemd/system/zoo-bot.service\n#   sudo systemctl enable --now zoo-bot`);
    return;
  }
  if (reset) {
    await rm(file, { force: true });
    return say(`Removed ${file}. Run "zoo telegram" to set the bot up again.`);
  }

  const config = await loadConfig(file);
  if (process.env.ZOO_TELEGRAM_TOKEN) config.token = process.env.ZOO_TELEGRAM_TOKEN.trim();

  if (!config.token) {
    if (!process.stdin.isTTY) {
      console.error('No bot token yet. Run "zoo telegram" once in a terminal, or set ZOO_TELEGRAM_TOKEN.');
      process.exitCode = 1;
      return;
    }
    say('\n🦝 localhost-zoo Telegram bot setup\n');
    say('  1. In Telegram, open @BotFather and send /newbot.');
    say('  2. Pick a name and a username for your bot.');
    say('  3. BotFather replies with a token like 123456789:AAH… — paste it below.\n');
    for (;;) {
      const token = await askSecret('  Bot token: ');
      if (!isValidToken(token)) { say('  That does not look like a bot token. Try again.\n'); continue; }
      try {
        const me = await makeApi(token)('getMe');
        config.token = token;
        config.username = me.username;
        break;
      } catch (err) {
        say(`  Telegram did not accept it: ${err.description || err.message}. Try again.\n`);
      }
    }
    await saveConfig(config, file);
    say(`\n  ✔ Connected to @${config.username}`);
    say(`  ✔ Saved to ${file} (only you can read it)`);
  }

  const api = makeApi(config.token, process.env.ZOO_TELEGRAM_API || DEFAULT_API);
  let me;
  try {
    me = await api('getMe');
  } catch (err) {
    console.error(`Telegram rejected the token: ${err.description || err.message}. Run "zoo telegram --reset" and set it up again.`);
    process.exitCode = 1;
    return;
  }

  const pairCode = config.ownerId ? null : randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  if (pairCode) {
    say(`\n  Now open https://t.me/${me.username} and send:\n\n      /start ${pairCode}\n\n  The first account that sends this code becomes the owner. Nobody else can use the bot.`);
  }

  await api('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
  await api('setMyCommands', {
    commands: [
      { command: 'list', description: 'What is running' },
      { command: 'exposure', description: 'What the internet can reach' },
      { command: 'port', description: 'Who is on a port: /port 3000' },
      { command: 'help', description: 'How to use the zoo' },
    ],
  }).catch(() => {});

  const getScan = (o) => (demo ? Promise.resolve(demoScan()) : scan(o));
  const stop = (e, o) => (demo ? Promise.resolve(demoKill(e)) : stopEntry(e, o));
  const bot = createBot({ api, config, save: (c) => saveConfig(c, file), getScan, stop, pairCode, log: (s) => say(`  ${s}`) });

  say(`\n  🦝 @${me.username} is running${demo ? ' (demo data)' : ''}${config.ownerId ? `, owner ${config.ownerName}` : ''}. Ctrl+C to stop.\n`);
  if (!pairCode) say('  To change the owner: zoo telegram --reset\n');

  let offset = 0, backoff = 1000;
  process.on('SIGINT', () => { say('\n  Bot stopped. 🌙'); process.exit(0); });
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: 40000 });
      backoff = 1000;
      for (const u of updates) {
        offset = u.update_id + 1;
        await bot.handleUpdate(u);
      }
    } catch (err) {
      if (err.code === 401) { console.error('Telegram says the token is no longer valid. Run "zoo telegram --reset".'); process.exit(1); }
      if (err.code === 409) say('  Another copy of this bot is already running somewhere. Retrying…');
      else if (err.name !== 'AbortError') say(`  Connection problem: ${err.message}. Retrying in ${backoff / 1000}s…`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}
