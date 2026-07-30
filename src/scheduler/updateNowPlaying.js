#!/usr/bin/env node
// Decides which show should be loaded into Liquidsoap's now_playing.m3u.
// Schedule startTime picks WHICH occurrence is next up, but never cuts the
// currently-loaded one off early: a show is allowed to run past its
// scheduled slot (DJ speech + track lengths make the real runtime only an
// estimate at schedule time) and finish before the next occurrence takes
// over. This is tracked via a small persisted state file (surviving a
// scheduler restart) recording which occurrence is currently loaded and its
// real, directed duration (context.json's durationSeconds, from
// director/index.js's ffprobe pass) -- not station.json's durationMinutes.
// Once that occurrence has run its course, whatever radio.liq already does
// when show_source's playlist (loop=false) empties out -- fall back to
// filler -- takes over on its own; nothing here needs to force that.
//
// Once a show's real runtime has elapsed, the NEXT occurrence to load is
// whatever comes after it in station.json's ordered lineup (scheduleUtil's
// nextOccurrence), not "whatever the wall clock says is due now"
// (mostRecentOccurrence) -- that wall-clock re-derivation is what let filler
// creep in on every clean back-to-back transition: a show's directed runtime
// only ever approximates its nominal slot, so it essentially never finishes
// exactly on the slot boundary, and re-asking "what's the latest show whose
// scheduled start has already passed" kept returning the *same* show that
// just finished until the clock caught up to the next slot's official start.
// mostRecentOccurrence is still used to (re)synchronize to wall-clock: on
// first-ever startup (no state yet) and after a long outage (state's
// estimatedEndAt is stale by more than maxCatchUpMinutes) -- otherwise a
// multi-hour scheduler outage would resume by racing sequentially through
// every show missed instead of picking up wherever real time now is.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import * as scheduleUtil from './scheduleUtil.js';

const log = createLogger('station');

export function readNowPlayingState() {
  try {
    return JSON.parse(fs.readFileSync(config.paths.nowPlayingStatePath, 'utf8'));
  } catch {
    return null; // no prior state (first run ever, or state file missing) -- treat as nothing loaded
  }
}

function writeState(state) {
  fs.writeFileSync(config.paths.nowPlayingStatePath, JSON.stringify(state));
}

// estimatedEndAt is set below (in updateNowPlaying) as "now, at the tick that
// decided to switch" + durationSeconds -- but Liquidsoap can't actually start
// this occurrence's audio until whatever's still playing from the PREVIOUS
// occurrence's now_playing.m3u finishes its current file (reload discards
// only the not-yet-started remainder of the old list, never interrupts a
// file mid-decode -- confirmed live 2026-07-29: an already-queued sign-off
// clip got silently dropped this way). That hand-off delay is real audio time
// this occurrence never gets credited for, so estimatedEndAt was consistently
// a bit short -- just enough to eat the final segment (almost always the
// show's own sign-off, since it's last and short) on every single
// transition. Fixed by re-anchoring estimatedEndAt to this occurrence's own
// confirmed real start (scrobbleTrack.js calling this the moment its first
// segment's on_metadata actually fires) instead of trusting the tick-time
// guess. `confirmed` gates it to fire once per occurrence -- both to skip the
// playlist.m3u read on every other segment, and so a track that happens to
// repeat later in the same show's segment list can't be mistaken for the
// first one again.
export function confirmOccurrenceStart(filePath) {
  const state = readNowPlayingState();
  if (!state || state.confirmed) return;

  const occDir = scheduleUtil.occurrenceDir(state.weekday, state.id, state.date, state.timeKey);
  let firstLine;
  try {
    firstLine = fs.readFileSync(path.join(occDir, 'playlist.m3u'), 'utf8').split('\n')[0];
  } catch {
    return; // occurrence's own playlist missing -- shouldn't happen once loaded, leave state as-is
  }
  // Playlist lines are either a bare path or annotate:key="val",...:path --
  // the path itself never contains a colon on this system, so the last colon
  // in the line is always the separator, regardless of colons inside an
  // annotate value (e.g. a title containing "Some: Thing").
  const firstRealPath = firstLine.slice(firstLine.lastIndexOf(':') + 1);
  if (firstRealPath !== filePath) return; // some other (non-first) segment of this occurrence, or filler -- nothing to correct

  const { durationSeconds } = JSON.parse(fs.readFileSync(path.join(occDir, 'context.json'), 'utf8'));
  writeState({ ...state, estimatedEndAt: Date.now() + durationSeconds * 1000, confirmed: true });
}

