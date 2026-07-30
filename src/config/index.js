import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '..', '..', 'config.json');

if (!fs.existsSync(configPath)) {
  throw new Error(
    `config.json not found at ${configPath}. Copy config.example.json to config.json and fill in real values.`
  );
}

export const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Every generated/operational path is derived from this one root rather than
// each being its own separately-configured absolute path -- moving to
// production means changing `dataDir` once, not hunting down individual
// path settings scattered across config.json.
config.paths = {
  stationFile: path.join(config.dataDir, 'station.json'),
  stationHashPath: path.join(config.dataDir, '.station_hash'),
  showDescriptionsDir: path.join(config.dataDir, 'show-descriptions'),
  // Every produced/directed show occurrence (weekday/showId/date/...) lives
  // under this one namespace, so config.dataDir's top level stays limited to
  // the small set of station-wide files instead of one directory per weekday.
  runningDir: path.join(config.dataDir, 'running'),
  historyFile: path.join(config.dataDir, 'history', 'played.jsonl'),
  logsDir: path.join(config.dataDir, 'logs'),
  nowPlayingPath: path.join(config.dataDir, 'now_playing.m3u'),
  nowPlayingStatePath: path.join(config.dataDir, 'now_playing_state.json'),
  fillerPath: path.join(config.dataDir, 'filler.m3u'),
  chatterboxLockPath: path.join(config.dataDir, '.chatterbox.lock'),
  wikipediaCacheDir: path.join(config.dataDir, 'cache', 'wikipedia'),
  trackRatingKeysPath: path.join(config.dataDir, 'track_ratingkeys.json'),
  trackRatingKeysLockPath: path.join(config.dataDir, '.track_ratingkeys.lock'),
  nowPlayingTrackPath: path.join(config.dataDir, 'now_playing_track.json'),
  airedHistoryFile: path.join(config.dataDir, 'history', 'aired.jsonl'),
  artCacheDir: path.join(config.dataDir, 'cache', 'art'),
};
