import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { parseShowBrief } from '../producer/showBrief.js';

function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// now_playing_track.json's "dj" field is director/playlist.js's raw
// annotate: value -- one lowercase persona id, or several joined with " & "
// for a handoff (see director/index.js's speechPersonas) -- capitalize each
// name in it for display.
export function capitalizePersonaList(djField) {
  return djField.split(' & ').map(capitalize).join(' & ');
}

// Shared by nowPlaying.js and upcoming.js -- a schedule entry's display name
// isn't a field on the entry itself, it's the H1 heading inside the show's
// markdown brief (parseShowBrief already parses exactly that, stripping a
// leading emoji). primaryPersona is the show's host -- config.personas keys
// (and every persona reference through the producer/director/script
// pipeline, confirmed live in transcript.json) are lowercase ids like
// "connor", so it's capitalized here for display only; nothing internal
// should ever match against this capitalized form.
export function resolveShowInfo(showEntry, fallbackId) {
  if (!showEntry?.description) return { name: fallbackId, host: null };
  try {
    const descriptionPath = path.isAbsolute(showEntry.description)
      ? showEntry.description
      : path.join(config.dataDir, showEntry.description);
    const { title, primaryPersona } = parseShowBrief(fs.readFileSync(descriptionPath, 'utf8'));
    return {
      name: title ?? fallbackId,
      host: primaryPersona ? capitalize(primaryPersona) : null,
    };
  } catch {
    return { name: fallbackId, host: null }; // brief missing/unreadable -- fall back to the raw id rather than failing the endpoint
  }
}
