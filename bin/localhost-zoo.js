#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { scan } from '../src/scan.js';
import { createZoo } from '../src/server.js';

const HELP = `
🦝 localhost-zoo — every dev server on this machine, in one place

Usage
  zoo                     open the dashboard (default)
  zoo list [--all]        print a table of listening dev servers
  zoo kill <port>         stop whatever is listening on <port>
  zoo --json              print the raw scan as JSON

Options
  -p, --port <n>          dashboard port (default 4321)
  -H, --host <addr>       bind address (default 127.0.0.1). Non-loopback
                          addresses require the token printed on start.
      --no-open           don't open a browser
      --demo              dashboard with fake servers (nothing is killed)
  -a, --all               include system listeners in "list"
  -f, --force             use SIGKILL instead of SIGTERM for "kill"
  -v, --version           print the version
  -h, --help              show this help

Remote server?  Run it there and tunnel the port:
  ssh -L 4321:localhost:4321 you@server 'npx localhost-zoo --no-open'
`;

const { values: opt, positionals } = parseArgs({
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
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c(2, s), bold = (s) => c(1, s), green = (s) => c(32, s), yellow = (s) => c(33, s), red = (s) => c(31, s);

async function main() {
  const cmd = positionals[0] || 'serve';
  if (opt.help || cmd === 'help') return console.log(HELP);
  if (opt.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }
  if (opt.json) return console.log(JSON.stringify(await scan(), null, 2));
  if (cmd === 'list' || cmd === 'ls') return list();
  if (cmd === 'kill') return killPort(positionals[1]);
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

async function list() {
  const { entries } = await scan();
  const rows = entries.filter((e) => opt.all || e.kind === 'dev');
  if (!rows.length) return console.log(dim('The zoo is quiet — no dev servers listening.') + (opt.all ? '' : dim(' (use --all for system listeners)')));
  const table = rows.map((e) => ({
    port: e.ports.join(','),
    pid: String(e.pid),
    what: e.project?.name || e.command || '?',
    kind: e.framework || e.project?.lang || '',
    up: fmtUptime(e.uptimeSec),
    where: (e.cwd || '').replace(/^\/(Users|home)\/[^/]+/, '~'),
    exposed: e.exposed,
  }));
  const cols = ['port', 'pid', 'what', 'kind', 'up', 'where'];
  const w = Object.fromEntries(cols.map((k) => [k, Math.max(k.length, ...table.map((r) => r[k].length))]));
  console.log(cols.map((k, i) => bold(i === cols.length - 1 ? k.toUpperCase() : k.toUpperCase().padEnd(w[k]))).join('  '));
  for (const r of table) {
    console.log([
      (r.exposed ? yellow : green)(r.port.padEnd(w.port)), dim(r.pid.padEnd(w.pid)), r.what.padEnd(w.what),
      r.kind.padEnd(w.kind), dim(r.up.padEnd(w.up)), dim(r.where),
    ].join('  '));
  }
  if (table.some((r) => r.exposed)) console.log(yellow('\n⚠ yellow ports listen on all interfaces and are reachable from your network.'));
}

async function killPort(arg) {
  const port = Number(arg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Usage: zoo kill <port>');
    return (process.exitCode = 1);
  }
  const { entries } = await scan({ probe: false });
  const targets = entries.filter((e) => e.ports.includes(port) && !e.self);
  if (!targets.length) return console.log(dim(`Nothing is listening on :${port}.`));
  const signal = opt.force ? 'SIGKILL' : 'SIGTERM';
  for (const e of targets) {
    try {
      process.kill(e.pid, signal);
      console.log(`${green('✔')} sent ${signal} to ${bold(e.project?.name || e.command)} ${dim(`(pid ${e.pid})`)} on :${port}`);
    } catch (err) {
      console.error(`${red('✘')} pid ${e.pid}: ${err.code === 'EPERM' ? `no permission (owned by ${e.user}) — try sudo` : err.message}`);
      process.exitCode = 1;
    }
  }
}

async function serve() {
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
  console.log(`\n  🦝 ${bold('localhost zoo')}${opt.demo ? yellow(' (demo: fake data, nothing is killed)') : ''} is open at ${green(url)}`);
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
