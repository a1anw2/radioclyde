// Deterministic, no-AI track queue builder. Once a query (artist/genre/
// decade + selection options) is decided, everything here -- fetching,
// popularity weighting, recently-played exclusion, duration-based
// accumulation -- runs without the LLM. This is the piece the producer
// session used to do itself via repeated search_tracks tool calls; pulling
// it out into one deterministic pass is what actually fixes the duration-
// fitting and catalog-variety problems that surfaced testing the AI-driven
// version.
import { fetchCandidateTracks } from '../../plex/tracks.js';
import { fetchCandidateAlbums, fetchAlbumTracks, fetchAlbumsByFolder } from '../../plex/albums.js';
import { dedupeByTitle, matchesExcludedKeyword, popularityWeight, weightedShuffle } from '../../plex/trackFilters.js';
import { recentlyPlayedRatingKeys, recentlyPlayedAlbumKeys, recentlyPlayedAlbumTitles, albumKey } from '../history.js';
import { shuffle } from '../../lib/format.js';

// Heavier per-track commentary (intro + teaser + trivia, roughly two DJ
// segments) costs more airtime than the old single-line-per-track pipeline
// budgeted for (~25s) -- this is a starting estimate, expected to get tuned
// once real Chatterbox-timed shows exist to check it against.
const DEFAULT_DJ_OVERHEAD_SECONDS = 45;

// "Best of"/"greatest hits"-style albums are exactly the compilations a
// single-album show shouldn't land on (the whole point is one real studio
// record, not a repackaging of tracks from several) -- matched the same
// keyword way as excludeKeywords below, so a brief's own exclusions (e.g.
// "no christmas") stack with these built-in ones rather than replacing them.
const DEFAULT_COMPILATION_ALBUM_KEYWORDS = [
  'greatest hits',
  'best of',
  'the hits',
  'anthology',
  'collection',
  'essential',
  'very best',
  'number ones',
  '#1',
  'box set',
  'ultimate',
  // Confirmed live: a movie soundtrack ("Back to the Future") got picked
  // because the LLM-produced excludeKeywords that run happened not to
  // include "various artists" -- relying on the brief/LLM to always think of
  // it is unreliable, and "Various Artists" as the credited album artist is
  // an unconditional, always-present signal that it's a multi-artist
  // compilation, not one artist's classic album. Baked in here rather than
  // left to the brief so it can never be forgotten.
  'various artists',
];

// Picks one real, non-compilation album at random from whatever
// artist/genre/decade the brief scoped things to (or the whole library, if
// none of those were given -- a fully random "Classic Album" show).
// excludeAlbumKeys is the show-level "don't repeat" for this mode (see
// recentlyPlayedAlbumKeys in producer/history.js) -- a rolling window, not a
// permanent ban: if every non-compilation album is inside the window (an
// artist-locked show with a small catalog, run often enough), fall back to
// the full list rather than failing the show outright.
async function pickRandomAlbum({ artist, genre, decade, albumKeyword, albumGenre, excludeKeywords, excludeAlbumKeys = new Set() }) {
  const albums = await fetchCandidateAlbums({ artist, genre, decade, albumKeyword, albumGenre });
  const compilationKeywords = [...DEFAULT_COMPILATION_ALBUM_KEYWORDS, ...excludeKeywords];
  const nonCompilation = albums.filter(
    (a) => !matchesExcludedKeyword({ title: a.title, album: a.title, artist: a.artist, genre: a.genre }, compilationKeywords)
  );
  if (nonCompilation.length === 0) {
    throw new Error(
      `No non-compilation albums found (artist=${artist ?? '-'}, genre=${genre ?? '-'}, decade=${decade ?? '-'}); ${albums.length} album(s) matched before compilation exclusion.`
    );
  }
  const fresh = nonCompilation.filter((a) => !excludeAlbumKeys.has(albumKey(a.artist, a.title)));
  return shuffle(fresh.length > 0 ? fresh : nonCompilation)[0];
}

