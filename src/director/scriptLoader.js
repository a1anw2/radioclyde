// Reads and validates a show's script.md, resolving every referenced
// ratingKey against Plex first so parseScript's duration-tolerance check
// uses each track's real length. Shared by directShow() (the near-air-time
// pass) and prewarmAudio.js's downtime pass -- both need the exact same
// validated parse of a show/date's script.md before doing anything with it.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import * as scheduleUtil from '../scheduler/scheduleUtil.js';
import { parseScript } from '../script/format.js';
import { getTrackByRatingKey } from '../plex/tracks.js';

export async function loadValidatedScript({ id, weekday, date }) {
  const showDateDir = scheduleUtil.dateDir(weekday, id, date);
  const scriptPath = path.join(showDateDir, 'script.md');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`No script.md found at ${scriptPath} -- run "npm run generate-script -- --id=${id}" first.`);
  }
  const markdown = fs.readFileSync(scriptPath, 'utf8');

  const ratingKeys = [...new Set([...markdown.matchAll(/^ratingKey:\s*(\S+)/gm)].map((m) => m[1]))];
  const knownRatingKeys = new Map();
  for (const ratingKey of ratingKeys) {
    knownRatingKeys.set(ratingKey, await getTrackByRatingKey(ratingKey));
  }

  const parsed = parseScript(markdown, { personas: config.personas, knownRatingKeys });
  if (!parsed.ok) {
    throw new Error(`script.md at ${scriptPath} failed validation: ${parsed.issues.join(' | ')}`);
  }
  return { parsed, scriptPath, showDateDir, knownRatingKeys };
}
