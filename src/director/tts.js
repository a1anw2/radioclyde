import { config } from '../config/index.js';

// exaggeration/cfgWeight/temperature are Chatterbox's own generation knobs,
// left out of the request (falling back to its server-side defaults) unless
// set in config.chatterbox -- a low cfg_weight is what produces the muffled,
// "hand over mouth" quality; a high exaggeration is what produces distortion
// that reads as bassy/boomy rather than expressive.
async function requestSynthesis(text, voiceFile) {
  const { exaggeration, cfgWeight, temperature } = config.chatterbox;
  const res = await fetch(config.chatterbox.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_mode: 'predefined',
      predefined_voice_id: voiceFile,
      output_format: 'wav',
      ...(exaggeration != null && { exaggeration }),
      ...(cfgWeight != null && { cfg_weight: cfgWeight }),
      ...(temperature != null && { temperature }),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Chatterbox request failed: ${res.status} ${res.statusText}${detail ? ` -- ${detail}` : ''}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Chatterbox does not lazily reload its model on a /tts call -- once it's
// unloaded (e.g. scheduler/restartChatterbox.js killed the process between
// shows and a request lands before the new process's startup has finished
// loading it), every /tts request 503s with "model is not currently loaded"
// until something explicitly hot-swaps it back in via /restart_server
// (Chatterbox's own name for that endpoint; despite the name it reloads the
// model in-process rather than restarting the server). So a 503 here is
// reloaded and retried once before giving up, rather than failing every show
// until the next unrelated /tts call happens to trigger a reload.
export async function synthesizeVoice(text, voiceFile) {
  try {
    return await requestSynthesis(text, voiceFile);
  } catch (err) {
    if (!err.message.includes('503')) throw err;
    await reloadModel();
    return await requestSynthesis(text, voiceFile);
  }
}

// Used above to recover from a 503 mid-show -- despite the endpoint's name
// this reloads the model in-process rather than restarting the server (see
// the comment above).
export async function reloadModel() {
  const reloadUrl = new URL('/restart_server', config.chatterbox.url).toString();
  const res = await fetch(reloadUrl, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Chatterbox model reload failed: ${res.status} ${res.statusText}`);
  }
}
