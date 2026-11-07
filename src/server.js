// Tiny HTTP server: serves the dashboard, a JSON scan, and a guarded kill endpoint.
//
// Safety model (this endpoint can kill processes, so it matters):
//  * Binds to 127.0.0.1 by default. Remote use = SSH tunnel (see README).
//  * Host header must match an allowed host → blocks DNS-rebinding attacks.
//  * Every mutating request needs a random per-run token (header), and a same-origin Origin.
//  * When bound to a non-loopback address, *every* request needs the token.
//  * Only entries from the latest scan can be stopped — never arbitrary PIDs, never the zoo itself.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { scan, findEntry } from './scan.js';
import { stopEntry, entryLabel } from './kill.js';
import { demoScan, demoKill } from './demo.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopback(host) {
  return LOOPBACK.has(host);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function hostOnly(h = '') {
  // "localhost:4321" → "localhost", "[::1]:4321" → "::1"
  const m = h.match(/^\[([^\]]+)\](?::\d+)?$/) || h.match(/^([^:]+)(?::\d+)?$/);
  return m ? m[1].toLowerCase() : '';
}

export function createZoo({ host = '127.0.0.1', port = 4321, token = randomBytes(18).toString('base64url'), demo = false } = {}) {
  const remote = !isLoopback(host);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (remote) {
    allowedHosts.add(host.toLowerCase());
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) allowedHosts.add(i.address.toLowerCase());
    }
    allowedHosts.add(os.hostname().toLowerCase());
  }

  let lastScan = { entries: [] };
  let scanning = null;
  const doScan = () => (scanning ??= (demo ? Promise.resolve(demoScan()) : scan()).then((r) => (lastScan = r)).finally(() => (scanning = null)));

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const hasToken = (req, url) =>
    safeEqual(req.headers['x-zoo-token'] || '', token) ||
    safeEqual(url.searchParams.get('t') || '', token) ||
    safeEqual((req.headers.cookie || '').match(/(?:^|;\s*)zoo=([^;]+)/)?.[1] || '', token);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (!allowedHosts.has(hostOnly(req.headers.host))) return send(res, 421, { error: 'Host not allowed' });
    if (remote && !hasToken(req, url)) return send(res, 401, { error: 'Missing token — use the URL printed in the terminal.' });

    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = (await readFile(path.join(PUBLIC, 'index.html'), 'utf8')).replace('__ZOO_TOKEN__', token);
        res.setHeader('set-cookie', `zoo=${token}; HttpOnly; SameSite=Strict; Path=/`);
        res.setHeader('content-security-policy',
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
        return send(res, 200, html, 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && url.pathname === '/api/ports') {
        return send(res, 200, await doScan());
      }

      if (req.method === 'POST' && url.pathname === '/api/kill') {
        const origin = req.headers.origin;
        if (!safeEqual(req.headers['x-zoo-token'] || '', token)) return send(res, 403, { error: 'Bad token' });
        if (origin && !allowedHosts.has(hostOnly(new URL(origin).host))) return send(res, 403, { error: 'Bad origin' });

        const body = await readJson(req);
        // Only entries from the latest scan can be stopped — never an arbitrary PID.
        const entry = findEntry(lastScan.entries, body.id != null ? { id: body.id } : { pid: body.pid });
        if (!entry) return send(res, 404, { error: 'That process is not in the current scan. Refresh and try again.' });
        const result = demo ? demoKill(entry) : await stopEntry(entry, { force: !!body.force });
        doScan();
        if (!result.ok) return send(res, result.status || 500, { error: result.error });
        return send(res, 200, { ...result, id: entry.id, label: entryLabel(entry) });
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });

  return {
    server, token, remote,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server.address()));
    }),
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 4096) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
