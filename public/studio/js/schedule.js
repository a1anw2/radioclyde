import { api } from './api.js';

// 2.5px/minute -- a 30min show is 75px tall, giving the title/time/badge
// room to breathe. (The original 0.625px/min scale made blocks ~19px tall,
// which is what made dragging unreliable and text illegible -- see git
// history/conversation for why this got bumped, first to 2, then to 2.5 once
// 2px still felt cramped with the readiness badge added.)
const PX_PER_MIN = 2.5;
const DAY_HEIGHT = 24 * 60 * PX_PER_MIN;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
// Every real show is a 30min slot -- snapping drag/resize/add to the same
// grain keeps the grid always landing on a clean boundary instead of
// producing odd times like 07:13.
const DRAG_SNAP_MIN = 30;

// One categorical color per show, so the grid reads at a glance instead of
// every block being the same blue. Each {bg, fg} pair is validated
// (dataviz skill's validate_palette.js, --mode light): all 8 pass the CVD
// and normal-vision separation gates in this fixed order; fg is picked per
// bg for real WCAG contrast (aqua/yellow/magenta read badly with white text
// despite passing the palette-vs-page-background check, so those three get
// dark text instead). With ~29 real shows there are always more shows than
// colors -- colorForShow() hashes the id to a stable slot, and the block's
// own title text (always visible) is what actually disambiguates when two
// shows land on the same color, not the color alone.
const SHOW_COLORS = [
  { bg: '#2a78d6', fg: '#ffffff' }, // blue
  { bg: '#eb6834', fg: '#111827' }, // orange
  { bg: '#1baf7a', fg: '#111827' }, // aqua
  { bg: '#eda100', fg: '#111827' }, // yellow
  { bg: '#e87ba4', fg: '#111827' }, // magenta
  { bg: '#008300', fg: '#ffffff' }, // green
  { bg: '#4a3aa7', fg: '#ffffff' }, // violet
  { bg: '#e34948', fg: '#111827' }, // red
];

function colorForShow(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SHOW_COLORS[hash % SHOW_COLORS.length];
}

const scrollEl = document.getElementById('schedule-scroll');
const gridEl = document.getElementById('schedule-grid');
const popoverEl = document.getElementById('schedule-popover');
const toastEl = document.getElementById('schedule-toast');

let currentSchedule = {};
let showTitles = {}; // id -> title, for block labels and the popover's <select>
let currentReadiness = {}; // "weekday/time-key" -> 'directed' | 'script' | 'none', today/tomorrow only
let toastTimer = null;
let hasScrolledToDay = false;

// A drag/resize that the server rejects (e.g. it wouldn't fit) has no form
// to show the error in -- a transient toast instead of a blocking alert(),
// since alert() freezes the whole page (confirmed while testing: it stalls
// the tab until dismissed) for an error that's often just "picked a bad
// spot, try again."
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

