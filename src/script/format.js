// Parser/validator/renderer for the `.script.md` grammar defined in
// script-format.md. Used by producer/generateScript.js to check a producer
// session's output before it's ever written to disk, and reused unchanged by
// director/index.js to consume finished scripts.
import { estimateSpeechMs } from '../lib/format.js';

const VALID_TYPES = new Set(['dj', 'track', 'live']);
const VALID_LIVE_KINDS = new Set(['time', 'weather', 'time-weather']);
const FALLBACK_TRACK_DURATION_MS = 210000; // ~3.5min, same fallback plex/tracks.js uses when Plex omits duration
// `live` segments have no real content yet at authoring time (that's the
// whole point -- see script-format.md), so these are nominal placeholders
// for a short spoken check-in, not a measurement of anything.
const LIVE_SEGMENT_ESTIMATE_MS = { time: 10000, weather: 15000, 'time-weather': 20000 };
// A producer session can't hit the target duration exactly -- it's working
// from word-count/track-length estimates, same as the preview tool. Wide
// enough to not fight over a couple minutes, tight enough to flag a show
// that's badly short or badly long. Running short is a soft warning, not a
// blocking issue -- a show ending early and handing off to filler is fine
// (scheduler/updateNowPlaying.js already tracks each occurrence's real,
// directed runtime rather than assuming the nominal schedule length, so
// nothing downstream breaks); running well over, though, risks eating into
// the next occurrence's slot, so that one still blocks.
const DURATION_TOLERANCE_LOW = 0.75;
const DURATION_TOLERANCE_HIGH = 1.3;

function splitFieldBlock(lines) {
  const fields = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;
    const match = /^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) break;
    fields[match[1]] = match[2].trim();
  }
  // Skip the blank line separating fields from body, if present.
  if (lines[i]?.trim() === '') i++;
  const body = lines.slice(i).join('\n').trim();
  return { fields, body };
}

