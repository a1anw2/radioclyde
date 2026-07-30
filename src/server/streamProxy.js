import http from 'node:http';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('web');

// The auth hook runs before this route (registered first in index.js), so
// an unauthenticated request never reaches here and never opens an upstream
// Icecast connection.
export function registerStreamRoute(fastify) {
  fastify.get('/stream', (request, reply) => {
    // No Icy-MetaData request header -- browsers/<audio> elements don't send
    // one, and forwarding it would make Icecast interleave binary ICY
    // metadata frames into the byte stream, corrupting playback.
    const upstreamReq = http.request({
      host: config.icecast.sourceHost,
      port: config.icecast.port,
      path: config.icecast.mount,
      method: 'GET',
    });

    upstreamReq.on('response', (upstreamRes) => {
      reply.code(upstreamRes.statusCode);
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        reply.header(key, value);
      }
      reply.send(upstreamRes);
    });

    upstreamReq.on('error', (err) => {
      log(`/stream proxy: upstream Icecast connection failed: ${err.message}`);
      if (!reply.sent) reply.code(502).send('Stream unavailable');
    });

    // Listener disconnected -- stop pulling bytes from Icecast rather than
    // leaking a permanent upstream connection for an abandoned response.
    request.raw.on('close', () => upstreamReq.destroy());

    upstreamReq.end();
  });
}
