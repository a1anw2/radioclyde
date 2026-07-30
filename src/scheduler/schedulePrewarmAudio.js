// Downtime trigger: while station.json's downtime window is active, warms
// every scheduled show's dj-audio cache as far ahead as the next downtime
// window (i.e. the whole broadcast day) -- so the bulk of TTS synthesis
// happens while filler is playing and nothing needs the resource, and
// scheduleDirect.js's own near-air-time pass (unchanged) finds the cache
// already warm and only has to resolve genuinely live content (weather/time)
// and finish assembly. A no-op outside the downtime window, or if
// station.json has no "downtime" configured. Called on its own interval by
// scheduler.js; also safe to call directly for a manual dry-run.
import fs from 'node:fs';
import path from 'node:path';
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
  const downtime = scheduleUtil.loadDowntime();
  const now = new Date();
  if (!scheduleUtil.isDowntime(downtime, now)) return;

  const schedule = scheduleUtil.loadSchedule();
  const horizon = scheduleUtil.minutesUntilNextDowntimeStart(downtime, now);

  for (const { show, weekday, date } of scheduleUtil.upcomingOccurrences(schedule, now, horizon)) {
    const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
    const scriptPath = path.join(showDateDir, 'script.md');
    if (!fs.existsSync(scriptPath)) continue; // scripts job hasn't produced this yet -- picked up on a later tick

    const djAudioDir = path.join(showDateDir, 'dj-audio');
    const markerPath = path.join(djAudioDir, '.prewarmed');
    if (fs.existsSync(markerPath)) continue; // already warmed for this show/date
    if (inFlight.has(showDateDir)) continue;
    inFlight.add(showDateDir);

    log(`Show "${show.id}" (${weekday} ${date}) -- queuing for downtime dj-audio prewarm.`);
    try {
      // runSerialized: shared with scheduleScripts.js/scheduleDirect.js so
      // this downtime prewarm work never overlaps another show's
      // script/direct job or another prewarm pass.
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
