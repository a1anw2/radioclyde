#!/usr/bin/env node
// Off-air filler: a big shuffled pool from the whole music library, so
// Liquidsoap's fallback() has something to play whenever no show is
// scheduled (or the scheduled show isn't ready yet) instead of the station
// going fully silent and Icecast clients disconnecting. Deliberately does
// NOT call recordPlayed() -- filler plays shouldn't shrink the recently-
// played pool that narrow curated shows (single-artist, etc.) draw from.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { fetchAllTracks } from '../plex/tracks.js';
import { dedupeByTitle, matchesExcludedKeyword } from '../plex/trackFilters.js';
import { recentlyPlayedRatingKeys } from '../producer/history.js';
import { toLocalPath } from '../plex/musicLibrary.js';
import { mergeTrackRatingKeys } from '../plex/ratingKeyIndex.js';
import { shuffle } from '../lib/format.js';
import * as scheduleUtil from './scheduleUtil.js';
import { annotateTrackEntry } from '../director/playlist.js';

const log = createLogger('station');

export async function generateFillerPlaylist() {
  const all = await fetchAllTracks();
  const recentlyPlayed = recentlyPlayedRatingKeys();
  // Which keywords to exclude is a curatorial/personality choice (station.json),
  // not an operational one -- config.json's filler block keeps poolSize/
  // intervals/max duration, the mechanical knobs.
  const excludeKeywords = scheduleUtil.loadStation().filler?.excludeKeywords ?? [];
  const maxTrackDurationMs = config.filler.maxTrackDurationSeconds
    ? config.filler.maxTrackDurationSeconds * 1000
    : undefined;
  const eligible = dedupeByTitle(all).filter(
    (t) =>
      !recentlyPlayed.has(String(t.ratingKey)) &&
      !matchesExcludedKeyword(t, excludeKeywords) &&
      (!maxTrackDurationMs || t.durationMs <= maxTrackDurationMs)
  );

  const pool = shuffle(eligible).slice(0, config.filler.poolSize);
  const localPaths = pool.map((t) => toLocalPath(t.plexPath));
  // Same fade-up as show tracks (director/playlist.js's annotateTrackEntry)
  // -- filler is real music too, no reason it should hard-cut in while show
  // tracks fade.
  const content = localPaths.map(annotateTrackEntry).join('\n') + '\n';

  // Feeds scrobbleTrack.js's path->ratingKey lookup, same as director/index.js.
  await mergeTrackRatingKeys(pool.map((t, i) => [localPaths[i], t.ratingKey]));

  fs.mkdirSync(path.dirname(config.paths.fillerPath), { recursive: true });
  fs.writeFileSync(config.paths.fillerPath, content);
  log(`Wrote filler playlist: ${pool.length} tracks -> ${config.paths.fillerPath}`);
  return { trackCount: pool.length };
}

async function main() {
  const { trackCount } = await generateFillerPlaylist();
  console.log(`Filler playlist: ${trackCount} tracks -> ${config.paths.fillerPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
