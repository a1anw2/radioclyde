// The weekly schedule grid's API -- reads via scheduleUtil.js, writes via
// stationWriter.js (which validates + locks + atomically writes
// station.json). Registered under the /studio prefix (see studioAuth.js).
import {
  loadSchedule,
  loadStation,
  loadDowntime,
  weekdayKey,
  dateKey,
  timeKey,
  occurrenceReadiness,
} from '../scheduler/scheduleUtil.js';
import { checkScheduleChanged } from '../scheduler/scheduleWatch.js';
import {
  addOccurrence,
  updateOccurrence,
  removeOccurrence,
  updateStationMeta,
} from '../scheduler/stationWriter.js';

// Runs scheduleWatch's own invalidation check inline, right after a write,
// instead of waiting for its next interval tick -- both processes are the
// same one now (src/server/index.js's process merge), so this is just a
// direct function call, not a signal to anything external. Never lets a
// write itself fail if this throws (e.g. a mid-write race with the
// scheduler's own tick) -- it'll just catch it on its next tick as before.
function invalidateSoon() {
  try {
    checkScheduleChanged();
  } catch {
    // next scheduled tick will pick it up
  }
}

export function registerStudioScheduleApi(fastify) {
  fastify.get('/api/schedule', () => ({
    schedule: loadSchedule(),
    station: loadStation(),
    downtime: loadDowntime(),
  }));

  // The weekly grid shows one recurring template slot per weekday, but
  // readiness (has a script/playlist actually been produced) only exists for
  // real calendar occurrences -- so this only ever has an answer for today's
  // and tomorrow's weekday, the two days scheduleScripts.js/scheduleDirect.js
  // can plausibly have already touched (scriptLeadTimeMinutes/
  // directLeadTimeMinutes are both well under 24h by default). Every other
  // weekday's slot has no real occurrence dir yet, so it's simply absent from
  // the response -- the studio UI treats a missing key as "not due yet"
  // rather than "not ready", which is the same distinction
  // logStartupStatus() draws for occurrences outside its own horizon.
  fastify.get('/api/schedule/readiness', () => {
    const schedule = loadSchedule();
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const days = [
      { weekday: weekdayKey(now), date: dateKey(now) },
      { weekday: weekdayKey(tomorrow), date: dateKey(tomorrow) },
    ];

    const readiness = {};
    for (const { weekday, date } of days) {
      for (const show of schedule[weekday] ?? []) {
        const time = timeKey(show.startTime);
        readiness[`${weekday}/${time}`] = occurrenceReadiness(weekday, show.id, date, time);
      }
    }
    return { readiness };
  });

  // addOccurrence/updateOccurrence return the whole day post-reflow (not
  // just the one changed) -- a conflicting drop pushes the rest of the day's
  // lineup later rather than being rejected, so the response reflects
  // everything that actually moved.
  fastify.post('/api/schedule/:weekday', async (request, reply) => {
    try {
      const day = await addOccurrence(request.params.weekday, request.body ?? {});
      invalidateSoon();
      return { weekday: request.params.weekday, occurrences: day };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.patch('/api/schedule/:weekday/:timeKey', async (request, reply) => {
    try {
      const day = await updateOccurrence(request.params.weekday, request.params.timeKey, request.body ?? {});
      invalidateSoon();
      return { weekday: request.params.weekday, occurrences: day };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.delete('/api/schedule/:weekday/:timeKey', async (request, reply) => {
    try {
      const removed = await removeOccurrence(request.params.weekday, request.params.timeKey);
      invalidateSoon();
      return removed;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.put('/api/schedule/meta', async (request, reply) => {
    try {
      const result = await updateStationMeta(request.body ?? {});
      invalidateSoon();
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
