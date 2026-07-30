import { loadSchedule, nextOccurrences } from '../scheduler/scheduleUtil.js';
import { resolveShowInfo } from './showName.js';

export function getUpcomingShows(count = 10) {
  const occurrences = nextOccurrences(loadSchedule(), new Date(), count);
  return occurrences.map((occ) => {
    const { name, host } = resolveShowInfo(occ.show, occ.show.id);
    return { id: occ.show.id, name, host, weekday: occ.weekday, date: occ.date, startTime: occ.show.startTime };
  });
}
