// Producer trigger: for each upcoming occurrence within scriptLeadTimeMinutes,
// produce script.md if it doesn't already exist for that show/day -- this is
// what makes a same-day repeat (e.g. Elvis at 10am and 2pm) reuse the same
// script instead of re-running track selection, while a repeat on a
// different day always regenerates (different date -> different dateDir).
// Called on its own interval by scheduler.js; also safe to call directly for
// a manual dry-run.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import * as scheduleUtil from './scheduleUtil.js';
import { generateScript } from '../producer/generateScript.js';
import { runSerialized } from '../lib/concurrency.js';

const log = createLogger('station');

// showDateDir -> true while a generateScript() job for it is queued or
// running. Guards two things: two same-day occurrences of one show both
// landing in the horizon at once, AND scheduler.js's setInterval firing
// checkAndTriggerScripts again before a prior call's generateScript() (queued
// behind other work on runSerialized, and often slower than
// scriptCheckIntervalMinutes -- LLM track research + boundary-walk moves)
// has finished -- without this, every subsequent tick that still finds no
// script.md re-triggers another redundant run for the same show/day.
const inFlight = new Set();

export async function checkAndTriggerScripts() {
  const schedule = scheduleUtil.loadSchedule();
  const downtime = scheduleUtil.loadDowntime();
  const now = new Date();
  // During the downtime window (station.json's "downtime"), front-load
  // script production for the whole broadcast day ahead -- the heavy
  // LLM/research/track-selection work -- instead of trickling it out show by
  // show on scriptLeadTimeMinutes, so it runs while filler is playing and
  // nothing needs the resource.
  const horizon = scheduleUtil.isDowntime(downtime, now)
    ? scheduleUtil.minutesUntilNextDowntimeStart(downtime, now)
    : config.schedule.scriptLeadTimeMinutes ?? 120;

  for (const { show, weekday, date } of scheduleUtil.upcomingOccurrences(schedule, now, horizon)) {
    const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
    if (fs.existsSync(path.join(showDateDir, 'script.md'))) continue;
    if (inFlight.has(showDateDir)) continue;

    // Getting out ahead, not catching up: production reliably takes at
    // least config.schedule.minLeadTimeMinutes end to end (and script
    // production is only the first half of it, direct/TTS still to come),
    // so an occurrence with less runway than that left before air can't
    // finish in time no matter when we start -- skip it here, before ever
    // touching the queue. This is per-occurrence, not per-show/day: a
    // same-day repeat (e.g. Elvis at 10am and 2pm) will just have this
    // check fail on the 10am iteration and succeed on the 2pm one.
    if (!scheduleUtil.hasLeadTime(date, show, new Date())) {
      log(`Show "${show.id}" (${weekday} ${date}) -- less than ${config.schedule.minLeadTimeMinutes ?? 30}min before air, skipping instead of starting something that can't finish in time.`);
      continue;
    }

    inFlight.add(showDateDir);

    // Not necessarily "kicking off" yet -- runSerialized may still be
    // working through another show's script/direct job first (its shared
    // tail spans both this job and scheduleDirect.js's), in which case this
    // one just queued and generateScript()'s own "Starting producer
    // pipeline..." log line is the true start-of-work signal.
    log(`Show "${show.id}" airs on ${weekday} ${date} -- queuing for script production.`);
    try {
      // runSerialized: AI work must run one job at a time across the whole
      // station, never overlapping another show's script/direct job.
      await runSerialized(() => {
        // Re-check on the way OUT of the queue: a backlog can delay this
        // long enough that every occurrence of this show today has dropped
        // below minLeadTimeMinutes (aired, or fallen out of reach) by the
        // time it's this job's turn -- same reasoning as scheduleDirect.js's
        // own check. anyOccurrenceHasLeadTime (not just the occurrence that
        // triggered this) so a same-day repeat still gets its script as long
        // as a later showing still has enough runway.
        if (!scheduleUtil.anyOccurrenceHasLeadTime(schedule, weekday, show.id, date, new Date())) {
          log(`Show "${show.id}" (${weekday} ${date}) -- less than ${config.schedule.minLeadTimeMinutes ?? 30}min before every remaining occurrence today, skipping script production instead of catching up.`);
          return;
        }
        return generateScript({ id: show.id, weekday, date });
      });
    } catch (err) {
      log(`Show "${show.id}" script production ERROR: ${err.stack || err.message}`);
    } finally {
      inFlight.delete(showDateDir);
    }
  }
}
