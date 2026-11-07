// Finds every process listening on a TCP port and describes it:
// pid, command, working directory, project, framework, uptime, memory.
// macOS: lsof. Linux: ss (falls back to lsof). No dependencies.

import { execFile } from 'node:child_process';
import { readFile, readlink, access } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);

async function sh(cmd, args) {
  try {
    const { stdout } = await run(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    // lsof exits 1 when it finds nothing; its stdout is still valid.
    if (err && typeof err.stdout === 'string') return err.stdout;
    return null;
  }
}

/** Parse "addr:port" / "[::1]:port" / "*:port" into { address, port }. */
export function splitAddress(s) {
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  const port = Number(s.slice(i + 1));
  if (!Number.isInteger(port)) return null;
  let address = s.slice(0, i).replace(/^\[|\]$/g, '');
  if (address === '*' || address === '0.0.0.0' || address === '::') address = '*';
  // ss prints scoped addresses like "127.0.0.1%lo"
  address = address.replace(/%.*$/, '');
  return { address, port };
}

/** lsof -F output → [{ pid, command, user, address, port }] */
export function parseLsof(out) {
  const rows = [];
  let pid = null, command = null, user = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    const tag = line[0], val = line.slice(1);
    if (tag === 'p') { pid = Number(val); command = null; user = null; }
    else if (tag === 'c') command = val;
    else if (tag === 'L') user = val;
    else if (tag === 'n' && pid) {
      const a = splitAddress(val);
      if (a) rows.push({ pid, command, user, ...a });
    }
  }
  return rows;
}

/** `ss -ltnpH` output → [{ pid, command, address, port }] */
export function parseSs(out) {
  const rows = [];
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const a = splitAddress(cols[3]);
    if (!a) continue;
    const users = line.match(/users:\((.*)\)\s*$/);
    if (!users) { rows.push({ pid: null, command: null, ...a }); continue; }
    for (const m of users[1].matchAll(/\("([^"]*)",pid=(\d+)/g)) {
      rows.push({ pid: Number(m[2]), command: m[1], ...a });
    }
  }
  return rows;
}

async function listListeners() {
  if (process.platform === 'linux') {
    const out = await sh('ss', ['-ltnpH']);
    if (out !== null) return parseSs(out);
  }
  const out = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcLn']);
  if (out === null) throw new Error('Neither ss nor lsof is available on this system.');
  return parseLsof(out);
}

async function cwdOf(pid) {
  if (process.platform === 'linux') {
    try { return await readlink(`/proc/${pid}/cwd`); } catch { /* fall through */ }
  }
  const out = await sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = out?.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : null;
}

/** ps gives the same columns on macOS and Linux. */
async function psInfo(pids) {
  if (!pids.length) return new Map();
  const out = await sh('ps', ['-o', 'pid=,ppid=,user=,rss=,etime=,command=', '-p', pids.join(',')]);
  const map = new Map();
  for (const line of (out || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) {
      map.set(Number(m[1]), {
        ppid: Number(m[2]), user: m[3], rssKb: Number(m[4]),
        uptimeSec: parseEtime(m[5]), cmdline: m[6],
      });
    }
  }
  return map;
}

