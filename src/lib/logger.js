import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { toLocalISOString } from './time.js';

const MAX_LOG_BYTES = 10 * 1024 * 1024;

// Single-backup rotation: once <name>.log passes MAX_LOG_BYTES it becomes
// <name>.log.1 (replacing whatever was there before), so a subsystem never
// accumulates more than one rotated file behind its active one.
function rotateIfNeeded(logFile) {
  let size;
  try {
    size = fs.statSync(logFile).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_BYTES) return;
  fs.renameSync(logFile, `${logFile}.1`);
}

export function createLogger(name) {
  const logFile = path.join(config.paths.logsDir, `${name}.log`);
  return function log(message) {
    const line = `[${toLocalISOString()}] ${message}`;
    // File write first, and console.log guarded: these scripts often run
    // detached (backgrounded by Liquidsoap's on_track hook), where inherited
    // stdout can be closed/invalid -- a throwing console.log must never take
    // down the process before the authoritative file log gets written.
    fs.mkdirSync(config.paths.logsDir, { recursive: true });
    rotateIfNeeded(logFile);
    fs.appendFileSync(logFile, line + '\n');
    try {
      console.log(line);
    } catch {
      // stdout unavailable in this context -- the file write above already
      // captured the message, so there's nothing more to do here.
    }
  };
}
