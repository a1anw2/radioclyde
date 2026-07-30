import { config } from '../config/index.js';
import { complete } from '../llm/client.js';
import { PARALINGUISTIC_INSTRUCTION, TIME_OF_DAY_INSTRUCTION } from '../llm/prompts.js';
import { fetchCurrentWeather, describeWeatherCode, currentLocalTimeString, currentLocalDateString } from './weather.js';

// Real data first (deterministic fetch, or the server clock for time --
// no network call, per script-format.md), THEN one small tool-free
// completion turns it into a spoken line shaped by the segment's `brief`.
export async function resolveLiveLine({ persona, kind, brief }) {
  const facts = [];
  if (kind === 'time' || kind === 'time-weather') {
    facts.push(`Current local date: ${currentLocalDateString(config.weather.timezone)}. Current local time: ${currentLocalTimeString(config.weather.timezone)}.`);
  }
  if (kind === 'weather' || kind === 'time-weather') {
    const current = await fetchCurrentWeather();
    facts.push(
      `Current conditions: ${describeWeatherCode(current.weather_code)}, ${Math.round(current.temperature_2m)}°F, wind ${Math.round(current.wind_speed_10m)} mph.`
    );
  }

  const personaPrompt = config.personas[persona]?.systemPrompt ?? `You are ${persona}, a radio DJ.`;
  const messages = [
    {
      role: 'system',
      content: [
        personaPrompt,
        '',
        `Speak a short live segment using ONLY the real data given below -- don't invent any other facts.`,
        `Direction: ${brief}`,
        'Speak it exactly as it should be said -- no stage directions, no meta-commentary, no quotation marks.',
        PARALINGUISTIC_INSTRUCTION,
        TIME_OF_DAY_INSTRUCTION,
      ].join('\n'),
    },
    { role: 'user', content: facts.join(' ') },
  ];
  return complete(messages);
}
