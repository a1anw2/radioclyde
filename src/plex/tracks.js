import { config } from '../config/index.js';
import { plexGet, TYPE_TRACK } from './client.js';
import { resolveGenreId } from './genres.js';
import { resolveArtistId } from './artists.js';
import { fetchAlbumsByDecade, fetchAlbumsByAlbumGenre, fetchAlbumsByKeyword, fetchAlbumTracks } from './albums.js';
import { mapWithConcurrency } from '../lib/concurrency.js';

export function trackFromMetadata(t) {
  const part = t.Media?.[0]?.Part?.[0];
  if (!part?.file) return null;
  return {
    ratingKey: t.ratingKey,
    // originalTitle is Plex's designated override for "this track's real
    // artist differs from the album/show artist" -- exactly the compilation
    // case (confirmed live: a Various Artists compilation track has
    // grandparentTitle="Various Artists" but originalTitle="The Rolling
    // Stones", the actual performer). Checking grandparentTitle first
    // collapsed every compilation track down to "Various Artists", masking
    // real per-track artist diversity and making oneTrackPerAlbum/
    // repeatArtist=false selection see one giant fake "artist" instead of
    // however many real ones a compilation actually contains.
    artist: t.originalTitle ?? t.grandparentTitle ?? 'Unknown Artist',
    title: t.title ?? 'Unknown Title',
    album: t.parentTitle ?? null,
    year: t.parentYear ?? t.year ?? null,
    genre: (t.Genre ?? []).map((g) => g.tag),
    durationMs: t.duration ?? part.duration ?? 210000, // ~3.5min fallback
    plexPath: part.file,
    // Confirmed live: Plex's music metadata agent attaches a global
    // popularity figure here (real examples: "Hound Dog" 875,729 vs a deep
    // cut in the low hundreds) -- this is what trackFilters.js's popularity
    // weighting biases sampling by. Not present on every track.
    ratingCount: t.ratingCount ?? null,
    // Plex's relative art path for this track -- parentThumb (album art) is
    // preferred over the track's own thumb since album art is what's
    // actually meaningful to show a listener; falls back to the track-level
    // thumb for the rare item with no album art but its own cover.
    art: t.parentThumb ?? t.thumb ?? null,
  };
}

// The director's counterpart to fetchCandidateTracks -- resolves a
// script.md track segment's ratingKey back to its real file path at
// production time, rather than re-searching by name (which risks matching a
// different reissue than the one actually selected).
export async function getTrackByRatingKey(ratingKey) {
  const data = await plexGet(`/library/metadata/${ratingKey}`);
  const meta = data.MediaContainer.Metadata?.[0];
  if (!meta) throw new Error(`No Plex track found for ratingKey ${ratingKey}`);
  const track = trackFromMetadata(meta);
  if (!track) throw new Error(`Plex track ${ratingKey} has no playable file (missing Media/Part).`);
  return track;
}

async function fetchTracksByGenre(name) {
  const genreId = await resolveGenreId(name);
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_TRACK}&genre=${genreId}&X-Plex-Container-Start=0&X-Plex-Container-Size=100000`
  );
  return (data.MediaContainer.Metadata ?? []).map(trackFromMetadata).filter(Boolean);
}

async function fetchTracksByArtistId(artistId) {
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_TRACK}&artist.id=${artistId}&X-Plex-Container-Start=0&X-Plex-Container-Size=100000`
  );
  return (data.MediaContainer.Metadata ?? []).map(trackFromMetadata).filter(Boolean);
}

async function fetchTracksByArtist(name) {
  const artistId = await resolveArtistId(name);
  return fetchTracksByArtistId(artistId);
}

// Decade/year filters only exist on albums (type=9), not tracks -- fetch
// matching albums, then each album's tracks via its /children endpoint.
async function fetchTracksByDecade(decadeValue) {
  const albums = await fetchAlbumsByDecade(decadeValue);
  const perAlbum = await mapWithConcurrency(albums, 10, (album) => fetchAlbumTracks(album.ratingKey));
  return perAlbum.flat();
}

// Track-level counterpart, same shape as fetchTracksByDecade/
// fetchTracksByAlbumKeyword -- no track-level filter param exists for an
// album-only genre tag, so fetch the matching albums, then each one's tracks
// via /children.
async function fetchTracksByAlbumGenre(name) {
  const albums = await fetchAlbumsByAlbumGenre(name);
  const perAlbum = await mapWithConcurrency(albums, 10, (album) => fetchAlbumTracks(album.ratingKey));
  return perAlbum.flat();
}

async function fetchTracksByAlbumKeyword(keyword) {
  const albums = await fetchAlbumsByKeyword(keyword);
  if (albums.length === 0) {
    throw new Error(`No albums with "${keyword}" in the title found in this library.`);
  }
  const perAlbum = await mapWithConcurrency(albums, 10, (album) => fetchAlbumTracks(album.ratingKey));
  return perAlbum.flat();
}

