// The director: mechanically turns a finished `.script.md` into real
// broadcast assets. Per script-format.md, it makes no creative decisions --
// every dj/track segment is already fully decided, spoken/played verbatim.
// The one exception is `live` segments: real time/weather data is fetched
// right now (never at authoring time) and turned into a spoken line, using
// the segment's `brief` as tone/length direction (see liveSegments.js).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import { toLocalISOString } from '../lib/time.js';
import { getDurationSeconds, concatWavFiles, applyFadeOut } from '../lib/audio.js';
import * as scheduleUtil from '../scheduler/scheduleUtil.js';
import { toLocalPath } from '../plex/musicLibrary.js';
import { mergeTrackRatingKeys } from '../plex/ratingKeyIndex.js';
import { restartChatterbox } from '../scheduler/restartChatterbox.js';
import { resolveLiveLine } from './liveSegments.js';
import { loadValidatedScript } from './scriptLoader.js';
import { synthesizeSpeechToPath, getCachedDjAudio } from './djAudio.js';
import { annotateSpeechEntry, annotateJingleEntry, annotateTrackEntry } from './playlist.js';

const log = createLogger('station');

// How long the jingle fades to silence at its own end (director/index.js
// renders this into a copy of the jingle at production time -- see
// applyFadeOut in lib/audio.js for why this isn't done live in radio.liq).
const JINGLE_FADE_OUT_SECONDS = 1.5;

