#!/usr/bin/env node
// Reclaims disk space by deleting produced/directed show occurrences (script,
// transcript, dj-audio, playlist.m3u, etc. -- everything under
// config.paths.runningDir/<weekday>/<showId>/<date>/) once they're older
// than config.cleanup.retentionDays. Safe to run against a live station:
// only whole date-named directories are removed, and only by parsing the
// date out of the directory name itself, not mtime -- a script/audio file
// touched today for a show that aired last week must not save it from
// cleanup, and conversely files untouched since creation but for a
// yesterday-dated show must not be removed early.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('station');

const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function listSubdirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

export async function cleanupOldShows(retentionDays = config.cleanup.retentionDays) {
  const runningDir = config.paths.runningDir;
  if (!fs.existsSync(runningDir)) return { removed: 0 };

  const cutoff = Date.now() - retentionDays * DAY_MS;
  let removed = 0;

  for (const weekday of listSubdirs(runningDir)) {
    const weekdayDir = path.join(runningDir, weekday);
    for (const showId of listSubdirs(weekdayDir)) {
      const showDir = path.join(weekdayDir, showId);
      for (const dateName of listSubdirs(showDir)) {
        if (!DATE_DIR_RE.test(dateName)) continue; // not a date dir -- leave anything unexpected alone
        // Local midnight for that date, same convention scheduleUtil.js's
        // dateKey()/weekdayKey() use elsewhere.
        const occurrenceDate = new Date(`${dateName}T00:00:00`);
        if (occurrenceDate.getTime() >= cutoff) continue; // within retention window

        const target = path.join(showDir, dateName);
        fs.rmSync(target, { recursive: true, force: true });
        removed++;
        log(`Removed ${target} (older than ${retentionDays}d)`);
      }
      // Prune the showId dir too once every date under it is gone, so a
      // show that's been removed from station.json doesn't leave an empty
      // shell behind forever.
      if (fs.existsSync(showDir) && listSubdirs(showDir).length === 0) {
        fs.rmdirSync(showDir);
      }
    }
    if (fs.existsSync(weekdayDir) && listSubdirs(weekdayDir).length === 0) {
      fs.rmdirSync(weekdayDir);
    }
  }

  if (removed > 0) {
    log(`Cleanup complete: removed ${removed} occurrence director${removed === 1 ? 'y' : 'ies'} older than ${retentionDays}d.`);
  }
  return { removed };
}

async function main() {
  const { removed } = await cleanupOldShows();
  console.log(`Cleanup complete: removed ${removed} occurrence director${removed === 1 ? 'y' : 'ies'}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
