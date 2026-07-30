// Persistent, no-expiry, on-disk cache for raw Wikipedia lookups. Caches the
// fetch result (title/extract), not any downstream fact-extraction, keyed by
// the query text itself since that's what callers actually have on hand.
// "Not found" is cached too, so a query known to have no Wikipedia page
// isn't re-fetched every run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { fetchSummary } from './wikipedia.js';
import { toLocalISOString } from '../../lib/time.js';

const cacheDir = config.paths.wikipediaCacheDir;

function cacheKeyFor(query) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

export async function cachedFetchSummary(query) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${cacheKeyFor(query)}.json`);

  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return cached.found ? { title: cached.title, extract: cached.extract } : null;
  }

  const result = await fetchSummary(query);
  const record = result
    ? { query, found: true, title: result.title, extract: result.extract, fetchedAt: toLocalISOString() }
    : { query, found: false, fetchedAt: toLocalISOString() };
  fs.writeFileSync(cachePath, JSON.stringify(record, null, 2));
  return result;
}
