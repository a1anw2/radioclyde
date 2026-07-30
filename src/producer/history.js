import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { toLocalISOString } from '../lib/time.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureHistoryFile() {
  fs.mkdirSync(path.dirname(config.paths.historyFile), { recursive: true });
  if (!fs.existsSync(config.paths.historyFile)) {
    fs.writeFileSync(config.paths.historyFile, '');
  }
}

function readEntries() {
  ensureHistoryFile();
  return fs
    .readFileSync(config.paths.historyFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Rolling window, not a permanent ban: a narrow theme (single artist, or a
// tight decade+genre combo) can have far fewer tracks than an hour needs, so
// a song must become eligible again after repeatWindowDays rather than being
// excluded forever.
export function recentlyPlayedRatingKeys(windowDays = config.shows.repeatWindowDays) {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const set = new Set();
  for (const entry of readEntries()) {
    if (new Date(entry.playedAt).getTime() >= cutoff) {
      set.add(String(entry.ratingKey));
    }
  }
  return set;
}

// Album-level counterpart to recentlyPlayedRatingKeys, for single-album
// shows (buildTrackQueue's singleAlbum mode). Track-level history is the
// wrong granularity for "don't repeat" there: a single-album show's whole
// point is repeating the SAME handful of tracks together as one unit, so
// blocking individual tracks station-wide would either pointlessly starve
// the pool of a re-picked album's own songs, or (worse) do nothing useful
// since the real repeat concern is the album recurring too soon, not any one
// song. Derived from the same history entries as recentlyPlayedRatingKeys
// (an album is "recently played" if any track recorded against it falls
// inside the window) rather than a separate log, so there's one history file
// and one source of truth.
function normalizeAlbumKey(artist, album) {
  return `${artist}|||${album}`.toLowerCase();
}

export function recentlyPlayedAlbumKeys(windowDays = config.shows.repeatWindowDays) {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const set = new Set();
  for (const entry of readEntries()) {
    if (entry.album && new Date(entry.playedAt).getTime() >= cutoff) {
      set.add(normalizeAlbumKey(entry.artist, entry.album));
    }
  }
  return set;
}

export function albumKey(artist, album) {
  return normalizeAlbumKey(artist, album);
}

// Title-only counterpart to recentlyPlayedAlbumKeys, for pseudo-albums built
// by grouping folder-scoped tracks by album title (see
// plex/albums.js's fetchAlbumsByFolder) -- a folder-organized soundtrack
// album credits each track to its own composer/performer rather than one
// consistent "artist", so the artist+album composite key normalizeAlbumKey
// relies on can't reliably catch the same soundtrack recurring across
// occurrences (different tracks of the same album get recorded under
// different artist values). Matching on album title alone is the only
// signal that's actually stable there.
export function recentlyPlayedAlbumTitles(windowDays = config.shows.repeatWindowDays) {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const set = new Set();
  for (const entry of readEntries()) {
    if (entry.album && new Date(entry.playedAt).getTime() >= cutoff) {
      set.add(entry.album.toLowerCase());
    }
  }
  return set;
}

export function recordPlayed(track, showId) {
  ensureHistoryFile();
  const entry = {
    ratingKey: track.ratingKey,
    artist: track.artist,
    title: track.title,
    album: track.album ?? null,
    showId,
    playedAt: toLocalISOString(),
  };
  fs.appendFileSync(config.paths.historyFile, JSON.stringify(entry) + '\n');
}

// Drops entries well outside the repeat window so the history file doesn't
// grow forever. Keeps a 2x margin past the window rather than pruning right
// at the cutoff, in case repeatWindowDays gets increased later.
export function pruneOldEntries() {
  const cutoff = Date.now() - config.shows.repeatWindowDays * DAY_MS * 2;
  const kept = readEntries().filter((e) => new Date(e.playedAt).getTime() >= cutoff);
  const body = kept.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(config.paths.historyFile, kept.length ? body + '\n' : '');
}
