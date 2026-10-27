// Deterministic parser for the small header block at the top of a
// show-descriptions/*.md producer brief. These are plain facts the harness
// needs up front -- which personas, which special segments exist, any
// per-show repeat-window override -- not something the producer LLM should
// have to infer from a paragraph of prose. Everything else in the brief
// stays free prose, handed to the LLM as-is.
const KNOWN_SEGMENT_KEYS = new Set(['quiz', 'weather', 'news']);

export function parseShowBrief(descriptionText, { defaultRepeatWindowDays } = {}) {
  const titleMatch = /^#\s+(.+)$/m.exec(descriptionText);
  const title = titleMatch ? titleMatch[1].replace(/^📻\s*/, '').trim() : null;

  const personasMatch = /\*\*Personas:\*\*\s*(.+)/i.exec(descriptionText);
  // First persona listed is the primary host (drives intro/recap/quiz moves
  // and the show open/close); any further personas are available for special
  // segments (e.g. the weather desk) -- see show-descriptions/elvis-lookback.md.
  const personas = personasMatch
    ? personasMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const segmentsMatch = /\*\*Segments:\*\*\s*(.+)/i.exec(descriptionText);
  const segments = new Set(
    segmentsMatch
      ? segmentsMatch[1]
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => KNOWN_SEGMENT_KEYS.has(s))
      : []
  );

  const repeatMatch = /\*\*Repeat window:\*\*\s*(\d+)\s*days?/i.exec(descriptionText);
  const repeatWindowDays = repeatMatch ? parseInt(repeatMatch[1], 10) : defaultRepeatWindowDays;

  // Station-wide neverPlay keywords (christmas, santa, …) apply to every
  // queue, which would empty a show whose whole point is those tracks.
  // This header is the explicit per-show exemption; filler does not read it.
  const allowMatch = /\*\*Allow keywords:\*\*\s*(.+)/i.exec(descriptionText);
  const allowKeywords = allowMatch
    ? allowMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    text: descriptionText,
    title,
    primaryPersona: personas[0],
    weatherPersona: personas[1],
    hasQuiz: segments.has('quiz'),
    hasWeather: segments.has('weather'),
    hasNews: segments.has('news'), // not implemented yet -- see script-format.md's `live` section
    repeatWindowDays,
    allowKeywords,
    trackSelectionText: extractSection(descriptionText, 'Track Selection'),
    description: extractSection(descriptionText, 'Description'),
  };
}

// Pulls the body text of a "## <name>" markdown section out of the brief --
// used for "## Track Selection", the loose prose that
// producer/trackSelection/query.js resolves into a concrete Plex query.
// Everything else in the section stays free text; only its boundaries (this
// heading to the next "## " heading, or end of file) are parsed mechanically.
// Exported for showBriefWriter.js's editing-round-trip reader, which needs
// the sections this module doesn't otherwise extract (Hosts/Tone/Track
// moves/Quiz/Weather) -- those aren't mechanically consumed by the producer
// pipeline itself, only by the studio admin's editor.
export function extractSection(descriptionText, name) {
  const lines = descriptionText.replace(/\r\n/g, '\n').split('\n');
  const startIdx = lines.findIndex((l) => new RegExp(`^##\\s+${name}\\s*$`, 'i').test(l.trim()));
  if (startIdx === -1) return null;
  let endIdx = lines.findIndex((l, i) => i > startIdx && /^##\s+\S/.test(l));
  if (endIdx === -1) endIdx = lines.length;
  return lines.slice(startIdx + 1, endIdx).join('\n').trim();
}
