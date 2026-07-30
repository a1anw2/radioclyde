#!/usr/bin/env node
// Cheap dry-run of the whole producer pipeline up to (not including) script
// writing: Track Selection brief -> AI-produced query -> deterministic
// tracklist -> per-track research. No writes, safe to re-run repeatedly.
import fs from 'node:fs';
import { produceTrackQuery } from '../producer/trackSelection/query.js';
import { researchTracks, researchAlbumTracks } from '../producer/research/trackResearch.js';
import { parseArgs } from '../lib/args.js';
import { formatClock } from '../lib/format.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const trackSelectionText = args.file ? fs.readFileSync(args.file, 'utf8') : args.text;
  const targetDurationMinutes = args.duration ? parseInt(args.duration, 10) : undefined;

  if (!trackSelectionText || !targetDurationMinutes) {
    throw new Error('Usage: previewShowPrep.js --text="<brief>" --duration=<minutes> (or --file=<path>)');
  }

  const { query, result } = await produceTrackQuery({ trackSelectionText, targetDurationMinutes });
  console.log('AI-produced query:', JSON.stringify(query));
  if (result.album) {
    console.log(`Album: ${result.album.artist} — ${result.album.title} (${result.album.year ?? '????'})`);
  }
  console.log(
    `Selected ${result.tracks.length} tracks, ~${formatClock(result.estimatedTotalMs)} total (target ${formatClock(result.targetMs)})`
  );
  console.log('');
  console.log(result.album ? 'Researching album...' : 'Researching tracks...');
  console.log('');

  const trackFacts = result.album
    ? await researchAlbumTracks(result.tracks, result.album)
    : await researchTracks(result.tracks);

  result.tracks.forEach((t, i) => {
    const facts = trackFacts.get(String(t.ratingKey));
    console.log(
      `${String(i + 1).padStart(2, '0')}. ${t.artist} — ${t.title} (${t.album ?? 'no album'}, ${t.year ?? '????'}) [${formatClock(t.durationMs)}]`
    );
    console.log(facts ? `    facts: ${facts}` : '    facts: (none found)');
  });
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
