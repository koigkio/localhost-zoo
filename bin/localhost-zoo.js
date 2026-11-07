#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { scan } from '../src/scan.js';
import { demoScan, demoKill } from '../src/demo.js';
import { stopEntry, entryLabel } from '../src/kill.js';

const HELP = `
🦝 localhost-zoo — every dev server on this machine, in one place

Usage
  zoo                     open the dashboard (default)
  zoo top                 live view in the terminal (great over SSH)
  zoo list [--all]        print a table of listening dev servers
  zoo kill <port>         stop whatever is listening on <port>
  zoo mcp                 MCP server for AI agents (Claude Code, Cursor…)
  zoo telegram            Telegram bot: the zoo in your pocket (asks for a bot token)
  zoo telegram service    print a systemd unit to keep the bot running
  zoo telegram --reset    forget the token and the owner
  zoo --json              print the raw scan as JSON

Options
  -p, --port <n>          dashboard port (default 4321)
  -H, --host <addr>       bind address (default 127.0.0.1). Non-loopback
                          addresses require the token printed on start.
      --no-open           don't open a browser
      --demo              fake servers, nothing is stopped (works everywhere)
  -a, --all               include system listeners in "list"
  -f, --force             SIGKILL / docker kill instead of SIGTERM / docker stop
  -v, --version           print the version
  -h, --help              show this help

Remote server?  Use "zoo top" there, or tunnel the dashboard:
  ssh -L 4321:localhost:4321 you@server 'zoo --no-open'
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p', default: '4321' },
      host: { type: 'string', short: 'H', default: '127.0.0.1' },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean' },
      all: { type: 'boolean', short: 'a' },
      force: { type: 'boolean', short: 'f' },
      json: { type: 'boolean' },
      demo: { type: 'boolean' },
      reset: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (err) {
  console.error(`${err.message}\nTry --help.`);
  process.exit(1);
}
const { values: opt, positionals } = parsed;

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c(2, s), bold = (s) => c(1, s), green = (s) => c(32, s), yellow = (s) => c(33, s), red = (s) => c(31, s);

const getScan = (o) => (opt.demo ? Promise.resolve(demoScan()) : scan(o));

async function main() {
  const cmd = positionals[0] || 'serve';
  if (opt.help || cmd === 'help') return console.log(HELP);
  if (opt.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }
  if (opt.json) return console.log(JSON.stringify(await getScan(), null, 2));
  if (cmd === 'list' || cmd === 'ls') return list();
  if (cmd === 'kill') return killPort(positionals[1]);
  if (cmd === 'top') return (await import('../src/top.js')).runTop({ demo: opt.demo });
  if (cmd === 'mcp') return (await import('../src/mcp.js')).runMcp({ demo: opt.demo });
  if (cmd === 'telegram' || cmd === 'tg' || cmd === 'bot') {
    return (await import('../src/telegram.js')).runTelegram({ demo: opt.demo, reset: opt.reset, sub: positionals[1] || null });
  }
  if (cmd === 'serve') return serve();
  console.error(`Unknown command "${cmd}". Try --help.`);
  process.exitCode = 1;
}

function fmtUptime(s) {
  if (s == null) return '';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const REACH_COLOR = { internet: red, network: yellow, firewalled: dim, local: dim };

async function list() {
  const { entries } = await getScan();
  const rows = entries.filter((e) => opt.all || e.kind === 'dev');
  if (!rows.length) return console.log(dim('The zoo is quiet — no dev servers listening.') + (opt.all ? '' : dim(' (use --all for system listeners)')));
  const table = rows.map((e) => ({
    port: e.ports.join(','),
    pid: e.container ? e.container.id.slice(0, 7) : String(e.pid),
    what: e.container?.name || e.project?.name || e.command || '?',
    kind: e.framework || e.project?.lang || '',
    up: fmtUptime(e.uptimeSec),
    reach: e.exposure?.level || 'local',
    where: e.container ? `docker ${e.container.image}` : (e.cwd === '/' ? '' : e.cwd || '').replace(/^\/(Users|home)\/[^/]+/, '~'),
  }));
  const cols = ['port', 'pid', 'what', 'kind', 'up', 'reach', 'where'];
  const w = Object.fromEntries(cols.map((k) => [k, Math.max(k.length, ...table.map((r) => r[k].length))]));
  console.log(cols.map((k, i) => bold(i === cols.length - 1 ? k.toUpperCase() : k.toUpperCase().padEnd(w[k]))).join('  '));
  for (const r of table) {
    console.log([
      green(r.port.padEnd(w.port)), dim(r.pid.padEnd(w.pid)), r.what.padEnd(w.what),
      r.kind.padEnd(w.kind), dim(r.up.padEnd(w.up)), REACH_COLOR[r.reach](r.reach.padEnd(w.reach)), dim(r.where),
    ].join('  '));
  }
  // Warn about dev servers only: sshd or nginx on :22/:443 are usually open on purpose.
  const open = rows.filter((e) => e.kind === 'dev' && e.exposure?.level === 'internet');
  if (open.length) console.log();
  for (const e of open) {
    console.log(red(`⚠ ${e.container?.name || e.project?.name || e.command} is open to the internet: ${e.exposure.reason}`));
    if (e.exposure.risk) console.log(dim(`  ${e.exposure.risk}`));
    const fix = e.exposure.fixes?.[0];
    if (fix) console.log(`  🩹 ${fix.title}:\n${green(fix.cmd.split('\n').map((l) => '     ' + l).join('\n'))}`);
  }
}

async function killPort(arg) {
  const port = Number(arg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Usage: zoo kill <port>');
    return (process.exitCode = 1);
  }
  const { entries } = await getScan({ probe: false });
  const targets = entries.filter((e) => e.ports.includes(port) && !e.self);
  if (!targets.length) return console.log(dim(`Nothing is listening on :${port}.`));
  for (const e of targets) {
    const r = opt.demo ? demoKill(e) : await stopEntry(e, { force: opt.force });
    if (r.ok) console.log(`${green('✔')} ${r.exited ? 'stopped' : `sent ${r.how} to`} ${bold(entryLabel(e))} on :${port}${r.exited ? '' : dim(' — still running, try -f')}`);
    else { console.error(`${red('✘')} ${r.error}`); process.exitCode = 1; }
  }
}

async function serve() {
  const { createZoo } = await import('../src/server.js');
  const zoo = createZoo({ host: opt.host, port: Number(opt.port), demo: opt.demo });
  try {
    await zoo.listen();
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(red(`Port ${opt.port} is taken. Ironic. Try: zoo -p ${Number(opt.port) + 1}`));
      return (process.exitCode = 1);
    }
    throw err;
  }
  const fmt = (h) => `http://${h.includes(':') ? `[${h}]` : h}:${opt.port}/` + (zoo.remote ? `?t=${zoo.token}` : '');
  let hosts = [opt.host === '127.0.0.1' ? 'localhost' : opt.host];
  if (opt.host === '0.0.0.0' || opt.host === '::') {
    hosts = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    if (!hosts.length) hosts = ['127.0.0.1'];
  }
  const url = fmt(hosts[0]);
  console.log(`\n  🦝 ${bold('localhost zoo')}${opt.demo ? yellow(' (demo: fake data, nothing is stopped)') : ''} is open at ${green(url)}`);
  for (const h of hosts.slice(1)) console.log(`                        also ${green(fmt(h))}`);
  console.log();
  if (zoo.remote) {
    console.log(yellow(`  ⚠ Bound to ${opt.host}: anyone with the URL above can stop your processes.`));
    console.log(yellow('    Prefer an SSH tunnel:  ssh -L 4321:localhost:4321 you@server\n'));
  }
  console.log(dim('  Ctrl+C to close the zoo.\n'));

  const noOpen = opt['no-open'] || !opt.open || !process.stdout.isTTY || process.env.SSH_CONNECTION;
  if (!noOpen) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref();
  }
  process.on('SIGINT', () => { console.log(dim('\n  Zoo closed. 🌙')); process.exit(0); });
}

main().catch((err) => {
  console.error(red(err.message));
  process.exitCode = 1;
});
