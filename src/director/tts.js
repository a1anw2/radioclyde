// fetch/Agent imported from undici itself, NOT Node's global fetch() --
// Node's global fetch is powered by its own internally-vendored undici, a
// different instance/version than the one installed in node_modules, and
// handing a dispatcher built from the latter to the former throws
// "InvalidArgumentError: invalid onRequestStart method" (confirmed
// 2026-08-06). Using undici's own fetch alongside its own Agent keeps both
// sides on one consistent implementation.
import { fetch, Agent } from 'undici';
import { config } from '../config/index.js';

// Chatterbox runs CPU-only on this box -- a single line routinely takes
// several minutes to synthesize, which is normal, not a hang. undici's
// *default* Agent enforces its own ~5min headers/body timeouts independently
// of any AbortSignal a caller passes in -- a longer AbortSignal does not
// override or extend that underlying default, so it still fires and kills a
// slow-but-healthy request (confirmed 2026-08-06: Chatterbox's own log
// showed the request completing successfully several minutes after Node had
// already given up on it and thrown a bare "fetch failed" with nothing
// server-side to explain it). Fixed by giving this request its own
// dispatcher with a generous explicit ceiling instead of relying on the
// ambient default.
const dispatcher = new Agent({
  headersTimeout: (config.chatterbox.requestTimeoutMinutes ?? 20) * 60 * 1000,
  bodyTimeout: (config.chatterbox.requestTimeoutMinutes ?? 20) * 60 * 1000,
});

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
    dispatcher,
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
