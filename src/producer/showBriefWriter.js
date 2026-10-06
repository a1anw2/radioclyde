// The write half of a show-descriptions/*.md brief -- showBrief.js only
// ever reads. Serializes the same header block + named "## " sections
// parseShowBrief()/extractSection() read back (only Description and Track
// Selection are mechanically consumed by the pipeline today -- Hosts, Tone,
// Track moves, Quiz, and Weather are free-prose authoring notes, kept in the
// same shape for round-trip fidelity and because a human/future pipeline
// change may still want them).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { removeShowOccurrences } from '../scheduler/stationWriter.js';
import { parseShowBrief, extractSection } from './showBrief.js';

// Show ids only ever come from station.json's own slugs (e.g. "80s-rock"),
// matching src/server/showLogoProxy.js's SHOW_ID_PATTERN -- reject anything
// else before it ever reaches path.join, since an unvalidated id used to
// build a filesystem path is a path-traversal write.
const SHOW_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertValidId(id) {
  if (!id || !SHOW_ID_PATTERN.test(id)) {
    throw new Error(`Invalid show id "${id}" -- must match ${SHOW_ID_PATTERN}.`);
  }
}

function briefPath(id) {
  return path.join(config.paths.showDescriptionsDir, `${id}.md`);
}

// Full editing-round-trip read: parseShowBrief() only extracts what the
// producer pipeline mechanically consumes (title/personas/segments/repeat
// window/Description/Track Selection) -- the studio editor also needs the
// remaining free-prose sections (Hosts/Tone/Track moves/Quiz/Weather) so a
// save doesn't silently drop them.
export function readShowBriefForEditing(id) {
  assertValidId(id);
  const target = briefPath(id);
  if (!fs.existsSync(target)) {
    throw new Error(`No show "${id}" found.`);
  }
  const text = fs.readFileSync(target, 'utf8');
  const parsed = parseShowBrief(text, { defaultRepeatWindowDays: config.scripts?.defaultRepeatWindowDays });
  // parseShowBrief only exposes the first two personas (primaryPersona/
  // weatherPersona -- all the pipeline itself ever needs) -- re-read the
  // full "**Personas:**" line directly here so a show with 3+ personas
  // round-trips through the editor without silently losing any past the
  // second.
  const personasMatch = /\*\*Personas:\*\*\s*(.+)/i.exec(text);
  const personas = personasMatch
    ? personasMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    id,
    title: parsed.title ?? id,
    personas,
    segments: [parsed.hasQuiz && 'quiz', parsed.hasWeather && 'weather', parsed.hasNews && 'news'].filter(Boolean),
    repeatWindowDays: parsed.repeatWindowDays,
    description: parsed.description ?? '',
    hosts: extractSection(text, 'Hosts') ?? '',
    trackSelectionText: parsed.trackSelectionText ?? '',
    tone: extractSection(text, 'Tone') ?? '',
    trackMoves: extractSection(text, 'Track moves') ?? '',
    quiz: extractSection(text, 'Quiz') ?? '',
    weather: extractSection(text, 'Weather') ?? '',
  };
}

function section(heading, body) {
  const trimmed = (body ?? '').trim();
  return trimmed ? `## ${heading}\n\n${trimmed}\n\n` : '';
}

// fields: { title, durationMinutes, personas: string[], segments: string[],
//   repeatWindowDays, description, hosts, trackSelectionText, tone,
//   trackMoves, quiz, weather }
export function renderShowBrief(fields) {
  const lines = [];
  lines.push(`# 📻 ${fields.title}`);
  lines.push('');
  if (fields.durationMinutes) lines.push(`**Duration:** ${fields.durationMinutes} min`);
  lines.push(`**Personas:** ${(fields.personas ?? []).join(', ')}`);
  lines.push(`**Segments:** ${(fields.segments ?? []).join(', ')}`);
  if (fields.repeatWindowDays) lines.push(`**Repeat window:** ${fields.repeatWindowDays} days`);
  lines.push('');
  lines.push('---');
  lines.push('');

  let body = '';
  body += section('Description', fields.description);
  body += section('Hosts', fields.hosts);
  body += section('Track Selection', fields.trackSelectionText);
  body += section('Tone', fields.tone);
  body += section('Track moves', fields.trackMoves);
  if ((fields.segments ?? []).includes('quiz')) body += section('Quiz', fields.quiz);
  if ((fields.segments ?? []).includes('weather')) body += section('Weather', fields.weather);

  return lines.join('\n') + '\n' + body.trimEnd() + '\n';
}

function atomicWrite(filePath, content) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

export function createShowBrief(id, fields) {
  assertValidId(id);
  const target = briefPath(id);
  if (fs.existsSync(target)) {
    throw new Error(`A show with id "${id}" already exists.`);
  }
  atomicWrite(target, renderShowBrief(fields));
  return { id };
}

export function updateShowBrief(id, fields) {
  assertValidId(id);
  const target = briefPath(id);
  if (!fs.existsSync(target)) {
    throw new Error(`No show "${id}" found.`);
  }
  atomicWrite(target, renderShowBrief(fields));
  return { id };
}

// Unschedules every occurrence of this show first, then deletes the
// brief -- a studio delete must not leave orphaned station.json slots.
export async function deleteShowBrief(id) {
  assertValidId(id);
  const target = briefPath(id);
  if (!fs.existsSync(target)) {
    throw new Error(`No show "${id}" found.`);
  }
  const removedFromSchedule = await removeShowOccurrences(id);
  fs.unlinkSync(target);
  return { id, removedFromSchedule };
}