/** ps etime "[[dd-]hh:]mm:ss" → seconds */
export function parseEtime(s) {
  const [days, rest] = s.includes('-') ? s.split('-') : [0, s];
  const parts = rest.split(':').map(Number).reverse();
  return Number(days) * 86400 + (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
}

const MARKERS = [
  ['package.json', 'node'], ['deno.json', 'deno'], ['bun.lockb', 'bun'],
  ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['manage.py', 'python'],
  ['go.mod', 'go'], ['Cargo.toml', 'rust'], ['Gemfile', 'ruby'], ['composer.json', 'php'],
  ['pom.xml', 'java'], ['build.gradle', 'java'], ['mix.exs', 'elixir'],
];

const exists = (p) => access(p).then(() => true, () => false);

/** Walk up from cwd to the nearest project root. */
async function findProject(cwd) {
  if (!cwd || cwd === '/') return null;
  const home = os.homedir();
  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    for (const [file, lang] of MARKERS) {
      if (await exists(path.join(dir, file))) {
        let name = path.basename(dir);
        if (file === 'package.json') {
          try { name = JSON.parse(await readFile(path.join(dir, file), 'utf8')).name || name; } catch {}
        }
        return { root: dir, name, lang };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }
  return null;
}

const FRAMEWORKS = [
  [/\bvite\b/, 'Vite'], [/\bnext\b/, 'Next.js'], [/\bnuxt\b/, 'Nuxt'], [/\bastro\b/, 'Astro'],
  [/\bremix\b/, 'Remix'], [/svelte-kit|sveltekit/, 'SvelteKit'], [/webpack/, 'webpack'],
  [/react-scripts/, 'Create React App'], [/\bng serve|@angular/, 'Angular'], [/storybook/, 'Storybook'],
  [/\bexpo\b/, 'Expo'], [/nodemon/, 'nodemon'], [/\bnest\b/, 'NestJS'],
  [/manage\.py runserver/, 'Django'], [/\bflask\b/, 'Flask'], [/uvicorn/, 'Uvicorn'],
  [/gunicorn/, 'Gunicorn'], [/streamlit/, 'Streamlit'], [/jupyter/, 'Jupyter'],
  [/http\.server/, 'Python http.server'], [/\brails\b|puma/, 'Rails'], [/\bhugo\b/, 'Hugo'],
  [/postgres/, 'PostgreSQL'], [/mysqld|mariadb/, 'MySQL'], [/redis-server/, 'Redis'],
  [/mongod\b/, 'MongoDB'], [/nginx/, 'nginx'], [/docker-proxy|com\.docker|vpnkit/, 'Docker'],
];

// Databases and proxies are infrastructure, but still worth showing as "dev" when started from a project.
const SYSTEM_FRAMEWORKS = new Set(['nginx', 'Docker']);

export function detectFramework(cmdline = '') {
  const c = cmdline.toLowerCase();
  for (const [re, name] of FRAMEWORKS) if (re.test(c)) return name;
  return null;
}

/** Hit the port over HTTP and grab status + <title>. Non-HTTP ports just fail fast. */
async function probe(port, address) {
  const host = address === '*' || address === '0.0.0.0' ? '127.0.0.1'
    : address === '::' ? '[::1]'
    : address.includes(':') ? `[${address}]` : address;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 700);
  try {
    const res = await fetch(`http://${host}:${port}/`, { signal: ctrl.signal, redirect: 'manual' });
    let title = null;
    if ((res.headers.get('content-type') || '').includes('html')) {
      const body = (await res.text()).slice(0, 64 * 1024);
      title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || null;
    } else {
      res.body?.cancel();
    }
    return { http: true, status: res.status, title, server: res.headers.get('server') };
  } catch {
    return { http: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Main entry: one entry per process, with all its ports.
 * @param {{ probe?: boolean, self?: number }} opts
 */
export async function scan({ probe: doProbe = true, self = process.pid } = {}) {
  const listeners = await listListeners();
  const byPid = new Map();
  const unknown = [];

  for (const l of listeners) {
    if (!l.pid) { unknown.push(l); continue; }
    let e = byPid.get(l.pid);
    if (!e) byPid.set(l.pid, (e = { pid: l.pid, command: l.command, user: l.user, bindings: [] }));
    if (!e.bindings.some((b) => b.port === l.port && b.address === l.address)) {
      e.bindings.push({ address: l.address, port: l.port });
    }
  }

  const pids = [...byPid.keys()];
  const ps = await psInfo(pids);

  const entries = await Promise.all(pids.map(async (pid) => {
    const e = byPid.get(pid);
    const info = ps.get(pid) || {};
    const cwd = await cwdOf(pid);
    const project = await findProject(cwd);
    const ports = [...new Set(e.bindings.map((b) => b.port))].sort((a, b) => a - b);
    const exposed = e.bindings.some((b) => !['127.0.0.1', '::1', 'localhost'].includes(b.address));
    const probes = doProbe
      ? await Promise.all(ports.slice(0, 4).map(async (p) => {
          const b = e.bindings.find((x) => x.port === p);
          return [p, await probe(p, b.address)];
        }))
      : [];
    const framework = detectFramework(info.cmdline || e.command);
    const owner = e.user || info.user || null;
    return {
      ...e,
      // "dev" = something you started from a project; "system" = OS daemons, apps, VPNs…
      kind: project || (framework && !SYSTEM_FRAMEWORKS.has(framework)) ? 'dev' : 'system',
      user: owner,
      ports,
      exposed,
      cmdline: info.cmdline || e.command,
      ppid: info.ppid ?? null,
      rssKb: info.rssKb ?? null,
      uptimeSec: info.uptimeSec ?? null,
      cwd,
      project,
      framework,
      http: Object.fromEntries(probes),
      self: pid === self,
      mine: owner === os.userInfo().username,
    };
  }));

  entries.sort((a, b) => a.ports[0] - b.ports[0]);
  return { host: os.hostname(), platform: process.platform, scannedAt: Date.now(), entries, unknown };
}
