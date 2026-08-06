import { config } from '../config/index.js';
import { plexGet, TYPE_ALBUM } from './client.js';
import { resolveGenreId, resolveAlbumGenreId } from './genres.js';
import { resolveArtistId } from './artists.js';
import { trackFromMetadata, fetchTracksByFolder } from './tracks.js';

export function albumFromMetadata(a) {
  return {
    ratingKey: a.ratingKey,
    title: a.title ?? 'Unknown Album',
    artist: a.parentTitle ?? 'Unknown Artist',
    year: a.year ?? null,
    genre: (a.Genre ?? []).map((g) => g.tag),
  };
}

// A single album's tracks via its /children endpoint -- shared by the
// per-decade fetch in tracks.js and by the single-album show mode
// (buildSingleAlbumTrackQueue's folder path), which needs one specific
// album's tracks rather than an aggregated pool.
export async function fetchAlbumTracks(albumRatingKey) {
  const data = await plexGet(`/library/metadata/${albumRatingKey}/children`);
  return (data.MediaContainer.Metadata ?? []).map(trackFromMetadata).filter(Boolean);
}

export async function fetchAlbumsByDecade(decadeValue) {
  const startYear = parseInt(decadeValue, 10);
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_ALBUM}&decade=${startYear}&X-Plex-Container-Start=0&X-Plex-Container-Size=10000`
  );
  return (data.MediaContainer.Metadata ?? []).map(albumFromMetadata);
}

// Confirmed live (2026-07-27, preview-track-queue --singleAlbum --genre):
// the section's genre tag id (fetched via type=10 in genres.js) also
// resolves correctly filtered against type=9 (albums), same as decade does.
export async function fetchAlbumsByGenre(name) {
  const genreId = await resolveGenreId(name);
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_ALBUM}&genre=${genreId}&X-Plex-Container-Start=0&X-Plex-Container-Size=10000`
  );
  return (data.MediaContainer.Metadata ?? []).map(albumFromMetadata);
}

// Filters albums by the separate album-level genre tag (resolveAlbumGenreId,
// not resolveGenreId) -- for tags like "Instrumental" that only exist at the
// album level, not the track level, in this library.
export async function fetchAlbumsByAlbumGenre(name) {
  const genreId = await resolveAlbumGenreId(name);
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_ALBUM}&genre=${genreId}&X-Plex-Container-Start=0&X-Plex-Container-Size=10000`
  );
  return (data.MediaContainer.Metadata ?? []).map(albumFromMetadata);
}

// Recently-added albums, newest first -- Plex's addedAt sort on the same
// /all endpoint every other album fetch uses here, rather than the separate
// /recentlyAdded view (keeps this one shape for every album query in the
// file). "Recent" means "the last N albums added" (matching Plex's own
// Recently Added semantics), not a fixed day cutoff -- a quiet library still
// gets a full pool to draw from, and a busy one doesn't drown in months-old
// albums that happen to fall inside some arbitrary day window.
const RECENTLY_ADDED_ALBUM_LIMIT = 40;

export async function fetchRecentlyAddedAlbums() {
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_ALBUM}&sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=${RECENTLY_ADDED_ALBUM_LIMIT}`
  );
  return (data.MediaContainer.Metadata ?? []).map(albumFromMetadata);
}

async function fetchAlbumsByArtist(name) {
  const artistId = await resolveArtistId(name);
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_ALBUM}&artist.id=${artistId}&X-Plex-Container-Start=0&X-Plex-Container-Size=10000`
  );
  return (data.MediaContainer.Metadata ?? []).map(albumFromMetadata);
}

let allAlbumsCache = null;
async function fetchAllAlbums() {
  if (allAlbumsCache) return allAlbumsCache;
  const data = await plexGet(
    `/library/sections/${config.plex.librarySectionId}/all?type=${TYPE_ALBUM}&X-Plex-Container-Start=0&X-Plex-Container-Size=100000`
  );
  allAlbumsCache = (data.MediaContainer.Metadata ?? []).map(albumFromMetadata);
  return allAlbumsCache;
}

// No Plex filter param exists for "album title contains X" (unlike
// genre/decade/artist, which all have dedicated query params) -- this is for
// briefs that name a compilation/branding rather than a genre tag (e.g. a
// "Disney" show: this library has no Disney genre, but does have several
// albums with "Disney" in the title -- "Ultimate Disney", "Classic Disney:
// 60 Years of Musical Magic", etc). Substring match against the full album
// list (already cached via fetchAllAlbums).
export async function fetchAlbumsByKeyword(keyword) {
  const albums = await fetchAllAlbums();
  const q = keyword.toLowerCase();
  return albums.filter((a) => a.title.toLowerCase().includes(q));
}

// Album-level counterpart to fetchCandidateTracks, for shows that pick one
// whole album (buildTrackQueue's singleAlbum mode) rather than a mix of
// tracks. Unlike fetchCandidateTracks, no filter at all is valid here -- it
// means "any album in the library", for a show with no artist/genre/decade
// scoping at all.
export async function fetchCandidateAlbums({ artist, genre, decade, albumKeyword, albumGenre } = {}) {
  const filterSets = [];
  if (decade) filterSets.push(await fetchAlbumsByDecade(decade));
  if (genre) filterSets.push(await fetchAlbumsByGenre(genre));
  if (artist) filterSets.push(await fetchAlbumsByArtist(artist));
  if (albumKeyword) filterSets.push(await fetchAlbumsByKeyword(albumKeyword));
  if (albumGenre) filterSets.push(await fetchAlbumsByAlbumGenre(albumGenre));

  if (filterSets.length === 0) return fetchAllAlbums();
  if (filterSets.length === 1) return filterSets[0];

  const [first, ...rest] = filterSets;
  const restKeySets = rest.map((list) => new Set(list.map((a) => String(a.ratingKey))));
  return first.filter((a) => restKeySets.every((set) => set.has(String(a.ratingKey))));
}

// Reconstructs "album" groupings for a folder-scoped single-album show
// (buildSingleAlbumTrackQueue's folder path) without a Plex album ratingKey
// to key off -- folder-organized soundtrack libraries put one movie/show per
// directory but credit each track to its own composer/performer rather than
// one consistent artist (confirmed live: "My Fair Lady"'s 27 tracks span
// several different credited artists), so album title is the only reliable
// grouping key, and each pseudo-album carries its own track list inline
// since there's no ratingKey to re-fetch tracks by later.
function groupTracksByAlbum(tracks) {
  const groups = new Map();
  for (const t of tracks) {
    if (!t.album) continue;
    if (!groups.has(t.album)) {
      groups.set(t.album, { title: t.album, artist: t.artist, year: t.year, genre: t.genre, tracks: [] });
    }
    groups.get(t.album).tracks.push(t);
  }
  return [...groups.values()];
}

export async function fetchAlbumsByFolder(folderPath) {
  return groupTracksByAlbum(await fetchTracksByFolder(folderPath));
}
