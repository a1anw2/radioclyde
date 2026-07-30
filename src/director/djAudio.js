// Synthesizes and caches a single `dj` segment's speech. A segment's text
// comes straight from script.md and never changes between same-day repeats
// of a show, so its Chatterbox output is deterministic -- cached once per
// script (keyed by segment position within it) under
// <showDateDir>/dj-audio/, and reused by every same-day airing *and* by
// prewarmAudio.js's downtime pass, instead of resynthesizing byte-identical
// audio each time.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { withLock } from '../lib/lock.js';
import { applyGain } from '../lib/audio.js';
import { synthesizeVoice } from './tts.js';

export async function synthesizeSpeechToPath(persona, text, filePath) {
  const voiceFile = config.personas[persona]?.voiceFile;
  if (!voiceFile) throw new Error(`Unknown persona "${persona}" -- no voiceFile in config.`);
  const startedAt = Date.now();
  const audio = await withLock(config.paths.chatterboxLockPath, () => synthesizeVoice(text, voiceFile));
  const ttsDurationMs = Date.now() - startedAt;
  const amplified = await applyGain(audio, config.djDrops.gain, config.dataDir);
  fs.writeFileSync(filePath, amplified);
  return ttsDurationMs;
}

export async function getCachedDjAudio(djAudioDir, segmentIndex, persona, text) {
  const cachedPath = path.join(djAudioDir, `dj_${String(segmentIndex).padStart(3, '0')}.wav`);
  if (fs.existsSync(cachedPath)) {
    return { filePath: cachedPath, ttsDurationMs: 0, cached: true };
  }
  const ttsDurationMs = await synthesizeSpeechToPath(persona, text, cachedPath);
  return { filePath: cachedPath, ttsDurationMs, cached: false };
}
