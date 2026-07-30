import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stationLogoPath = path.join(__dirname, '..', '..', 'public', 'logo.png');

// Show ids only ever come from station.json's own slugs (e.g. "80s-rock"),
// but they arrive here as a URL param, so reject anything else outright
// rather than letting it reach path.join.
const SHOW_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Shows can optionally drop their own logo at <dataDir>/show-logos/<id>.png;
// until they do (or for shows that never get one), this falls back to the
// station-wide logo at public/logo.png, so the client always gets *some*
// image back without needing its own fallback logic.
export function registerShowLogoRoute(fastify) {
  fastify.get('/api/show-logo/:showId', (request, reply) => {
    const { showId } = request.params;
    if (!SHOW_ID_PATTERN.test(showId)) return reply.code(400).send();

    const showLogoPath = path.join(config.paths.showLogosDir, `${showId}.png`);
    const resolvedPath = fs.existsSync(showLogoPath) ? showLogoPath : stationLogoPath;

    let body;
    try {
      body = fs.readFileSync(resolvedPath);
    } catch {
      return reply.code(404).send();
    }
    reply.header('content-type', 'image/png');
    return body;
  });
}
