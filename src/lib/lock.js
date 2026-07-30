import fs from 'node:fs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Chatterbox is single-GPU/single-threaded -- concurrent requests either
// queue up badly (slower than running sequentially) or time out outright
// (confirmed: 6 of 8 parallel requests timed out in testing). Each on_track
// firing spawns a separate OS process, so an in-process mutex can't
// coordinate across them -- this uses a lock *file* instead.
export async function withLock(lockPath, fn, { retryMs = 500, timeoutMs = 120000, staleMs = 180000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        // A lock file left behind by a crashed process would otherwise
        // block Chatterbox generation forever -- clear it if it's older
        // than any realistic single TTS call.
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Lock vanished between the failed open and this stat -- fine, retry.
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for lock at ${lockPath}`);
      }
      await sleep(retryMs);
    }
  }
  try {
    return await fn();
  } finally {
    fs.unlinkSync(lockPath);
  }
}
