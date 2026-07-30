// Harness-driven boundary walk: the code -- not the model -- walks the
// tracklist and decides, at each boundary, which small fixed set of moves to
// generate (see script-format.md's authoring rules and the move vocabulary
// in moves.js). Each move is its own tool-free completion; a per-track memo
// carries forward what's already been said about that track so a recap
// doesn't repeat its intro's fact, and so a quiz reveal can close off the
// exact question it asked earlier.
import { formatCalendarDate } from '../lib/time.js';
import {
  generateOpenLine,
  generateCloseLine,
  generateIntroLine,
  generateRecapLine,
  generateWeatherHandoffLine,
} from './moves.js';

export async function buildSegments({ tracks, trackFacts, brief, date }) {
  // The show's real scheduled air date, not whatever day it happens to be
  // produced on -- station.json's downtime window can front-load a script
  // most of a day before it airs, so "today" from the model's own training
  // data or its own guess would routinely be wrong. Threaded into every
  // move call below (see moves.js's generateLine).
  const airDate = date ? formatCalendarDate(date) : undefined;
  const segments = [];
  const record = []; // historical record of every move generated, for transcript.json
  const memo = new Map(); // String(ratingKey) -> what's already been said about this track
  const n = tracks.length;

  // "Somewhere in the middle" / "roughly two-thirds through" are the brief's
  // own placement language (see elvis-lookback.md) -- resolved here as plain
  // fractions of the tracklist rather than left for the model to judge.
  const quizIndex = brief.hasQuiz ? Math.floor(n / 2) : -1;
  const weatherAfterIndex = brief.hasWeather ? Math.floor((n * 2) / 3) : -1;

  const primaryPersona = brief.primaryPersona;
  const weatherPersona = brief.weatherPersona ?? primaryPersona;

  // Open/close get a curated context -- the brief's own "## Description"
  // synopsis plus the real tracklist -- rather than the whole brief file, so
  // the DJ can reference specific upcoming classics without also seeing
  // operational sections (Track Selection, Quiz, Weather) that aren't
  // relevant to an intro/outro.
  const showContext = [
    brief.description,
    '',
    "This show's tracklist, in order:",
    tracks.map((t) => `- ${t.artist} — ${t.title}`).join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  segments.push({
    type: 'dj',
    persona: primaryPersona,
    body: await generateOpenLine({ persona: primaryPersona, showContext, airDate, record }),
  });

  for (let i = 0; i < n; i++) {
    const track = tracks[i];
    const key = String(track.ratingKey);
    const facts = trackFacts.get(key);
    const isQuizTrack = i === quizIndex;

    const introText = await generateIntroLine({
      persona: primaryPersona,
      track,
      facts,
      asQuizQuestion: isQuizTrack,
      airDate,
      record,
    });
    segments.push({ type: 'dj', persona: primaryPersona, body: introText });
    memo.set(key, introText);

    segments.push({ type: 'track', artist: track.artist, title: track.title, ratingKey: track.ratingKey });

    const recapText = await generateRecapLine({
      persona: primaryPersona,
      track,
      facts,
      alreadySaid: isQuizTrack ? undefined : memo.get(key),
      quizQuestion: isQuizTrack ? memo.get(key) : undefined,
      airDate,
      record,
    });
    segments.push({ type: 'dj', persona: primaryPersona, body: recapText });

    if (i === weatherAfterIndex) {
      segments.push({
        type: 'dj',
        persona: primaryPersona,
        body: await generateWeatherHandoffLine({ persona: primaryPersona, toPersona: weatherPersona, airDate, record }),
      });
      segments.push({
        type: 'live',
        persona: weatherPersona,
        kind: 'weather',
        brief: 'short, casual check-in',
      });
    }
  }

  segments.push({
    type: 'dj',
    persona: primaryPersona,
    body: await generateCloseLine({ persona: primaryPersona, showContext, airDate, record }),
  });

  return { segments, record };
}
