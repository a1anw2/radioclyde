import fs from 'node:fs';
import { config } from '../config/index.js';
import { readNowPlayingState } from '../scheduler/updateNowPlaying.js';
import { loadSchedule, loadStation } from '../scheduler/scheduleUtil.js';
import { resolveShowInfo, capitalizePersonaList } from './showName.js';

// now_playing_track.json holds either a track record or a DJ-speaking
// record ({dj, startedAt}, written by plex/scrobbleTrack.js when the
// currently airing segment has no ratingKey but is annotated with a
// persona name) -- never both at once, since it's overwritten wholesale on
// every segment boundary.
function readNowPlayingTrack() {
  try {
    const entry = JSON.parse(fs.readFileSync(config.paths.nowPlayingTrackPath, 'utf8'));
    if (entry.dj) return { track: null, dj: capitalizePersonaList(entry.dj) };
    return {
      track: {
        artist: entry.artist,
        title: entry.title,
        album: entry.album,
        artUrl: entry.ratingKey ? `/api/art/${entry.ratingKey}` : null,
        durationMs: entry.durationMs ?? null,
        playedAt: entry.playedAt ?? null,
      },
      dj: null,
    };
  } catch {
    return { track: null, dj: null }; // nothing has aired since deploy, or the file is mid-write
  }
}

// Fastify (config.web.port), not Icecast's own internal port, is what a
// listener/external player actually connects to now -- /stream on the
// public port is proxied straight through (see server/streamProxy.js).
function streamUrl() {
  return `http://${config.icecast.publicHost}:${config.web.port}${config.icecast.mount}`;
}

export function composeNowPlaying() {
  const state = readNowPlayingState();
  const { track, dj } = readNowPlayingTrack();
  const station = { name: loadStation().name ?? null, streamUrl: streamUrl() };

  // A finished show's state is left in place until the next occurrence is
  // ready to load (see updateNowPlaying's comment on filler taking over on
  // its own) -- once its estimated runtime has elapsed, filler is what's
  // actually on air, not the show state still points to.
  if (!state || Date.now() >= state.estimatedEndAt) {
    return { station, show: null, track, dj, scheduledStart: null, estimatedEndAt: null };
  }

  const showEntry = (loadSchedule()[state.weekday] ?? []).find((s) => s.id === state.id);
  const { name, host } = resolveShowInfo(showEntry, state.id);
  return {
    station,
    show: { id: state.id, name, host },
    track,
    dj,
    scheduledStart: showEntry?.startTime ?? null,
    estimatedEndAt: state.estimatedEndAt,
  };
}
