/**
 * Calendar days in the browser's own time zone, like java.time.LocalDate in the Android app.
 * A day is kept as its "YYYY-MM-DD" text so it can be compared and used as a map key.
 */
export type DayKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(year: number, month: number, day: number): DayKey {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The local calendar day of an instant. */
export function dayOf(millis: number): DayKey {
  const d = new Date(millis);
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function parseDay(key: DayKey): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/** Whole calendar days from a to b (negative when b is earlier). */
export function daysBetween(a: DayKey, b: DayKey): number {
  const x = parseDay(a);
  const y = parseDay(b);
  return Math.round((Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / 86_400_000);
}

export function plusDays(key: DayKey, days: number): DayKey {
  const { year, month, day } = parseDay(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(key: DayKey): number {
  const { year, month, day } = parseDay(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Local noon on the day, which is how the Android app saves a due date. */
export function noonMillis(key: DayKey): number {
  const { year, month, day } = parseDay(key);
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

/** Local midnight at the start of the day. */
export function startOfDayMillis(key: DayKey): number {
  const { year, month, day } = parseDay(key);
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

export function today(): DayKey {
  return dayOf(Date.now());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const monthShort = (month: number) => MONTHS[month - 1];
export const monthLong = (month: number) => MONTHS_LONG[month - 1];
export const weekdayShort = (wd: number) => WEEKDAYS[wd];
export const weekdayLong = (wd: number) => WEEKDAYS_LONG[wd];
