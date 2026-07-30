// Grounded in real Chatterbox measurements (8/25/51-word test lines produced
// 2.72s/6.84s/14.32s of audio => ~2.9-3.7 words/sec). Shared by anything that
// needs to lay out a plausible timeline before TTS actually runs -- the
// preview tool (cli/previewShowPrep.js) and the producer's duration check
// (script/format.js) both need this same estimate.
const ESTIMATED_SPEECH_WORDS_PER_SEC = 3.4;

export function estimateSpeechMs(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return (words / ESTIMATED_SPEECH_WORDS_PER_SEC) * 1000;
}

export function formatClock(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
