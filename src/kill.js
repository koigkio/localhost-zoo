// One way to stop things, shared by the dashboard, the CLI, `zoo top` and `zoo mcp`.

import { stopContainer } from './docker.js';

async function waitForExit(pid, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Stop a scan entry: a container via `docker stop`, a process via a signal.
 * @returns {Promise<{ ok: boolean, exited?: boolean, how?: string, status?: number, error?: string }>}
 */
export async function stopEntry(entry, { force = false } = {}) {
  if (entry.self) return { ok: false, status: 400, error: "The zoo keeper can't be released." };

  if (entry.container) {
    try {
      await stopContainer(entry.container.id, { force });
      return { ok: true, exited: true, how: force ? 'docker kill' : 'docker stop' };
    } catch (err) {
      const msg = (err.stderr || err.message || '').trim().split('\n').pop();
      return { ok: false, status: 403, error: `Could not stop container ${entry.container.name}: ${msg}` };
    }
  }

  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(entry.pid, signal);
  } catch (err) {
    if (err.code === 'ESRCH') return { ok: false, status: 410, error: 'Process already exited.' };
    if (err.code === 'EPERM') return { ok: false, status: 403, error: `No permission to stop PID ${entry.pid} (owned by ${entry.user}). Try running zoo with sudo.` };
    return { ok: false, status: 500, error: err.message };
  }
  const exited = await waitForExit(entry.pid, force ? 1500 : 3000);
  return { ok: true, exited, how: signal };
}

/** Human label used in messages. */
export function entryLabel(e) {
  if (e.container) return `${e.container.name} (container)`;
  return `${e.project?.name || e.command || 'process'} (pid ${e.pid})`;
}
