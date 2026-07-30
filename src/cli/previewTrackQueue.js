#!/usr/bin/env node
// Cheap dry-run for producer/trackSelection/queue.js -- prints what
// buildTrackQueue would hand to a show, no AI, no writes, safe to re-run
// repeatedly while tuning weightPopular/djOverheadSeconds/etc.
import { buildTrackQueue } from '../producer/trackSelection/queue.js';
import { parseArgs } from '../lib/args.js';
import { formatClock } from '../lib/format.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const query = {
    artist: args.artist,
    genre: args.genre,
    decade: args.decade,
    albumKeyword: args.albumKeyword,
    folder: args.folder,
    artistList: args.artistList ? args.artistList.split(',').map((s) => s.trim()) : undefined,
    albumGenre: args.albumGenre,
    excludeKeywords: args.exclude ? args.exclude.split(',').map((s) => s.trim()) : [],
    maxTrackDurationSeconds: args.maxTrackDurationSeconds ? parseInt(args.maxTrackDurationSeconds, 10) : undefined,
    repeatArtist: args.repeatArtist === undefined ? undefined : args.repeatArtist === 'true',
    weightPopular: args.weightPopular === 'true',
    oneTrackPerAlbum: args.oneTrackPerAlbum === 'true',
    singleAlbum: args.singleAlbum === 'true',
    targetDurationMinutes: args.duration ? parseInt(args.duration, 10) : undefined,
    djOverheadSeconds: args.overhead ? parseInt(args.overhead, 10) : undefined,
    repeatWindowDays: args.repeatWindow ? parseInt(args.repeatWindow, 10) : undefined,
  };

  const result = await buildTrackQueue(query);

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
