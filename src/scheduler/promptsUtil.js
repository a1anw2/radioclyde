// Persona system prompts + the script-review system prompt, stored in
// dataDir/prompts.json and re-read fresh on every call -- same no-caching
// pattern scheduleUtil.js already uses for station.json. This is what lets a
// studio admin edit either without restarting the process: they used to live
// in config.json, which is only ever read once at process boot.
import fs from 'node:fs';
import { config } from '../config/index.js';
import { withLock } from '../lib/lock.js';

function readPromptsFile() {
  return JSON.parse(fs.readFileSync(config.paths.promptsFile, 'utf8'));
}

function atomicWrite(data) {
  const tmpPath = `${config.paths.promptsFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, config.paths.promptsFile);
}

// { personaId: { voiceFile, systemPrompt } }
export function loadPersonas() {
  return readPromptsFile().personas ?? {};
}

// { enabled, systemPrompt }
export function loadScriptReview() {
  return readPromptsFile().scriptReview ?? { enabled: true, systemPrompt: null };
}

export async function savePersonas(personas) {
  await withLock(config.paths.promptsLockPath, async () => {
    const current = readPromptsFile();
    atomicWrite({ ...current, personas });
  });
}

export async function saveScriptReview(systemPrompt) {
  await withLock(config.paths.promptsLockPath, async () => {
    const current = readPromptsFile();
    atomicWrite({ ...current, scriptReview: { ...(current.scriptReview ?? {}), systemPrompt } });
  });
}
