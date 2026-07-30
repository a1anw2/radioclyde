import { config } from '../config/index.js';

// Offset-aware local-time ISO string (e.g. "2026-07-27T16:55:23.123-04:00")
// instead of Date.prototype.toISOString()'s forced UTC ("...Z") -- logs and
// history/cache records should read in the station's own local time (this
// is a single-location station; config.weather.timezone is the one place
// that's already configured, reused here as the general station timezone
// rather than duplicating the same zone string in a second config field).
// Still fully parseable by `new Date(...)` into the exact right instant (the
// numeric offset is real, not decorative), so anything doing epoch math on
// these strings (history.js's repeat-window cutoffs) is unaffected.
function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Human-readable calendar date (e.g. "Thursday, July 30, 2026") from a plain
// "YYYY-MM-DD" dateKey (scheduleUtil.dateKey()'s format) -- built straight
// from its y/m/d components via the local Date constructor, so it always
// names the same day scheduleUtil.weekdayKey() would for that same dateKey,
// with no timezone conversion to get wrong.
export function formatCalendarDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(
    new Date(y, m - 1, d)
  );
}

export function toLocalISOString(date = new Date(), timeZone = config.weather?.timezone) {
  if (!timeZone) return date.toISOString();
  const offsetMin = tzOffsetMinutes(date, timeZone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}${sign}${oh}:${om}`;
}
