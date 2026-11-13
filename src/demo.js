// Fake but realistic scan data for `zoo --demo`: screenshots, trying the UI and the MCP server.
// Nothing here touches real processes. Exposure is computed by the real classifier.

import { classify, parseUfw } from './exposure.js';
import { advise } from './fixes.js';
import { protectedReason } from './scan.js';

const home = '/home/dev';

const UFW = parseUfw(`Status: active
Default: deny (incoming), allow (outgoing), disabled (routed)

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80,443/tcp (Nginx Full)    ALLOW IN    Anywhere
8000/tcp                   ALLOW IN    Anywhere
`);
const NET = { publicIps: ['203.0.113.7'], firewall: UFW };

const p = (id, o) => ({ id: `pid:${id}`, pid: id, container: null, ...o });
const c = (id, proxyPid, o) => ({ id: `docker:${id}`, pid: proxyPid, command: 'docker', ...o });

const SEED = [
  p(41210, { command: 'node', framework: 'Vite', lang: 'node', name: 'shop-frontend', dir: 'code/shop/frontend',
    bind: [['127.0.0.1', 5173]], cmd: 'node /home/dev/code/shop/frontend/node_modules/.bin/vite --port 5173', rss: 182_000, up: 7_420,
    http: { 5173: [200, 'Shop — dev'] } }),
  p(41388, { command: 'node', framework: 'Next.js', lang: 'node', name: 'admin-dashboard', dir: 'code/shop/admin',
    bind: [['127.0.0.1', 3000]], cmd: 'node /home/dev/code/shop/admin/node_modules/.bin/next dev', rss: 512_000, up: 3_300,
    http: { 3000: [200, 'Admin · Orders'] } }),
  p(39001, { command: 'python3', framework: 'Uvicorn', lang: 'python', name: 'ml-api', dir: 'code/ml-api',
    bind: [['*', 8000]], cmd: '/srv/ml-api/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0', rss: 640_000, up: 93_600,
    unit: { name: 'ml-api.service', user: false },
    http: { 8000: [200, 'ML API — Swagger UI'] } }),
  c('3f9a1c2b7d4e', 2201, { framework: 'Redis', name: 'shop', dir: 'code/shop',
    container: { id: '3f9a1c2b7d4e', name: 'shop-cache-1', image: 'redis:7', status: 'Up 2 days', service: 'cache' },
    bind: [['*', 6379, 6379]], cmd: 'redis:7  docker-entrypoint.sh redis-server', up: 172_800 }),
  c('8b2e4f6a1c3d', 2202, { framework: 'PostgreSQL', name: 'shop', dir: 'code/shop',
    container: { id: '8b2e4f6a1c3d', name: 'shop-db-1', image: 'postgres:16', status: 'Up 2 days (healthy)', service: 'db' },
    bind: [['127.0.0.1', 5432, 5432]], cmd: 'postgres:16  docker-entrypoint.sh postgres', up: 172_800 }),
  p(38200, { command: 'go', framework: null, lang: 'go', name: 'auth-service', dir: 'code/auth-service',
    bind: [['127.0.0.1', 8081], ['127.0.0.1', 9091]], cmd: '/tmp/go-build123/exe/auth-service -port 8081', rss: 31_000, up: 15_000,
    http: { 8081: [401], 9091: [200] } }),
  p(40777, { command: 'ingest-worker', framework: null, lang: 'rust', name: 'ingest-worker', dir: 'code/ingest-worker',
    bind: [['127.0.0.1', 9090]], cmd: 'target/debug/ingest-worker --metrics-port 9090', rss: 24_000, up: 1_200,
    http: { 9090: [404] } }),
  p(39544, { command: 'python3', framework: 'Jupyter', lang: 'python', name: 'experiments', dir: 'notebooks/experiments',
    bind: [['*', 8888]], cmd: 'python3 -m jupyter lab --no-browser --ip 0.0.0.0', rss: 230_000, up: 260_000,
    http: { 8888: [302] } }),
  p(1180, { command: 'nginx', framework: 'nginx', system: true,
    bind: [['*', 80], ['*', 443]], cmd: 'nginx: master process /usr/sbin/nginx -g daemon on;', rss: 6_400, up: 2_592_000,
    unit: { name: 'nginx.service', user: false },
    http: { 80: [301], 443: [400] } }),
  p(801, { command: 'sshd', framework: null, system: true,
    bind: [['*', 22]], cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', rss: 7_200, up: 2_592_000,
    unit: { name: 'ssh.service', user: false } }),
];

let animals = SEED.slice();
let started = Date.now();

