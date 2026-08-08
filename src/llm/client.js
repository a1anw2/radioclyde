// Generic LM Studio chat-completions client for the harness-driven producer
// (track selection's tool-calling loop, and the boundary walk's tool-free
// single-line completions).
import { config } from '../config/index.js';

// Confirmed live 2026-08-07/08: this call previously had no timeout at all,
// and director/liveSegments.js's resolveLiveLine() -- called only from
// directShow(), never from script production or prewarm -- awaits it
// directly. A single hung request here froze the entire shared production
// queue indefinitely with no error and no log line, which is exactly what
// took the station down twice: script production and prewarm (which never
// call this from a `live` segment context) kept working fine throughout,
// while directing specifically stopped producing any output for hours.
// Kept comfortably under 5min: Node's native fetch is powered by undici's
// *default* Agent, which enforces its own ~5min ceiling regardless of any
// longer AbortSignal (see src/director/tts.js's own note on this same
// quirk) -- so a timeout at or above that would silently do nothing extra.
export async function callModel(messages, tools, toolChoice = 'auto') {
  const body = { model: config.lmStudio.model, messages };
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  const res = await fetch(config.lmStudio.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout((config.lmStudio.requestTimeoutMinutes ?? 3) * 60 * 1000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LM Studio request failed: ${res.status} ${res.statusText} -- ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('LM Studio returned no choices');
  return choice.message;
}

// Plain tool-free single completion -- used for the boundary-walk moves,
// where the facts/context are already resolved deterministically and the
// model's only job is to write one line, not decide anything else. No tools
// means no risk of the research-thrashing behavior seen in the old flat
// producer loop.
export async function complete(messages) {
  const message = await callModel(messages);
  return message.content?.trim() ?? '';
}
