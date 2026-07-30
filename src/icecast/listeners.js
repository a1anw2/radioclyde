import { config } from '../config/index.js';

// Icecast is a LAN service -- a request that hasn't answered by now is
// stuck, not slow. Kept short since this sits in scrobbleTrack.js's
// per-track hot path.
const ICECAST_REQUEST_TIMEOUT_MS = 5_000;

// Icecast's own count of open connections to the stream mount -- distinct
// from config.web.listeners (Basic Auth credentials for /stream). Used to
// gate Plex scrobbling so a track airing to nobody doesn't inflate Plex's
// play count (see plex/scrobbleTrack.js). status-json.xsl is Icecast's
// unauthenticated public status page, so no adminPassword is needed here.
export async function getListenerCount() {
  const url = `http://${config.icecast.sourceHost}:${config.icecast.port}/status-json.xsl`;
  const res = await fetch(url, { signal: AbortSignal.timeout(ICECAST_REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Icecast status request failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const sources = [].concat(body.icestats?.source ?? []);
  const source = sources.find((s) => s.listenurl?.endsWith(config.icecast.mount)) ?? sources[0];
  return source?.listeners ?? 0;
}