function preview(text, maxLen = 60) {
  const trimmed = text.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen).trimEnd()}…` : trimmed;
}

export async function directShow({ id, weekday, date, timeKey }) {
  // The real "work has actually begun" signal, as distinct from
  // scheduleDirect.js's "queuing for direct" log -- that one fires as soon
  // as a job is handed to runSerialized, which may still be minutes behind
  // another show's script/direct job on the same shared tail.
  log(`[${id}] Starting direct (${weekday} ${date} ${timeKey})...`);
  const { parsed, scriptPath, showDateDir, knownRatingKeys } = await loadValidatedScript({ id, weekday, date });
  // A short-runtime warning doesn't block directing -- the show just plays
  // out shorter than its nominal slot and hands off to filler early
  // (scheduler/updateNowPlaying.js already tracks each occurrence's real,
  // directed runtime rather than the nominal schedule length), rather than
  // getting stuck endlessly re-failing direct on the exact same script.md.
  if (parsed.warnings?.length) {
    log(`[${id}] NOTE: ${parsed.warnings.join(' | ')}`);
  }

  const showOccurrenceDir = scheduleUtil.occurrenceDir(weekday, id, date, timeKey);
  const djAudioDir = path.join(showDateDir, 'dj-audio');
  fs.mkdirSync(showOccurrenceDir, { recursive: true });
  fs.mkdirSync(djAudioDir, { recursive: true });

  const segments = []; // ordered absolute file paths -- becomes playlist.m3u (dj/live/jingle entries get annotated with metadata below)
  const speechPaths = new Set(); // subset of `segments` that are dj/live clips, not real tracks -- these carry no ID3 tags of their own, so Icecast's now-playing display would otherwise keep showing whatever track played last while the DJ talks; annotated below with station name/show title instead.
  const speechPersonas = new Map(); // finalized speech path -> ordered, deduped persona names that spoke in it -- feeds annotateSpeechEntry's `dj` field, which is how plex/scrobbleTrack.js's real-time hook (and the web page) knows who's talking.
  let jinglePath = null; // set below if this occurrence has one -- kept separate from speechPaths since it gets its own fade treatment (annotateJingleEntry), not annotateSpeechEntry's
  const ratingKeyEntries = []; // [localPath, ratingKey] for track segments -- feeds the scrobble hook's path->ratingKey lookup
  const liveLog = []; // resolved live-segment text, for the historical record
  const ttsLog = []; // one entry per synthesized/reused clip, with timing
  let liveSeq = 0;
  let pendingSpeechFiles = []; // current unbroken run of dj/live clips, not yet flushed to `segments`
  let pendingSpeechPersonas = []; // parallel to pendingSpeechFiles -- one persona name per pending clip

  // Jingle played as the very first segment ahead of the show's own content.
  // A show's own "jingle" field (station.json schedule entry) wins; falling
  // back to the station-wide default at station.jingle (station.json's
  // "station" block, alongside filler's excludeKeywords) when the show
  // doesn't set its own. Both are paths relative to dataDir -- same
  // convention as "description". Missing/unset is the common case (not
  // every show has an override yet, and a configured path whose file hasn't
  // landed yet shouldn't fail the whole show) -- both just skip rather than
  // erroring.
  const showEntry = (scheduleUtil.loadSchedule()[weekday] ?? []).find((s) => s.id === id);
  const jingleRelPath = showEntry?.jingle ?? scheduleUtil.loadStation().jingle;
  if (jingleRelPath) {
    const resolvedJinglePath = path.join(config.dataDir, jingleRelPath);
    if (fs.existsSync(resolvedJinglePath)) {
      const fadedJinglePath = path.join(showOccurrenceDir, `jingle${path.extname(resolvedJinglePath)}`);
      await applyFadeOut(resolvedJinglePath, fadedJinglePath, JINGLE_FADE_OUT_SECONDS);
      segments.push(fadedJinglePath);
      jinglePath = fadedJinglePath;
      log(`[${id}] Jingle: ${resolvedJinglePath} (fading out over ${JINGLE_FADE_OUT_SECONDS}s -> ${fadedJinglePath})`);
    } else {
      log(`[${id}] NOTE: jingle configured (${jingleRelPath}) but file not found at ${resolvedJinglePath} -- skipping.`);
    }
  }

  // `dj` segments are usually already warmed by now -- either by a prior
  // occurrence of this same-day repeat, or by schedulePrewarmAudio.js's
  // downtime pass (see director/djAudio.js) -- so this is normally a cache
  // hit. Only `live` segments actually need fresh synthesis here.
  async function getDjAudio(segmentIndex, persona, text) {
    const { filePath, ttsDurationMs, cached } = await getCachedDjAudio(djAudioDir, segmentIndex, persona, text);
    ttsLog.push({ persona, text, filePath, aiGenerationMs: 0, ttsDurationMs, gain: config.djDrops.gain ?? 1, cached });
    return filePath;
  }

  async function getLiveAudio(persona, text, aiGenerationMs) {
    const filePath = path.join(showOccurrenceDir, `live_${String(liveSeq++).padStart(3, '0')}.wav`);
    const ttsDurationMs = await synthesizeSpeechToPath(persona, text, filePath);
    ttsLog.push({ persona, text, filePath, aiGenerationMs, ttsDurationMs, gain: config.djDrops.gain ?? 1 });
    return filePath;
  }

  // Consecutive dj/live segments (no track between them -- e.g. the show
  // open running straight into the first track's intro, or a weather
  // handoff followed by the live weather segment) must NOT get a Liquidsoap
  // crossfade between them -- confirmed live it sounded like a DJ fading
  // into their own next sentence, not a real transition. Splicing them into
  // one physical file here (plain concat, no fade) means radio.liq's
  // crossfade() only ever sees a genuine speech<->track boundary. This
  // combined file is always occurrence-specific (even a dj-only run is cheap
  // to re-concat, and any run touching a `live` segment must be), so it
  // lives in showOccurrenceDir rather than being cached alongside the dj
  // audio itself.
  let speechSeq = 0;
  async function flushPendingSpeech() {
    if (pendingSpeechFiles.length === 0) return;
    // Ordered, deduped so a handoff between the same two personas (e.g. dj
    // segment then a live segment from the same speaker) doesn't repeat a
    // name -- annotateSpeechEntry joins these into a single "dj" field, e.g.
    // "Ryan" or "Ryan & Elena" for a real handoff.
    const personas = [...new Set(pendingSpeechPersonas)];
    if (pendingSpeechFiles.length === 1) {
      segments.push(pendingSpeechFiles[0]);
      speechPaths.add(pendingSpeechFiles[0]);
      speechPersonas.set(pendingSpeechFiles[0], personas);
    } else {
      const combined = await concatWavFiles(
        pendingSpeechFiles,
        path.join(showOccurrenceDir, `speech_${String(speechSeq++).padStart(3, '0')}.wav`)
      );
      segments.push(combined);
      speechPaths.add(combined);
      speechPersonas.set(combined, personas);
    }
    pendingSpeechFiles = [];
    pendingSpeechPersonas = [];
  }

  const totalSpeechSegments = parsed.segments.filter((s) => s.type === 'dj' || s.type === 'live').length;
  let speechSegmentSeq = 0;

  for (const [i, seg] of parsed.segments.entries()) {
    if (seg.type === 'track') {
      await flushPendingSpeech();
      const track = knownRatingKeys.get(String(seg.ratingKey));
      const localPath = toLocalPath(track.plexPath);
      segments.push(localPath);
      ratingKeyEntries.push([localPath, track.ratingKey]);
    } else if (seg.type === 'dj') {
      speechSegmentSeq++;
      const startedAt = Date.now();
      const audioPath = await getDjAudio(i, seg.persona, seg.body);
      log(
        `[${id}] [${speechSegmentSeq}/${totalSpeechSegments}] dj (${seg.persona}): "${preview(seg.body)}" (${Date.now() - startedAt}ms)`
      );
      pendingSpeechFiles.push(audioPath);
      pendingSpeechPersonas.push(seg.persona);
    } else if (seg.type === 'live') {
      speechSegmentSeq++;
      const textStartedAt = Date.now();
      const text = await resolveLiveLine(seg);
      const aiGenerationMs = Date.now() - textStartedAt;
      liveLog.push({ persona: seg.persona, kind: seg.kind, brief: seg.brief, text, aiGenerationMs });
      const audioStartedAt = Date.now();
      const audioPath = await getLiveAudio(seg.persona, text, aiGenerationMs);
      log(
        `[${id}] [${speechSegmentSeq}/${totalSpeechSegments}] live (${seg.persona}, ${seg.kind}): "${preview(text)}" (text ${aiGenerationMs}ms, tts ${Date.now() - audioStartedAt}ms)`
      );
      pendingSpeechFiles.push(audioPath);
      pendingSpeechPersonas.push(seg.persona);
    }
  }
  await flushPendingSpeech();

  // All of this show's TTS is done -- restart Chatterbox's OS process now
  // rather than leaving it resident until the next show needs one (see
  // scheduler/restartChatterbox.js: unloading the model alone doesn't
  // reclaim everything that accumulates in the process's memory/swap over
  // many shows). Best-effort: a failure here shouldn't block this show from
  // finishing production, and it doesn't need scrobbleEnabled-style config
  // gating -- reclaiming memory has no meaningful "disabled" state a user
  // would want.
  try {
    await restartChatterbox();
  } catch (err) {
    log(`[${id}] NOTE: Chatterbox restart failed: ${err.message}`);
  }

  // Real per-file durations, not the scheduled durationMinutes -- DJ speech
  // length is only ever estimated at script time (lib/format.js's
  // words/sec heuristic), and track lengths vary track to track, so the
  // show's actual on-air runtime routinely differs from its slot.
  // scheduler/updateNowPlaying.js uses this to let a show finish before
  // cutting to the next one, rather than switching at the scheduled
  // boundary regardless of what's still playing.
  const segmentDurations = await Promise.all(segments.map(getDurationSeconds));
  const durationSeconds = segmentDurations.reduce((a, b) => a + b, 0);

  fs.writeFileSync(path.join(showOccurrenceDir, 'live-segments.json'), JSON.stringify(liveLog, null, 2));
  fs.writeFileSync(path.join(showOccurrenceDir, 'transcript.json'), JSON.stringify(ttsLog, null, 2));
  fs.writeFileSync(
    path.join(showOccurrenceDir, 'context.json'),
    JSON.stringify(
      { id, weekday, date, timeKey, sourceScript: scriptPath, generatedAt: toLocalISOString(), segmentCount: segments.length, durationSeconds },
      null,
      2
    )
  );

  // Feeds scrobbleTrack.js's path->ratingKey lookup -- written before
  // playlist.m3u so the mapping is already in place by the time
  // scheduler/updateNowPlaying.js could pick this occurrence up.
  await mergeTrackRatingKeys(ratingKeyEntries);

  // DJ speech clips carry no ID3/metadata tags of their own (they're raw
  // Chatterbox/ffmpeg output), so plain playlist entries leave Icecast's
  // now-playing display frozen on whatever track played last while the DJ is
  // talking. annotateSpeechEntry (playlist.js) overrides each speech
  // segment's metadata (station.json's station name as artist, this show's
  // title as track title, and -- via speechPersonas -- who's actually
  // talking) instead of touching the audio files themselves; annotateJingleEntry
  // gives the jingle the same title/artist override without the `dj` field.
  // Real tracks get annotateTrackEntry purely for the liq_fade_in override
  // radio.liq's fade.in reads (listener feedback, 2026-07-29: fade up into
  // tracks; the jingle's own fade-down is baked into its rendered copy
  // above, not done live, and DJ speech is forced to "0" -- never fades).
  const stationName = scheduleUtil.loadStation().name;
  const playlistLines = segments.map((p) => {
    if (p === jinglePath) return annotateJingleEntry(p, parsed.title, stationName);
    if (speechPaths.has(p)) return annotateSpeechEntry(p, parsed.title, stationName, speechPersonas.get(p));
    return annotateTrackEntry(p);
  });

  // Written last, and only on full success -- its presence is the signal
  // scheduler/updateNowPlaying.js/scheduleDirect.js use to decide this
  // occurrence is ready/already directed.
  fs.writeFileSync(path.join(showOccurrenceDir, 'playlist.m3u'), playlistLines.join('\n') + '\n');

  log(`Directed "${id}" (${weekday} ${date} ${timeKey}): ${segments.length} segments -> ${showOccurrenceDir}`);
  return { outDir: showOccurrenceDir, segmentCount: segments.length };
}
