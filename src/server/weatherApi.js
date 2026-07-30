import { fetchCurrentWeather, describeWeatherCode } from '../director/weather.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('web');

// Conditions don't meaningfully change faster than this, and Open-Meteo is a
// free, unauthenticated API -- no reason to hit it on every client's 12s
// now-playing-style poll cycle.
const CACHE_TTL_MS = 10 * 60 * 1000;

let cached = null; // { temperatureF, temperatureC, condition } | null
let cachedAt = 0;

export function registerWeatherRoute(fastify) {
  fastify.get('/api/weather', async () => {
    const now = Date.now();
    if (!cached || now - cachedAt > CACHE_TTL_MS) {
      try {
        const current = await fetchCurrentWeather();
        cached = {
          temperatureF: Math.round(current.temperature_2m),
          temperatureC: Math.round(((current.temperature_2m - 32) * 5) / 9),
          condition: describeWeatherCode(current.weather_code),
        };
        cachedAt = now;
      } catch (err) {
        log(`/api/weather: fetch failed: ${err.message}`);
        if (!cached) throw err; // nothing to serve -- let it 500, same as any other transient failure
      }
    }
    return cached;
  });
}
