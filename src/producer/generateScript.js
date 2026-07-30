#!/usr/bin/env node
// The show producer: takes a show-description brief and turns it into a
// validated `.script.md` (per script-format.md) through a small pipeline of
// mostly-deterministic phases, with the LLM used only where it genuinely has
// to make a judgment call -- never as one long open-ended session. See
// project memory / conversation history for why: an earlier flat
// tool-calling loop (search + research + write, all mixed into one session)
// reliably thrashed on research-heavy shows. This version splits that into:
//
//   A. Track selection -- trackSelection/query.js resolves the brief's loose
//      "## Track Selection" text into a concrete query, then
//      trackSelection/queue.js's buildTrackQueue() picks real tracks fully
//      deterministically (no LLM in this step at all).
//   B. Fact research -- research/trackResearch.js, a deterministic Wikipedia
//      fetch + small fixed extraction pass per track, run once up front.
//   C. Special-segment placement -- quiz/weather positions are plain
//      fractions of the tracklist (see boundaryWalk.js), not an LLM decision.
//   D. The boundary walk -- code walks the tracklist and generates each
//      move (open/intro/recap/weather-handoff/close) as its own small,
//      tool-free completion (moves.js), not one long session.
//
// This is the deliberately agentic half of the producer/director split --
// see script-format.md for what director/index.js does with the output.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { parseArgs } from '../lib/args.js';
import { toLocalISOString } from '../lib/time.js';
import * as scheduleUtil from '../scheduler/scheduleUtil.js';
import { parseScript, renderScript } from '../script/format.js';
import { recordPlayed } from './history.js';
import { parseShowBrief } from './showBrief.js';
import { produceTrackQuery } from './trackSelection/query.js';
import { researchTracks, researchAlbumTracks } from './research/trackResearch.js';
import { buildSegments } from './boundaryWalk.js';
import { reviewScript } from './reviewScript.js';

const log = createLogger('station');

function loadShowEntry(id) {
  if (!fs.existsSync(config.paths.stationFile)) return null;
  const schedule = scheduleUtil.loadSchedule();
  for (const day of Object.keys(schedule)) {
    const match = schedule[day].find((s) => s.id === id);
    if (match) return match;
  }
  return null;
}

async function runProducerPipeline({ id, descriptionText, durationMinutes, date }) {
  const debug = {}; // accumulated phase-by-phase, attached to any thrown error

  const brief = parseShowBrief(descriptionText, {
    defaultRepeatWindowDays: config.scripts.defaultRepeatWindowDays ?? 7,
  });
  debug.brief = { ...brief, text: undefined }; // the raw text is long and already on disk as the brief itself
  if (!brief.primaryPersona) {
    throw Object.assign(new Error(`Show "${id}"'s brief has no "**Personas:**" line -- at least one persona is required.`), { debug });
  }
  if (!brief.trackSelectionText) {
    throw Object.assign(
      new Error(`Show "${id}"'s brief has no "## Track Selection" section -- required to resolve a real tracklist.`),
      { debug }
    );
  }

  log(`[${id}] Phase A: resolving track selection (repeat window ${brief.repeatWindowDays} days)...`);
  const { query, result: trackQueueResult } = await produceTrackQuery({
    trackSelectionText: brief.trackSelectionText,
    targetDurationMinutes: durationMinutes,
    repeatWindowDays: brief.repeatWindowDays,
  });
  debug.trackQuery = query;
  debug.trackQueueResult = {
    poolSize: trackQueueResult.poolSize,
    estimatedMusicMs: trackQueueResult.estimatedMusicMs,
    estimatedTotalMs: trackQueueResult.estimatedTotalMs,
    targetMs: trackQueueResult.targetMs,
    trackCount: trackQueueResult.tracks.length,
  };
  const tracks = trackQueueResult.tracks;
  if (tracks.length === 0) {
    throw Object.assign(new Error(`Track selection for "${id}" resolved zero tracks.`), { debug });
  }
  log(`[${id}] Phase A done: ${tracks.length} tracks (query: ${JSON.stringify(query)}).`);

  log(`[${id}] Phase B: researching track facts...`);
  // Single-album shows (buildTrackQueue's singleAlbum mode) get one
  // album-level Wikipedia lookup instead of one per track -- see
  // researchAlbumTracks's comment in research/trackResearch.js for why.
  const trackFacts = trackQueueResult.album
    ? await researchAlbumTracks(tracks, trackQueueResult.album)
    : await researchTracks(tracks);
  debug.factsFound = tracks.filter((t) => trackFacts.get(String(t.ratingKey))).length;
  log(`[${id}] Phase B done: facts found for ${debug.factsFound}/${tracks.length} tracks.`);

  log(`[${id}] Phase C+D: walking track boundaries, generating moves...`);
  const { segments, record } = await buildSegments({ tracks, trackFacts, brief, date });
  debug.moves = record;
  log(`[${id}] Phase D done: ${segments.length} segments assembled.`);

  let reviewedSegments = segments;
  if (config.scriptReview?.enabled !== false) {
    log(`[${id}] Phase E: reviewing script for cross-segment repetition...`);
    debug.review = [];
    reviewedSegments = await reviewScript({ segments, record: debug.review });
    const summary = debug.review[0];
    log(`[${id}] Phase E done: ${summary.changed}/${summary.total} lines revised (${summary.rejected} rejected, ${summary.missing} missing).`);
  }

  const knownRatingKeys = new Map(tracks.map((t) => [String(t.ratingKey), t]));
  const title = brief.title || id;
  const markdown = renderScript({ title, durationMinutes, segments: reviewedSegments });
  const validation = parseScript(markdown, {
    requiredDurationMinutes: durationMinutes,
    personas: config.personas,
    knownRatingKeys,
  });
  debug.validation = validation.ok
    ? { ok: true, warnings: validation.warnings }
    : { ok: false, issues: validation.issues, warnings: validation.warnings };
  if (!validation.ok) {
    // Nothing left to retry against here (the tracklist and every move are
    // already generated) -- surfaced as a loud warning rather than a thrown
    // error, since the file is still a real, useful draft.
    log(`[${id}] WARNING: validation issues (written anyway): ${validation.issues.join(' | ')}`);
  }
  // A short-runtime warning is not fatal -- director/index.js will direct
  // this script as-is and it'll just end early, handing off to filler -- but
  // still worth a visible note rather than silently absorbing it.
  if (validation.warnings?.length) {
    log(`[${id}] NOTE: ${validation.warnings.join(' | ')}`);
  }

  return { markdown, tracks, debug };
}

