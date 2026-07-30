#!/usr/bin/env node
// Public-facing web server: takes over the role Icecast used to occupy on
// 0.0.0.0:8000 (see config.web.port). Icecast itself moves to an
// internal-only port (config.icecast.port) reachable only from here and
// from Liquidsoap's source push -- /stream below proxies straight through
// to it. The auth hook is registered first, before any route, so it gates
// the page, the API, and /stream uniformly.
import Fastify from 'fastify';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { registerAuthHook } from './auth.js';
import { registerStaticRoutes } from './staticFiles.js';
import { registerStreamRoute } from './streamProxy.js';
import { registerApiRoutes } from './api.js';
import { registerArtRoute } from './artProxy.js';
import { registerShowLogoRoute } from './showLogoProxy.js';
import { registerDjPhotoRoute } from './djPhotoProxy.js';
import { registerWeatherRoute } from './weatherApi.js';

const log = createLogger('web');

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

  await fastify.listen({ port: config.web.port, host: '0.0.0.0' });
  log(`Listening on 0.0.0.0:${config.web.port}`);
}

main().catch((err) => {
  log(`ERROR: ${err.stack || err.message}`);
  process.exitCode = 1;
});
