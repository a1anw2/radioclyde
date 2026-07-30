const POLL_INTERVAL_MS = 12000;

const player = document.getElementById('player');
const playButton = document.getElementById('play-button');
const artEl = document.getElementById('art');
const logoEl = document.getElementById('logo');
const streamUrlEl = document.getElementById('stream-url');
const onAirLabelEl = document.getElementById('on-air-label');
const showNameEl = document.getElementById('show-name');
const showHostEl = document.getElementById('show-host');
const djTalkingEl = document.getElementById('dj-talking');
const trackTitleEl = document.getElementById('track-title');
const trackArtistEl = document.getElementById('track-artist');
const trackProgressEl = document.getElementById('track-progress');
const trackProgressFillEl = document.getElementById('track-progress-fill');
const trackElapsedEl = document.getElementById('track-elapsed');
const trackDurationEl = document.getElementById('track-duration');
const historyListEl = document.getElementById('history-list');
const upcomingListEl = document.getElementById('upcoming-list');

const WEEKDAY_ABBR = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

let streamStarted = false;
// Set from the last /api/now-playing response and ticked client-side every
// second so the progress bar moves smoothly between polls -- polling every
// second instead would just hammer the server for something the client can
// derive on its own from playedAt/durationMs.
let currentTrackTiming = null; // { playedAt: number epoch ms, durationMs: number } | null
// Set from the last /api/now-playing response -- when a track (not a DJ) is
// airing, it's also the most recent /api/history entry, so fetchHistory()
// drops that duplicate leading entry rather than showing it twice.
let trackIsPlaying = false;

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function tickTrackProgress() {
  if (!currentTrackTiming) {
    trackProgressEl.hidden = true;
    return;
  }
  const { playedAt, durationMs } = currentTrackTiming;
  const elapsedMs = Math.min(Date.now() - playedAt, durationMs);
  trackProgressEl.hidden = false;
  trackProgressFillEl.style.width = `${Math.min(100, (elapsedMs / durationMs) * 100)}%`;
  trackElapsedEl.textContent = formatClock(elapsedMs);
  trackDurationEl.textContent = formatClock(durationMs);
}

// No logo uploaded yet (drop one at public/logo.png) -- hide the broken
// image rather than show it.
logoEl.addEventListener('error', () => (logoEl.hidden = true));

playButton.addEventListener('click', () => {
  if (!streamStarted) {
    player.src = '/stream';
    streamStarted = true;
  }
  if (player.paused) {
    player.play();
  } else {
    player.pause();
  }
});

player.addEventListener('play', () => (playButton.textContent = 'Pause'));
player.addEventListener('pause', () => (playButton.textContent = 'Tune In'));

async function fetchNowPlaying() {
  try {
    const res = await fetch('/api/now-playing');
    if (!res.ok) return;
    const data = await res.json();

    if (data.station?.name) {
      document.title = data.station.name;
    }
    if (data.station?.streamUrl) {
      streamUrlEl.textContent = `Icecast URL: ${data.station.streamUrl}`;
    }
    onAirLabelEl.hidden = !data.show;
    onAirLabelEl.textContent = data.station?.name ? `On Air at ${data.station.name}` : 'On Air';
    showNameEl.textContent = data.show ? data.show.name : '';
    showHostEl.hidden = !data.show?.host;
    showHostEl.textContent = data.show?.host ? `with ${data.show.host}` : '';

    if (data.dj) {
      djTalkingEl.textContent = `🎙 ${data.dj} talking`;
      djTalkingEl.hidden = false;
      trackTitleEl.hidden = true;
      trackArtistEl.hidden = true;
      artEl.hidden = true;
      currentTrackTiming = null;
      trackIsPlaying = false;
    } else {
      djTalkingEl.hidden = true;
      trackTitleEl.hidden = false;
      trackArtistEl.hidden = false;
      trackTitleEl.textContent = data.track ? data.track.title : '';
      trackArtistEl.textContent = data.track?.artist ?? '';
      artEl.hidden = !data.track?.artUrl;
      if (data.track?.artUrl) artEl.src = data.track.artUrl;

      currentTrackTiming =
        data.track?.playedAt && data.track?.durationMs
          ? { playedAt: new Date(data.track.playedAt).getTime(), durationMs: data.track.durationMs }
          : null;
      trackIsPlaying = Boolean(data.track);
    }
    tickTrackProgress();
  } catch {
    // transient network hiccup -- next poll will retry
  }
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return;
    const { entries } = await res.json();
    // The currently-playing track is also entries[0] -- skip it here since
    // it's already shown in the now-playing section above.
    const displayEntries = trackIsPlaying ? entries.slice(1) : entries;

    historyListEl.innerHTML = '';
    for (const entry of displayEntries) {
      const li = document.createElement('li');

      if (entry.artUrl) {
        const img = document.createElement('img');
        img.src = entry.artUrl;
        img.alt = '';
        li.appendChild(img);
      }

      const text = document.createElement('span');
      text.textContent = `${entry.artist} — ${entry.title}`;
      li.appendChild(text);

      historyListEl.appendChild(li);
    }
  } catch {
    // transient network hiccup -- next poll will retry
  }
}

async function fetchUpcoming() {
  try {
    const res = await fetch('/api/upcoming');
    if (!res.ok) return;
    const { shows } = await res.json();

    upcomingListEl.innerHTML = '';
    for (const show of shows) {
      const li = document.createElement('li');

      const time = document.createElement('span');
      time.className = 'upcoming-time';
      time.textContent = `${WEEKDAY_ABBR[show.weekday] ?? show.weekday} ${show.startTime}`;

      const info = document.createElement('span');
      info.className = 'upcoming-info';
      const name = document.createElement('span');
      name.className = 'upcoming-name';
      name.textContent = show.name;
      info.appendChild(name);
      if (show.host) {
        const host = document.createElement('span');
        host.className = 'upcoming-host';
        host.textContent = `with ${show.host}`;
        info.appendChild(host);
      }

      li.appendChild(time);
      li.appendChild(info);
      upcomingListEl.appendChild(li);
    }
  } catch {
    // transient network hiccup -- next poll will retry
  }
}

fetchNowPlaying();
fetchHistory();
fetchUpcoming();
setInterval(fetchNowPlaying, POLL_INTERVAL_MS);
setInterval(fetchHistory, POLL_INTERVAL_MS);
setInterval(fetchUpcoming, POLL_INTERVAL_MS);
setInterval(tickTrackProgress, 1000);
