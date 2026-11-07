// `zoo top` — the zoo in your terminal, htop-style. Made for SSH sessions.
// No dependencies: raw-mode stdin + ANSI escape codes.

import { scan } from './scan.js';
import { demoScan, demoKill } from './demo.js';
import { stopEntry, entryLabel } from './kill.js';

const ESC = '\x1b[';
const A = { reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`, inv: `${ESC}7m`, red: `${ESC}31m`, green: `${ESC}32m`, yellow: `${ESC}33m`, cyan: `${ESC}36m` };

const ANIMALS = {
  PostgreSQL: '🐘', MySQL: '🐬', Redis: '🦊', MongoDB: '🐿', Elasticsearch: '🦌', Docker: '🐳', nginx: '🦬', Jupyter: '🪐', Storybook: '🦜',
  node: '🦖', deno: '🦕', bun: '🐰', python: '🐍', go: '🐹', rust: '🦀', ruby: '🐞', php: '🐘', java: '🦧', elixir: '🦄',
};
export const animalFor = (e) => ANIMALS[e.framework] || ANIMALS[e.project?.lang] || (e.container ? '🐳' : e.kind === 'system' ? '🦉' : '🦝');

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

/** Display width in terminal cells (emoji count as 2). */
export function strWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || cp === 0x200d || (cp >= 0x300 && cp <= 0x36f)) continue;
    w += cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xff00 && cp <= 0xff60) ? 2 : 1;
  }
  return w;
}

/** Cut or pad plain text to exactly `width` cells. */
export function fit(s, width) {
  s = String(s ?? '');
  if (width <= 0) return '';
  if (strWidth(s) <= width) return s + ' '.repeat(width - strWidth(s));
  let out = '';
  for (const ch of s) {
    if (strWidth(out + ch) > width - 1) break;
    out += ch;
  }
  return out + '…' + ' '.repeat(Math.max(0, width - strWidth(out) - 1));
}

/** Cut a line with ANSI colors to `width` visible cells, keeping the escape codes intact. */
export function clip(s, width) {
  if (strWidth(s) <= width) return s;
  let out = '', w = 0;
  for (let i = 0; i < s.length;) {
    const m = s.slice(i).match(/^\x1b\[[0-9;?]*[a-zA-Z]/);
    if (m) { out += m[0]; i += m[0].length; continue; }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const cw = strWidth(ch);
    if (w + cw > width) break;
    out += ch; w += cw; i += ch.length;
  }
  return out + A.reset;
}

const uptime = (s) => s == null ? '' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
const memory = (kb) => kb == null ? '' : kb >= 1048576 ? `${(kb / 1048576).toFixed(1)}G` : `${Math.round(kb / 1024)}M`;
const home = (p) => (p || '').replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^\/root(?=\/|$)/, '~');
const REACH = { internet: [A.red + A.bold, 'INTERNET'], network: [A.yellow, 'network'], firewalled: [A.dim, 'firewalled'], local: [A.dim, 'local'] };

export function visibleEntries(data, { showSystem, filter }) {
  const q = (filter || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (data?.entries || []).filter((e) => {
    if (!showSystem && e.kind !== 'dev' && !q.length) return false;
    const hay = [e.ports.join(' '), e.command, e.cmdline, e.cwd, e.project?.name, e.framework, e.container?.name, e.container?.image, e.pid]
      .join(' ').toLowerCase();
    return q.every((w) => hay.includes(w));
  });
}

/**
 * Pure renderer: state → array of lines, each at most `cols` cells wide.
 * state: { data, selectedId, offset, showSystem, filter, mode: 'list'|'filter'|'confirm', confirm, message }
 */
export function renderFrame(state, cols, rows) {
  const lines = [];
  const d = state.data;
  const push = (s = '') => lines.push(s);
  const list = visibleEntries(d, state);
  const dev = (d?.entries || []).filter((e) => e.kind === 'dev');

  // Header
  const net = d?.network;
  const netText = !d ? '' : net?.publicIps?.length
    ? `public IP ${net.publicIps[0]} · ${net.firewall ? `${net.firewall.name} ${net.firewall.active ? 'active' : 'inactive'}` : 'no firewall detected'}`
    : 'private network';
  const left = ` 🦝 localhost zoo${d ? ` — ${d.host}` : ''}`;
  // Shrink the right side before ever hiding the name.
  const options = d ? [`${dev.length} dev · ${d.entries.length - dev.length} system   ${netText} `, `${dev.length} dev · ${d.entries.length - dev.length} system `, ''] : ['scanning… ', ''];
  const right = options.find((r) => strWidth(left) + strWidth(r) + 1 <= cols) ?? '';
  push(A.inv + A.bold + fit(left, Math.max(0, cols - strWidth(right))) + fit(right, Math.min(cols, strWidth(right))) + A.reset);

  const open = dev.filter((e) => e.exposure?.level === 'internet');
  if (open.length) {
    const what = open.map((e) => `${e.container?.name || e.project?.name || e.command} ${e.ports.filter((p) => e.exposure.ports[p] === 'internet').map((p) => ':' + p).join(' ')}`).join(', ');
    push(A.red + A.bold + fit(` ⚠ Open to the internet: ${what}`, cols) + A.reset);
  }
  push('');

  // Table
  const W = { port: 13, name: 22, kind: 12, up: 5, mem: 6, reach: 10 };
  const fixed = 4 + W.port + W.name + W.kind + W.up + W.mem + W.reach + 7;
  const whereW = Math.max(0, cols - fixed);
  push(A.dim + fit(`    ${fit('PORT', W.port)} ${fit('NAME', W.name)} ${fit('KIND', W.kind)} ${fit('UP', W.up)} ${fit('MEM', W.mem)} ${fit('REACH', W.reach)} WHERE`, cols) + A.reset);

  const detailRows = 4;
  const footerRows = 2;
  const listRows = Math.max(1, rows - lines.length - detailRows - footerRows);
  const selIndex = Math.max(0, list.findIndex((e) => e.id === state.selectedId));
  let offset = Math.min(state.offset || 0, Math.max(0, list.length - listRows));
  if (selIndex < offset) offset = selIndex;
  if (selIndex >= offset + listRows) offset = selIndex - listRows + 1;
  state.offset = offset;

  if (!list.length) {
    push(A.dim + fit(d ? (state.filter ? `   No animal matches "${state.filter}".` : '   The zoo is quiet. Start a dev server and it shows up here.') : '   Rounding up the animals…', cols) + A.reset);
    for (let i = 1; i < listRows; i++) push('');
  } else {
    for (let i = 0; i < listRows; i++) {
      const e = list[offset + i];
      if (!e) { push(''); continue; }
      const sel = offset + i === selIndex;
      const [color, label] = REACH[e.exposure?.level || 'local'];
      const name = e.container?.name || e.project?.name || e.command || `pid ${e.pid}`;
      const kind = e.framework || e.project?.lang || (e.kind === 'system' ? 'system' : '');
      const row = `${sel ? '▸' : ' '} ${animalFor(e)} ${fit(e.ports.map((p) => ':' + p).join(' '), W.port)} ${fit(name, W.name)} ${fit(kind, W.kind)} ${fit(uptime(e.uptimeSec), W.up)} ${fit(memory(e.rssKb), W.mem)} `;
      const where = fit(e.container ? `🐳 ${e.container.image}` : home(e.cwd === '/' ? '' : e.cwd), whereW);
      const reach = fit(label, W.reach);
      const rowW = strWidth(row);
      if (sel) push(A.inv + fit(row + reach + ' ' + where, cols) + A.reset);
      else push(fit(row, Math.min(cols, rowW)) + (cols > rowW ? color + fit(reach, Math.min(W.reach, cols - rowW)) + A.reset + fit(' ' + where, Math.max(0, cols - rowW - W.reach)) : ''));
    }
  }

  // Details of the selected entry
  const s = list[selIndex];
  push(A.dim + '─'.repeat(cols) + A.reset);
  if (s) {
    const titles = Object.values(s.http || {}).map((h) => h.title).filter(Boolean);
    const http = Object.entries(s.http || {}).filter(([, h]) => h.http).map(([p, h]) => `:${p} ${h.status}`).join('  ');
    const who = s.container ? `container ${s.container.id} · ${s.container.status}` : `pid ${s.pid} · ${s.user || '?'}${s.unit ? ` · ${s.unit.name}` : ''}`;
    push(fit(` ${who}  ${s.cmdline}`, cols));
    const reach = s.exposure ? `${s.exposure.level}: ${s.exposure.reason}` : '';
    push(fit(` ${http ? 'http ' + http + (titles[0] ? ` “${titles[0]}”` : '') + '  ·  ' : ''}${reach}`, cols));
    const fix = s.exposure?.fixes?.[0];
    if (s.protected) push(A.yellow + fit(` 🔒 ${s.protected}`, cols) + A.reset);
    else if (fix) push(A.green + fit(` 🩹 ${fix.title}: ${fix.cmd.split('\n').filter((l) => !l.startsWith('#')).join(' ⏎ ')}`, cols) + A.reset);
    else push('');
  } else { push(''); push(''); push(''); }

  // Footer
  push(A.dim + '─'.repeat(cols) + A.reset);
  let footer;
  if (state.mode === 'confirm' && state.confirm) {
    footer = `${A.red}${A.bold} ${state.confirm.force ? 'Force-stop' : 'Stop'} ${entryLabel(state.confirm.entry)}? ${A.reset}${A.bold}y${A.reset} yes  ${A.bold}n${A.reset} no`;
  } else if (state.mode === 'filter') {
    footer = ` ${A.cyan}/${A.reset}${state.filter}█   ${A.dim}Enter apply · Esc clear${A.reset}`;
  } else if (state.message) {
    footer = ` ${state.message}`;
  } else {
    const k = (key, what) => `${A.bold}${key}${A.reset}${A.dim} ${what}${A.reset}`;
    footer = ` ${k('↑↓', 'move')}  ${k('s', 'stop')}  ${k('S', 'force')}  ${k('/', 'filter')}  ${k('a', state.showSystem ? 'hide system' : 'show system')}  ${k('r', 'refresh')}  ${k('q', 'quit')}${state.filter ? `   ${A.cyan}filter: ${state.filter}${A.reset}` : ''}`;
  }
  push(footer);

  return lines.slice(0, rows).map((l) => clip(l, cols));
}

export async function runTop({ demo = false, interval = 2000 } = {}) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('zoo top needs an interactive terminal. Try `zoo list` instead.');
    process.exitCode = 1;
    return;
  }

  const state = { data: null, selectedId: null, offset: 0, showSystem: false, filter: '', mode: 'list', confirm: null, message: '' };
  let messageTimer, timer;
  const say = (msg) => { state.message = msg; clearTimeout(messageTimer); messageTimer = setTimeout(() => { state.message = ''; draw(); }, 3500); draw(); };

  const draw = () => {
    const cols = stdout.columns || 100, rows = stdout.rows || 30;
    const list = visibleEntries(state.data, state);
    if (list.length && !list.some((e) => e.id === state.selectedId)) state.selectedId = list[0].id;
    const frame = renderFrame(state, cols, rows);
    stdout.write(`${ESC}H` + frame.map((l) => l + `${ESC}K`).join('\r\n') + `${ESC}J`);
  };

  let busy = false;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try { state.data = demo ? demoScan() : await scan(); } catch (err) { say(`${A.red}${err.message}${A.reset}`); }
    busy = false;
    draw();
  };

  const move = (delta) => {
    const list = visibleEntries(state.data, state);
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((e) => e.id === state.selectedId));
    state.selectedId = list[Math.min(list.length - 1, Math.max(0, i + delta))].id;
    draw();
  };

  const quit = () => {
    clearInterval(timer);
    stdout.write(`${ESC}?25h${ESC}?1049l`);
    stdin.setRawMode(false);
    process.exit(0);
  };

  stdin.on('data', async (buf) => {
    const key = buf.toString();
    if (key === '\x03') return quit(); // Ctrl-C always works

    if (state.mode === 'filter') {
      if (key === '\r') state.mode = 'list';
      else if (key === '\x1b') { state.filter = ''; state.mode = 'list'; }
      else if (key === '\x7f' || key === '\b') state.filter = state.filter.slice(0, -1);
      else if (key >= ' ' && !key.startsWith('\x1b')) state.filter += key;
      return draw();
    }

    if (state.mode === 'confirm') {
      const { entry, force } = state.confirm;
      state.mode = 'list'; state.confirm = null;
      if (key.toLowerCase() !== 'y') return draw();
      say(`Stopping ${entryLabel(entry)}…`);
      const r = demo ? demoKill(entry) : await stopEntry(entry, { force });
      say(r.ok ? (r.exited ? `${A.green}Released ${entryLabel(entry)} back into the wild 🌿${A.reset}` : `${A.yellow}Sent ${r.how}, still running — press S to force.${A.reset}`) : `${A.red}${r.error}${A.reset}`);
      return refresh();
    }

    switch (key) {
      case 'q': case '\x1b': return quit();
      case '\x1b[A': case 'k': return move(-1);
      case '\x1b[B': case 'j': return move(1);
      case '\x1b[5~': return move(-10);
      case '\x1b[6~': return move(10);
      case 'g': case '\x1b[H': return move(-1e6);
      case 'G': case '\x1b[F': return move(1e6);
      case '/': state.mode = 'filter'; return draw();
      case 'a': state.showSystem = !state.showSystem; return draw();
      case 'r': return refresh();
      case 's': case 'S': case 'x': {
        const entry = visibleEntries(state.data, state).find((e) => e.id === state.selectedId);
        if (!entry) return;
        if (entry.self) return say("That's the zoo itself.");
        if (entry.protected) return say(`${A.yellow}🔒 ${entry.protected}${A.reset}`);
        state.mode = 'confirm'; state.confirm = { entry, force: key === 'S' };
        return draw();
      }
    }
  });

  stdout.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.on('resize', draw);
  process.on('SIGTERM', quit);
  draw();
  await refresh();
  timer = setInterval(() => { if (state.mode !== 'confirm') refresh(); }, interval);
}
