// One way to stop things, shared by the dashboard, the CLI, `zoo top`, `zoo mcp` and the Telegram bot.
//   container       → docker stop / docker kill
//   systemd service → systemctl stop / systemctl kill -s SIGKILL (otherwise systemd just restarts it)
//   anything else   → SIGTERM / SIGKILL

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stopContainer } from './docker.js';

const run = promisify(execFile);

async function waitForExit(pid, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const lastLine = (err) => (err.stderr || err.message || '').trim().split('\n').pop();

/**
 * Stop a scan entry.
 * @returns {Promise<{ ok: boolean, exited?: boolean, how?: string, status?: number, error?: string }>}
 */
export async function stopEntry(entry, { force = false } = {}) {
  if (entry.self) return { ok: false, status: 400, error: "The zoo keeper can't be released." };
  if (entry.protected) return { ok: false, status: 403, error: `Refusing to stop ${entryLabel(entry)}. ${entry.protected}` };

  if (entry.container) {
    try {
      await stopContainer(entry.container.id, { force });
      return { ok: true, exited: true, how: force ? 'docker kill' : 'docker stop' };
    } catch (err) {
      return { ok: false, status: 403, error: `Could not stop container ${entry.container.name}: ${lastLine(err)}` };
    }
  }

  if (entry.unit) {
    const scope = entry.unit.user ? ['--user'] : [];
    const args = force ? [...scope, 'kill', '--signal=SIGKILL', entry.unit.name] : [...scope, 'stop', entry.unit.name];
    try {
      await run('systemctl', args, { timeout: 30000 });
      const exited = entry.pid ? await waitForExit(entry.pid, 3000) : true;
      return { ok: true, exited, how: force ? `systemctl kill ${entry.unit.name}` : `systemctl stop ${entry.unit.name}` };
    } catch (err) {
      const msg = lastLine(err);
      const hint = /access denied|interactive authentication|permission/i.test(msg) ? ' Run zoo with sudo.' : '';
      return { ok: false, status: 403, error: `Could not stop ${entry.unit.name}: ${msg}.${hint}` };
    }
  }

  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(entry.pid, signal);
  } catch (err) {
    if (err.code === 'ESRCH') return { ok: false, status: 410, error: 'Process already exited.' };
    if (err.code === 'EPERM') return { ok: false, status: 403, error: `No permission to stop PID ${entry.pid} (owned by ${entry.user}). Run zoo with sudo.` };
    return { ok: false, status: 500, error: err.message };
  }
  const exited = await waitForExit(entry.pid, force ? 1500 : 3000);
  return { ok: true, exited, how: signal };
}

/** Human label used in messages. */
export function entryLabel(e) {
  if (e.container) return `${e.container.name} (container)`;
  if (e.unit) return `${e.unit.name}`;
  return `${e.project?.name || e.command || 'process'} (pid ${e.pid})`;
}
