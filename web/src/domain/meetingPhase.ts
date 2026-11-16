/**
 * Where a class meeting stands right now, in Philippine time: over for today, going on, or still to come.
 * Only today's meetings can be over or going on; another day's are always still to come.
 */
export type MeetingPhase = 'ENDED' | 'NOW' | 'LATER';

const PH_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

/** The Philippine calendar day of a moment, as a day number (for comparing two moments). */
const phDay = (millis: number) => Math.floor((millis + PH_OFFSET_MS) / DAY_MS);

/** Minutes since Philippine midnight. */
export const phMinutes = (millis: number) => Math.floor(((millis + PH_OFFSET_MS) % DAY_MS) / 60_000);

/** `dayMillis` is any moment on the day the meeting is listed under; `now` is the current time. */
export function meetingPhase(startMinutes: number, endMinutes: number, dayMillis: number, now: number): MeetingPhase {
  if (phDay(dayMillis) !== phDay(now)) return 'LATER';
  const minutes = phMinutes(now);
  if (minutes >= endMinutes) return 'ENDED';
  if (minutes >= startMinutes) return 'NOW';
  return 'LATER';
}
