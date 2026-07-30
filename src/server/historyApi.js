import fs from 'node:fs';
import { config } from '../config/index.js';

const HARD_CAP = 200;

function readAiredEntries() {
  try {
    return fs
      .readFileSync(config.paths.airedHistoryFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return []; // nothing aired yet since deploy
  }
}

// history/aired.jsonl is append-only chronological (oldest first), written
// by plex/scrobbleTrack.js at real track-start -- unlike producer/history.js's
// played.jsonl, which is written at production time and isn't safe to show a
// listener as "what's played".
export function getRecentHistory(limit = 50) {
  const cappedLimit = Math.min(limit, HARD_CAP);
  const entries = readAiredEntries();
  const recent = entries.slice(-cappedLimit).reverse();
  return recent.map((e) => ({
    artist: e.artist,
    title: e.title,
    album: e.album,
    showId: e.showId,
    playedAt: e.playedAt,
    artUrl: e.ratingKey ? `/api/art/${e.ratingKey}` : null,
  }));
}
