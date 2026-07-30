#!/usr/bin/env node
import { createLogger } from '../lib/logger.js';
import { parseArgs } from '../lib/args.js';
import * as scheduleUtil from '../scheduler/scheduleUtil.js';
import { directShow } from '../director/index.js';

const log = createLogger('station');

function pad2(n) {
  return String(n).padStart(2, '0');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { id, time } = args;
  if (!id) {
    throw new Error(
      'Usage: directShow.js --id=<showId> [--weekday=<weekday> --date=<yyyy-mm-dd> --time=<HH:MM>] (defaults to now)'
    );
  }
  const now = new Date();
  const weekday = args.weekday || scheduleUtil.weekdayKey(now);
  const date = args.date || scheduleUtil.dateKey(now);
  const timeKey = scheduleUtil.timeKey(time || `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);

  const { outDir, segmentCount } = await directShow({ id, weekday, date, timeKey });
  log(`Directed "${id}": ${segmentCount} segments -> ${outDir}/playlist.m3u`);
}

main().catch((err) => {
  log(`ERROR: ${err.stack || err.message}`);
  process.exitCode = 1;
});
