// `zoo mcp` — a Model Context Protocol server over stdio, so AI coding agents
// (Claude Code, Cursor, …) can ask "what is on port 3000?" and free it.
// Newline-delimited JSON-RPC 2.0, no dependencies. stdout carries protocol only.

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { scan } from './scan.js';
import { demoScan, demoKill } from './demo.js';
import { stopEntry, entryLabel } from './kill.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const home = (p) => (p || '').replace(/^\/(Users|home)\/[^/]+/, '~');
const up = (s) => s == null ? '' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;

/** One readable line per server — what an agent needs to decide. */
export function describe(e) {
  const name = e.container ? `${e.container.name} (docker ${e.container.image})` : (e.project?.name || e.command);
  const who = e.container ? `container ${e.container.id.slice(0, 12)}` : `pid ${e.pid}`;
  const http = Object.entries(e.http || {}).filter(([, h]) => h.http)
    .map(([p, h]) => `:${p} → HTTP ${h.status}${h.title ? ` "${h.title}"` : ''}`).join(', ');
  return [
    `${e.ports.map((p) => ':' + p).join(' ')}  ${name}${e.framework ? ` [${e.framework}]` : ''}`,
    `  ${who}${e.uptimeSec != null ? ` · up ${up(e.uptimeSec)}` : ''} · reach: ${e.exposure?.level || 'local'}${e.cwd && e.cwd !== '/' ? ` · ${home(e.cwd)}` : ''}`,
    http && `  ${http}`,
    `  cmd: ${e.cmdline}`,
  ].filter(Boolean).join('\n');
}

export const TOOLS = [
  {
    name: 'list_servers',
    title: 'List dev servers',
    description: 'List every dev server (process or Docker container) listening on a TCP port on this machine: port, project, framework, folder, uptime, HTTP status/title and who can reach it.',
    inputSchema: {
      type: 'object',
      properties: { include_system: { type: 'boolean', description: 'Also include system listeners such as sshd or AirPlay.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'who_is_on_port',
    title: 'Who is on this port?',
    description: 'Show what is listening on a TCP port: process or container, project folder, command line, HTTP title. Use it before starting a dev server or when a port is "already in use".',
    inputSchema: {
      type: 'object',
      properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } },
      required: ['port'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stop_server',
    title: 'Stop what is on a port',
    description: 'Stop whatever is listening on a TCP port: SIGTERM for a process, `docker stop` for a container. force=true uses SIGKILL / `docker kill`. Ask the user before stopping something you did not start.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        force: { type: 'boolean', description: 'SIGKILL / docker kill instead of a graceful stop.' },
      },
      required: ['port'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'check_exposure',
    title: 'What is open to the internet?',
    description: 'Report which listening ports can be reached from the internet or the local network, with the reason (public IP, ufw rules, Docker publishing past ufw).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function createHandler({ demo = false, version = '0.0.0' } = {}) {
  const getScan = (o) => (demo ? Promise.resolve(demoScan()) : scan(o));
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

  async function callTool(name, args = {}) {
    if (name === 'list_servers') {
      const d = await getScan();
      const list = d.entries.filter((e) => args.include_system || e.kind === 'dev');
      if (!list.length) return text('No dev servers are listening on this machine.');
      return text(`${list.length} server(s) on ${d.host}:\n\n${list.map(describe).join('\n\n')}`);
    }
    if (name === 'who_is_on_port' || name === 'stop_server') {
      const port = Number(args.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return text('port must be an integer between 1 and 65535.', true);
      const d = await getScan({ probe: name === 'who_is_on_port' });
      const hits = d.entries.filter((e) => e.ports.includes(port));
      if (!hits.length) return text(`Nothing is listening on :${port}. It is free.`);
      if (name === 'who_is_on_port') return text(hits.map(describe).join('\n\n'));
      const results = [];
      for (const e of hits) {
        if (e.self) { results.push(`Skipped ${entryLabel(e)}: it is the zoo itself.`); continue; }
        const r = demo ? demoKill(e) : await stopEntry(e, { force: !!args.force });
        results.push(r.ok
          ? (r.exited ? `Stopped ${entryLabel(e)} (${r.how}).` : `Sent ${r.how} to ${entryLabel(e)}, but it is still running. Retry with force=true.`)
          : `Could not stop ${entryLabel(e)}: ${r.error}`);
      }
      return text(results.join('\n'), results.some((r) => r.startsWith('Could not')));
    }
    if (name === 'check_exposure') {
      const d = await getScan({ probe: false });
      const net = d.network || {};
      const head = `${d.host}: ${net.publicIps?.length ? `public IP ${net.publicIps.join(', ')}` : 'no public IP on any interface'}; firewall: ${net.firewall ? `${net.firewall.name} ${net.firewall.active ? 'active' : 'inactive'}` : 'none detected (or not readable without root)'}.`;
      const rank = { internet: 0, network: 1, firewalled: 2 };
      const exposed = d.entries.filter((e) => e.exposure && e.exposure.level !== 'local')
        .sort((a, b) => rank[a.exposure.level] - rank[b.exposure.level]);
      if (!exposed.length) return text(`${head}\nEverything listens on localhost only.`);
      return text(`${head}\n\n${exposed.map((e) => `${e.exposure.level.toUpperCase()}  ${e.ports.map((p) => ':' + p).join(' ')}  ${e.container?.name || e.project?.name || e.command} — ${e.exposure.reason}`).join('\n')}`);
    }
    return null;
  }

  /** Handle one JSON-RPC message; returns a response object or null for notifications. */
  return async function handle(msg) {
    const { id, method, params } = msg || {};
    const reply = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
    const fail = (code, message) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } });

    try {
      switch (method) {
        case 'initialize':
          return reply({
            protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'localhost-zoo', title: 'localhost zoo', version },
            instructions: 'Use who_is_on_port before starting a dev server or when a port is busy; list_servers to see what is running; check_exposure to find ports open to the internet. stop_server really stops processes and containers.',
          });
        case 'ping':
          return reply({});
        case 'tools/list':
          return reply({ tools: TOOLS });
        case 'tools/call': {
          const result = await callTool(params?.name, params?.arguments || {});
          return result ? reply(result) : fail(-32602, `Unknown tool: ${params?.name}`);
        }
        default:
          if (method?.startsWith('notifications/')) return null;
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (err) {
      return id === undefined ? null : reply(text(`localhost-zoo error: ${err.message}`, true));
    }
  };
}

export async function runMcp({ demo = false } = {}) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const handle = createHandler({ demo, version: pkg.version });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (obj) => obj && process.stdout.write(JSON.stringify(obj) + '\n');

  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (Array.isArray(msg)) { for (const m of msg) send(await handle(m)); continue; }
    send(await handle(msg));
  }
}
