// disk zoo: finds the space dev work quietly eats — node_modules, virtualenvs, build folders,
// package caches — and moves what you pick to the Trash. No dependencies.
//
// Safety model (this deletes folders, so it matters):
//  * Only folders found by the latest scan can be cleaned — never an arbitrary path.
//  * Everything must sit inside the home folder, be a real folder (not a symlink) and still match its rule.
//  * The default is the Trash (macOS ~/.Trash, Linux ~/.local/share/Trash); deleting for good is opt-in.
//  * Everything found can be rebuilt: `npm install`, `pip install`, `cargo build`, or the tool refills its cache.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, lstat, rename, rm, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const exists = (p) => access(p).then(() => true, () => false);

/** Folders inside a project that can be rebuilt. `need` = a file next to it that proves what it is. */
export const RULES = [
  { name: 'node_modules', kind: 'node_modules', icon: '📦', rebuild: 'npm install' },
  { name: '.venv', kind: 'virtualenv', icon: '🐍', inside: 'pyvenv.cfg', rebuild: 'python -m venv .venv' },
  { name: 'venv', kind: 'virtualenv', icon: '🐍', inside: 'pyvenv.cfg', rebuild: 'python -m venv venv' },
  { name: 'target', kind: 'Rust build', icon: '🦀', need: 'Cargo.toml', rebuild: 'cargo build' },
  { name: '.next', kind: 'Next.js build', icon: '▲', need: 'package.json', rebuild: 'next build' },
  { name: '.nuxt', kind: 'Nuxt build', icon: '💚', need: 'package.json', rebuild: 'nuxt build' },
  { name: '.svelte-kit', kind: 'SvelteKit build', icon: '🧡', need: 'package.json', rebuild: 'vite build' },
  { name: '.turbo', kind: 'Turbo cache', icon: '⚡', need: 'package.json', rebuild: 'refilled on the next build' },
  { name: '.parcel-cache', kind: 'Parcel cache', icon: '📦', need: 'package.json', rebuild: 'refilled on the next build' },
  { name: '.gradle', kind: 'Gradle build', icon: '🐘', needAny: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'], rebuild: 'gradle build' },
];
const BY_NAME = new Map(RULES.map((r) => [r.name, r]));

/** Tool caches in the home folder. Paths are relative to home. */
export const CACHES = [
  { rel: '.npm/_cacache', kind: 'npm cache', icon: '📦' },
  { rel: 'Library/Caches/Yarn', kind: 'Yarn cache', icon: '🧶', os: 'darwin' },
  { rel: '.cache/yarn', kind: 'Yarn cache', icon: '🧶', os: 'linux' },
  { rel: 'Library/pnpm/store', kind: 'pnpm store', icon: '📦', os: 'darwin' },
  { rel: '.local/share/pnpm/store', kind: 'pnpm store', icon: '📦', os: 'linux' },
  { rel: '.bun/install/cache', kind: 'Bun cache', icon: '🐰' },
  { rel: 'Library/Caches/pip', kind: 'pip cache', icon: '🐍', os: 'darwin' },
  { rel: '.cache/pip', kind: 'pip cache', icon: '🐍', os: 'linux' },
  { rel: 'Library/Caches/pypoetry', kind: 'Poetry cache', icon: '🐍', os: 'darwin' },
  { rel: '.cache/pypoetry', kind: 'Poetry cache', icon: '🐍', os: 'linux' },
  { rel: '.cache/uv', kind: 'uv cache', icon: '🐍' },
  { rel: 'Library/Caches/Homebrew', kind: 'Homebrew cache', icon: '🍺', os: 'darwin' },
  { rel: '.cargo/registry', kind: 'Cargo registry', icon: '🦀' },
  { rel: 'go/pkg/mod/cache', kind: 'Go module cache', icon: '🐹' },
  { rel: '.gradle/caches', kind: 'Gradle cache', icon: '🐘' },
  { rel: '.m2/repository', kind: 'Maven repository', icon: '🦧' },
  { rel: 'Library/Developer/Xcode/DerivedData', kind: 'Xcode DerivedData', icon: '🔨', os: 'darwin' },
  { rel: 'Library/Developer/CoreSimulator/Caches', kind: 'Simulator caches', icon: '📱', os: 'darwin' },
];

// Never walk into these: they are huge, private or not ours.
const SKIP = new Set(['.git', '.hg', '.svn', '.Trash', 'Library', 'Applications', 'Pictures', 'Music', 'Movies',
  'Photos Library.photoslibrary', '.cache', '.local', '.npm', '.cargo', '.rustup', '.gradle', '.m2', '.docker',
  'go', '.nvm', '.pyenv', '.bun', 'snap', 'proc']);

/** Is this folder one we can clean? Returns the rule or null. */
export async function matchRule(dir) {
  const rule = BY_NAME.get(path.basename(dir));
  if (!rule) return null;
  const parent = path.dirname(dir);
  if (rule.inside && !(await exists(path.join(dir, rule.inside)))) return null;
  if (rule.need && !(await exists(path.join(parent, rule.need)))) return null;
  if (rule.needAny && !(await Promise.all(rule.needAny.map((f) => exists(path.join(parent, f))))).some(Boolean)) return null;
  // node_modules inside node_modules belongs to the outer one.
  if (parent.split(path.sep).includes('node_modules')) return null;
  return rule;
}

/** Walk `root` and return every matching folder. Does not follow symlinks, stops at `limit` folders. */
export async function findJunk(root, { maxDepth = 7, limit = 60000 } = {}) {
  const found = [];
  let visited = 0;
  async function walk(dir, depth) {
    if (depth > maxDepth || visited > limit) return;
    visited++;
    let list;
    try { list = await readdir(dir, { withFileTypes: true }); } catch { return; }
    const subdirs = [];
    for (const d of list) {
      if (!d.isDirectory()) continue; // Dirent: symlinks are not directories here
      const full = path.join(dir, d.name);
      if (BY_NAME.has(d.name)) {
        const rule = await matchRule(full);
        if (rule) { found.push({ path: full, rule }); continue; }
      }
      if (SKIP.has(d.name) || d.name === 'node_modules') continue;
      if (d.name.startsWith('.') && depth === 0) continue; // dotfolders in home are tools, not projects
      subdirs.push(full);
    }
    // A few at a time: fast, but no "too many open files".
    for (let i = 0; i < subdirs.length; i += 16) await Promise.all(subdirs.slice(i, i + 16).map((s) => walk(s, depth + 1)));
  }
  await walk(root, 0);
  return found;
}

/** Folder size in bytes. `du` is much faster than walking in JS; JS is the fallback. */
export async function folderSize(dir) {
  try {
    const { stdout } = await run('du', ['-sk', dir], { maxBuffer: 1024 * 1024, timeout: 120000 });
    const kb = Number(stdout.trim().split(/\s+/)[0]);
    if (Number.isFinite(kb)) return kb * 1024;
  } catch (err) {
    // du exits 1 on unreadable files but still prints the total.
    const kb = Number(String(err.stdout || '').trim().split(/\s+/)[0]);
    if (Number.isFinite(kb) && kb > 0) return kb * 1024;
  }
  let total = 0;
  async function walk(d) {
    let list;
    try { list = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { try { total += (await lstat(p)).blocks * 512 || 0; } catch {} }
    }
  }
  await walk(dir);
  return total;
}

/** Name of the project a folder belongs to, from its manifest. */
export async function projectName(dir) {
  const read = (f) => readFile(path.join(dir, f), 'utf8').catch(() => null);
  const pkg = await read('package.json');
  if (pkg) { try { const n = JSON.parse(pkg).name; if (n) return n; } catch {} }
  for (const f of ['pyproject.toml', 'Cargo.toml']) {
    const t = await read(f);
    const m = t && t.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1];
  }
  const go = await read('go.mod');
  const m = go && go.match(/^module\s+(\S+)/m);
  if (m) return m[1].split('/').pop();
  return path.basename(dir);
}

