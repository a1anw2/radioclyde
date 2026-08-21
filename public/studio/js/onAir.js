import { api } from './api.js';

const POLL_INTERVAL_MS = 12000;

const statusDotEl = document.getElementById('status-dot');
const statusLabelEl = document.getElementById('status-label');
const listenerCountEl = document.getElementById('listener-count');
const artEl = document.getElementById('on-air-art');
const showEl = document.getElementById('on-air-show');
const titleEl = document.getElementById('on-air-title');
const artistEl = document.getElementById('on-air-artist');
const progressEl = document.getElementById('on-air-progress');
const progressFillEl = document.getElementById('progress-fill');
const elapsedEl = document.getElementById('progress-elapsed');
const durationEl = document.getElementById('progress-duration');
const upcomingListEl = document.getElementById('upcoming-list');
const historyListEl = document.getElementById('history-list');
const skipButton = document.getElementById('skip-button');
const forceNextButton = document.getElementById('force-next-button');
const actionMessageEl = document.getElementById('on-air-action-message');

const WEEKDAY_ABBR = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' };

let currentTrackTiming = null;
let pollTimer = null;

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function tickProgress() {
  if (!currentTrackTiming) {
    progressEl.hidden = true;
    return;
  }
  const { playedAt, durationMs } = currentTrackTiming;
  const elapsedMs = Math.min(Date.now() - playedAt, durationMs);
  progressEl.hidden = false;
  progressFillEl.style.width = `${Math.min(100, (elapsedMs / durationMs) * 100)}%`;
  elapsedEl.textContent = formatClock(elapsedMs);
  durationEl.textContent = formatClock(durationMs);
}

function setActionMessage(text, isError) {
  actionMessageEl.textContent = text;
  actionMessageEl.classList.toggle('error', Boolean(isError));
}

async function fetchOnAir() {
  try {
    const data = await api('/api/on-air');

    const isLive = Boolean(data.show || data.track || data.dj);
    statusDotEl.className = `status-dot ${isLive ? 'status-live' : 'status-idle'}`;
    statusLabelEl.textContent = isLive ? 'ON AIR' : 'OFF AIR (filler)';
    listenerCountEl.textContent = data.listenerCount != null ? `${data.listenerCount} listener${data.listenerCount === 1 ? '' : 's'}` : '';

    showEl.textContent = data.show ? `${data.show.name}${data.show.host ? ` — ${data.show.host}` : ''}` : '';

    if (data.dj) {
      titleEl.textContent = `🎙 ${data.dj} talking`;
      artistEl.textContent = '';
      artEl.hidden = true;
      currentTrackTiming = null;
      skipButton.disabled = true;
    } else if (data.track) {
      titleEl.textContent = data.track.title ?? '';
      artistEl.textContent = data.track.artist ?? '';
      if (data.track.artUrl) {
        artEl.src = data.track.artUrl;
        artEl.hidden = false;
      } else {
        artEl.hidden = true;
      }
      currentTrackTiming =
        data.track.playedAt && data.track.durationMs
          ? { playedAt: new Date(data.track.playedAt).getTime(), durationMs: data.track.durationMs }
          : null;
      skipButton.disabled = false;
    } else {
      titleEl.textContent = '';
      artistEl.textContent = '';
      artEl.hidden = true;
      currentTrackTiming = null;
      skipButton.disabled = true;
    }
    tickProgress();

    upcomingListEl.innerHTML = '';
    for (const show of data.upcoming ?? []) {
      const li = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = `${WEEKDAY_ABBR[show.weekday] ?? show.weekday} ${show.startTime}`;
      const name = document.createElement('span');
      name.textContent = show.host ? `${show.name} — ${show.host}` : show.name;
      li.append(time, name);
      upcomingListEl.appendChild(li);
    }

    historyListEl.innerHTML = '';
    for (const entry of data.history ?? []) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${entry.artist} — ${entry.title}`;
      li.appendChild(name);
      historyListEl.appendChild(li);
    }
  } catch (err) {
    setActionMessage(err.message, true);
  }
}

skipButton.addEventListener('click', async () => {
  skipButton.disabled = true;
  setActionMessage('Skipping...');
  try {
    await api('/api/on-air/skip', { method: 'POST' });
    setActionMessage('Skipped.');
    fetchOnAir();
  } catch (err) {
    setActionMessage(err.message, true);
  }
});

forceNextButton.addEventListener('click', async () => {
  forceNextButton.disabled = true;
  setActionMessage('Forcing next show...');
  try {
    await api('/api/on-air/force-next', { method: 'POST' });
    setActionMessage('Moved to next show.');
    fetchOnAir();
  } catch (err) {
    setActionMessage(err.message, true);
  } finally {
    forceNextButton.disabled = false;
  }
});

export function startOnAirView() {
  fetchOnAir();
  if (!pollTimer) {
    pollTimer = setInterval(fetchOnAir, POLL_INTERVAL_MS);
    setInterval(tickProgress, 1000);
  }
}
