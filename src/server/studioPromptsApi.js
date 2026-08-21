// Persona + script-review prompt editing, backed by promptsUtil.js
// (dataDir/prompts.json, read fresh on every access -- edits here take
// effect on the next script generated, no restart needed). Registered under
// the /studio prefix (see studioAuth.js).
import { loadPersonas, loadScriptReview, savePersonas, saveScriptReview } from '../scheduler/promptsUtil.js';

export function registerStudioPromptsApi(fastify) {
  fastify.get('/api/personas', () => ({ personas: loadPersonas() }));

  fastify.put('/api/personas', async (request, reply) => {
    const { personas } = request.body ?? {};
    if (!personas || typeof personas !== 'object') {
      return reply.code(400).send({ error: '"personas" object is required.' });
    }
    await savePersonas(personas);
    return { personas };
  });

  fastify.get('/api/script-review', () => loadScriptReview());

  fastify.put('/api/script-review', async (request, reply) => {
    const { systemPrompt } = request.body ?? {};
    if (typeof systemPrompt !== 'string') {
      return reply.code(400).send({ error: '"systemPrompt" string is required.' });
    }
    await saveScriptReview(systemPrompt);
    return loadScriptReview();
  });
}