/** When was the project last touched? Newest mtime among its own top-level files, ignoring junk folders. */
export async function lastTouched(dir) {
  let newest = 0;
  try {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (BY_NAME.has(d.name) || d.name === '.DS_Store') continue;
      try { newest = Math.max(newest, (await lstat(path.join(dir, d.name))).mtimeMs); } catch {}
    }
  } catch {}
  return newest || null;
}

/** Docker's own disk use, from `docker system df`. Cleaning it is left to Docker. */
export async function dockerUsage() {
  try {
    const { stdout } = await run('docker', ['system', 'df', '--format', '{{json .}}'], { timeout: 15000 });
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const bytes = (s) => {
      const m = String(s).match(/^([\d.]+)\s*([kMGT]?B)/i);
      return m ? Number(m[1]) * ({ B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()] || 1) : 0;
    };
    const size = rows.reduce((n, r) => n + bytes(r.Size), 0);
    const reclaimable = rows.reduce((n, r) => n + bytes(r.Reclaimable), 0);
    return size ? { size, reclaimable } : null;
  } catch {
    return null;
  }
}

const DAY = 86400000;

/**
 * Scan the home folder.
 * @returns {Promise<{ home, scannedAt, total, items: Array, docker }>}
 */
export async function scanDisk({ home = os.homedir(), roots = [home], platform = process.platform } = {}) {
  const now = Date.now();
  const items = [];

  for (const root of roots) {
    for (const { path: p, rule } of await findJunk(root)) {
      const project = path.dirname(p);
      const atHome = project === home;
      items.push({
        id: 'dir:' + p, path: p, kind: rule.kind, icon: rule.icon, rebuild: rule.rebuild, type: 'project',
        project: { root: project, name: atHome ? '~' : await projectName(project) },
        touched: atHome ? null : await lastTouched(project),
      });
    }
  }
  for (const c of CACHES) {
    if (c.os && c.os !== platform) continue;
    const p = path.join(home, c.rel);
    try { if (!(await lstat(p)).isDirectory()) continue; } catch { continue; }
    items.push({ id: 'cache:' + c.rel, path: p, kind: c.kind, icon: c.icon, rebuild: 'refilled when the tool needs it', type: 'cache', project: null, touched: null });
  }

  for (let i = 0; i < items.length; i += 8) {
    await Promise.all(items.slice(i, i + 8).map(async (it) => { it.size = await folderSize(it.path); }));
  }
  for (const it of items) it.idleDays = it.touched ? Math.floor((now - it.touched) / DAY) : null;
  const kept = items.filter((it) => it.size >= 1024 * 1024).sort((a, b) => b.size - a.size);

  return {
    home, platform, scannedAt: now,
    total: kept.reduce((n, it) => n + it.size, 0),
    items: kept,
    docker: await dockerUsage(),
  };
}

