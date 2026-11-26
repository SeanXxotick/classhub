const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Parses a YYYY-MM-DD key to UTC midnight milliseconds, or NaN if invalid. */
function utcDayMillis(dateKey: string): number {
  if (!DATE_KEY.test(dateKey)) return Number.NaN;
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(ms)) return Number.NaN;
  // Reject overflowed calendar dates such as 2026-02-31.
  return new Date(ms).toISOString().slice(0, 10) === dateKey ? ms : Number.NaN;
}

/** The Monday (YYYY-MM-DD) of the Mon-Sun calendar week containing dateKey. */
export function mondayKey(dateKey: string): string | null {
  const ms = utcDayMillis(dateKey);
  if (!Number.isFinite(ms)) return null;
  const dow = new Date(ms).getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offset = (dow + 6) % 7;
  return new Date(ms - offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The class's 1-based school week number on targetDateKey, anchored to the Monday of the week
 * in which the first attendance was taken. Returns null when no valid first date exists or
 * targetDateKey falls in an earlier week.
 */
export function classWeekNumber(firstDateKey: string | null | undefined, targetDateKey: string): number | null {
  if (!firstDateKey) return null;
  const firstMon = mondayKey(firstDateKey);
  const targetMon = mondayKey(targetDateKey);
  if (!firstMon || !targetMon) return null;
  const diffDays = Math.round((utcDayMillis(targetMon) - utcDayMillis(firstMon)) / DAY_MS);
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

/**
 * Earliest valid YYYY-MM-DD date on which attendance was taken, combining public per-course totals
 * (readable by every member) with full sheets when loaded for an attendance officer.
 */
export function earliestAttendanceDate(
  totals: { taken: number; firstDateKey?: string }[],
  sheets?: { dateKey: string }[] | null,
): string | null {
  let earliest: string | null = null;
  const consider = (key: string | undefined) => {
    if (!key || !Number.isFinite(utcDayMillis(key))) return;
    if (!earliest || key < earliest) earliest = key;
  };
  for (const t of totals) {
    if (t.taken > 0) consider(t.firstDateKey);
  }
  if (sheets) {
    for (const s of sheets) consider(s.dateKey);
  }
  return earliest;
}