function sameOccurrence(state, weekday, id, date, timeKey) {
  return !!state && state.weekday === weekday && state.id === id && state.date === date && state.timeKey === timeKey;
}

function currentShowEntry(schedule, state) {
  return (schedule[state.weekday] ?? []).find(
    (s) => s.id === state.id && scheduleUtil.timeKey(s.startTime) === state.timeKey
  );
}

export async function updateNowPlaying() {
  const schedule = scheduleUtil.loadSchedule();
  const now = new Date();
  const state = readNowPlayingState();

  // Currently-loaded occurrence's real (directed) runtime hasn't elapsed yet
  // -- let it keep playing even if a later occurrence's scheduled startTime
  // has already arrived.
  if (state && now.getTime() < state.estimatedEndAt) return;

  const maxCatchUpMs = (config.schedule.maxCatchUpMinutes ?? 10) * 60 * 1000;
  const staleState = state && now.getTime() - state.estimatedEndAt > maxCatchUpMs;
  const currentShow = state && !staleState ? currentShowEntry(schedule, state) : null;

  let occurrence;
  if (currentShow) {
    const next = scheduleUtil.nextOccurrence(schedule, {
      show: currentShow,
      weekday: state.weekday,
      date: state.date,
      timeKey: state.timeKey,
    });
    if (!next) return; // nothing programmed anywhere in the lineup -- leave whatever's loaded, filler covers it
    if (next.hasGap && now.getTime() < next.nextStart) return; // a real, on-paper gap -- filler fills it until next's own scheduled start
    occurrence = next;
  } else {
    // First run ever, or the scheduler was down long enough that resuming
    // sequentially from `state` would just race through everything missed --
    // resynchronize to whatever wall-clock says is airing right now instead.
    occurrence = scheduleUtil.mostRecentOccurrence(schedule, now);
  }
  if (!occurrence) return; // nothing has started yet today (or yesterday) -- leave now_playing.m3u alone

  const { show, weekday, date, timeKey } = occurrence;
  if (sameOccurrence(state, weekday, show.id, date, timeKey)) return; // already the one loaded -- nothing to do

  const occDir = scheduleUtil.occurrenceDir(weekday, show.id, date, timeKey);
  const playlistPath = path.join(occDir, 'playlist.m3u');
  const contextPath = path.join(occDir, 'context.json');
  if (!fs.existsSync(playlistPath) || !fs.existsSync(contextPath)) return; // due on, but not directed yet -- leave the current show playing

  const { durationSeconds } = JSON.parse(fs.readFileSync(contextPath, 'utf8'));

  // now_playing.m3u carries the occurrence's actual segment list directly
  // (not a pointer to the other file) -- Liquidsoap's playlist parser treats
  // every line as a media request, so nesting an m3u reference wouldn't
  // resolve.
  fs.writeFileSync(config.paths.nowPlayingPath, fs.readFileSync(playlistPath, 'utf8'));
  writeState({
    weekday,
    id: show.id,
    date,
    timeKey,
    // Provisional -- confirmOccurrenceStart corrects this once the occurrence's
    // first segment is confirmed actually airing (see its own comment above).
    estimatedEndAt: now.getTime() + (durationSeconds ?? (show.durationMinutes ?? 60) * 60) * 1000,
    confirmed: false,
  });
  log(`Now playing: "${show.id}" (${weekday} ${timeKey}) -> ${playlistPath}`);
}

async function main() {
  await updateNowPlaying();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
