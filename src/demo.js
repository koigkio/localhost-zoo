// Fake but realistic scan data for `zoo --demo`: screenshots, trying the UI, developing it.
// Nothing here touches real processes.

const now = () => Date.now();
const home = '/home/dev';

const SEED = [
  { pid: 41210, command: 'node', framework: 'Vite', lang: 'node', name: 'shop-frontend', dir: 'code/shop/frontend',
    ports: [5173], cmd: 'node /home/dev/code/shop/frontend/node_modules/.bin/vite --port 5173', rss: 182_000, up: 7_420,
    http: { 5173: { status: 200, title: 'Shop — dev' } } },
  { pid: 41388, command: 'node', framework: 'Next.js', lang: 'node', name: 'admin-dashboard', dir: 'code/shop/admin',
    ports: [3000], cmd: 'node /home/dev/code/shop/admin/node_modules/.bin/next dev', rss: 512_000, up: 3_300,
    http: { 3000: { status: 200, title: 'Admin · Orders' } } },
  { pid: 39001, command: 'python3', framework: 'Uvicorn', lang: 'python', name: 'ml-api', dir: 'code/ml-api',
    ports: [8000], cmd: 'python3 -m uvicorn app.main:app --reload --host 0.0.0.0', rss: 640_000, up: 93_600, exposed: true,
    http: { 8000: { status: 200, title: 'ML API — Swagger UI' } } },
  { pid: 39544, command: 'python3', framework: 'Jupyter', lang: 'python', name: 'experiments', dir: 'notebooks/experiments',
    ports: [8888], cmd: 'python3 -m jupyter lab --no-browser', rss: 230_000, up: 260_000,
    http: { 8888: { status: 302, title: null } } },
  { pid: 40777, command: 'cargo-watch', framework: null, lang: 'rust', name: 'ingest-worker', dir: 'code/ingest-worker',
    ports: [9090], cmd: 'target/debug/ingest-worker --metrics-port 9090', rss: 24_000, up: 1_200,
    http: { 9090: { status: 404, title: null } } },
  { pid: 38200, command: 'go', framework: null, lang: 'go', name: 'auth-service', dir: 'code/auth-service',
    ports: [8081, 9091], cmd: '/tmp/go-build123/exe/auth-service -port 8081', rss: 31_000, up: 15_000,
    http: { 8081: { status: 401, title: null }, 9091: { status: 200, title: null } } },
  { pid: 1022, command: 'postgres', framework: 'PostgreSQL', lang: null, name: 'postgres', dir: 'code/shop/docker/pg',
    ports: [5432], cmd: '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main', rss: 48_000, up: 604_800, system: true },
  { pid: 1023, command: 'redis-server', framework: 'Redis', lang: null, name: 'redis', dir: null,
    ports: [6379], cmd: 'redis-server 127.0.0.1:6379', rss: 9_800, up: 604_800, system: true },
  { pid: 801, command: 'sshd', framework: null, lang: null, name: null, dir: null, exposed: true,
    ports: [22], cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', rss: 7_200, up: 2_592_000, system: true },
];

let animals = SEED.map((a) => ({ ...a }));
let started = now();

export function demoScan() {
  const elapsed = Math.floor((now() - started) / 1000);
  if (!animals.length) { animals = SEED.map((a) => ({ ...a })); started = now(); } // refill the zoo
  return {
    host: 'devbox',
    platform: 'linux',
    scannedAt: now(),
    demo: true,
    unknown: [],
    entries: animals.map((a) => ({
      pid: a.pid,
      command: a.command,
      user: a.system ? 'root' : 'dev',
      kind: a.system ? 'system' : 'dev',
      ports: a.ports,
      bindings: a.ports.map((port) => ({ address: a.exposed ? '*' : '127.0.0.1', port })),
      exposed: !!a.exposed,
      cmdline: a.cmd,
      ppid: 1,
      rssKb: a.rss,
      uptimeSec: a.up + elapsed,
      cwd: a.dir ? `${home}/${a.dir}` : '/',
      project: a.name && !a.system ? { root: `${home}/${a.dir}`, name: a.name, lang: a.lang } : null,
      framework: a.framework,
      http: Object.fromEntries(Object.entries(a.http || {}).map(([p, h]) => [p, { http: true, server: null, ...h }])),
      self: false,
      mine: !a.system,
    })),
  };
}

export function demoKill(pid) {
  const before = animals.length;
  animals = animals.filter((a) => a.pid !== pid);
  return animals.length < before;
}
