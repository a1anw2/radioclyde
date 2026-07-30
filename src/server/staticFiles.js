import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', '..', 'public');

const ASSETS = [
  { route: '/', file: 'index.html', contentType: 'text/html' },
  { route: '/app.js', file: 'app.js', contentType: 'application/javascript' },
  { route: '/style.css', file: 'style.css', contentType: 'text/css' },
  // Drop a station logo at public/logo.png to have it appear in the page
  // header -- optional, the page hides it gracefully if the file's missing.
  { route: '/logo.png', file: 'logo.png', contentType: 'image/png' },
  { route: '/favicon.svg', file: 'favicon.svg', contentType: 'image/svg+xml' },
];

// Four explicit routes, not a wildcard/@fastify/static setup -- the asset
// set is small and fixed, so no path-traversal handling is ever needed and
// the project's dependency footprint stays at just fastify itself.
export function registerStaticRoutes(fastify) {
  for (const { route, file, contentType } of ASSETS) {
    fastify.get(route, (request, reply) => {
      let body;
      try {
        // No encoding -- returns a Buffer, correct for both text assets and
        // binary ones (logo.png); reading as 'utf8' would corrupt an image.
        body = fs.readFileSync(path.join(publicDir, file));
      } catch {
        return reply.code(404).send();
      }
      reply.header('content-type', contentType);
      // No cache-control/etag/last-modified are sent otherwise, which
      // leaves browsers free to cache these heuristically -- app.js in
      // particular is a live <script>, and a cached stale copy silently
      // keeps running old logic against the current server/API forever
      // (only a hard-refresh would ever notice). These assets are tiny and
      // served to a handful of personal devices, so there's no real cost
      // to always fetching fresh.
      reply.header('cache-control', 'no-store');
      return body;
    });
  }
}
