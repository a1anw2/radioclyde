import { config } from '../config/index.js';
import { isTrustedIp } from '../lib/ipRange.js';

// Single onRequest hook, registered before any routes in index.js, so it
// gates the page, the API, and /stream uniformly -- no per-route auth code
// anywhere else in src/server/. WWW-Authenticate on every 401 is what makes
// the browser's native credential prompt fire (and then cache/reuse
// credentials automatically) for the page, fetch() calls, and the <audio>
// element alike.
//
// request.ip (not request.socket.remoteAddress) is what respects index.js's
// trustProxy: 'loopback' setting -- today that's a no-op (nothing proxies
// through loopback yet), but once the planned Cloudflare Tunnel lands,
// cloudflared connects to Fastify over loopback and this is what lets
// request.ip keep resolving to the real remote client instead of always
// reading as local.
export function registerAuthHook(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    if (isTrustedIp(request.ip, config.web.trustedNetworks)) return;

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      return unauthorized(reply);
    }

    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    if (sepIndex === -1) return unauthorized(reply);

    const username = decoded.slice(0, sepIndex);
    const password = decoded.slice(sepIndex + 1);
    const authorized = (config.web.listeners ?? []).some(
      (l) => l.username === username && l.password === password
    );
    if (!authorized) return unauthorized(reply);
  });
}

function unauthorized(reply) {
  reply.header('WWW-Authenticate', 'Basic realm="radioclyde"').code(401).send('Unauthorized');
}
