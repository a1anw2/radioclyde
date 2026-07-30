#!/usr/bin/env node
// Chatterbox's /restart_server endpoint (tts.js's reloadModel()) despite its
// name only reloads the model in-process -- it doesn't touch the Python
// process itself, so whatever accumulates in the process's system
// memory/swap over many shows never gets reclaimed that way. This restarts
// the OS process directly instead. The service (chatterbox-tts.service)
// runs as this same unprivileged user with Restart=always, so killing its
// PID respawns it without needing sudo -- `systemctl restart` would
// otherwise require root. Runs through the same lock file synthesis uses so
// it can't race a TTS call already in flight.
import { execFileSync } from 'node:child_process';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { withLock } from '../lib/lock.js';

const log = createLogger('station');
const SERVICE_NAME = 'chatterbox-tts.service';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read-only systemd query -- unlike start/stop/restart this needs no
// privilege, so it works for any user without a sudo/polkit rule.
function getMainPid() {
  const out = execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', SERVICE_NAME], {
    encoding: 'utf8',
  }).trim();
  return Number(out) || 0;
}

async function waitForRespawn(oldPid, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = getMainPid();
    if (pid && pid !== oldPid) return pid;
    await sleep(intervalMs);
  }
  throw new Error(`Chatterbox did not respawn within ${timeoutMs}ms`);
}

export async function restartChatterbox() {
  await withLock(config.paths.chatterboxLockPath, async () => {
    const oldPid = getMainPid();
    if (!oldPid) throw new Error(`${SERVICE_NAME} is not running (no MainPID)`);
    process.kill(oldPid, 'SIGTERM');
    const newPid = await waitForRespawn(oldPid);
    log(`Chatterbox process restarted (pid ${oldPid} -> ${newPid}).`);
  });
}

async function main() {
  await restartChatterbox();
  console.log('Chatterbox restarted.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
