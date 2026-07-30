import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const djPhotosDir = path.join(__dirname, '..', '..', 'public', 'dj-photos');

// Persona ids are always lowercase single words (config.json's personas
// keys), but this arrives as a URL param -- reject anything else outright
// rather than letting it reach path.join.
const PERSONA_PATTERN = /^[a-z0-9_-]+$/;

// Not every persona has a photo yet -- missing ones 404 and the client
// just hides the image (public/app.js's #art error handler; Android's
// Glide .error(card_placeholder)/Media3 BitmapLoader both already treat a
// failed artwork fetch as "nothing to show" with no extra handling needed).
export function registerDjPhotoRoute(fastify) {
  fastify.get('/dj-photos/:persona', (request, reply) => {
    const { persona } = request.params;
    if (!PERSONA_PATTERN.test(persona)) return reply.code(400).send();

    let body;
    try {
      body = fs.readFileSync(path.join(djPhotosDir, `${persona}.jpg`));
    } catch {
      return reply.code(404).send();
    }
    reply.header('content-type', 'image/jpeg');
    return body;
  });
}
