// checkAndTriggerScripts and checkAndTriggerDirect are two independent async
// jobs on their own scheduler.js intervals, in the same process -- without
// this, their LLM/TTS calls could still interleave on the event loop even
// though nothing spawns a separate OS process anymore (async/await doesn't
// block other in-flight async work the way a synchronous call would).
// Chaining every job onto one promise tail keeps AI/TTS work strictly one
// job at a time, station-wide.
let tail = Promise.resolve();

export function runSerialized(fn) {
  const result = tail.then(fn, fn);
  tail = result.catch(() => {}); // one job's rejection shouldn't jam the queue for the next
  return result;
}

// Run promise-returning thunks with limited concurrency, so a decade query
// (which can mean fetching a couple hundred albums' worth of tracks) doesn't
// fire hundreds of requests at Plex simultaneously.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
