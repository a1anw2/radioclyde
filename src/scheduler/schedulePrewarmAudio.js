// Prewarm trigger: continuously warms every scheduled show's dj-audio cache
// as far ahead as config.schedule.prewarmHorizonMinutes (default 24h) --
// runs on every tick, any time of day, not just during station.json's
// downtime window. It used to be downtime-only, on the idea that the bulk of
// TTS synthesis should happen while filler is playing and nothing needs the
// resource. In practice that meant a show airing outside the downtime window
// (e.g. an evening slot, script produced hours in advance but never
// prewarmed because prewarm itself only ran overnight) fell through to
// scheduleDirect.js's near-air-time pass with nothing cached, forcing live
// per-line synthesis -- several CPU-only minutes per line -- that blocked
// the shared queue for the better part of an hour and knocked the station
// onto filler (confirmed live 2026-08-07 with "british-artists"). Now it
// picks up any show with a script and no `.prewarmed` marker whenever the
// queue is free, same as before, just without the time-of-day gate. The
// horizon cap keeps it from burning synthesis on a show so far out its
// schedule could still change before it airs; downtime still gets scripts
// produced a full day ahead (scheduleScripts.js), so this mostly just
// catches up on whatever that pass left unwarmed. Called on its own
// interval by scheduler.js; also safe to call directly for a manual dry-run.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import * as scheduleUtil from './scheduleUtil.js';
import { prewarmShowAudio } from '../director/prewarmAudio.js';
import { runSerialized } from '../lib/concurrency.js';

const log = createLogger('station');

// showDateDir -> true while a prewarmShowAudio() job for it is queued or
// running -- same reasoning as scheduleScripts.js's own inFlight guard: this
// job's own setInterval tick can fire again before a prior call (queued
// behind other work on runSerialized) has finished.
const inFlight = new Set();

export async function checkAndTriggerPrewarmAudio() {
  const schedule = scheduleUtil.loadSchedule();
  const now = new Date();
  const horizon = config.schedule.prewarmHorizonMinutes ?? 24 * 60;

  for (const { show, weekday, date } of scheduleUtil.upcomingOccurrences(schedule, now, horizon)) {
    const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
    const scriptPath = path.join(showDateDir, 'script.md');
    if (!fs.existsSync(scriptPath)) continue; // scripts job hasn't produced this yet -- picked up on a later tick

    const djAudioDir = path.join(showDateDir, 'dj-audio');
    const markerPath = path.join(djAudioDir, '.prewarmed');
    if (fs.existsSync(markerPath)) continue; // already warmed for this show/date
    if (inFlight.has(showDateDir)) continue;
    inFlight.add(showDateDir);

    log(`Show "${show.id}" (${weekday} ${date}) -- queuing for dj-audio prewarm.`);
    try {
      // runSerialized: shared with scheduleScripts.js/scheduleDirect.js so
      // this prewarm work never overlaps another show's script/direct job
      // or another prewarm pass.
      await runSerialized(() => prewarmShowAudio({ id: show.id, weekday, date }));
      fs.mkdirSync(djAudioDir, { recursive: true });
      fs.writeFileSync(markerPath, new Date().toISOString());
    } catch (err) {
      log(`Show "${show.id}" dj-audio prewarm ERROR: ${err.stack || err.message}`);
    } finally {
      inFlight.delete(showDateDir);
    }
  }
}
