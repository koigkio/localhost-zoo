import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanDisk, cleanItem, findJunk, fmtBytes, fmtIdle } from '../src/disk.js';
import { createZoo } from '../src/server.js';

const there = (p) => access(p).then(() => true, () => false);

async function fakeHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'zoo-disk-'));
  const file = async (rel, size = 2 * 1024 * 1024) => {
    await mkdir(path.dirname(path.join(home, rel)), { recursive: true });
    await writeFile(path.join(home, rel), Buffer.alloc(size, 1));
  };
  await file('code/shop/package.json', 30);
  await writeFile(path.join(home, 'code/shop/package.json'), '{"name":"shop"}');
  await file('code/shop/node_modules/react/index.js');
  await file('code/shop/node_modules/react/node_modules/x/index.js'); // nested: part of the outer one
  await file('code/api/pyproject.toml', 10);
  await writeFile(path.join(home, 'code/api/pyproject.toml'), '[project]\nname = "api"\n');
  await file('code/api/.venv/pyvenv.cfg', 10);
  await file('code/api/.venv/lib/big.bin');
  await file('code/notes/target/report.pdf'); // "target" without Cargo.toml: someone's real folder
  await file('code/notes/build/keep.txt');
  await file('.npm/_cacache/blob');
  await symlink(path.join(home, 'code/shop'), path.join(home, 'code/link'));
  return home;
}

test('scanDisk finds rebuildable folders and leaves real ones alone', async () => {
  const home = await fakeHome();
  try {
    const r = await scanDisk({ home, platform: 'linux' });
    const rel = r.items.map((it) => path.relative(home, it.path)).sort();
    assert.deepEqual(rel, ['.npm/_cacache', 'code/api/.venv', 'code/shop/node_modules']);
    const shop = r.items.find((it) => it.path.endsWith('node_modules'));
    assert.equal(shop.project.name, 'shop');
    assert.equal(shop.kind, 'node_modules');
    assert.ok(shop.size >= 4 * 1024 * 1024, 'nested node_modules counted in the outer one');
    assert.equal(r.items.find((it) => it.path.endsWith('.venv')).project.name, 'api');
    assert.equal(r.total, r.items.reduce((n, it) => n + it.size, 0));
    // the symlink to the shop project is not walked twice
    assert.equal((await findJunk(home)).filter((f) => f.rule.name === 'node_modules').length, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('cleanItem moves to the Trash, refuses anything odd', async () => {
  const home = await fakeHome();
  const xdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(home, '.local/share');
  try {
    const { items } = await scanDisk({ home, platform: 'linux' });
    const nm = items.find((it) => it.path.endsWith('node_modules'));
    const r = await cleanItem(nm, { home, platform: 'linux' });
    assert.equal(r.ok, true);
    assert.equal(r.how, 'trash');
    assert.equal(await there(nm.path), false);
    assert.ok(await there(path.join(home, '.local/share/Trash/files/node_modules')));
    assert.ok(await there(path.join(home, '.local/share/Trash/info/node_modules.trashinfo')));
    assert.match((await cleanItem(nm, { home, platform: 'linux' })).error, /Already gone/);

    const outside = { ...nm, path: os.tmpdir() };
    assert.match((await cleanItem(outside, { home, platform: 'linux' })).error, /inside your home/);
    const notJunk = { ...nm, path: path.join(home, 'code/notes/target') };
    assert.match((await cleanItem(notJunk, { home, platform: 'linux' })).error, /no longer looks rebuildable/);
    const viaLink = { ...nm, path: path.join(home, 'code/link') };
    assert.match((await cleanItem(viaLink, { home, platform: 'linux' })).error, /Not a real folder/);
    assert.ok(await there(path.join(home, 'code/notes/target/report.pdf')));

    const venv = items.find((it) => it.path.endsWith('.venv'));
    const del = await cleanItem(venv, { home, platform: 'linux', force: true });
    assert.equal(del.how, 'deleted');
    assert.equal(await there(venv.path), false);
  } finally {
    if (xdg == null) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = xdg;
    await rm(home, { recursive: true, force: true });
  }
});

test('dashboard: disk endpoints need the token and only clean scanned folders', async () => {
  const zoo = createZoo({ port: 0, demo: true });
  const { port } = await zoo.listen();
  const url = `http://127.0.0.1:${port}`;
  const post = (body, token = zoo.token) => fetch(url + '/api/disk/clean', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-zoo-token': token }, body: JSON.stringify(body),
  });
  try {
    const d = await (await fetch(url + '/api/disk', { headers: { 'x-zoo-token': zoo.token } })).json();
    assert.ok(d.items.length > 5);
    assert.equal((await post({ ids: [d.items[0].id] }, 'nope')).status, 403);
    const r = await (await post({ ids: [d.items[0].id, 'dir:/etc'] })).json();
    assert.equal(r.results[0].ok, true);
    assert.equal(r.results[1].ok, false);
    assert.equal(r.freed, d.items[0].size);
    assert.equal(r.total, d.total - d.items[0].size);
  } finally {
    zoo.server.close();
  }
});

test('fmtBytes / fmtIdle', () => {
  assert.equal(fmtBytes(1.84e9), '1.8 GB');
  assert.equal(fmtBytes(640e6), '640 MB');
  assert.equal(fmtIdle(0), 'today');
  assert.equal(fmtIdle(12), '12d');
  assert.equal(fmtIdle(241), '8mo');
  assert.equal(fmtIdle(412), '1.1y');
});
