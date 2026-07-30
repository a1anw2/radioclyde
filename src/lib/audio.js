import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// All Chatterbox output is the same codec (pcm_s16le, 24000Hz, mono --
// confirmed live via Liquidsoap's decoder logs), so a plain concat-demuxer
// stream copy (no re-encode) is safe and lossless here.
export async function getDurationSeconds(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout);
}

export async function concatWavFiles(filePaths, outputPath) {
  const listPath = `${outputPath}.list.txt`;
  const listContent = filePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
  fs.writeFileSync(listPath, listContent);
  try {
    await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
  } finally {
    fs.unlinkSync(listPath);
  }
  return outputPath;
}

// Fades the last `fadeSeconds` of `inputPath` to silence, writing the result
// to `outputPath`. Used for the jingle's fade-down (director/index.js)
// instead of a runtime Liquidsoap fade.out() -- confirmed live 2026-07-29
// that fade.out() at low (<~0.5s) durations silences the *entire* track, not
// just the tail, in this Liquidsoap build (2.2.4-1+dev), which made it unsafe
// to use as the "no fade" default for every non-jingle entry. Baking the
// fade into the file sidesteps that bug entirely.
export async function applyFadeOut(inputPath, outputPath, fadeSeconds) {
  const duration = await getDurationSeconds(inputPath);
  const start = Math.max(duration - fadeSeconds, 0);
  await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-filter:a', `afade=t=out:st=${start}:d=${fadeSeconds}`, outputPath]);
  return outputPath;
}

// tmpDir is caller-provided (director/index.js passes config.dataDir) rather
// than read from config directly -- this module has no config/domain
// knowledge of its own, same as the other lib/ helpers.
export async function applyGain(inputBuffer, gain, tmpDir) {
  if (!gain || gain === 1) return inputBuffer;
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = path.join(tmpDir, `.gain-in-${stamp}.wav`);
  const tmpOut = path.join(tmpDir, `.gain-out-${stamp}.wav`);
  fs.writeFileSync(tmpIn, inputBuffer);
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', tmpIn, '-filter:a', `volume=${gain}`, tmpOut]);
    return fs.readFileSync(tmpOut);
  } finally {
    fs.rmSync(tmpIn, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
}