/** Is the folder still safe to remove? Returns an error string or null. */
export async function checkCleanable(item, home = os.homedir()) {
  const rel = path.relative(home, item.path);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'Only folders inside your home folder can be cleaned.';
  let st;
  try { st = await lstat(item.path); } catch { return 'Already gone.'; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'Not a real folder any more.';
  if (item.type === 'project' && !(await matchRule(item.path))) return 'This folder no longer looks rebuildable — left alone.';
  if (item.type === 'cache' && !CACHES.some((c) => path.join(home, c.rel) === item.path)) return 'Not a known cache.';
  return null;
}

/** Move a folder to the Trash. macOS: ~/.Trash. Linux: the freedesktop Trash, with a .trashinfo file. */
export async function moveToTrash(p, { home = os.homedir(), platform = process.platform } = {}) {
  const base = path.basename(p);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (platform === 'darwin') {
    const dir = path.join(home, '.Trash');
    let dest = path.join(dir, base);
    if (await exists(dest)) dest = path.join(dir, `${base} ${stamp}`);
    await rename(p, dest);
    return dest;
  }
  if (platform === 'linux') {
    const trash = path.join(process.env.XDG_DATA_HOME || path.join(home, '.local/share'), 'Trash');
    await mkdir(path.join(trash, 'files'), { recursive: true });
    await mkdir(path.join(trash, 'info'), { recursive: true });
    let name = base;
    if (await exists(path.join(trash, 'files', name))) name = `${base}.${stamp}`;
    const info = `[Trash Info]\nPath=${encodeURI(p)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`;
    await writeFile(path.join(trash, 'info', name + '.trashinfo'), info);
    await rename(p, path.join(trash, 'files', name));
    return path.join(trash, 'files', name);
  }
  throw Object.assign(new Error('No Trash on this system — use "delete for good".'), { code: 'NOTRASH' });
}

/**
 * Clean one scanned item.
 * @returns {Promise<{ ok: boolean, how?: string, freed?: number, status?: number, error?: string }>}
 */
export async function cleanItem(item, { force = false, home = os.homedir(), platform = process.platform } = {}) {
  const why = await checkCleanable(item, home);
  if (why) return { ok: false, status: 409, error: `${shortHome(item.path, home)}: ${why}` };
  try {
    if (force) {
      await rm(item.path, { recursive: true, force: true, maxRetries: 2 });
      return { ok: true, how: 'deleted', freed: item.size };
    }
    await moveToTrash(item.path, { home, platform });
    return { ok: true, how: 'trash', freed: item.size };
  } catch (err) {
    if (err.code === 'EXDEV') return { ok: false, status: 409, error: `${shortHome(item.path, home)} is on another drive, so it can't go to the Trash. Delete it for good instead.` };
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, status: 403, error: `No permission to move ${shortHome(item.path, home)}.` };
    return { ok: false, status: 500, error: err.message };
  }
}

export function findItem(items, id) {
  return items.find((it) => it.id === id) || null;
}

export const shortHome = (p, home = os.homedir()) => (p && p.startsWith(home) ? '~' + p.slice(home.length) : p);

export function fmtBytes(n) {
  if (n == null) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
  return Math.round(n / 1e3) + ' KB';
}

export function fmtIdle(days) {
  if (days == null) return '';
  if (days < 1) return 'today';
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
