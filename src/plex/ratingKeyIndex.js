// Sidecar index the on_track scrobble hook depends on: m3u files carry plain
// filesystem paths with no Plex ratingKey, so director/index.js/
// scheduler/generateFillerPlaylist.js record the path->ratingKey mapping here
// at the same point they already resolve it, and scrobbleTrack.js looks it
// up when Liquidsoap reports a path at playback time.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { withLock } from '../lib/lock.js';

function readMap() {
  if (!fs.existsSync(config.paths.trackRatingKeysPath)) return {};
  return JSON.parse(fs.readFileSync(config.paths.trackRatingKeysPath, 'utf8'));
}

export async function mergeTrackRatingKeys(entries) {
  await withLock(config.paths.trackRatingKeysLockPath, () => {
    const map = readMap();
    for (const [localPath, ratingKey] of entries) {
      map[localPath] = String(ratingKey);
    }
    fs.mkdirSync(path.dirname(config.paths.trackRatingKeysPath), { recursive: true });
    fs.writeFileSync(config.paths.trackRatingKeysPath, JSON.stringify(map, null, 2));
  });
}

export function lookupRatingKey(localPath) {
  return readMap()[localPath] ?? null;
}
