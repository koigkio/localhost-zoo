// Docker support: turn anonymous `docker-proxy` / Docker Desktop listeners into
// named containers ("shop-db · postgres:16"), and stop them with `docker stop`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Processes that publish container ports on the host. */
export const DOCKER_PROCESS = /docker-proxy|com\.docker|vpnkit|dockerd|OrbStack|rootlessport|gvproxy|podman/i;

export function isDockerProcess(command = '', cmdline = '') {
  return DOCKER_PROCESS.test(command) || DOCKER_PROCESS.test(cmdline.split(' ')[0] || '');
}

/**
 * Parse the Ports column of `docker ps`:
 * "0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 127.0.0.1:8000-8001->80-81/tcp, 6379/tcp"
 * → [{ address: '*', port: 5432, containerPort: 5432 }, …]  (TCP, published only)
 */
export function parseDockerPorts(s = '') {
  const out = [];
  for (const part of s.split(/,\s*/)) {
    const m = part.trim().match(/^(.*):(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?\/(tcp|udp|sctp)$/);
    if (!m || m[6] !== 'tcp') continue;
    let address = m[1].replace(/^\[|\]$/g, '');
    if (address === '0.0.0.0' || address === '::' || address === '') address = '*';
    const from = Number(m[2]), to = Number(m[3] || m[2]), cFrom = Number(m[4]);
    for (let p = from; p <= to; p++) {
      if (!out.some((o) => o.port === p && o.address === address)) {
        out.push({ address, port: p, containerPort: cFrom + (p - from) });
      }
    }
  }
  return out;
}

/** "a=1,b=two" → { a: '1', b: 'two' } */
export function parseLabels(s = '') {
  const labels = {};
  for (const pair of s.split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) labels[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return labels;
}

/** Output of `docker ps --format '{{json .}}'` → containers with published TCP ports. */
export function parseDockerPs(out = '') {
  const containers = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let c;
    try { c = JSON.parse(line); } catch { continue; }
    const labels = parseLabels(c.Labels);
    containers.push({
      id: String(c.ID || '').slice(0, 12),
      name: String(c.Names || '').split(',')[0],
      image: c.Image || '',
      command: String(c.Command || '').replace(/^"|"$/g, ''),
      status: c.Status || '',
      bindings: parseDockerPorts(c.Ports),
      compose: labels['com.docker.compose.project']
        ? {
            project: labels['com.docker.compose.project'],
            service: labels['com.docker.compose.service'] || null,
            workingDir: labels['com.docker.compose.project.working_dir'] || null,
          }
        : null,
    });
  }
  return containers;
}

/** "Up 3 hours" / "Up 2 days (healthy)" → seconds (approximate) or null. */
export function parseDockerUptime(status = '') {
  const m = status.match(/^Up (?:About )?(an?|\d+|Less than a) ?(second|minute|hour|day|week|month|year)s?/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].toLowerCase().startsWith('less') ? 0 : 1;
  const unit = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[m[2].toLowerCase()];
  return n * unit;
}

/** Running containers, or null when Docker is missing, stopped or not accessible. */
export async function listContainers() {
  try {
    const { stdout } = await run('docker', ['ps', '--no-trunc', '--format', '{{json .}}'], { timeout: 3000 });
    return parseDockerPs(stdout);
  } catch {
    return null;
  }
}

export async function stopContainer(id, { force = false } = {}) {
  await run('docker', [force ? 'kill' : 'stop', id], { timeout: 30000 });
}