// The importable half of the CLI below -- also called in-process,
// serialized, by scheduler/scheduleScripts.js. Takes weekday/date/description/
// duration directly rather than reading process.argv, same split as
// director/index.js's directShow()/cli/directShow.js.
export async function generateScript({ id, weekday, date, descriptionPath, durationMinutes } = {}) {
  if (!descriptionPath || !durationMinutes) {
    const entry = loadShowEntry(id);
    if (!entry) {
      throw new Error(
        `No show "${id}" found in ${config.paths.stationFile}, and no description/duration given directly.`
      );
    }
    descriptionPath = descriptionPath || entry.description;
    durationMinutes = durationMinutes || entry.durationMinutes;
  }

  // show-descriptions/*.md live under config.dataDir now, alongside
  // station.json -- resolve any relative description path (as recorded in
  // station.json, e.g. "show-descriptions/elvis-lookback.md") against that,
  // not the code checkout.
  const resolvedDescriptionPath = path.isAbsolute(descriptionPath)
    ? descriptionPath
    : path.join(config.dataDir, descriptionPath);
  const descriptionText = fs.readFileSync(resolvedDescriptionPath, 'utf8');

  const now = new Date();
  weekday = weekday || scheduleUtil.weekdayKey(now);
  date = date || scheduleUtil.dateKey(now);

  log(`Starting producer pipeline for "${id}" (${durationMinutes}min) from ${resolvedDescriptionPath}`);

  const runDir = scheduleUtil.dateDir(weekday, id, date);

  try {
    const { markdown, tracks, debug } = await runProducerPipeline({ id, descriptionText, durationMinutes, date });

    // Recorded now, at finalization, not on every intermediate lookup or on
    // a failed run -- a script that never finished shouldn't burn down the
    // eligible-track pool for a retry of the same brief.
    for (const track of tracks) {
      recordPlayed({ ratingKey: track.ratingKey, artist: track.artist, title: track.title, album: track.album }, id);
    }

    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'script.md'), markdown);
    fs.writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(debug, null, 2));
    fs.writeFileSync(
      path.join(runDir, 'context.json'),
      JSON.stringify(
        {
          id,
          weekday,
          date,
          descriptionPath: resolvedDescriptionPath,
          durationMinutes,
          repeatWindowDays: debug.brief.repeatWindowDays,
          model: config.lmStudio.model,
          generatedAt: toLocalISOString(),
          trackCount: tracks.length,
          validationOk: debug.validation.ok,
        },
        null,
        2
      )
    );

    log(`Wrote script for "${id}" to ${runDir} (${tracks.length} tracks).`);
    return { markdown, runDir, tracks };
  } catch (err) {
    fs.mkdirSync(runDir, { recursive: true });
    if (err.debug) {
      fs.writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(err.debug, null, 2));
    }
    fs.writeFileSync(path.join(runDir, 'error.json'), JSON.stringify({ message: err.message }, null, 2));
    log(`FAILED for "${id}" -- ${err.message}`);
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { id } = args;
  if (!id) {
    throw new Error(
      'Usage: generateScript.js --id=<showId> [--weekday=<weekday> --date=<yyyy-mm-dd>] [--description=<path/to/brief.md> --duration=<minutes>]'
    );
  }

  const { markdown } = await generateScript({
    id,
    weekday: args.weekday,
    date: args.date,
    descriptionPath: args.description,
    durationMinutes: args.duration ? parseInt(args.duration, 10) : undefined,
  });

  console.log(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
