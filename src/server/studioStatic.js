import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioDir = path.join(__dirname, '..', '..', 'public', 'studio');

const ASSETS = [
  { route: '/', file: 'index.html', contentType: 'text/html' },
  { route: '/style.css', file: 'style.css', contentType: 'text/css' },
  { route: '/js/app.js', file: 'js/app.js', contentType: 'application/javascript' },
  { route: '/js/api.js', file: 'js/api.js', contentType: 'application/javascript' },
  { route: '/js/onAir.js', file: 'js/onAir.js', contentType: 'application/javascript' },
  { route: '/js/shows.js', file: 'js/shows.js', contentType: 'application/javascript' },
  { route: '/js/schedule.js', file: 'js/schedule.js', contentType: 'application/javascript' },
  { route: '/js/prompts.js', file: 'js/prompts.js', contentType: 'application/javascript' },
];

// Same fixed-route approach as staticFiles.js -- small, fixed asset set, no
// @fastify/static needed. Registered inside the /studio-prefixed plugin
// (studioAuth.js), so these routes are already gated by the studio's own
// auth hook before this ever runs.
export function registerStudioStaticRoutes(fastify) {
  for (const { route, file, contentType } of ASSETS) {
    fastify.get(route, (request, reply) => {
      let body;
      try {
        body = fs.readFileSync(path.join(studioDir, file));
      } catch {
        return reply.code(404).send();
      }
      reply.header('content-type', contentType);
      reply.header('cache-control', 'no-store');
      return body;
    });
  }
}
