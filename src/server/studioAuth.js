// The studio's own Basic Auth realm -- a second, independent hook from
// src/server/auth.js's public-site one (deliberately not shared: reusing
// config.web.listeners would let a regular stream listener log into the
// studio). Registered as a Fastify plugin scoped to the /studio prefix in
// src/server/index.js, so this is also where every other studio route
// module gets wired in.
//
// Unlike auth.js, this does NOT bypass on trustedNetworks -- studio access
// always requires the studio password, since it's a write-access control
// surface, not just stream listening. Password-only (no additional
// trusted-network requirement) is the deliberate choice for now, over what's
// currently plain HTTP -- worth revisiting once the Cloudflare Tunnel
// mentioned in auth.js's comments adds TLS.
import { config } from '../config/index.js';
import { registerStudioStaticRoutes } from './studioStatic.js';
import { registerStudioShowsApi } from './studioShowsApi.js';
import { registerStudioScheduleApi } from './studioScheduleApi.js';
import { registerStudioPromptsApi } from './studioPromptsApi.js';
import { registerStudioOnAirApi } from './studioOnAirApi.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function unauthorized(reply) {
  reply.header('WWW-Authenticate', 'Basic realm="radioclyde-studio"').code(401).send('Unauthorized');
}

export async function registerStudioRoutes(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Basic ')) return unauthorized(reply);

    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    if (sepIndex === -1) return unauthorized(reply);

    const username = decoded.slice(0, sepIndex);
    const password = decoded.slice(sepIndex + 1);
    const authorized = (config.studio.users ?? []).some(
      (u) => u.username === username && u.password === password
    );
    if (!authorized) return unauthorized(reply);
  });

  // CSRF mitigation: a browser auto-replays cached Basic Auth credentials on
  // any same-origin request regardless of which page initiated it (there's
  // no session/cookie here, so no SameSite protection applies either). A
  // plain HTML form submission can't set a non-form Content-Type, and a
  // cross-origin fetch() sending JSON would need CORS headers this app never
  // sends -- so requiring (and rejecting anything but) application/json on
  // every write is a cheap, effective block on both.
  fastify.addHook('preHandler', async (request, reply) => {
    if (!WRITE_METHODS.has(request.method)) return;
    const contentType = request.headers['content-type'] || '';
    if (!contentType.startsWith('application/json')) {
      return reply.code(415).send({ error: 'Content-Type must be application/json' });
    }
  });

  registerStudioStaticRoutes(fastify);
  registerStudioShowsApi(fastify);
  registerStudioScheduleApi(fastify);
  registerStudioPromptsApi(fastify);
  registerStudioOnAirApi(fastify);
}
