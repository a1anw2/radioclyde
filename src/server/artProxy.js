import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { getTrackByRatingKey } from '../plex/tracks.js';

const log = createLogger('web');

function cachePath(ratingKey) {
  return path.join(config.paths.artCacheDir, `${ratingKey}.jpg`);
}

// Never expose the Plex token to the browser -- fetch art bytes server-side
// and disk-cache them (mirrors producer/research/wikipedia.js's
// wikipediaCacheDir pattern), keyed by ratingKey since art for a given track
// practically never changes.
export function registerArtRoute(fastify) {
  fastify.get('/api/art/:ratingKey', async (request, reply) => {
    const { ratingKey } = request.params;
    const cached = cachePath(ratingKey);

    if (fs.existsSync(cached)) {
      reply.header('content-type', 'image/jpeg');
      return fs.createReadStream(cached);
    }

    let track;
    try {
      track = await getTrackByRatingKey(ratingKey);
    } catch (err) {
      log(`/api/art/${ratingKey}: Plex lookup failed: ${err.message}`);
      return reply.code(404).send();
    }
    if (!track.art) return reply.code(404).send();

    const res = await fetch(`${config.plex.baseUrl}${track.art}?X-Plex-Token=${config.plex.token}`);
    if (!res.ok) {
      log(`/api/art/${ratingKey}: Plex art fetch failed: ${res.status} ${res.statusText}`);
      return reply.code(502).send();
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(config.paths.artCacheDir, { recursive: true });
    fs.writeFileSync(cached, bytes);

    reply.header('content-type', res.headers.get('content-type') ?? 'image/jpeg');
    return bytes;
  });
}
