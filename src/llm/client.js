// Generic LM Studio chat-completions client for the harness-driven producer
// (track selection's tool-calling loop, and the boundary walk's tool-free
// single-line completions).
import { config } from '../config/index.js';

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
