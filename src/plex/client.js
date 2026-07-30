import { config } from '../config/index.js';

export const TYPE_ARTIST = 8;
export const TYPE_ALBUM = 9;
export const TYPE_TRACK = 10;

// Plex is a single LAN server -- a request that hasn't answered by now is
// stuck, not slow, and left unbounded it can pin a detached process (e.g.
// scrobbleTrack.js) at 100% CPU indefinitely rather than failing.
//
// 30s (not 10s): folder/artistList-scoped track queries (tracks.js) fetch
// up to 100,000 tracks unfiltered and filter client-side, since Plex has no
// server-side folder-substring filter. Measured at ~14.5s against this
// library's current ~32,000 tracks -- a 10s timeout made every one of
// those queries fail permanently (not just under transient load), which
// cascaded into no script production, no DJ speech, and a now-playing
// state stuck on the last show that happened to use a cheaper query path.
// Revisit if the library keeps growing.
export const PLEX_REQUEST_TIMEOUT_MS = 30_000;

function headers() {
  return {
    Accept: 'application/json',
    'X-Plex-Token': config.plex.token,
  };
}

export async function plexGet(pathAndQuery) {
  const url = `${config.plex.baseUrl}${pathAndQuery}`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(PLEX_REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Plex request failed: ${res.status} ${res.statusText} (${pathAndQuery})`);
  }
  return res.json();
}
