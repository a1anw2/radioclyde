import { config } from '../config/index.js';
import { PLEX_REQUEST_TIMEOUT_MS } from './client.js';

// Fired from scrobbleTrack.js (invoked by radio.liq's on_track hook) so
// Plex's own view count/play history reflect what's actually broadcast --
// playback reads straight off the filesystem and otherwise never touches
// Plex. No response body on success, so this skips plexGet's res.json().
export async function scrobbleTrack(ratingKey) {
  const url = `${config.plex.baseUrl}/:/scrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}&X-Plex-Token=${config.plex.token}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(PLEX_REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Plex scrobble failed: ${res.status} ${res.statusText} (ratingKey ${ratingKey})`);
  }
}
