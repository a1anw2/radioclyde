#!/usr/bin/env node
// Chatterbox keeps its model resident in GPU memory between requests and
// unloadVoice() (director/tts.js) only releases that after each show -- over
// many shows something beyond that still accumulates in system memory, so
// this restarts the Python process itself once a day rather than relying on
// the per-show unload alone. Runs through the same lock file synthesis uses
// so it can't race a TTS call already in flight.
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { withLock } from '../lib/lock.js';
import { reloadModel } from '../director/tts.js';

const log = createLogger('station');

export async function restartChatterbox() {
  await withLock(config.paths.chatterboxLockPath, reloadModel);
  log('Chatterbox restarted (daily maintenance).');
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
