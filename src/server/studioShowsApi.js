// CRUD over show-descriptions/*.md briefs. Registered under the /studio
// prefix (see studioAuth.js) -- already behind the studio auth hook and the
// application/json content-type check by the time any handler here runs.
import fs from 'node:fs';
import { config } from '../config/index.js';
import { loadSchedule } from '../scheduler/scheduleUtil.js';
import { checkScheduleChanged } from '../scheduler/scheduleWatch.js';
import { parseShowBrief } from '../producer/showBrief.js';
import {
  readShowBriefForEditing,
  createShowBrief,
  updateShowBrief,
  deleteShowBrief,
} from '../producer/showBriefWriter.js';

function listShowIds() {
  return fs
    .readdirSync(config.paths.showDescriptionsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

// First scheduled occurrence's durationMinutes, or null if this show isn't
// on the schedule yet -- a show can exist in the library before it's placed
// on any weekday.
function firstScheduledDuration(id, schedule) {
  for (const occurrences of Object.values(schedule)) {
    const match = occurrences.find((o) => o.id === id);
    if (match) return match.durationMinutes;
  }
  return null;
}

export function registerStudioShowsApi(fastify) {
  fastify.get('/api/shows', () => {
    const schedule = loadSchedule();
    const shows = listShowIds().map((id) => {
      const text = fs.readFileSync(`${config.paths.showDescriptionsDir}/${id}.md`, 'utf8');
      const brief = parseShowBrief(text);
      return {
        id,
        title: brief.title ?? id,
        personas: [brief.primaryPersona, brief.weatherPersona].filter(Boolean),
        segments: [brief.hasQuiz && 'quiz', brief.hasWeather && 'weather', brief.hasNews && 'news'].filter(Boolean),
        durationMinutes: firstScheduledDuration(id, schedule),
      };
    });
    return { shows };
  });

  fastify.get('/api/shows/:id', (request, reply) => {
    try {
      return readShowBriefForEditing(request.params.id);
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  fastify.post('/api/shows', (request, reply) => {
    const { id, ...fields } = request.body ?? {};
    if (!id) return reply.code(400).send({ error: '"id" is required.' });
    try {
      return createShowBrief(id, fields);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.put('/api/shows/:id', (request, reply) => {
    try {
      return updateShowBrief(request.params.id, request.body ?? {});
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.delete('/api/shows/:id', async (request, reply) => {
    try {
      const result = await deleteShowBrief(request.params.id);
      try {
        checkScheduleChanged();
      } catch {
        // next scheduled tick will pick it up
      }
      return result;
    } catch (err) {
      const code = err.message.startsWith('No show') ? 404 : 400;
      return reply.code(code).send({ error: err.message });
    }
  });
}
