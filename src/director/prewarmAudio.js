// Downtime-only pass: synthesizes and caches every `dj` segment's speech
// ahead of air time, so directShow()'s own near-air-time run -- triggered by
// scheduleDirect.js on its usual directLeadTimeMinutes clock, unchanged --
// finds the dj-audio cache already warm and only has to do what genuinely
// can't be done early: resolve `live` segments (weather/time) and assemble
// the occurrence. Never touches `live` segments itself, and never writes
// playlist.m3u -- this only ever populates the per-show/date dj-audio cache
// that directShow() already reads from (see director/djAudio.js).
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../lib/logger.js';
import { loadValidatedScript } from './scriptLoader.js';
import { getCachedDjAudio } from './djAudio.js';
import { unloadVoice } from './tts.js';

const log = createLogger('station');

export async function prewarmShowAudio({ id, weekday, date }) {
  const { parsed, showDateDir } = await loadValidatedScript({ id, weekday, date });
  const djAudioDir = path.join(showDateDir, 'dj-audio');
  fs.mkdirSync(djAudioDir, { recursive: true });

  const djSegments = parsed.segments.filter((s) => s.type === 'dj');
  let warmed = 0;
  for (const [i, seg] of parsed.segments.entries()) {
    if (seg.type !== 'dj') continue;
    const { cached } = await getCachedDjAudio(djAudioDir, i, seg.persona, seg.body);
    if (!cached) warmed++;
  }

  // Same reasoning as directShow()'s own unloadVoice call: don't leave
  // Chatterbox's voice model resident in GPU memory once this show's TTS is
  // done. Best-effort -- a failure here shouldn't block the prewarm pass
  // from moving on to the next show.
  try {
    await unloadVoice();
  } catch (err) {
    log(`[${id}] NOTE: Chatterbox unload failed after prewarm: ${err.message}`);
  }

  log(`[${id}] Prewarmed dj audio for ${weekday} ${date}: ${warmed}/${djSegments.length} segment(s) synthesized (rest already cached).`);
  return { warmed, total: djSegments.length };
}