// folder's counterpart to pickRandomAlbum -- albums here are reconstructed
// from track paths (fetchAlbumsByFolder), not a Plex album entity, so
// "artist" isn't a reliable per-album identity (see fetchAlbumsByFolder's
// comment); dedupe against history by title alone via
// recentlyPlayedAlbumTitles rather than albumKey's artist+title composite.
async function pickRandomAlbumFromFolder({ folder, excludeKeywords, excludeAlbumTitles = new Set() }) {
  const albums = await fetchAlbumsByFolder(folder);
  const compilationKeywords = [...DEFAULT_COMPILATION_ALBUM_KEYWORDS, ...excludeKeywords];
  const nonCompilation = albums.filter(
    (a) => !matchesExcludedKeyword({ title: a.title, album: a.title, artist: a.artist, genre: a.genre }, compilationKeywords)
  );
  if (nonCompilation.length === 0) {
    throw new Error(
      `No non-compilation albums found under folder "${folder}"; ${albums.length} album(s) matched before compilation exclusion.`
    );
  }
  const fresh = nonCompilation.filter((a) => !excludeAlbumTitles.has(a.title.toLowerCase()));
  return shuffle(fresh.length > 0 ? fresh : nonCompilation)[0];
}

// Single-album show mode: one whole show built around one randomly-picked
// album, rather than a themed mix pulled from across an artist/genre/decade's
// full catalog. "Top songs" here means popularity-weighted sampling within
// that one album (same weightedShuffle mechanism buildTrackQueue's
// weightPopular uses) -- but unlike the regular flow, at least one
// distinctly less-popular track is *reserved* up front rather than left to
// chance, since weighted sampling alone could plausibly land on an
// all-popular-track show for a well-known album. Final playback order is
// reshuffled after selection so "top songs" doesn't also mean "in popularity
// order".
//
// "Don't repeat" lives at the ALBUM level here, not the track level -- the
// regular buildTrackQueue path excludes individual recently-played tracks
// station-wide (recentlyPlayedRatingKeys), but that's the wrong granularity
// for a show whose whole point is playing several tracks off one record
// together as a unit. Blocking individual tracks would either starve a
// re-picked album's own eligible pool for no reason, or do nothing useful --
// the actual repeat concern is the SAME ALBUM coming back too soon, which
// recentlyPlayedAlbumKeys (repeatWindowDays, same brief override as before)
// governs instead. Once an album is picked, none of its own tracks are
// excluded by other shows' history -- repeating them together is the point.
export async function buildSingleAlbumTrackQueue({
  artist,
  genre,
  decade,
  albumKeyword,
  folder,
  albumGenre,
  excludeKeywords = [],
  maxTrackDurationSeconds,
  targetDurationMinutes,
  djOverheadSeconds = DEFAULT_DJ_OVERHEAD_SECONDS,
  repeatWindowDays,
  maxAlbumAttempts = 5,
} = {}) {
  if (!targetDurationMinutes) {
    throw new Error('buildSingleAlbumTrackQueue requires targetDurationMinutes');
  }

  const maxTrackDurationMs = maxTrackDurationSeconds ? maxTrackDurationSeconds * 1000 : undefined;
  const excludeAlbumKeys = recentlyPlayedAlbumKeys(repeatWindowDays);
  const excludeAlbumTitles = folder ? recentlyPlayedAlbumTitles(repeatWindowDays) : undefined;
  const targetMs = targetDurationMinutes * 60 * 1000;
  const overheadMs = djOverheadSeconds * 1000;

  const triedAlbums = new Set();
  let lastError;
  for (let attempt = 1; attempt <= maxAlbumAttempts; attempt++) {
    const album = folder
      ? await pickRandomAlbumFromFolder({ folder, excludeKeywords, excludeAlbumTitles })
      : await pickRandomAlbum({ artist, genre, decade, albumKeyword, albumGenre, excludeKeywords, excludeAlbumKeys });
    // Folder pseudo-albums have no Plex ratingKey (see fetchAlbumsByFolder) --
    // fall back to title as the "already tried this attempt" identity.
    const albumIdentity = album.ratingKey ?? album.title;
    if (triedAlbums.has(albumIdentity)) continue;
    triedAlbums.add(albumIdentity);

    // Folder pseudo-albums carry their tracks inline (no ratingKey to
    // re-fetch by); everything else still looks them up via Plex.
    const rawTracks = album.tracks ?? (await fetchAlbumTracks(album.ratingKey));
    const eligible = dedupeByTitle(rawTracks).filter(
      (t) => !matchesExcludedKeyword(t, excludeKeywords) && (!maxTrackDurationMs || t.durationMs <= maxTrackDurationMs)
    );

    if (eligible.length < 2) {
      lastError = new Error(
        `Album "${album.title}" by ${album.artist} only had ${eligible.length} eligible track(s) after filtering -- trying another album.`
      );
      continue;
    }

    // Reserve the single least-popular track as the guaranteed non-popular
    // pick, then weighted-sample the rest toward the album's better-known
    // songs for everything else.
    const byPopularityAsc = [...eligible].sort((a, b) => popularityWeight(a) - popularityWeight(b));
    const deepCut = byPopularityAsc[0];
    const rest = eligible.filter((t) => t !== deepCut);
    const topOrdered = weightedShuffle(rest, popularityWeight);

    const selected = [deepCut];
    let totalMs = deepCut.durationMs + overheadMs;
    for (const track of topOrdered) {
      if (totalMs >= targetMs) break;
      selected.push(track);
      totalMs += track.durationMs + overheadMs;
    }

    return {
      tracks: shuffle(selected),
      estimatedTotalMs: totalMs,
      estimatedMusicMs: selected.reduce((sum, t) => sum + t.durationMs, 0),
      targetMs,
      poolSize: eligible.length,
      album: { title: album.title, artist: album.artist, year: album.year },
    };
  }

  throw lastError ?? new Error(`Could not find a suitable album after ${maxAlbumAttempts} attempts.`);
}

