// Narrow, single-purpose AI step: translate a human-authored "Track
// Selection" brief (which may mix clean fields like "artist: Elvis Presley"
// with looser concepts like "no christmas songs") into the concrete,
// resolvable query queue.js's buildTrackQueue() needs. This is the ONLY
// place the LLM touches track selection -- once this call returns a query
// that actually resolves against real Plex data, everything else (fetch,
// dedupe, popularity weighting, duration-fitting) is deterministic, same as
// before.
//
// Validation reuses buildTrackQueue itself rather than a separate check:
// if the produced query doesn't actually resolve (bad artist, invalid
// genre), buildTrackQueue throws a real, specific error (same messages a
// human would get), which gets fed back to the model as the retry signal --
// no duplicate validation logic to keep in sync.
import { listGenreTags, listAlbumGenreTags } from '../../plex/genres.js';
import { buildTrackQueue } from './queue.js';
import { callModel } from '../../llm/client.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('station');

function queryTool() {
  return {
    type: 'function',
    function: {
      name: 'produce_query',
      description:
        'Produce the concrete Plex track-selection query implied by the Track Selection brief. Only set fields the brief actually implies.',
      parameters: {
        type: 'object',
        properties: {
          artist: { type: 'string', description: 'Artist name, if the brief names one.' },
          genre: {
            type: 'string',
            description: 'Pick the closest real tag from the provided genre list, if the brief implies a genre/style.',
          },
          decade: { type: 'string', description: 'Decade start year (e.g. "1980"), if the brief implies one.' },
          albumKeyword: {
            type: 'string',
            description:
              'A word/phrase that must appear in the album title, for briefs naming a compilation/branding rather than a real genre tag (e.g. a "Disney" show -- this library has no Disney genre, but does have albums titled things like "Ultimate Disney" and "Classic Disney: 60 Years of Musical Magic"). Only set this when no genre tag actually covers what the brief means; prefer genre when one fits.',
          },
          folder: {
            type: 'string',
            description:
              'A library folder path (or distinctive substring of one) the brief explicitly scopes tracks to, e.g. "/volume1/media/_soundtrack" for a show restricted to that one folder. Only set this when the brief names a specific folder/path -- not a general inference from genre or theme.',
          },
          artistList: {
            type: 'array',
            items: { type: 'string' },
            description:
              'A list of specific real artist names, for a brief describing a theme spanning many named artists rather than one genre/decade/single-artist (e.g. "female vocalists", "one-hit wonders") -- no such theme metadata exists in this library, only Genre/Country/artist/album/decade, so the only way to express it is by naming actual artists who fit. List a good number (10-30+) of well-known, genuinely fitting real artists; ones not present in this library are silently skipped, so err on the generous side rather than a short list. Only use this when genre/decade/artist alone cannot express the brief.',
          },
          albumGenre: {
            type: 'string',
            description:
              'Pick the closest real tag from the provided ALBUM genre list, if the brief explicitly says to use album genre (a separate, richer tag vocabulary from track genre in this library -- includes tags like "Instrumental" that only exist at the album level). Only set this when the brief specifically calls for album genre rather than plain genre.',
          },
          singleAlbum: {
            type: 'boolean',
            description:
              'true if the brief wants the whole show built around ONE randomly-picked album (e.g. "pick a random album and play its songs"), rather than a themed mix pulled from across an artist/genre/decade\'s full catalog. A single compilation/best-of album is never picked. artist/genre/decade still narrow which albums are eligible, if given, but none of them are required -- omit all three for a fully random pick across the whole library.',
          },
          excludeKeywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Plain words/phrases to exclude by matching against track title/album/genre. Expand vague exclusions into concrete keywords -- e.g. "no christmas songs" -> ["christmas","santa","xmas"].',
          },
          repeatArtist: {
            type: 'boolean',
            description: 'true if the same artist may/should repeat throughout (typical for a single-artist show).',
          },
          oneTrackPerAlbum: {
            type: 'boolean',
            description:
              'true if the brief wants variety across albums/eras for a single-artist show (e.g. "tracks from different albums") -- caps at one track per album.',
          },
          weightPopular: {
            type: 'boolean',
            description: 'true if well-known/popular tracks should be favored over deep cuts.',
          },
          maxTrackDurationSeconds: {
            type: 'number',
            description:
              'Maximum track length in seconds, if the brief implies a cap (e.g. "no tracks over 5 minutes" -> 300, "radio edits only, under 3:30" -> 210).',
          },
        },
      },
    },
  };
}

export async function produceTrackQuery({ trackSelectionText, targetDurationMinutes, repeatWindowDays, maxAttempts = 4 }) {
  const [genreTags, albumGenreTags] = await Promise.all([listGenreTags(), listAlbumGenreTags()]);
  const systemPrompt = [
    'You translate a human-authored "Track Selection" brief for a radio show into a concrete Plex music query',
    'by calling produce_query. Resolve vague concepts into concrete values -- a genre/style mention should map to',
    'the closest real tag in the list below; a vague exclusion should expand into a few concrete keywords.',
    '',
    `Real genre tags in this library: ${genreTags.join(', ')}`,
    '',
    `Real ALBUM genre tags in this library (a separate, richer vocabulary -- only use via the albumGenre field, and only when the brief explicitly asks for album genre): ${albumGenreTags.join(', ')}`,
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Track Selection brief:\n${trackSelectionText}` },
  ];
  const tools = [queryTool()];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const message = await callModel(messages, tools, 'required');
    messages.push(message);

    const call = message.tool_calls?.[0];
    if (!call) {
      messages.push({ role: 'user', content: 'Call produce_query with the fields.' });
      continue;
    }

    let args;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (err) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ error: `Arguments were not valid JSON: ${err.message}` }),
      });
      continue;
    }

    log(`track query attempt ${attempt}: ${JSON.stringify(args)}`);
    try {
      const result = await buildTrackQueue({ ...args, targetDurationMinutes, repeatWindowDays });
      return { query: args, result };
    } catch (err) {
      log(`track query attempt ${attempt} rejected: ${err.message}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: err.message }) });
    }
  }

  throw new Error(`Could not produce a valid, resolvable Plex query after ${maxAttempts} attempts`);
}
