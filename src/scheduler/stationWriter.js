// The write half of station.json -- scheduleUtil.js only ever reads it.
// Every write here is atomic (temp file + rename, so a reader never sees a
// half-written file) and serialized through lib/lock.js's withLock() (so two
// concurrent studio requests can't race each other into a corrupt file).
//
// Validates before writing: startTime format, durationMinutes > 0, the
// referenced show id actually exists under show-descriptions/. A day's
// occurrences are treated as a single ordered, gapless sequence. Dragging one
// directly onto another's slot swaps the two in place (see findSwapTarget) --
// everything else stays put. Anything else that would otherwise overlap
// (a resize, a reassignment, a drag into empty space) instead reorders and
// repacks the whole day around the change via reorderAndPack() below, rather
// than rejecting the write outright. Removing an occurrence closes up
// whatever gap it leaves.
//
// Writes always expand to plain per-weekday keys -- station.json's optional
// comma-joined shared-weekday-key compression (e.g.
// "monday,tuesday,wednesday": [...]) stays supported for hand-editing (see
// scheduleUtil.js's loadSchedule()) but a studio write never recreates it;
// once the studio edits a day that was part of a shared key, that day
// becomes its own independent entry going forward.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { withLock } from '../lib/lock.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MINUTES = 24 * 60;

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function readStationFile() {
  return JSON.parse(fs.readFileSync(config.paths.stationFile, 'utf8'));
}

