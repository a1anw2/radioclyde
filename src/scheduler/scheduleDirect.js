// Director trigger: for each upcoming occurrence within directLeadTimeMinutes,
// direct it (synthesize DJ audio if not already cached, resolve live
// weather/time fresh, assemble playlist.m3u) if that hasn't already happened
// for this exact occurrence. Called on its own interval by scheduler.js;
// also safe to call directly for a manual dry-run.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import * as scheduleUtil from './scheduleUtil.js';
import { directShow } from '../director/index.js';
import { runSerialized } from '../lib/concurrency.js';

const log = createLogger('station');

const TIME_KEY_RE = /^\d{2}-\d{2}$/;

// showOccurrenceDir -> true while a directShow() job for it is queued or
// running. scheduler.js's setInterval fires checkAndTriggerDirect on a fixed
// clock without waiting for the previous call to finish -- without this
// guard, a directShow() queued behind other work on runSerialized (and so
// taking longer than directCheckIntervalMinutes) gets re-triggered by every
// subsequent tick that still finds no playlist.m3u, each one piling on
// another redundant, duplicate TTS run for the same occurrence. Shared with
// rebuildIncompleteOccurrences() below so its startup pass and this file's
// own interval can never both queue the same occurrence at once either.
const inFlight = new Set();

async function directOccurrence(show, weekday, date, timeKey, showOccurrenceDir) {
  if (inFlight.has(showOccurrenceDir)) return; // already kicked off on a prior tick/pass, still running

  // Same caveat as scheduleScripts.js: this may just be joining the queue
  // behind another show's still-running script/direct job, not actually
  // starting yet -- director/index.js has no equivalent "really starting
  // now" log line, so the first per-segment TTS log line is the real
  // start signal.
  log(`Show "${show.id}" airs at ${timeKey} on ${weekday} ${date} -- queuing for direct.`);
  inFlight.add(showOccurrenceDir);
  try {
    // runSerialized: shared with scheduleScripts.js so directing/TTS never
    // overlaps script generation, or another show's directing.
    await runSerialized(() => directShow({ id: show.id, weekday, date, timeKey }));
  } catch (err) {
    log(`Show "${show.id}" direct ERROR: ${err.stack || err.message}`);
  } finally {
    inFlight.delete(showOccurrenceDir);
  }
}

export async function checkAndTriggerDirect() {
  const schedule = scheduleUtil.loadSchedule();
  const now = new Date();
  const horizon = config.schedule.directLeadTimeMinutes ?? 15;

  for (const { show, weekday, date, timeKey } of scheduleUtil.upcomingOccurrences(schedule, now, horizon)) {
    const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
    const showOccurrenceDir = scheduleUtil.occurrenceDir(weekday, show.id, date, timeKey);

    if (fs.existsSync(path.join(showOccurrenceDir, 'playlist.m3u'))) continue; // already directed this occurrence

    if (!fs.existsSync(path.join(showDateDir, 'script.md'))) {
      log(`Show "${show.id}" (${weekday} ${date} ${timeKey}) has no script.md yet -- skipping direct until the scripts job catches up.`);
      continue;
    }

    await directOccurrence(show, weekday, date, timeKey, showOccurrenceDir);
  }
}

// director/index.js's directShow() mkdir's showOccurrenceDir as its very
// first step and only writes playlist.m3u at the very end, on full success
// -- so a timeKey directory that exists without a playlist.m3u next to it is
// unambiguous proof a previous direct attempt started and never finished
// (crashed mid-TTS, got killed, or lost a race with a duplicate concurrent
// attempt for the same occurrence -- e.g. two scheduler processes running at
// once, each with its own in-memory `inFlight` guard that can't see the
// other's). checkAndTriggerDirect can't rediscover these on its own:
// scheduleUtil.upcomingOccurrences only ever looks forward from "now", so
// once an occurrence's scheduled start slips into the past it drops off that
// list for good and nothing revisits it -- updateNowPlaying.js just treats
// the missing playlist.m3u as "not directed yet" and quietly leaves the
// previous/filler show playing instead. Scoped to today's and yesterday's
// date dirs, the same day-boundary convention scheduleUtil.mostRecentOccurrence()
// uses, so a partial dir from weeks ago (already irrelevant, and due for
// cleanupOldShows.js) doesn't get rebuilt for no reason.
function findIncompleteOccurrences(schedule, now) {
  const runningDir = config.paths.runningDir;
  if (!fs.existsSync(runningDir)) return [];

  const relevantDates = new Set([
    scheduleUtil.dateKey(now),
    scheduleUtil.dateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
  ]);

  const results = [];
  for (const weekday of fs.readdirSync(runningDir)) {
    const weekdayDir = path.join(runningDir, weekday);
    if (!fs.statSync(weekdayDir).isDirectory()) continue;

    for (const showId of fs.readdirSync(weekdayDir)) {
      const show = (schedule[weekday] ?? []).find((s) => s.id === showId);
      if (!show) continue; // no longer in the schedule -- not ours to rebuild

      const showDir = path.join(weekdayDir, showId);
      for (const date of fs.readdirSync(showDir)) {
        if (!relevantDates.has(date)) continue;
        const dateDir = path.join(showDir, date);
        if (!fs.statSync(dateDir).isDirectory()) continue;

        for (const timeKey of fs.readdirSync(dateDir)) {
          if (!TIME_KEY_RE.test(timeKey)) continue; // skip dj-audio/ and the date-level script/context/transcript files
          const showOccurrenceDir = path.join(dateDir, timeKey);
          if (fs.existsSync(path.join(showOccurrenceDir, 'playlist.m3u'))) continue; // finished

          results.push({ show, weekday, date, timeKey, showOccurrenceDir });
        }
      }
    }
  }
  return results;
}

// Runs once at scheduler startup, before the interval jobs get going, so a
// show left half-built by a previous run gets queued for rebuild right away
// instead of silently sitting there un-aired until someone notices.
export async function rebuildIncompleteOccurrences() {
  const schedule = scheduleUtil.loadSchedule();
  const incomplete = findIncompleteOccurrences(schedule, new Date());
  if (incomplete.length === 0) return;

  log(`Startup: found ${incomplete.length} show occurrence(s) left in a half-built state (no playlist.m3u) -- queuing for rebuild.`);
  for (const { show, weekday, date, timeKey, showOccurrenceDir } of incomplete) {
    await directOccurrence(show, weekday, date, timeKey, showOccurrenceDir);
  }
}