function minutesToTime(totalMinutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function timeKeyOf(startTime) {
  return startTime.replace(':', '-');
}

// Date#getDay() is Sun=0..Sat=6; WEEKDAYS starts Monday, so shift by 6 (mod
// 7) to land on the same index scheduleUtil.js's weekdayKey() would produce.
function todayWeekday() {
  return WEEKDAYS[(new Date().getDay() + 6) % 7];
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function endTimeLabel(occ) {
  return minutesToTime(timeToMinutes(occ.startTime) + occ.durationMinutes);
}

function closePopover() {
  popoverEl.hidden = true;
  popoverEl.innerHTML = '';
}

// Anchors the popover near (x, y) in viewport coordinates, clamped so it
// never renders off the right/bottom edge of the window.
function openPopoverAt(x, y, buildContent) {
  popoverEl.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'schedule-popover-header';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'schedule-popover-close';
  closeButton.textContent = '×';
  closeButton.addEventListener('click', closePopover);
  header.append(buildContent.title, closeButton);
  popoverEl.appendChild(header);
  popoverEl.appendChild(buildContent.body);

  popoverEl.hidden = false;
  const width = 250;
  const left = Math.min(x, window.innerWidth - width - 16);
  popoverEl.style.left = `${Math.max(8, left)}px`;
  const height = popoverEl.offsetHeight || 200;
  const top = Math.min(y, window.innerHeight - height - 16);
  popoverEl.style.top = `${Math.max(8, top)}px`;
}

async function loadShowTitles() {
  const { shows } = await api('/api/shows');
  showTitles = Object.fromEntries(shows.map((s) => [s.id, s.title]));
}

function makeShowSelect(selectedId) {
  const select = document.createElement('select');
  for (const [id, title] of Object.entries(showTitles).sort(([, a], [, b]) => a.localeCompare(b))) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = title;
    if (id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

function makeHeaderCell(text, isToday) {
  const el = document.createElement('div');
  el.className = isToday ? 'schedule-day-header is-today' : 'schedule-day-header';
  el.textContent = text;
  return el;
}

// A live line across today's column at the current time, the same idea as
// Google Calendar's "now" marker -- otherwise there's no way to tell, at a
// glance, where "now" falls in a grid that's a recurring weekly template
// with no dates on it. Re-run both on every render() (which tears down and
// rebuilds the whole grid) and on its own interval (see startScheduleView())
// so it keeps creeping forward between renders too.
function updateNowLine() {
  const col = gridEl.querySelector(`.schedule-day-column[data-day="${todayWeekday()}"]`);
  if (!col) return;
  let line = col.querySelector('.schedule-now-line');
  if (!line) {
    line = document.createElement('div');
    line.className = 'schedule-now-line';
    const label = document.createElement('span');
    label.className = 'schedule-now-line-label';
    line.appendChild(label);
    col.appendChild(line);
  }
  const minutes = nowMinutes();
  line.style.top = `${minutes * PX_PER_MIN}px`;
  line.querySelector('.schedule-now-line-label').textContent = minutesToTime(minutes);
}

// Only 'directed' and 'script' get a badge -- 'none'/missing (not due yet,
// or today/tomorrow doesn't cover this slot) looks the same as "not ready"
// and needs no visual noise on a grid that's mostly slots nothing has
// touched yet (see the /api/schedule/readiness comment for why). Reuses the
// same status-dot/status-live/status-pending classes the On Air page uses,
// so "green = ready" reads the same way in both places.
const READINESS_META = {
  directed: { statusClass: 'status-live', label: 'Ready to air -- script and audio are directed.' },
  script: { statusClass: 'status-pending', label: 'Script ready, audio not directed yet.' },
};

function makeReadinessBadge(weekday, occ) {
  const status = currentReadiness[`${weekday}/${timeKeyOf(occ.startTime)}`];
  const meta = READINESS_META[status];
  if (!meta) return null;
  const badge = document.createElement('div');
  badge.className = `schedule-block-readiness status-dot ${meta.statusClass}`;
  badge.title = meta.label;
  return badge;
}

function makeBlock(weekday, occ) {
  const el = document.createElement('div');
  el.className = 'schedule-block';
  el.style.top = `${timeToMinutes(occ.startTime) * PX_PER_MIN}px`;
  el.style.height = `${Math.max(occ.durationMinutes * PX_PER_MIN, 26)}px`;
  const { bg, fg } = colorForShow(occ.id);
  el.style.background = bg;
  el.style.color = fg;

  const handle = document.createElement('div');
  handle.className = 'schedule-block-handle';
  handle.title = 'Drag to move';
  handle.textContent = '⋮⋮';

  const body = document.createElement('div');
  body.className = 'schedule-block-body';
  const title = document.createElement('div');
  title.className = 'schedule-block-title';
  title.textContent = showTitles[occ.id] ?? occ.id;
  const time = document.createElement('div');
  time.className = 'schedule-block-time';
  time.textContent = `${occ.startTime}–${endTimeLabel(occ)}`;
  body.append(title, time);
  body.addEventListener('click', () => openEditPopover(weekday, occ, body.getBoundingClientRect()));

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'schedule-block-resize';

  el.append(handle, body, resizeHandle);
  const readinessBadge = makeReadinessBadge(weekday, occ);
  if (readinessBadge) el.appendChild(readinessBadge);

  wireDrag(handle, el, weekday, occ);
  wireResize(resizeHandle, el, weekday, occ);
  return el;
}

function openEditPopover(weekday, occ, anchorRect) {
  const title = document.createElement('strong');
  title.textContent = `${DAY_LABELS[weekday]} · ${occ.startTime}–${endTimeLabel(occ)}`;

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '0.5rem';

  const select = makeShowSelect(occ.id);
  body.appendChild(select);

  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn-primary';
  saveButton.textContent = 'Save';
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn-danger';
  deleteButton.textContent = 'Delete';
  actions.append(saveButton, deleteButton);
  body.appendChild(actions);

  const messageEl = document.createElement('span');
  messageEl.className = 'action-message';
  body.appendChild(messageEl);

  saveButton.addEventListener('click', async () => {
    if (select.value === occ.id) return closePopover();
    messageEl.textContent = 'Saving...';
    try {
      await api(`/api/schedule/${weekday}/${timeKeyOf(occ.startTime)}`, {
        method: 'PATCH',
        body: { id: select.value },
      });
      closePopover();
      await render();
    } catch (err) {
      messageEl.textContent = err.message;
      messageEl.classList.add('error');
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!confirm(`Remove "${showTitles[occ.id] ?? occ.id}" from ${DAY_LABELS[weekday]} ${occ.startTime}?`)) return;
    try {
      await api(`/api/schedule/${weekday}/${timeKeyOf(occ.startTime)}`, { method: 'DELETE' });
      closePopover();
      await render();
    } catch (err) {
      messageEl.textContent = err.message;
      messageEl.classList.add('error');
    }
  });

  openPopoverAt(anchorRect.left, anchorRect.bottom + 6, { title, body });
}

function openAddPopover(weekday, startTime, clientX, clientY) {
  const title = document.createElement('strong');
  title.textContent = `Add to ${DAY_LABELS[weekday]}`;

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '0.5rem';

  const select = makeShowSelect(null);
  const durationInput = document.createElement('input');
  durationInput.type = 'number';
  durationInput.min = '1';
  durationInput.value = '30';
  durationInput.placeholder = 'Duration (minutes)';
  body.append(select, durationInput);

  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn-primary';
  addButton.textContent = 'Add';
  actions.appendChild(addButton);
  body.appendChild(actions);

  const messageEl = document.createElement('span');
  messageEl.className = 'action-message';
  body.appendChild(messageEl);

  addButton.addEventListener('click', async () => {
    messageEl.textContent = 'Adding...';
    try {
      await api(`/api/schedule/${weekday}`, {
        method: 'POST',
        body: { id: select.value, startTime, durationMinutes: Number(durationInput.value) },
      });
      closePopover();
      await render();
    } catch (err) {
      messageEl.textContent = err.message;
      messageEl.classList.add('error');
    }
  });

  openPopoverAt(clientX, clientY, { title, body });
}

// Dragging is only ever started from the dedicated handle -- no click-vs-
// drag guessing needed, so clicking a show's title/time always reliably
// opens the popover (see makeBlock's body click listener) and grabbing the
// handle always reliably moves it.
function wireDrag(handle, el, weekday, occ) {
  handle.addEventListener('pointerdown', (startEvent) => {
    startEvent.preventDefault();
    closePopover();
    const startY = startEvent.clientY;
    const startTop = parseFloat(el.style.top);
    let dropColumn = el.parentElement;
    el.classList.add('dragging');

    const onMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      el.style.top = `${Math.max(0, startTop + deltaY)}px`;
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const column = target?.closest('.schedule-day-column');
      if (column && column !== dropColumn) {
        dropColumn.classList.remove('drop-target');
        dropColumn = column;
        dropColumn.classList.add('drop-target');
      }
    };
    const onUp = async (upEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      dropColumn.classList.remove('drop-target');

      const deltaY = upEvent.clientY - startY;
      const rawMinutes = (startTop + deltaY) / PX_PER_MIN;
      const snapped = Math.round(rawMinutes / DRAG_SNAP_MIN) * DRAG_SNAP_MIN;
      const newStartTime = minutesToTime(snapped);
      const newWeekday = dropColumn.dataset.day;

      try {
        if (newWeekday === weekday) {
          await api(`/api/schedule/${weekday}/${timeKeyOf(occ.startTime)}`, {
            method: 'PATCH',
            body: { startTime: newStartTime },
          });
        } else {
          await api(`/api/schedule/${weekday}/${timeKeyOf(occ.startTime)}`, { method: 'DELETE' });
          await api(`/api/schedule/${newWeekday}`, {
            method: 'POST',
            body: { id: occ.id, startTime: newStartTime, durationMinutes: occ.durationMinutes, description: occ.description },
          });
        }
      } catch (err) {
        showToast(err.message);
      }
      await render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function wireResize(handle, el, weekday, occ) {
  handle.addEventListener('pointerdown', (startEvent) => {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    closePopover();
    const startY = startEvent.clientY;
    const startHeight = parseFloat(el.style.height);
    el.classList.add('dragging');

    const onMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      el.style.height = `${Math.max(26, startHeight + deltaY)}px`;
    };
    const onUp = async (upEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      el.classList.remove('dragging');
      const deltaY = upEvent.clientY - startY;
      const rawMinutes = (startHeight + deltaY) / PX_PER_MIN;
      const snapped = Math.max(DRAG_SNAP_MIN, Math.round(rawMinutes / DRAG_SNAP_MIN) * DRAG_SNAP_MIN);
      try {
        await api(`/api/schedule/${weekday}/${timeKeyOf(occ.startTime)}`, {
          method: 'PATCH',
          body: { durationMinutes: snapped },
        });
      } catch (err) {
        showToast(err.message);
      }
      await render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

async function render() {
  closePopover();
  const [{ schedule }, , { readiness }] = await Promise.all([
    api('/api/schedule'),
    loadShowTitles(),
    api('/api/schedule/readiness'),
  ]);
  currentSchedule = schedule;
  currentReadiness = readiness;
  gridEl.innerHTML = '';
  gridEl.style.gridTemplateRows = `auto ${DAY_HEIGHT}px`;

  const today = todayWeekday();
  gridEl.appendChild(makeHeaderCell(''));
  for (const day of WEEKDAYS) gridEl.appendChild(makeHeaderCell(DAY_LABELS[day], day === today));

  const hourCol = document.createElement('div');
  hourCol.style.position = 'relative';
  hourCol.style.height = `${DAY_HEIGHT}px`;
  hourCol.style.background = 'var(--surface)';
  for (let h = 0; h < 24; h++) {
    const label = document.createElement('div');
    label.className = 'schedule-hour-label';
    label.style.position = 'absolute';
    label.style.top = `${h * 60 * PX_PER_MIN - 6}px`;
    label.style.right = '0';
    label.textContent = `${String(h).padStart(2, '0')}:00`;
    hourCol.appendChild(label);
  }
  gridEl.appendChild(hourCol);

  for (const day of WEEKDAYS) {
    const col = document.createElement('div');
    col.className = day === today ? 'schedule-day-column is-today' : 'schedule-day-column';
    col.dataset.day = day;
    col.style.height = `${DAY_HEIGHT}px`;
    col.addEventListener('click', (event) => {
      if (event.target !== col) return;
      const rect = col.getBoundingClientRect();
      const minutes = (event.clientY - rect.top) / PX_PER_MIN;
      const startTime = minutesToTime(Math.round(minutes / DRAG_SNAP_MIN) * DRAG_SNAP_MIN);
      openAddPopover(day, startTime, event.clientX, event.clientY);
    });
    for (const occ of currentSchedule[day] ?? []) {
      col.appendChild(makeBlock(day, occ));
    }
    gridEl.appendChild(col);
  }

  updateNowLine();

  // Default the visible scroll position to just above "now" (with an hour
  // of already-aired context still visible above it) rather than the top of
  // the grid, so opening the page answers "what's on right now" without any
  // scrolling -- only on the view's first render, so it doesn't fight a
  // studio user who's scrolled elsewhere on a later refresh.
  if (!hasScrolledToDay) {
    hasScrolledToDay = true;
    scrollEl.scrollTop = Math.max(0, (nowMinutes() - 60) * PX_PER_MIN);
  }
}

window.addEventListener('hashchange', closePopover);

let nowLineTimer = null;

export function startScheduleView() {
  render();
  // Guarded like onAir.js's pollTimer -- startScheduleView() re-runs on
  // every visit to the tab (see app.js), but the line only needs one ticker
  // for the process's whole lifetime.
  if (!nowLineTimer) {
    nowLineTimer = setInterval(updateNowLine, 30000);
  }
}
