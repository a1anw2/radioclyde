#!/usr/bin/env node
// Cheap dry-run for producer/trackSelection/query.js -- shows both what
// query the AI step produced from a Track Selection brief AND the resulting
// tracklist (via buildTrackQueue), so the whole "brief -> query -> playlist"
// path can be checked in one go without touching the full show-producer
// session.
//
// Usage while designing a new show (not yet in station.json):
//   npm run preview-tracks -- 80s-rock
// takes just the show-descriptions/*.md basename (or a full/relative path),
// pulling the "## Track Selection" text, "**Duration:**", and any
// "**Repeat window:**" straight out of that file -- same brief format
// producer/generateScript.js reads for real. Flags override anything parsed:
// --file to point at a description elsewhere, --text for an ad hoc brief
// with no file at all (then --duration is required, since there's no file
// to read it from), --duration/--repeatWindow to force either value.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { parseShowBrief } from '../producer/showBrief.js';
import { produceTrackQuery } from '../producer/trackSelection/query.js';
import { parseArgs } from '../lib/args.js';
import { formatClock } from '../lib/format.js';

function resolveDescriptionPath(input) {
  if (fs.existsSync(input)) return input;
  const withExt = input.endsWith('.md') ? input : `${input}.md`;
  return path.join(config.paths.showDescriptionsDir, withExt);
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.find((a) => !a.startsWith('--'));
  const args = parseArgs(argv);

  let trackSelectionText = args.text;
  let targetDurationMinutes = args.duration ? parseInt(args.duration, 10) : undefined;
  let repeatWindowDays = args.repeatWindow ? parseInt(args.repeatWindow, 10) : undefined;

  const descriptionRef = args.file ?? (args.text ? undefined : positional);
  if (descriptionRef) {
    const descriptionPath = resolveDescriptionPath(descriptionRef);
    const descriptionText = fs.readFileSync(descriptionPath, 'utf8');
    const brief = parseShowBrief(descriptionText, { defaultRepeatWindowDays: config.scripts.defaultRepeatWindowDays ?? 7 });
    trackSelectionText = trackSelectionText ?? brief.trackSelectionText;
    repeatWindowDays = repeatWindowDays ?? brief.repeatWindowDays;
    if (!targetDurationMinutes) {
      const match = descriptionText.match(/\*\*Duration:\*\*\s*(\d+)\s*min/i);
      targetDurationMinutes = match ? parseInt(match[1], 10) : undefined;
    }
  }

  if (!trackSelectionText || !targetDurationMinutes) {
    throw new Error(
      'Usage: previewTrackQueryAi.js <show-name|path/to/brief.md> [--duration=<minutes>] [--repeatWindow=<days>]\n' +
        '   or: previewTrackQueryAi.js --text="<brief>" --duration=<minutes> [--repeatWindow=<days>]'
    );
  }

  const { query, result } = await produceTrackQuery({ trackSelectionText, targetDurationMinutes, repeatWindowDays });

  console.log('AI-produced query:', JSON.stringify(query, null, 2));
  console.log('');
  if (result.album) {
    console.log(`Album: ${result.album.artist} — ${result.album.title} (${result.album.year ?? '????'})`);
  }
  console.log(`Pool size (after dedupe + recently-played exclusion): ${result.poolSize}`);
  console.log(`Selected ${result.tracks.length} tracks`);
  console.log(`Estimated music time: ${formatClock(result.estimatedMusicMs)}`);
  console.log(
    `Estimated total w/ DJ overhead: ${formatClock(result.estimatedTotalMs)} (target ${formatClock(result.targetMs)})`
  );
  console.log('');
  result.tracks.forEach((t, i) => {
    console.log(
      `${String(i + 1).padStart(2, '0')}. ${t.artist} — ${t.title} (${t.album ?? 'no album'}, ${t.year ?? '????'}) [${formatClock(t.durationMs)}] ratingCount=${t.ratingCount ?? 'n/a'}`
    );
  });
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
