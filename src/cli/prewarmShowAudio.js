#!/usr/bin/env node
import { createLogger } from '../lib/logger.js';
import { parseArgs } from '../lib/args.js';
import * as scheduleUtil from '../scheduler/scheduleUtil.js';
import { prewarmShowAudio } from '../director/prewarmAudio.js';

const log = createLogger('station');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { id } = args;
  if (!id) {
    throw new Error('Usage: prewarmShowAudio.js --id=<showId> [--weekday=<weekday> --date=<yyyy-mm-dd>] (defaults to today)');
  }
  const now = new Date();
  const weekday = args.weekday || scheduleUtil.weekdayKey(now);
  const date = args.date || scheduleUtil.dateKey(now);

  const { warmed, total } = await prewarmShowAudio({ id, weekday, date });
  log(`Prewarmed "${id}": ${warmed}/${total} dj segment(s) synthesized (rest already cached).`);
}

main().catch((err) => {
  log(`ERROR: ${err.stack || err.message}`);
  process.exitCode = 1;
});
