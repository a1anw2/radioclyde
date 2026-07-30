// Per-track research for the producer pipeline: song-level Wikipedia lookup
// first, falling back to the album's page when Wikipedia has no dedicated
// page for the song itself (the majority case for deep cuts). Each lookup
// goes through wikipediaCache.js's on-disk cache. Album-level results are
// also cached per-run (in memory) so multiple tracks from the same album --
// common when one show pulls several tracks off one record -- only pay for
// one fetch+extraction, not one per track.
import { cachedFetchSummary } from './wikipediaCache.js';
import { complete } from '../../llm/client.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('station');

async function extractFacts(entityName, rawText) {
  return complete([
    {
      role: 'system',
      content:
        'You pull out short, interesting, radio-DJ-worthy facts from reference text. Reply with 2-3 concise facts as plain sentences, no preamble, no bullet points.',
    },
    { role: 'user', content: `Entity: ${entityName}\n\nReference text:\n${rawText}` },
  ]);
}

// Last-resort fallback when neither song- nor album-level Wikipedia lookup
// turns up anything: plain factual metadata Plex already gave us for free
// (no lookup, so it can't fail). Not "interesting trivia" the way real
// research is, but it means a track never has literally nothing to say
// about it.
function buildFallbackFacts(track) {
  if (track.album) {
    return track.year ? `From the ${track.year} album "${track.album}".` : `From the album "${track.album}".`;
  }
  if (track.year) return `Released in ${track.year}.`;
  if (track.genre?.length) return `Genre: ${track.genre.join(', ')}.`;
  return null;
}

// Album-first research for single-album shows (buildTrackQueue's
// singleAlbum mode): one Wikipedia lookup for the album itself, rather than
// one per track. A per-track song lookup would mostly surface song-level
// trivia that has nothing to do with the album as a shared body of work --
// the opposite of what a "spend the whole show on this one record" format
// wants. Pulls a bigger pool of facts than the per-track 2-3 (asks for up to
// 2 per track) and hands each track a distinct, non-overlapping slice, so
// intros/recaps across the show build a running picture of the album
// instead of every track repeating the same couple of facts.
async function extractAlbumFacts(albumTitle, rawText, desiredCount) {
  const content = await complete([
    {
      role: 'system',
      content:
        `You pull out short, interesting, radio-DJ-worthy facts about an album from reference text. Reply with ` +
        `one concise fact per line (plain sentences, no numbering or bullet points) -- as many distinct facts as ` +
        `the text genuinely supports, up to ${desiredCount}. Do not pad with filler or repeat the same fact reworded.`,
    },
    { role: 'user', content: `Album: ${albumTitle}\n\nReference text:\n${rawText}` },
  ]);
  return content
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter(Boolean);
}

export async function researchAlbumTracks(tracks, album) {
  const trackFacts = new Map();
  let facts = [];
  try {
    const albumQuery = `${album.title} ${album.artist} album`;
    const summary = await cachedFetchSummary(albumQuery);
    // Some albums (confirmed live: Norah Jones's "Living Room") have no
    // dedicated Wikipedia page at all -- every query phrasing tried just
    // falls back to Wikipedia's search ranking the artist's own bio page
    // instead. Using that page's content would present generic artist trivia
    // ("she's won ten Grammys") as if it were specifically about this album,
    // which is worse than admitting no album facts were found. Reject a
    // summary whose title is just the artist's own name.
    if (summary && summary.title.trim().toLowerCase() === album.artist.trim().toLowerCase()) {
      log(`No dedicated Wikipedia page for album "${album.title}" -- search only matched the artist's own page ("${summary.title}"), discarding rather than misattributing artist facts to the album.`);
    } else if (summary) {
      facts = await extractAlbumFacts(album.title, summary.extract, Math.max(tracks.length * 2, 8));
      log(`Album facts for "${album.title}" (${facts.length} found): ${facts.join(' | ')}`);
    } else {
      log(`No Wikipedia page found for album "${album.title}" by ${album.artist}`);
    }
  } catch (err) {
    // Same rule as researchTracks: a failed request must not be treated as
    // "no facts" -- wikipediaCache.js only persists a negative cache entry
    // on a genuine "not found" result.
    log(`WARNING: album research failed for "${album.title}": ${err.message}`);
  }

  tracks.forEach((track, i) => {
    let assigned;
    if (facts.length) {
      // Two distinct slots per track (intro + recap) cycling through the
      // pool -- if the pool is smaller than 2x the track count this wraps
      // around, which is the best available fallback rather than an error.
      const first = facts[(i * 2) % facts.length];
      const second = facts[(i * 2 + 1) % facts.length];
      assigned = first === second ? first : `${first} ${second}`;
    } else {
      assigned = buildFallbackFacts(track);
      if (assigned) log(`Using Plex-metadata fallback for "${track.title}": ${assigned}`);
    }
    trackFacts.set(String(track.ratingKey), assigned);
  });

  return trackFacts;
}

export async function researchTracks(tracks) {
  const albumFactsCache = new Map(); // album name -> facts string or null
  const trackFacts = new Map(); // String(ratingKey) -> facts string or null

  for (const track of tracks) {
    let facts = null;
    try {
      const songQuery = `"${track.title}" ${track.artist} song`;
      const songSummary = await cachedFetchSummary(songQuery);
      if (songSummary) {
        facts = await extractFacts(track.title, songSummary.extract);
        log(`Facts for "${track.title}" (song-level): ${facts}`);
      } else if (track.album) {
        if (albumFactsCache.has(track.album)) {
          facts = albumFactsCache.get(track.album);
          log(`Facts for "${track.title}" reused from album cache ("${track.album}")`);
        } else {
          const albumQuery = `${track.album} ${track.artist} album`;
          const albumSummary = await cachedFetchSummary(albumQuery);
          facts = albumSummary ? await extractFacts(track.album, albumSummary.extract) : null;
          albumFactsCache.set(track.album, facts);
          log(facts ? `Facts for album "${track.album}": ${facts}` : `No facts found for album "${track.album}"`);
        }
      } else {
        log(`No facts found for "${track.title}" (no song page, no album to fall back to)`);
      }
    } catch (err) {
      // A failed request (rate-limited, network hiccup) must NOT be treated
      // as "no facts" for this track -- wikipediaCache.js only persists a
      // negative cache entry on a genuine "not found" result, so nothing
      // gets wrongly cached here. This track just has no facts *this run*;
      // a retry later can still succeed.
      log(`WARNING: research failed for "${track.title}": ${err.message}`);
    }

    if (!facts) {
      facts = buildFallbackFacts(track);
      if (facts) log(`Using Plex-metadata fallback for "${track.title}": ${facts}`);
    }
    trackFacts.set(String(track.ratingKey), facts);
    // Request pacing itself now lives in wikipedia.js's pacedFetch, shared
    // across every actual HTTP call this loop triggers (song lookup, album
    // fallback lookup, or both) -- nothing to do here per track.
  }

  return trackFacts;
}