// No Plex filter param exists for "album title contains X"/"folder path
// contains X" (unlike genre/decade/artist, which all have dedicated query
// params) -- this is for briefs that name a compilation/branding or a
// specific library folder rather than a genre tag. Fetches every track once
// and filters by substring match against each track's real filesystem path.
export async function fetchTracksByFolder(folderPath) {
  const tracks = await fetchAllTracks();
  const q = folderPath.toLowerCase();
  const matches = tracks.filter((t) => t.plexPath.toLowerCase().includes(q));
  if (matches.length === 0) {
    throw new Error(`No tracks found under folder "${folderPath}".`);
  }
  return matches;
}

// For a brief describing a theme spanning several named artists rather than
// one genre/decade/artist (e.g. "female vocalists" -- no gender/vocalist
// metadata exists anywhere in this library, only Genre and Country, so the
// only way to express that theme is by naming real artists who fit it). Each
// name is resolved independently and unmatched ones are silently skipped
// (not every named artist will actually be in this library) -- only throws
// if literally none of them resolved, same "tell the caller nothing worked"
// signal fetchTracksByAlbumKeyword/fetchTracksByFolder give for their own
// empty-match case.
async function fetchTracksByArtistList(names) {
  const ids = await mapWithConcurrency(names, 5, async (name) => {
    try {
      return await resolveArtistId(name);
    } catch {
      return null;
    }
  });
  const resolvedIds = [...new Set(ids.filter(Boolean))];
  if (resolvedIds.length === 0) {
    throw new Error(`None of the ${names.length} named artists were found in this library: ${names.join(', ')}`);
  }
  const perArtist = await mapWithConcurrency(resolvedIds, 10, (artistId) => fetchTracksByArtistId(artistId));
  return perArtist.flat();
}

// Every track in the library, no filter at all -- used by the off-air
// filler playlist, which just needs a big shuffled pool to keep the station
// broadcasting something during a scheduling gap, not a themed selection.
export async function fetchAllTracks() {
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_TRACK}&X-Plex-Container-Start=0&X-Plex-Container-Size=100000`
  );
  return (data.MediaContainer.Metadata ?? []).map(trackFromMetadata).filter(Boolean);
}

// Title-only search across the whole library (no artist/genre/decade
// narrowing available yet) -- substring match, so callers should treat
// results as candidates to disambiguate by artist, not a single confirmed
// answer (a "Queen" search also matches "Christine and the Queens").
async function fetchTracksByTitle(name) {
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_TRACK}&title=${encodeURIComponent(name)}&X-Plex-Container-Start=0&X-Plex-Container-Size=200`
  );
  return (data.MediaContainer.Metadata ?? []).map(trackFromMetadata).filter(Boolean);
}

// Resolves any combination of artist/genre/decade/title to a single
// candidate list, by fetching each provided field's full match set
// independently and intersecting by ratingKey -- picking one "primary"
// filter and ignoring the rest (an earlier version did that) silently drops
// filters instead of narrowing by them, which is worse than erroring.
export async function fetchCandidateTracks({ artist, title, genre, decade, albumKeyword, folder, artistList, albumGenre } = {}) {
  const filterSets = [];
  if (decade) filterSets.push(await fetchTracksByDecade(decade));
  if (genre) filterSets.push(await fetchTracksByGenre(genre)); // throws listing valid genres if unknown
  if (artist) filterSets.push(await fetchTracksByArtist(artist)); // throws/suggests if no match
  if (albumKeyword) filterSets.push(await fetchTracksByAlbumKeyword(albumKeyword)); // throws if no album title matches
  if (folder) filterSets.push(await fetchTracksByFolder(folder)); // throws if no track path matches
  if (artistList?.length) filterSets.push(await fetchTracksByArtistList(artistList)); // throws if none resolve
  if (albumGenre) filterSets.push(await fetchTracksByAlbumGenre(albumGenre)); // throws listing valid album genres if unknown
  if (title && filterSets.length === 0) filterSets.push(await fetchTracksByTitle(title));

  let candidates;
  if (filterSets.length === 1) {
    candidates = filterSets[0];
  } else {
    const [first, ...rest] = filterSets;
    const restKeySets = rest.map((list) => new Set(list.map((t) => String(t.ratingKey))));
    candidates = first.filter((t) => restKeySets.every((set) => set.has(String(t.ratingKey))));
  }

  if (title && filterSets.length > 0 && (decade || genre || artist)) {
    const q = title.toLowerCase();
    candidates = candidates.filter((t) => t.title.toLowerCase().includes(q));
  }

  return candidates;
}
