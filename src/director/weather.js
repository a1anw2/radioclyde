// Deterministic current-conditions fetch for `live` weather/time-weather
// segments -- resolved at director time, per script-format.md, never at
// authoring time. No LLM involved here; the director's LM Studio call (in
// director/liveSegments.js) only turns this real data into a spoken line.
import { config } from '../config/index.js';

// WMO weather interpretation codes (the scheme Open-Meteo's `weather_code`
// uses) -- confirmed live against the real API response shape before
// writing this, per this project's "verify against the live service" habit.
const WEATHER_CODE_DESCRIPTIONS = {
  0: 'clear sky',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'foggy',
  48: 'foggy',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  95: 'thunderstorms',
  96: 'thunderstorms with hail',
  99: 'thunderstorms with hail',
};

export function describeWeatherCode(code) {
  return WEATHER_CODE_DESCRIPTIONS[code] ?? 'unusual conditions';
}

// 15s: a plain third-party REST GET has no business running long -- unlike
// Chatterbox/LM Studio, there's no "normal but slow" case to accommodate
// here, only a hang to guard against. Confirmed live 2026-08-07/08: this
// call previously had no timeout at all, and directShow() (via
// resolveLiveLine()) awaits it directly -- a single hung request here froze
// the entire shared production queue indefinitely with no error logged,
// exactly like the un-timed-out LM Studio call in src/llm/client.js.
export async function fetchCurrentWeather() {
  const { url, latitude, longitude, timezone } = config.weather;
  const qs = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    current: 'temperature_2m,weather_code,wind_speed_10m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  });
  const res = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.current;
}

export function currentLocalTimeString(timezone) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date());
}

export function currentLocalDateString(timezone) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timezone }).format(
    new Date()
  );
}
