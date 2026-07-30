// Chatterbox-Turbo's native paralinguistic tags (confirmed against the
// TTS server's own TURBO_PARALINGUISTIC_TAGS list, engine.py) -- written
// inline as "[tag]" in the spoken text and passed straight through to the
// engine, which renders them as the actual non-verbal sound rather than
// speaking the word. Original (non-Turbo) Chatterbox ignores them silently,
// so this is safe even if the station ever falls back to that model.
export const PARALINGUISTIC_TAGS = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan', 'shush'];

export const PARALINGUISTIC_INSTRUCTION = `You can drop in a natural vocal reaction as a bracket tag the voice engine understands: ${PARALINGUISTIC_TAGS.map((t) => `[${t}]`).join(', ')}. Use one only where it's genuinely natural (e.g. "[chuckle] yeah, that one's aged well" or "[sigh] rain again tomorrow") -- most lines should have none at all, and never more than one per line.`;

// Scripts are produced well ahead of air time and DJ speech is cached/reused
// across same-day repeats (see director/index.js's getDjAudio), so there's no
// reliable signal here for what time it'll actually be when this plays --
// the model's own "radio DJ" instinct defaults to evening/night framing
// ("good evening," "tonight") regardless of the actual show, which is wrong
// for anything airing outside the evening. Default to time-neutral phrasing;
// only reference a time of day when the real data given actually says so, or
// the persona is explicitly written as a particular time-of-day host.
export const TIME_OF_DAY_INSTRUCTION = `Don't say things like "good evening," "tonight," "this morning," or otherwise imply a specific time of day, unless the real data you were given states it explicitly or your persona description above establishes a specific time of day (e.g. a late-night or morning-show host) -- otherwise keep greetings/sign-offs/asides time-neutral.`;