// Parses raw markdown into a structured { title, durationMinutes, segments }
// plus an `issues` array. Issues are collected (not thrown on first error) so
// a producer session can fix everything in one retry round instead of
// discovering problems one at a time.
export function parseScript(markdown, { requiredDurationMinutes, personas, knownRatingKeys } = {}) {
  const issues = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  const titleLine = lines.find((l) => /^#\s+\S/.test(l));
  const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : null;
  if (!title) issues.push('Missing title line ("# <show title>") at the top of the file.');

  const durationMatch = markdown.match(/\*\*Duration:\*\*\s*(\d+)\s*min/i);
  const durationMinutes = durationMatch ? parseInt(durationMatch[1], 10) : null;
  if (!durationMinutes) {
    issues.push('Missing or unparseable "**Duration:** <N> min" line.');
  } else if (requiredDurationMinutes && durationMinutes !== requiredDurationMinutes) {
    issues.push(`Duration is ${durationMinutes} min but this show slot requires ${requiredDurationMinutes} min.`);
  }

  const headingIdx = [];
  lines.forEach((l, i) => {
    if (/^##\s+\S/.test(l)) headingIdx.push(i);
  });
  if (headingIdx.length === 0) {
    issues.push('No segments found — every dj/track/live segment must be a "## " heading.');
  }

  const segments = [];
  for (let s = 0; s < headingIdx.length; s++) {
    const start = headingIdx[s] + 1;
    const end = s + 1 < headingIdx.length ? headingIdx[s + 1] : lines.length;
    const blockLines = lines.slice(start, end);
    const label = `segment #${s + 1} ("${lines[headingIdx[s]].replace(/^##\s+/, '').trim()}")`;
    const { fields, body } = splitFieldBlock(blockLines);

    const type = fields.type;
    if (!type || !VALID_TYPES.has(type)) {
      issues.push(`${label}: missing or invalid "type:" (must be dj, track, or live).`);
      continue;
    }

    if (type === 'dj') {
      const persona = fields.persona;
      if (!persona) issues.push(`${label}: dj segment missing "persona:".`);
      else if (personas && !personas[persona]) {
        issues.push(`${label}: persona "${persona}" is not a known persona (${Object.keys(personas).join(', ')}).`);
      }
      if (!body) issues.push(`${label}: dj segment has no body text to speak.`);
      segments.push({ type, persona, body });
    } else if (type === 'track') {
      const { artist, title: trackTitle, ratingKey } = fields;
      if (!artist) issues.push(`${label}: track segment missing "artist:".`);
      if (!trackTitle) issues.push(`${label}: track segment missing "title:".`);
      if (!ratingKey) {
        issues.push(`${label}: track segment missing "ratingKey:" — use the ratingKey from a search_tracks result.`);
      } else if (knownRatingKeys && !knownRatingKeys.has(String(ratingKey))) {
        issues.push(
          `${label}: ratingKey "${ratingKey}" was never returned by search_tracks in this session — do not invent ratingKeys, call search_tracks to find the real one.`
        );
      }
      segments.push({ type, artist, title: trackTitle, ratingKey });
    } else if (type === 'live') {
      const persona = fields.persona;
      const kind = fields.kind;
      const brief = fields.brief;
      if (!persona) issues.push(`${label}: live segment missing "persona:".`);
      else if (personas && !personas[persona]) {
        issues.push(`${label}: persona "${persona}" is not a known persona (${Object.keys(personas).join(', ')}).`);
      }
      if (!kind || !VALID_LIVE_KINDS.has(kind)) {
        issues.push(`${label}: live segment "kind:" must be one of time, weather, time-weather.`);
      }
      if (!brief) issues.push(`${label}: live segment missing "brief:".`);
      segments.push({ type, persona, kind, brief });
    }
  }

  if (issues.length) return { ok: false, issues, warnings: [], title, durationMinutes, segments };

  // Authoritative track metadata (from Plex, via knownRatingKeys) wins over
  // whatever the model transcribed -- guards against typos in artist/title
  // without rejecting an otherwise-valid script over a cosmetic mismatch.
  if (knownRatingKeys) {
    for (const seg of segments) {
      if (seg.type !== 'track') continue;
      const authoritative = knownRatingKeys.get(String(seg.ratingKey));
      if (authoritative) {
        seg.artist = authoritative.artist;
        seg.title = authoritative.title;
      }
    }
  }

  const estimatedMs = segments.reduce((sum, seg) => {
    if (seg.type === 'track') {
      const authoritative = knownRatingKeys?.get(String(seg.ratingKey));
      return sum + (authoritative?.durationMs ?? FALLBACK_TRACK_DURATION_MS);
    }
    if (seg.type === 'dj') return sum + estimateSpeechMs(seg.body);
    return sum + LIVE_SEGMENT_ESTIMATE_MS[seg.kind];
  }, 0);
  const targetMs = requiredDurationMinutes ? requiredDurationMinutes * 60 * 1000 : durationMinutes * 60 * 1000;
  const estimatedMinutes = Math.round(estimatedMs / 60000);
  const warnings = [];
  if (estimatedMs < targetMs * DURATION_TOLERANCE_LOW) {
    warnings.push(
      `Estimated total runtime is only ~${estimatedMinutes} min (tracks + estimated DJ speech), short of the requested ${requiredDurationMinutes ?? durationMinutes} min -- will end early and hand off to filler.`
    );
  }
  if (estimatedMs > targetMs * DURATION_TOLERANCE_HIGH) {
    issues.push(
      `Estimated total runtime is ~${estimatedMinutes} min, well over the required ${requiredDurationMinutes ?? durationMinutes} min. Cut some tracks and/or DJ segments.`
    );
  }

  if (issues.length) return { ok: false, issues, warnings, title, durationMinutes, segments };
  return { ok: true, title, durationMinutes, segments, warnings };
}

// Regenerates canonical markdown from parsed structure rather than trusting
// the model's exact formatting -- the director will parse this file
// mechanically later, so heading text/spacing consistency matters more than
// preserving the model's prose around the fields.
export function renderScript({ title, durationMinutes, segments }) {
  const lines = [`# ${title}`, '', `**Duration:** ${durationMinutes} min`, '', '---', ''];
  for (const seg of segments) {
    if (seg.type === 'dj') {
      lines.push(`## DJ — ${seg.persona}`, 'type: dj', `persona: ${seg.persona}`, '', seg.body.trim(), '');
    } else if (seg.type === 'track') {
      lines.push(
        '## Track',
        'type: track',
        `artist: ${seg.artist}`,
        `title: ${seg.title}`,
        `ratingKey: ${seg.ratingKey}`,
        ''
      );
    } else if (seg.type === 'live') {
      lines.push(
        `## Live — ${seg.persona}`,
        'type: live',
        `persona: ${seg.persona}`,
        `kind: ${seg.kind}`,
        `brief: ${seg.brief}`,
        ''
      );
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
