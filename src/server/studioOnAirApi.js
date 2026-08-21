// The On Air dashboard's API: current show/track/DJ, listener count (first
// time it's surfaced anywhere -- getListenerCount() was previously only used
// internally by plex/scrobbleTrack.js), upcoming, recent history, plus the
// Skip and Force Next Show controls. Registered under the /studio prefix
// (see studioAuth.js).
import { composeNowPlaying } from './nowPlaying.js';
import { getUpcomingShows } from './upcoming.js';
import { getRecentHistory } from './historyApi.js';
import { getListenerCount } from '../icecast/listeners.js';
import { forceNextOccurrence } from '../scheduler/updateNowPlaying.js';
import { sendCommand } from '../liquidsoap/telnetClient.js';

export function registerStudioOnAirApi(fastify) {
  fastify.get('/api/on-air', async () => {
    const nowPlaying = composeNowPlaying();
    let listenerCount = null;
    try {
      listenerCount = await getListenerCount();
    } catch {
      // Icecast unreachable/slow -- the rest of the dashboard is still
      // useful without a listener count, so don't fail the whole endpoint.
    }
    return {
      ...nowPlaying,
      listenerCount,
      upcoming: getUpcomingShows(10),
      history: getRecentHistory(20),
    };
  });

  // Only meaningful while a track (not DJ speech) is airing -- the studio UI
  // is expected to disable this button otherwise, so it can't cut a DJ off
  // mid-sentence, but the check is enforced here too since a stale/raced UI
  // state shouldn't be trusted alone.
  fastify.post('/api/on-air/skip', async (request, reply) => {
    const { track } = composeNowPlaying();
    if (!track) {
      return reply.code(409).send({ error: 'Nothing skippable right now (no track currently airing).' });
    }
    try {
      const result = await sendCommand('show_source.skip');
      return { result };
    } catch (err) {
      return reply.code(502).send({ error: `Liquidsoap telnet command failed: ${err.message}` });
    }
  });

  fastify.post('/api/on-air/force-next', async (request, reply) => {
    try {
      const state = await forceNextOccurrence();
      return { state };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
