// Detects edits to station.json and invalidates whatever stale production
// artifacts they'd otherwise leave behind. scheduleScripts.js/scheduleDirect.js
// only ever check *existence* of script.md/playlist.m3u -- they have no way
// to notice that the schedule entry a produced occurrence was built from has
// since changed (different startTime/durationMinutes/description). Without
// this, an edit made within the lead-time windows (or after an occurrence's
// already been directed) is silently masked by the stale files sitting there
// from before the edit.
//
// Policy: never touch the occurrence currently on air (per now_playing_state.json)
// -- everything else that's already been produced (scripted and/or directed,
// even if directed audio is sitting there ready but hasn't started playing
// yet) gets wiped so the normal scripts/direct ticks regenerate it fresh.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import * as scheduleUtil from './scheduleUtil.js';

const log = createLogger('station');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readLastHash() {
  try {
    return fs.readFileSync(config.paths.stationHashPath, 'utf8').trim();
  } catch {
    return null; // never checked before (first boot, or file predates this feature)
  }
}

function readNowPlayingState() {
  try {
    return JSON.parse(fs.readFileSync(config.paths.nowPlayingStatePath, 'utf8'));
  } catch {
    return null;
  }
}

function isCurrentlyAiring(state, now, weekday, showId, date, timeKey) {
  return (
    !!state &&
    now.getTime() < state.estimatedEndAt &&
    state.weekday === weekday &&
    state.id === showId &&
    state.date === date &&
    state.timeKey === timeKey
  );
}

// True if the occurrence currently on air is *any* same-day repeat of this
// exact show (same weekday/id/date, any timeKey) -- distinct from
// isCurrentlyAiring, which also requires the same timeKey.
function anyRepeatCurrentlyAiring(state, now, weekday, showId, date) {
  return (
    !!state &&
    now.getTime() < state.estimatedEndAt &&
    state.weekday === weekday &&
    state.id === showId &&
    state.date === date
  );
}

// Wipes produced artifacts for every occurrence that isn't the one currently
// on air. Returns { invalidatedCount, deferredCount } -- deferredCount is
// nonzero when a same-day repeat's dateDir-level assets (script.md,
// dj-audio/) couldn't be touched because a sibling occurrence of that same
// show/date is currently on air; the caller must retry later rather than
// consider the station.json edit fully applied.
export function invalidateStaleProduction(schedule, now) {
  const state = readNowPlayingState();
  // scriptLeadTimeMinutes is normally the widest window anything could
  // already have been produced within -- but a configured downtime window
  // (station.json's "downtime") lets scheduleScripts.js/schedulePrewarmAudio.js
  // front-load a whole day's shows overnight, so once one exists the sweep
  // has to reach as far as the next downtime start too, or an edit made
  // later in the day leaves stale script/dj-audio/playlist files from that
  // overnight run sitting there unnoticed.
  const downtime = scheduleUtil.loadDowntime();
  const horizonMinutes = downtime
    ? Math.max(config.schedule.scriptLeadTimeMinutes ?? 120, scheduleUtil.minutesUntilNextDowntimeStart(downtime, now))
    : config.schedule.scriptLeadTimeMinutes ?? 120;
  const occurrences = scheduleUtil.upcomingOccurrences(schedule, now, horizonMinutes);

  let invalidatedCount = 0;
  let deferredCount = 0;
  const seenDateDirs = new Set();

  for (const { show, weekday, date, timeKey } of occurrences) {
    // upcomingOccurrences only returns occurrences that haven't started yet
    // (minutesUntil >= 0), so the occurrence actually on air can never appear
    // here itself -- this check exists for the edge case right below.
    if (isCurrentlyAiring(state, now, weekday, show.id, date, timeKey)) continue;

    const occDir = scheduleUtil.occurrenceDir(weekday, show.id, date, timeKey);
    if (fs.existsSync(occDir)) {
      fs.rmSync(occDir, { recursive: true, force: true });
      invalidatedCount++;
      log(`Invalidated directed occurrence "${show.id}" ${weekday} ${date} ${timeKey} (station.json changed).`);
    }

    // script.md and dj-audio/ live one level up at the dateDir, shared by
    // every same-day repeat of this show. If a same-day repeat is currently
    // on air, its dj-only segments may point straight at dj-audio/dj_NNN.wav
    // (director/index.js only concats into the occurrence dir when a track
    // breaks up consecutive speech) -- wiping the shared cache out from
    // under a live broadcast would kill audio mid-air, so skip the whole
    // dateDir until that repeat finishes.
    const dateDirKey = `${weekday}|${show.id}|${date}`;
    if (seenDateDirs.has(dateDirKey)) continue;
    seenDateDirs.add(dateDirKey);
    if (anyRepeatCurrentlyAiring(state, now, weekday, show.id, date)) {
      const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
      if (fs.existsSync(path.join(showDateDir, 'script.md'))) {
        deferredCount++;
        log(`Deferred invalidating script for "${show.id}" ${weekday} ${date} -- a same-day repeat is currently on air.`);
      }
      continue;
    }

    const showDateDir = scheduleUtil.dateDir(weekday, show.id, date);
    const scriptPath = path.join(showDateDir, 'script.md');
    if (fs.existsSync(scriptPath)) {
      fs.rmSync(scriptPath);
      invalidatedCount++;
      log(`Invalidated script for "${show.id}" ${weekday} ${date} (station.json changed).`);
    }

    // dj-audio/ caches synthesized clips by segment *index* within
    // script.md (director/index.js's getDjAudio), not by content -- if
    // script.md regenerates with different text, stale clips at the same
    // index would otherwise get silently reused for the wrong line. Must go
    // whenever script.md does.
    const djAudioDir = path.join(showDateDir, 'dj-audio');
    if (fs.existsSync(djAudioDir)) {
      fs.rmSync(djAudioDir, { recursive: true, force: true });
      invalidatedCount++;
    }
  }

  return { invalidatedCount, deferredCount };
}

// Called on its own interval by scheduler.js. Cheap no-op on every tick where
// station.json hasn't changed since the last *fully applied* check -- if a
// prior pass deferred anything (a same-day repeat was on air), the persisted
// hash is deliberately held back so this keeps retrying every tick until the
// live repeat finishes and the deferred dateDir can finally be invalidated.
export function checkScheduleChanged() {
  const currentHash = hashFile(config.paths.stationFile);
  const lastHash = readLastHash();

  if (lastHash === currentHash) return;

  if (lastHash === null) {
    // Nothing to compare against yet (first run ever) -- just record the
    // baseline. Treating this as "changed" would invalidate everything
    // already produced on every fresh scheduler boot, which isn't a real
    // station.json edit.
    fs.writeFileSync(config.paths.stationHashPath, currentHash);
    return;
  }

  log('station.json changed -- invalidating stale not-yet-aired production.');
  const schedule = scheduleUtil.loadSchedule();
  const { invalidatedCount, deferredCount } = invalidateStaleProduction(schedule, new Date());
  log(`station.json change handled -- ${invalidatedCount} artifact(s) invalidated, ${deferredCount} deferred.`);

  // Only mark this station.json content as fully applied once nothing was
  // deferred -- otherwise leave lastHash pointing at the *previous* content
  // so the next tick's mismatch triggers another (cheap, mostly-no-op) pass.
  if (deferredCount === 0) {
    fs.writeFileSync(config.paths.stationHashPath, currentHash);
  }
}
