import { composeNowPlaying } from './nowPlaying.js';
import { getRecentHistory } from './historyApi.js';
import { getUpcomingShows } from './upcoming.js';

// Natural future home for POST /api/requests (song requests) -- same file,
// same auth hook already applied globally in index.js, no rework needed.
export function registerApiRoutes(fastify) {
  fastify.get('/api/now-playing', () => composeNowPlaying());

  fastify.get('/api/history', (request) => {
    const limit = parseInt(request.query.limit, 10);
    return { entries: getRecentHistory(Number.isFinite(limit) ? limit : undefined) };
  });

  fastify.get('/api/upcoming', () => ({ shows: getUpcomingShows() }));
}
