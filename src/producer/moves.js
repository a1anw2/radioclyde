// The move vocabulary for the harness-driven boundary walk: a small,
// tool-free single completion per move. Facts are already resolved
// deterministically (research/trackResearch.js) before any of this runs, so
// none of these calls have tools or a research loop to thrash in -- the
// model's only job each time is to write one move's worth of content.
// Deliberately no sentence-count cap on these instructions -- let the model
// decide how much a given moment needs to say.
import { config } from '../config/index.js';
import { complete } from '../llm/client.js';
import { PARALINGUISTIC_INSTRUCTION, TIME_OF_DAY_INSTRUCTION } from '../llm/prompts.js';

async function generateLine({ persona, instruction, context, airDate, record }) {
  const personaPrompt = config.personas[persona]?.systemPrompt ?? `You are ${persona}, a radio DJ.`;
  // A script can be produced hours (or, during station.json's downtime
  // window, most of a day) before it airs, so the model has no reliable way
  // to know the real date on its own -- state the show's actual air date
  // rather than leave it to guess (see director/liveSegments.js for the
  // director-side equivalent, using the real date at direct time instead).
  const dateFact = airDate ? `Today's real date is ${airDate} -- use this if a date comes up, don't guess.\n\n` : '';
  const messages = [
    { role: 'system', content: `${personaPrompt}\n\n${dateFact}${instruction}\n\nSpeak the line exactly as it should be said -- no stage directions, no meta-commentary, no quotation marks around it. ${PARALINGUISTIC_INSTRUCTION} ${TIME_OF_DAY_INSTRUCTION}` },
    { role: 'user', content: context || 'Write the line now.' },
  ];
  const startedAt = Date.now();
  const result = await complete(messages);
  record?.push({ persona, instruction, context, result, durationMs: Date.now() - startedAt });
  return result;
}

export async function generateOpenLine({ persona, showContext, airDate, record }) {
  return generateLine({
    persona,
    instruction:
      'Write a show-opening line to kick off this radio show. Feel free to tease a track or two from the lineup below to build excitement.',
    context: showContext,
    airDate,
    record,
  });
}

export async function generateCloseLine({ persona, showContext, airDate, record }) {
  return generateLine({
    persona,
    instruction: 'Write a sign-off line to close out this radio show.',
    context: showContext,
    airDate,
    record,
  });
}

export async function generateIntroLine({ persona, track, facts, alreadySaid, asQuizQuestion, airDate, record }) {
  const instruction = asQuizQuestion
    ? 'Write a short tease for the upcoming track, phrased as a guessing question for listeners (e.g. guess the year) using the fact below. Do not give the answer away.'
    : 'Write a tease introducing the upcoming track. Do not give away everything -- just enough to make it interesting.';
  const context = [
    `Upcoming track: "${track.title}" by ${track.artist}.`,
    facts ? `Known facts: ${facts}` : 'No particular facts known -- keep it general.',
    alreadySaid ? `Already said about this track: "${alreadySaid}" -- say something different this time.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return generateLine({ persona, instruction, context, airDate, record });
}

export async function generateRecapLine({ persona, track, facts, alreadySaid, quizQuestion, airDate, record }) {
  const instruction = quizQuestion
    ? `Reveal the answer to the quiz question you just asked ("${quizQuestion}"). Reference the question directly and give the answer clearly.`
    : 'Write a recap of the track that just played -- what it was, plus one interesting thing about it if you have one.';
  const context = [
    `Track that just played: "${track.title}" by ${track.artist}.`,
    facts ? `Known facts: ${facts}` : 'No particular facts known -- keep it general.',
    alreadySaid && !quizQuestion ? `Already said about this track: "${alreadySaid}" -- don't repeat it, say something different.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return generateLine({ persona, instruction, context, airDate, record });
}

export async function generateWeatherHandoffLine({ persona, toPersona, airDate, record }) {
  return generateLine({
    persona,
    instruction: `Write a toss handing off to ${toPersona} for a weather check-in.`,
    context: '',
    airDate,
    record,
  });
}
