// Who can reach a port? "local" (this machine), "network" (LAN / provider network),
// "internet" (public IP and nothing blocks it) or "firewalled" (ufw drops it).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const run = promisify(execFile);

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** True for globally routable addresses (not private, loopback, link-local, CGNAT, ULA…). */
export function isPublicIp(ip = '') {
  ip = ip.toLowerCase().replace(/%.*$/, '');
  if (ip.includes(':')) {
    if (ip.startsWith('::ffff:')) return isPublicIp(ip.slice(7));
    if (ip === '::' || ip === '::1') return false;
    if (/^fe[89ab]/.test(ip)) return false; // link-local
    if (/^f[cd]/.test(ip)) return false; // unique local
    if (ip.startsWith('2001:db8')) return false; // documentation
    return /^[23]/.test(ip); // 2000::/3 global unicast
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

/** Parse `ufw status verbose`. Returns null when ufw output is unusable. */
export function parseUfw(out = '') {
  const status = out.match(/^Status:\s*(\w+)/m)?.[1];
  if (!status) return null;
  const fw = {
    name: 'ufw',
    active: status === 'active',
    defaultIncoming: out.match(/^Default:\s*(\w+)\s*\(incoming\)/m)?.[1] || 'deny',
    rules: [],
  };
  for (const line of out.split('\n')) {
    const m = line.match(/^(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?\s{2,}(.+?)\s*$/);
    if (!m || m[3] === 'OUT' || m[3] === 'FWD') continue;
    const to = m[1].replace(/\(v6\)/g, '').replace(/\([^)]*\)/g, '').trim();
    const from = m[4].replace(/\(v6\)/g, '').replace(/\([^)]*\)/g, '').trim();
    const target = to.split(/\s+/).pop(); // "192.168.1.5 22/tcp" → "22/tcp"
    let ranges;
    if (/^anywhere$/i.test(target)) ranges = [[1, 65535]];
    else {
      const [list, proto] = target.split('/');
      if (proto && proto !== 'tcp') continue;
      ranges = [];
      for (const piece of list.split(',')) {
        const [lo, hi] = piece.split(':').map(Number);
        if (Number.isInteger(lo)) ranges.push([lo, Number.isInteger(hi) ? hi : lo]);
      }
      if (!ranges.length) continue;
    }
    fw.rules.push({
      ranges,
      action: m[2] === 'LIMIT' ? 'ALLOW' : m[2],
      fromAnywhere: /^anywhere$/i.test(from),
    });
  }
  return fw;
}

/** Would ufw let a packet from a random internet host reach this port? (first match wins) */
export function ufwAllows(fw, port) {
  if (!fw || !fw.active) return true;
  for (const r of fw.rules) {
    if (!r.fromAnywhere) continue;
    if (r.ranges.some(([lo, hi]) => port >= lo && port <= hi)) return r.action === 'ALLOW';
  }
  return fw.defaultIncoming === 'allow';
}

async function detectFirewall() {
  if (process.platform !== 'linux') return null;
  try {
    const { stdout } = await run('ufw', ['status', 'verbose'], { timeout: 2000 });
    return parseUfw(stdout);
  } catch {
    return null; // not installed, or not root
  }
}

export async function networkInfo() {
  const publicIps = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (!i.internal && isPublicIp(i.address)) publicIps.push(i.address);
  }
  return { publicIps, firewall: await detectFirewall() };
}

const RANK = { local: 0, firewalled: 1, network: 2, internet: 3 };

/**
 * Decide who can reach each port of an entry.
 * @returns {{ level, reason, ports: Record<number, string> }}
 */
export function classify(entry, net) {
  const ports = {};
  const reasons = [];
  const fw = net.firewall?.active ? net.firewall : null;

  for (const b of entry.bindings) {
    let level;
    if (LOOPBACK.has(b.address)) level = 'local';
    else {
      const publicAddr = b.address === '*' ? net.publicIps.length > 0 : isPublicIp(b.address);
      if (entry.container && publicAddr) {
        level = 'internet';
        if (fw) reasons.push(`Docker publishes :${b.port} past ufw rules`);
        else reasons.push(`:${b.port} is published on a public IP`);
      } else if (fw && !ufwAllows(fw, b.port)) {
        level = 'firewalled';
      } else if (publicAddr) {
        level = 'internet';
        reasons.push(fw ? `ufw allows :${b.port} from anywhere` : `:${b.port} listens on a public IP and no firewall was detected`);
      } else {
        level = 'network';
      }
    }
    if (!(b.port in ports) || RANK[level] > RANK[ports[b.port]]) ports[b.port] = level;
  }

  const level = Object.values(ports).reduce((a, l) => (RANK[l] > RANK[a] ? l : a), 'local');
  const reason = level === 'internet' ? [...new Set(reasons)].join('; ')
    : level === 'firewalled' ? 'ufw blocks it from the internet'
    : level === 'network' ? 'reachable from your local or provider network'
    : 'only this machine';
  return { level, reason, ports };
}
