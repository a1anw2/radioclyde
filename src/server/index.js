#!/usr/bin/env node
// Public-facing web server AND the scheduling daemon: one process (one
// systemd service) that takes over the role Icecast used to occupy on
// 0.0.0.0:8000 (see config.web.port), and owns every timing decision for the
// station (src/scheduler/scheduler.js's startScheduler(), formerly its own
// radioclyde-scheduler process/service). Merged so the studio admin's
// on-air controls (force-next-show, schedule-change feedback) can call
// straight into the scheduler's own state instead of signaling a separate
// process and waiting for its next tick -- see scheduler.js's own comment.
//
// Icecast itself is on an internal-only port (config.icecast.port) reachable
// only from here and from Liquidsoap's source push -- /stream below proxies
// straight through to it. The auth hook is registered first, before any
// route, so it gates the page, the API, and /stream uniformly; /studio has
// its own separate auth hook, scoped to that prefix only (see studioAuth.js).
import Fastify from 'fastify';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { startScheduler } from '../scheduler/scheduler.js';
import { registerAuthHook } from './auth.js';
import { registerStaticRoutes } from './staticFiles.js';
import { registerStreamRoute } from './streamProxy.js';
import { registerApiRoutes } from './api.js';
import { registerArtRoute } from './artProxy.js';
import { registerShowLogoRoute } from './showLogoProxy.js';
import { registerDjPhotoRoute } from './djPhotoProxy.js';
import { registerWeatherRoute } from './weatherApi.js';
import { registerStudioRoutes } from './studioAuth.js';

const log = createLogger('web');

// Merging the web server and scheduler into one process means a scheduler-
// domain error that escapes every()'s own per-job try/catch (scheduler.js)
// would otherwise crash the whole process -- taking the public /stream proxy
// down with it, which the two-process split never allowed. Log and continue
// rather than let that happen; systemd's Restart=on-failure is still the
// backstop for anything that genuinely can't be caught here (e.g. an actual
// Node-level fault), but a stray unhandled rejection in scheduler-side code
// shouldn't be able to do that on its own.
process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (err) => {
  log(`unhandledRejection: ${err?.stack || err}`);
});

async function main() {
  // trustProxy: 'loopback' -- trust X-Forwarded-For only when the
  // connecting peer is loopback itself. A no-op today (nothing proxies
  // through loopback), but the exact hop the future Cloudflare Tunnel's
  // cloudflared process uses, so request.ip keeps resolving to the real
  // remote client once that's added, with no further change here.
  const fastify = Fastify({ logger: false, trustProxy: 'loopback' });

  registerAuthHook(fastify);
  registerStaticRoutes(fastify);
  registerStreamRoute(fastify);
  registerApiRoutes(fastify);
  registerArtRoute(fastify);
  registerShowLogoRoute(fastify);
  registerDjPhotoRoute(fastify);
  registerWeatherRoute(fastify);
  await fastify.register(registerStudioRoutes, { prefix: '/studio' });

  await fastify.listen({ port: config.web.port, host: '0.0.0.0' });
  log(`Listening on 0.0.0.0:${config.web.port}`);

  startScheduler();
}

main().catch((err) => {
  log(`ERROR: ${err.stack || err.message}`);
  process.exitCode = 1;
});
