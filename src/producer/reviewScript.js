#!/usr/bin/env node
// Final pass over a fully-assembled script: one LLM call that reads every DJ
// line across the whole show together and smooths out repetition that
// individual moves.js completions structurally cannot see -- each move
// (open/intro/recap/close/...) is generated as its own isolated completion
// (see boundaryWalk.js), so a phrase or motif reused across segments (e.g.
// every recap reaching for the same "paint a picture" metaphor) is invisible
// to any single completion. This phase looks at the whole show at once and
// is the only place that's true.
//
// Operates on `dj` segment bodies only -- track/live segments and every
// structural field are left completely untouched, and the prompt/response
// format below never carries them, so there's no way for this pass to
// corrupt the script-format.md grammar the way a raw-markdown rewrite could.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { complete } from '../llm/client.js';
import { parseArgs } from '../lib/args.js';
import { PARALINGUISTIC_INSTRUCTION } from '../llm/prompts.js';
import { parseScript, renderScript } from '../script/format.js';

const DEFAULT_SYSTEM_PROMPT =
  "You are the final script editor for a radio show, reviewing the complete assembled script in one pass. " +
  "Each line was originally written separately by a writer who could only see one line at a time, so the same " +
  "phrase, simile, or metaphor sometimes gets reused across the show without anyone noticing (e.g. three " +
  "different segments all reaching for the same turn of phrase). Your only job is to fix that kind of repetition " +
  "and smooth over any line that doesn't flow naturally into what comes right before or after it. Rewrite only " +
  "what genuinely needs it -- most lines should come back completely unchanged. Preserve every fact, name, date, " +
  "and number exactly as given. Preserve each persona's voice and each line's approximate length and role. Do " +
  "not merge, drop, add, or reorder lines, and do not add stage directions or meta-commentary.";

// A reviewed line's length may drift this far from the original before it's
// rejected as a probable model error (truncation, runaway rewrite, dropped
// content) rather than a genuine edit -- that segment's original body is
// kept instead of the candidate.
const MIN_LENGTH_RATIO = 0.4;
const MAX_LENGTH_RATIO = 2.5;

const BLOCK_HEADER_RE = /^===(\d+)(?:[^\n]*)===\s*$/;

function buildPrompt(djSegments) {
  return djSegments.map(({ index, persona, body }) => `===${index} (persona: ${persona})===\n${body}`).join('\n\n');
}

function parseResponse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = new Map();
  let current = null;
  let buf = [];
  const flush = () => {
    if (current != null) blocks.set(current, buf.join('\n').trim());
  };
  for (const line of lines) {
    const m = BLOCK_HEADER_RE.exec(line.trim());
    if (m) {
      flush();
      current = parseInt(m[1], 10);
      buf = [];
    } else if (current != null) {
      buf.push(line);
    }
  }
  flush();
  return blocks;
}

// Reviews every `dj` segment's body in one pass, given the full assembled
// segment list (as produced by boundaryWalk.buildSegments). Returns a new
// segments array -- never mutates the input -- falling back to the original
// body per-segment (never failing the whole show) on a missing block or an
// implausible-looking rewrite, so a bad response degrades quality rather
// than corrupting the script.
export async function reviewScript({ segments, record }) {
  const djIndexes = segments.map((seg, i) => (seg.type === 'dj' ? i : -1)).filter((i) => i !== -1);
  if (djIndexes.length === 0) return segments;

  const djSegments = djIndexes.map((i) => ({ index: i, persona: segments[i].persona, body: segments[i].body }));
  const systemPrompt = config.scriptReview?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const messages = [
    {
      role: 'system',
      content:
        `${systemPrompt}\n\nThe script is presented as "===N (persona: x)===" blocks, one per line to review. ` +
        `Reply with exactly the same blocks in the same order, same N values, one revised (or unchanged) block per ` +
        `input block -- nothing before, after, or between them. ${PARALINGUISTIC_INSTRUCTION}`,
    },
    { role: 'user', content: buildPrompt(djSegments) },
  ];

  const startedAt = Date.now();
  const result = await complete(messages);
  const durationMs = Date.now() - startedAt;

  const blocks = parseResponse(result);
  const revised = segments.slice();
  let changed = 0;
  let rejected = 0;
  let missing = 0;
  for (const { index, body } of djSegments) {
    const candidate = blocks.get(index);
    if (candidate == null || candidate === '') {
      missing++;
      continue;
    }
    const ratio = candidate.length / Math.max(body.length, 1);
    if (ratio < MIN_LENGTH_RATIO || ratio > MAX_LENGTH_RATIO) {
      rejected++;
      continue;
    }
    if (candidate !== body) {
      revised[index] = { ...revised[index], body: candidate };
      changed++;
    }
  }
  record?.push({ phase: 'review', input: djSegments, result, durationMs, total: djSegments.length, changed, rejected, missing });
  return revised;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error('Usage: reviewScript.js --file=<path/to/script.md> [--write=true] [--out=<path>]');
  }
  const filePath = path.resolve(args.file);
  const markdown = fs.readFileSync(filePath, 'utf8');
  const parsed = parseScript(markdown, { personas: config.personas });
  if (!parsed.segments) {
    console.error('Script failed to parse -- fix these issues first:');
    for (const issue of parsed.issues) console.error(`  - ${issue}`);
    process.exitCode = 1;
    return;
  }
  if (!parsed.ok) {
    console.warn('Note: script has pre-existing validation issues (unrelated to review), proceeding anyway:');
    for (const issue of parsed.issues) console.warn(`  - ${issue}`);
  }

  const record = [];
  const revisedSegments = await reviewScript({ segments: parsed.segments, record });
  const summary = record.find((r) => r.phase === 'review');
  console.log(`Reviewed ${summary.total} DJ lines: ${summary.changed} changed, ${summary.rejected} rejected (implausible length), ${summary.missing} missing from response.`);

  for (let i = 0; i < parsed.segments.length; i++) {
    if (parsed.segments[i].type !== 'dj') continue;
    if (parsed.segments[i].body === revisedSegments[i].body) continue;
    console.log(`\n--- segment #${i + 1} (${parsed.segments[i].persona}) ---`);
    console.log(`BEFORE: ${parsed.segments[i].body}`);
    console.log(`AFTER:  ${revisedSegments[i].body}`);
  }

  const outMarkdown = renderScript({ title: parsed.title, durationMinutes: parsed.durationMinutes, segments: revisedSegments });
  if (args.write === 'true') {
    const outPath = args.out ? path.resolve(args.out) : filePath.replace(/\.script\.md$|\.md$/, '.reviewed.md');
    fs.writeFileSync(outPath, outMarkdown);
    console.log(`\nWrote reviewed script to ${outPath}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}