function atomicWrite(data) {
  const tmpPath = `${config.paths.stationFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, config.paths.stationFile);
}

// Expands any comma-joined weekday keys in the raw schedule object into
// plain per-weekday keys, same expansion loadSchedule() does for readers --
// needed here too since a write must know which day it's actually editing.
function expandSchedule(rawSchedule) {
  const expanded = {};
  for (const [key, shows] of Object.entries(rawSchedule ?? {})) {
    for (const day of key.split(',').map((d) => d.trim())) {
      expanded[day] = shows;
    }
  }
  return expanded;
}

function assertValidWeekday(weekday) {
  if (!WEEKDAYS.includes(weekday)) {
    throw new Error(`Invalid weekday "${weekday}" -- must be one of: ${WEEKDAYS.join(', ')}`);
  }
}

function assertValidOccurrence(occurrence) {
  if (!TIME_PATTERN.test(occurrence.startTime)) {
    throw new Error(`Invalid startTime "${occurrence.startTime}" -- expected HH:MM (24-hour).`);
  }
  if (!Number.isFinite(occurrence.durationMinutes) || occurrence.durationMinutes <= 0) {
    throw new Error(`Invalid durationMinutes "${occurrence.durationMinutes}" -- must be a positive number.`);
  }
  if (!occurrence.id || typeof occurrence.id !== 'string') {
    throw new Error('Occurrence must have a string "id".');
  }
  const briefPath = path.join(config.paths.showDescriptionsDir, `${occurrence.id}.md`);
  if (!fs.existsSync(briefPath)) {
    throw new Error(`No show "${occurrence.id}" found under show-descriptions/ -- create the show first.`);
  }
}

// Inserts `moving` among `others` at the position its startTime sorts to
// (this is just "where in the sequence did it get dropped" -- ties are
// broken by putting `moving` after an equal-time neighbor), then repacks
// the whole resulting list back-to-back with zero gaps. The anchor (the
// first item's actual start time) is whichever is earlier: the drop target,
// or the earliest of the other occurrences -- so reordering within the
// existing broadcast window never drifts the day's start, but dropping
// something genuinely earlier than everything else legitimately extends it.
function reorderAndPack(others, moving) {
  const targetMinutes = timeToMinutes(moving.startTime);
  const sortedOthers = [...others].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  let insertAt = sortedOthers.findIndex((o) => timeToMinutes(o.startTime) > targetMinutes);
  if (insertAt === -1) insertAt = sortedOthers.length;
  const ordered = [...sortedOthers.slice(0, insertAt), moving, ...sortedOthers.slice(insertAt)];

  const otherStarts = sortedOthers.map((o) => timeToMinutes(o.startTime));
  const anchor = Math.min(targetMinutes, ...(otherStarts.length ? otherStarts : [targetMinutes]));

  let cursor = anchor;
  return ordered.map((occ) => {
    if (cursor + occ.durationMinutes > DAY_MINUTES) {
      throw new Error(`No room left in the day for "${occ.id}" -- shorten something earlier in the lineup first.`);
    }
    const placed = { ...occ, startTime: minutesToTime(cursor) };
    cursor += occ.durationMinutes;
    return placed;
  });
}

// If `moving`'s new startTime lands inside an existing occurrence's slot,
// the two swap places (each keeps its own duration) and nothing else in the
// day changes. Returns null if there's no overlap -- the caller falls back
// to reorderAndPack for a move into genuinely empty space.
function findSwapTarget(day, movingIdx, moving) {
  const targetStart = timeToMinutes(moving.startTime);
  const targetEnd = targetStart + moving.durationMinutes;
  return day.find((o, i) => {
    if (i === movingIdx) return false;
    const start = timeToMinutes(o.startTime);
    return start < targetEnd && targetStart < start + o.durationMinutes;
  });
}

// Repacks an already-ordered list back-to-back with zero gaps, starting
// from its own first item's start time -- used after a removal, so
// whatever gap the removed occurrence leaves behind closes up too.
function closeGaps(orderedOccurrences) {
  if (orderedOccurrences.length === 0) return orderedOccurrences;
  let cursor = timeToMinutes(orderedOccurrences[0].startTime);
  return orderedOccurrences.map((occ) => {
    const placed = { ...occ, startTime: minutesToTime(cursor) };
    cursor += occ.durationMinutes;
    return placed;
  });
}

async function withStation(mutate) {
  return withLock(config.paths.stationLockPath, async () => {
    const data = readStationFile();
    data.schedule = expandSchedule(data.schedule);
    const result = mutate(data);
    atomicWrite(data);
    return result;
  });
}

// Returns the whole day's occurrences post-repack (not just the one added)
// so the caller can see exactly what else moved to make room.
export async function addOccurrence(weekday, occurrence) {
  assertValidWeekday(weekday);
  assertValidOccurrence(occurrence);
  return withStation((data) => {
    const day = data.schedule[weekday] ?? [];
    const placed = reorderAndPack(day, occurrence);
    data.schedule[weekday] = placed;
    return placed;
  });
}

// timeKey identifies the existing occurrence being changed (its current
// startTime with ":" replaced by "-", matching scheduleUtil.js's timeKey()).
// patch may change startTime/durationMinutes/id. Returns the whole day's
// occurrences post-repack (or post-swap), same reasoning as addOccurrence.
//
// A plain drag (startTime changes, nothing else) that lands on top of
// another occurrence swaps the two in place -- everything else in the day
// stays exactly where it is, which is what dragging one show directly onto
// another's slot in the studio grid is expected to do. A resize, a show
// reassignment, or a drag into genuinely empty space instead reorders and
// repacks the whole day around the change (see reorderAndPack).
export async function updateOccurrence(weekday, timeKey, patch) {
  assertValidWeekday(weekday);
  return withStation((data) => {
    const day = data.schedule[weekday] ?? [];
    const idx = day.findIndex((s) => s.startTime.replace(':', '-') === timeKey);
    if (idx === -1) throw new Error(`No occurrence at ${weekday} ${timeKey} to update.`);
    const updated = { ...day[idx], ...patch };
    assertValidOccurrence(updated);

    const isPlainMove = patch.startTime !== undefined && patch.durationMinutes === undefined && patch.id === undefined;
    const swapTarget = isPlainMove ? findSwapTarget(day, idx, updated) : null;
    if (swapTarget) {
      const swapIdx = day.indexOf(swapTarget);
      const placed = [...day];
      placed[idx] = { ...day[idx], startTime: swapTarget.startTime };
      placed[swapIdx] = { ...swapTarget, startTime: day[idx].startTime };
      placed.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      data.schedule[weekday] = placed;
      return placed;
    }

    const rest = day.filter((_, i) => i !== idx);
    const placed = reorderAndPack(rest, updated);
    data.schedule[weekday] = placed;
    return placed;
  });
}

export async function removeOccurrence(weekday, timeKey) {
  assertValidWeekday(weekday);
  return withStation((data) => {
    const day = data.schedule[weekday] ?? [];
    const idx = day.findIndex((s) => s.startTime.replace(':', '-') === timeKey);
    if (idx === -1) throw new Error(`No occurrence at ${weekday} ${timeKey} to remove.`);
    const [removed] = day.splice(idx, 1);
    data.schedule[weekday] = closeGaps(day);
    return removed;
  });
}

// Drops every occurrence of `id` from every weekday and closes the gaps
// those slots leave behind. Used by studio show-delete so a deleted brief
// can't leave orphaned schedule entries. Skips the write entirely when the
// show isn't on the lineup (no reason to expand shared weekday keys or
// trip scheduleWatch for a no-op).
export async function removeShowOccurrences(id) {
  return withLock(config.paths.stationLockPath, async () => {
    const data = readStationFile();
    data.schedule = expandSchedule(data.schedule);
    const removed = [];
    for (const [weekday, day] of Object.entries(data.schedule ?? {})) {
      const kept = day.filter((occ) => {
        if (occ.id === id) {
          removed.push({ weekday, startTime: occ.startTime });
          return false;
        }
        return true;
      });
      if (kept.length !== day.length) {
        data.schedule[weekday] = closeGaps(kept);
      }
    }
    if (removed.length > 0) atomicWrite(data);
    return removed;
  });
}

export async function replaceDaySchedule(weekday, occurrences) {
  assertValidWeekday(weekday);
  for (const occurrence of occurrences) assertValidOccurrence(occurrence);
  return withStation((data) => {
    const sorted = [...occurrences].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    const placed = closeGaps(sorted);
    data.schedule[weekday] = placed;
    return placed;
  });
}

// patch may include name/downtime/neverPlay/filler.excludeKeywords under "station".
export async function updateStationMeta(patch) {
  return withStation((data) => {
    data.station = { ...data.station, ...patch.station };
    if (patch.station?.neverPlay) {
      const keywords = [...(patch.station.neverPlay.keywords ?? [])];
      const artists = [...(patch.station.neverPlay.artists ?? [])];
      data.station.neverPlay = { keywords, artists };
      data.station.filler = { ...(data.station.filler ?? {}), excludeKeywords: keywords };
    }
    if (patch.downtime !== undefined) data.downtime = patch.downtime;
    return { station: data.station, downtime: data.downtime };
  });
}