function toEntry(a, elapsed) {
  const bindings = a.bind.map(([address, port, containerPort]) => (containerPort ? { address, port, containerPort } : { address, port }));
  const e = {
    id: a.id,
    pid: a.pid,
    command: a.command,
    user: a.system || a.container ? 'root' : 'dev',
    kind: a.system ? 'system' : 'dev',
    bindings,
    ports: [...new Set(a.bind.map((b) => b[1]))],
    cmdline: a.cmd,
    ppid: 1,
    rssKb: a.rss ?? null,
    uptimeSec: a.up + elapsed,
    cwd: a.dir ? `${home}/${a.dir}` : '/',
    project: a.name ? { root: `${home}/${a.dir}`, name: a.name, lang: a.lang || null } : null,
    framework: a.framework,
    container: a.container || null,
    unit: a.unit || null,
    http: Object.fromEntries(Object.entries(a.http || {}).map(([port, [status, title]]) =>
      [port, { http: true, status, title: title || null, server: null }])),
    self: false,
    mine: !a.system,
  };
  e.exposure = classify(e, NET);
  e.exposed = e.exposure.level !== 'local';
  Object.assign(e.exposure, advise(e, NET));
  e.protected = protectedReason(e);
  return e;
}

export function demoScan() {
  if (!animals.some((a) => !a.system)) { animals = SEED.slice(); started = Date.now(); } // refill the zoo
  const elapsed = Math.floor((Date.now() - started) / 1000);
  return {
    host: 'devbox',
    platform: 'linux',
    scannedAt: Date.now(),
    demo: true,
    network: { publicIps: NET.publicIps, firewall: { name: 'ufw', active: true } },
    docker: true,
    unknown: [],
    entries: animals.map((a) => toEntry(a, elapsed)),
  };
}

export function demoKill(entry) {
  if (entry.protected) return { ok: false, status: 403, error: `Refusing to stop ${entry.unit?.name || entry.command}. ${entry.protected}` };
  animals = animals.filter((a) => a.id !== entry.id);
  const how = entry.container ? 'docker stop' : entry.unit ? `systemctl stop ${entry.unit.name}` : 'SIGTERM';
  return { ok: true, exited: true, how, demo: true };
}

// ---- disk zoo demo: fake folders, nothing is deleted ----

const GB = 1e9, MB = 1e6, DAY = 86400000;
const DISK_SEED = [
  ['dir', 'code/old-landing/node_modules', 'node_modules', '📦', 'old-landing', 1.84 * GB, 241],
  ['cache', 'Library/Developer/Xcode/DerivedData', 'Xcode DerivedData', '🔨', null, 6.2 * GB, null],
  ['dir', 'code/shop/admin/node_modules', 'node_modules', '📦', 'admin-dashboard', 1.12 * GB, 0],
  ['dir', 'code/shop/admin/.next', 'Next.js build', '▲', 'admin-dashboard', 640 * MB, 0],
  ['dir', 'code/ingest-worker/target', 'Rust build', '🦀', 'ingest-worker', 3.9 * GB, 2],
  ['dir', 'code/hackathon-2024/node_modules', 'node_modules', '📦', 'hackathon-2024', 980 * MB, 412],
  ['dir', 'code/ml-api/.venv', 'virtualenv', '🐍', 'ml-api', 2.3 * GB, 1],
  ['dir', 'notebooks/kaggle-titanic/.venv', 'virtualenv', '🐍', 'kaggle-titanic', 1.4 * GB, 530],
  ['dir', 'code/rust-playground/target', 'Rust build', '🦀', 'rust-playground', 2.1 * GB, 188],
  ['cache', '.npm/_cacache', 'npm cache', '📦', null, 1.7 * GB, null],
  ['cache', 'Library/Caches/Homebrew', 'Homebrew cache', '🍺', null, 890 * MB, null],
  ['cache', 'Library/Caches/pip', 'pip cache', '🐍', null, 760 * MB, null],
  ['cache', '.cargo/registry', 'Cargo registry', '🦀', null, 1.1 * GB, null],
];
let diskItems = null;

export function demoDisk() {
  const now = Date.now();
  diskItems ??= DISK_SEED.map(([type, rel, kind, icon, name, size, idle]) => ({
    id: `${type}:${rel}`, path: `${home}/${rel}`, kind, icon, size: Math.round(size),
    type: type === 'dir' ? 'project' : 'cache',
    rebuild: type === 'dir' ? (kind === 'node_modules' ? 'npm install' : kind === 'virtualenv' ? 'python -m venv .venv' : kind === 'Rust build' ? 'cargo build' : 'next build') : 'refilled when the tool needs it',
    project: name ? { root: `${home}/${rel.split('/').slice(0, -1).join('/')}`, name } : null,
    touched: idle == null ? null : now - idle * DAY, idleDays: idle,
  }));
  if (!diskItems.length) { diskItems = null; return demoDisk(); } // everything cleaned: refill
  const items = diskItems.slice().sort((a, b) => b.size - a.size);
  return { home, platform: 'linux', scannedAt: now, demo: true, total: items.reduce((n, it) => n + it.size, 0), items,
    docker: { size: 14.2 * GB, reclaimable: 9.8 * GB } };
}

export function demoClean(item, { force = false } = {}) {
  diskItems = (diskItems || []).filter((it) => it.id !== item.id);
  return { ok: true, how: force ? 'deleted' : 'trash', freed: item.size, demo: true };
}