export async function buildTrackQueue({
  artist,
  genre,
  decade,
  albumKeyword,
  folder,
  artistList,
  albumGenre,
  excludeKeywords = [],
  maxTrackDurationSeconds,
  repeatArtist = true,
  oneTrackPerAlbum = false,
  weightPopular = false,
  singleAlbum = false,
  targetDurationMinutes,
  djOverheadSeconds = DEFAULT_DJ_OVERHEAD_SECONDS,
  repeatWindowDays,
} = {}) {
  if (singleAlbum) {
    return buildSingleAlbumTrackQueue({
      artist,
      genre,
      decade,
      albumKeyword,
      folder,
      albumGenre,
      excludeKeywords,
      maxTrackDurationSeconds,
      targetDurationMinutes,
      djOverheadSeconds,
      repeatWindowDays,
    });
  }

  if (!artist && !genre && !decade && !albumKeyword && !folder && !artistList?.length && !albumGenre) {
    throw new Error(
      'buildTrackQueue requires at least one of: artist, genre, decade, albumKeyword, folder, artistList, albumGenre'
    );
  }
  if (!targetDurationMinutes) {
    throw new Error('buildTrackQueue requires targetDurationMinutes');
  }

  const maxTrackDurationMs = maxTrackDurationSeconds ? maxTrackDurationSeconds * 1000 : undefined;
  const rawCandidates = await fetchCandidateTracks({ artist, genre, decade, albumKeyword, folder, artistList, albumGenre });
  const recentlyPlayed = recentlyPlayedRatingKeys(repeatWindowDays);
  // maxTrackDurationSeconds is a plain mechanical length cutoff -- applied
  // here as a post-fetch prune, same as recently-played exclusion. The
  // value itself comes from the brief (e.g. "no tracks over 5 minutes" ->
  // 300), extracted by the AI query-producer's produce_query schema.
  const eligible = dedupeByTitle(rawCandidates).filter(
    (t) =>
      !recentlyPlayed.has(String(t.ratingKey)) &&
      !matchesExcludedKeyword(t, excludeKeywords) &&
      (!maxTrackDurationMs || t.durationMs <= maxTrackDurationMs)
  );

  const ordered = weightPopular ? weightedShuffle(eligible, popularityWeight) : shuffle(eligible);

  const targetMs = targetDurationMinutes * 60 * 1000;
  const overheadMs = djOverheadSeconds * 1000;
  const usedArtists = new Set();
  const usedAlbums = new Set();
  const selected = [];
  let totalMs = 0;

  for (const track of ordered) {
    if (totalMs >= targetMs) break;
    // Artist-themed selections are expected to repeat the artist by
    // definition (every track already is that artist) -- the no-repeat
    // rule only means something for genre/decade selections, same
    // distinction below draws for oneTrackPerAlbum.
    if (!repeatArtist && usedArtists.has(track.artist)) continue;
    // oneTrackPerAlbum is for the opposite case -- a single-artist show
    // that still wants catalog variety (e.g. "Elvis Lookback" spanning many
    // albums, not several cuts off one record). Tracks with no album info
    // are never deduped against each other.
    if (oneTrackPerAlbum && track.album && usedAlbums.has(track.album)) continue;
    selected.push(track);
    usedArtists.add(track.artist);
    if (track.album) usedAlbums.add(track.album);
    totalMs += track.durationMs + overheadMs;
  }

  return {
    tracks: selected,
    estimatedTotalMs: totalMs,
    estimatedMusicMs: selected.reduce((sum, t) => sum + t.durationMs, 0),
    targetMs,
    poolSize: eligible.length,
  };
}
