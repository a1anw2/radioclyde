// Shared track-list filtering/weighting helpers, used by both the producer's
// deterministic queue builder (producer/trackSelection/queue.js) and the
// off-air filler playlist (scheduler/generateFillerPlaylist.js) -- pulled out
// here rather than left inside the producer's track-selection module since
// both callers need the exact same dedupe/exclusion behavior.

// Confirmed live: this library has the same song under both a straight (')
// and curly (') apostrophe across different reissues (two "Rubberneckin'"
// entries, different ratingKeys) -- normalizing quote characters is required
// for the title match below to actually catch it as a duplicate.
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[‘’']/g, "'")
    .trim();
}

// Compilation-heavy artists re-release the same song under multiple albums
// (confirmed live: this library has "Jailhouse Rock" under at least two
// different ratingKeys/albums for Elvis Presley) -- keep only the highest-
// ratingCount instance of each normalized title so a show never plays "the
// same song" twice under two different catalog entries.
export function dedupeByTitle(tracks) {
  const byTitle = new Map();
  for (const t of tracks) {
    const key = normalizeTitle(t.title);
    const existing = byTitle.get(key);
    if (!existing || (t.ratingCount ?? 0) > (existing.ratingCount ?? 0)) {
      byTitle.set(key, t);
    }
  }
  return [...byTitle.values()];
}

// A negative filter like "not christmas" can't rely on genre -- confirmed
// live that Christmas tracks in this library are inconsistently tagged
// (some genre: [], some genre: ["Pop/Rock"], none tagged "Holiday"), and one
// ("Santa Claus Is Back in Town") isn't even on a Christmas-named album. The
// only signal that's actually reliable is keyword matching against title,
// album, genre, artist, AND the Plex file path together -- so a track is
// excluded if ANY of those mention an excluded keyword. artist catches
// compilation-style "Various Artists" credits; plexPath catches library
// folders like "_soundtrack" that aren't reflected in any metadata field
// (confirmed live: "Wipeout" from the Dirty Dancing soundtrack has
// genre: ["Pop/Rock"] and no "soundtrack"/"compilation" in its title or
// album, but lives under .../_soundtrack/Dirty Dancing/...).
export function matchesExcludedKeyword(track, excludeKeywords) {
  if (!excludeKeywords?.length) return false;
  const haystack = [track.title, track.album, track.artist, track.plexPath, ...(track.genre ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return excludeKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

// Plex's music metadata agent attaches a global popularity figure as
// ratingCount (confirmed live: a few hundred for deep cuts vs 800k+ for
// "Hound Dog"). Log-scaling keeps a handful of blockbuster hits from
// crowding out everything else; missing/zero ratingCount still gets a small
// positive floor rather than being effectively excluded.
export function popularityWeight(track) {
  return Math.log10((track.ratingCount ?? 0) + 10);
}

// Efraimidis-Spirakis weighted sampling without replacement: give each item
// a key of random()^(1/weight) and sort descending. Higher-weight items are
// more likely to land earlier, but nothing is excluded outright the way a
// strict top-N by weight would.
export function weightedShuffle(tracks, weightFn) {
  return tracks
    .map((t) => ({ t, key: Math.random() ** (1 / weightFn(t)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.t);
}
