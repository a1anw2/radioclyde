#!/usr/bin/env node
// The single coordinating daemon: one long-running process (run under
// systemd) that owns every timing decision for the station. Each job is a
// plain exported async function living in its own module -- so each stays
// independently testable/dry-runnable -- wired here to its own interval.
// A crash inside any one job's tick is caught and logged without touching
// the others; heavy/slow work (LLM calls, TTS synthesis) still runs
// serialized via lib/concurrency.js's runSerialized, never overlapping.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import * as scheduleUtil from './scheduleUtil.js';
import { checkScheduleChanged } from './scheduleWatch.js';
import { checkAndTriggerScripts } from './scheduleScripts.js';
import { checkAndTriggerDirect, rebuildIncompleteOccurrences } from './scheduleDirect.js';
import { checkAndTriggerPrewarmAudio } from './schedulePrewarmAudio.js';
import { updateNowPlaying } from './updateNowPlaying.js';
import { generateFillerPlaylist } from './generateFillerPlaylist.js';
import { cleanupOldShows } from './cleanupOldShows.js';
import { backupStation } from './backupStation.js';
import { restartChatterbox } from './restartChatterbox.js';

const log = createLogger('station');

function every(minutes, label, fn) {
  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      log(`${label} ERROR: ${err.stack || err.message}`);
    }
  };
  tick(); // run once immediately at startup, then on the interval
  setInterval(tick, minutes * 60 * 1000);
}

// Runs once at process start, before the interval jobs get a chance to act,
// so a restart immediately tells you where every upcoming show actually
// stands (no script yet / script done but not directed yet / fully directed)
// instead of that only being inferrable by watching for the next tick to
// either act or silently skip it.
function logStartupStatus() {
  const schedule = scheduleUtil.loadSchedule();
  const now = new Date();
  const horizonMinutes = Math.max(config.schedule.scriptLeadTimeMinutes ?? 120, 24 * 60);
  const occurrences = scheduleUtil
    .upcomingOccurrences(schedule, now, horizonMinutes)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);

  if (occurrences.length === 0) {
    log(`Startup: no shows scheduled in the next ${horizonMinutes}min.`);
    return;
  }

  log(`Startup: ${occurrences.length} show occurrence(s) scheduled in the next ${horizonMinutes}min:`);
  for (const { show, weekday, date, timeKey, minutesUntil } of occurrences) {
    const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
    const showOccurrenceDir = scheduleUtil.occurrenceDir(weekday, show.id, date, timeKey);
    const scriptReady = fs.existsSync(path.join(showDateDir, 'script.md'));
    const directed = fs.existsSync(path.join(showOccurrenceDir, 'playlist.m3u'));

    let status;
    if (directed) {
      status = 'directed -- ready to air';
    } else if (scriptReady) {
      status =
        minutesUntil <= (config.schedule.directLeadTimeMinutes ?? 15)
          ? 'script ready -- direct/audio job should pick it up this tick'
          : `script ready, awaiting audio creation (director triggers ${config.schedule.directLeadTimeMinutes}min before air)`;
    } else {
      status =
        minutesUntil <= (config.schedule.scriptLeadTimeMinutes ?? 120)
          ? 'no script yet -- producer should pick it up this tick'
          : `not yet due (script production triggers ${config.schedule.scriptLeadTimeMinutes}min before air)`;
    }
    log(`  "${show.id}" airs ${weekday} ${date} ${show.startTime} (in ${minutesUntil}min): ${status}`);
  }
}

log('Scheduler starting...');
logStartupStatus();

// Fire-and-forget, same as every()'s own immediate tick() below: it chains
// onto the same runSerialized tail as the scripts/direct jobs (so it never
// overlaps their TTS/LLM work), but startup itself doesn't block on it.
rebuildIncompleteOccurrences().catch((err) => log(`Startup rebuild-check ERROR: ${err.stack || err.message}`));

every(config.schedule.scheduleWatchIntervalMinutes ?? 1, 'schedule_watch', checkScheduleChanged);
every(config.schedule.scriptCheckIntervalMinutes, 'schedule_scripts', checkAndTriggerScripts);
every(config.schedule.directCheckIntervalMinutes, 'schedule_direct', checkAndTriggerDirect);
every(config.schedule.prewarmCheckIntervalMinutes ?? config.schedule.scriptCheckIntervalMinutes, 'schedule_prewarm', checkAndTriggerPrewarmAudio);
every(config.schedule.nowPlayingCheckIntervalMinutes, 'now_playing', updateNowPlaying);
every(config.filler.regenerateIntervalMinutes, 'filler', generateFillerPlaylist);
every(config.cleanup.intervalMinutes, 'cleanup', cleanupOldShows);
every(config.backup.intervalMinutes, 'backup', backupStation);
every(config.chatterbox.restartIntervalMinutes ?? 1440, 'chatterbox_restart', restartChatterbox);

log('Scheduler started.');
