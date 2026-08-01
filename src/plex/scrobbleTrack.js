#!/usr/bin/env node
// Invoked once per track start by radio.liq's on_track hook, as a detached
// OS process (Liquidsoap's on_track callback runs in the main streaming
// thread and must stay fast, so it can't make the Plex HTTP call itself --
// see liquidsoap/radio.liq). Fires optimistically at track start rather than
// waiting for playback to complete; that tradeoff is fine here since the
// goal is just keeping Plex's counts/history roughly in sync with what
// airs, not a verified play confirmation.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { toLocalISOString } from '../lib/time.js';
import { scrobbleTrack } from './scrobble.js';
import { lookupRatingKey } from './ratingKeyIndex.js';
import { getTrackByRatingKey } from './tracks.js';
import { readNowPlayingState, confirmOccurrenceStart, updateNowPlaying } from '../scheduler/updateNowPlaying.js';
import { getListenerCount } from '../icecast/listeners.js';

const log = createLogger('station');
const filePath = process.argv[2];
const djName = process.argv[3]; // director/playlist.js's annotate: "dj" field -- "" for track entries and the jingle

// Real-time counterpart to producer/history.js's played.jsonl: that file is
// written at production time (up to scriptLeadTimeMinutes ahead of air), so
// it can't answer "what's airing right now" for the web page. This fires
// exactly when a track actually starts, so it's the accurate source for
// both now_playing_track.json (src/server/nowPlaying.js) and the web
// history API (src/server/historyApi.js).
function recordNowPlaying(track) {
  const state = readNowPlayingState();
  const entry = {
    ratingKey: track.ratingKey,
    artist: track.artist,
    title: track.title,
    album: track.album,
    art: track.art,
    durationMs: track.durationMs,
    showId: state?.id ?? null,
    playedAt: toLocalISOString(),
  };
  fs.writeFileSync(config.paths.nowPlayingTrackPath, JSON.stringify(entry));
  fs.mkdirSync(path.dirname(config.paths.airedHistoryFile), { recursive: true });
  fs.appendFileSync(config.paths.airedHistoryFile, JSON.stringify(entry) + '\n');
}

// DJ speech isn't a "play" (no aired.jsonl entry, no Plex scrobble) -- just
// overwrites now_playing_track.json so the web page can show "<persona>
// talking" instead of freezing on whatever track played last.
function recordDjTalking(persona) {
  fs.writeFileSync(config.paths.nowPlayingTrackPath, JSON.stringify({ dj: persona, startedAt: toLocalISOString() }));
}

async function main() {
  if (!filePath) {
    log('Called with no file path argument -- skipping.');
    return;
  }

  // Fires on every segment (jingle, speech, track, filler), not just the
  // ones handled below -- confirmOccurrenceStart itself is a no-op past the
  // currently-loaded occurrence's own first segment, see its comment in
  // scheduler/updateNowPlaying.js for why this needs to run here at all.
  confirmOccurrenceStart(filePath);

  // Reactive nudge, not a replacement for scheduler.js's own fixed-interval
  // call -- show_source (radio.liq) is loop=false, so the instant a show's
  // real audio runs out, Liquidsoap falls back to filler on its own, in real
  // time. If nothing swaps the next occurrence's playlist into
  // now_playing.m3u until scheduler.js's next nowPlayingCheckIntervalMinutes
  // tick (currently 1min), a clean back-to-back handoff (no gap in
  // station.json) still audibly plays filler-then-jingle-then-show instead
  // of cutting straight over. Calling this here means the very next segment
  // to start airing -- typically the first filler track, since fallback()
  // picks one up within a second or two of show_source emptying -- catches
  // the transition almost immediately instead of waiting out the poll. Cheap
  // and safe to call on every single segment: for any segment well before
  // the current occurrence's estimatedEndAt (the overwhelming majority),
  // updateNowPlaying() reads two small files and returns immediately.
  // Runs in its own detached process per segment (see this file's header),
  // separate from scheduler.js's daemon process -- both racing to write the
  // same state file/now_playing.m3u is safe here because the function is
  // idempotent (sameOccurrence() early-returns once either has applied the
  // switch) and a redundant duplicate write is harmless, so no cross-process
  // lock is needed for this.
  await updateNowPlaying();

  const ratingKey = lookupRatingKey(filePath);
  if (!ratingKey) {
    if (djName) {
      recordDjTalking(djName);
      log(`DJ speaking: "${djName}".`);
    } else {
      log(`No known ratingKey for "${filePath}" (jingle or unannotated speech) -- skipping.`);
    }
    return;
  }

  // scrobbleEnabled only gates the Plex ping -- now-playing/history are
  // local-only and should stay accurate regardless of whether Plex's own
  // view-count is being kept in sync.
  if (config.plex.scrobbleEnabled !== false) {
    try {
      const listenerCount = await getListenerCount();
      if (listenerCount > 0) {
        await scrobbleTrack(ratingKey);
        log(`Scrobbled ratingKey ${ratingKey} ("${filePath}").`);
      } else {
        log(`No active Icecast listeners -- skipping Plex scrobble for ratingKey ${ratingKey}.`);
      }
    } catch (err) {
      log(`Plex scrobble skipped for ratingKey ${ratingKey}: ${err.message}`);
    }
  }

  const track = await getTrackByRatingKey(ratingKey);
  recordNowPlaying(track);
}

main().catch((err) => {
  log(`ERROR scrobbling "${filePath}": ${err.stack || err.message}`);
  process.exitCode = 1;
});
