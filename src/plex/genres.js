import { config } from '../config/index.js';
import { plexGet, TYPE_ALBUM, TYPE_TRACK } from './client.js';

let genreTagsCache = null;
async function fetchGenreTags() {
  if (genreTagsCache) return genreTagsCache;
  const data = await plexGet(`/library/sections/${config.plex.librarySectionId}/genre?type=${TYPE_TRACK}`);
  genreTagsCache = data.MediaContainer.Directory ?? [];
  return genreTagsCache;
}

// Real tag titles as known to this library (e.g. "Pop/Rock", not "Rock") --
// exposed so a query-producing step can be told the real vocabulary up
// front instead of guessing and getting corrected.
export async function listGenreTags() {
  return (await fetchGenreTags()).map((t) => t.title);
}

// The `genre` filter param takes Plex's internal numeric tag id, not the
// literal genre name -- resolve it via the section's genre tag list first.
// This library's tag set is coarse (e.g. "Pop/Rock", not "Rock"/"Disco"), so
// throw with the real options rather than silently returning zero tracks.
export async function resolveGenreId(name) {
  const tags = await fetchGenreTags();
  const match = tags.find((t) => t.title.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new Error(
      `No genre tag "${name}" in this library. Available genres: ${tags.map((t) => t.title).join(', ')}`
    );
  }
  return match.key;
}

// Album-level genre is a separate tag vocabulary from track-level genre in
// this library (confirmed live, 2026-07-28: after the user's metadata
// cleanup, type=9's genre list has tags like "Instrumental", "Female Vocal",
// "Irish" that don't exist at all in type=10's track-genre list -- some tags
// like "Classical" happen to share the same key across both, but that's not
// reliable, so this needs its own fetch/resolve/cache, not a reuse of
// fetchGenreTags/resolveGenreId).
let albumGenreTagsCache = null;
async function fetchAlbumGenreTags() {
  if (albumGenreTagsCache) return albumGenreTagsCache;
  const data = await plexGet(`/library/sections/${config.plex.librarySectionId}/genre?type=${TYPE_ALBUM}`);
  albumGenreTagsCache = data.MediaContainer.Directory ?? [];
  return albumGenreTagsCache;
}

export async function listAlbumGenreTags() {
  return (await fetchAlbumGenreTags()).map((t) => t.title);
}

export async function resolveAlbumGenreId(name) {
  const tags = await fetchAlbumGenreTags();
  const match = tags.find((t) => t.title.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new Error(
      `No album genre tag "${name}" in this library. Available album genres: ${tags.map((t) => t.title).join(', ')}`
    );
  }
  return match.key;
}
