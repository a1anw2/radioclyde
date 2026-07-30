#!/usr/bin/env node
// Daily safety copy of the two hand-authored station config sources --
// station.json (schedule + personality) and show-descriptions/ (per-show
// briefs) -- into config.backup.dir, dated so a bad edit to either one can be
// rolled back. Everything else under dataDir is generated/derived and
// already covered by cleanupOldShows.js's retention, not by this backup.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { dateKey } from './scheduleUtil.js';

const log = createLogger('station');

export async function backupStation() {
  const backupDir = config.backup.dir;
  const destDir = path.join(backupDir, dateKey(new Date()));
  fs.mkdirSync(destDir, { recursive: true });

  fs.cpSync(config.paths.stationFile, path.join(destDir, 'station.json'));
  fs.cpSync(config.paths.showDescriptionsDir, path.join(destDir, 'show-descriptions'), { recursive: true });

  log(`Backed up station.json and show-descriptions/ to ${destDir}`);
  return { destDir };
}

async function main() {
  const { destDir } = await backupStation();
  console.log(`Backup complete: ${destDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
