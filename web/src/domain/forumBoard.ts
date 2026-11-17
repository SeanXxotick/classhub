/**
 * The Forum's top helpers: one point for each best answer a member wrote. Counted from the questions the
 * viewer can see, so there are no counters to keep in step.
 */

export interface PickedQuestion {
  bestAnswerUid: string;
  pickedAtMillis: number;
}

export interface Helper {
  uid: string;
  points: number;
}

/**
 * Members with at least one point since `sinceMillis` (0 = all time), most first, then by name.
 * Only current members count, and not those who chose to be left out.
 */
export function topHelpers(questions: PickedQuestion[], members: { id: string; name: string }[], leftOut: Set<string>, sinceMillis: number): Helper[] {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const points = new Map<string, number>();
  for (const q of questions) {
    if (!q.bestAnswerUid || q.pickedAtMillis < sinceMillis || !names.has(q.bestAnswerUid) || leftOut.has(q.bestAnswerUid)) continue;
    points.set(q.bestAnswerUid, (points.get(q.bestAnswerUid) ?? 0) + 1);
  }
  return [...points.entries()]
    .map(([uid, n]) => ({ uid, points: n }))
    .sort((a, b) => b.points - a.points || (names.get(a.uid) ?? '').localeCompare(names.get(b.uid) ?? ''));
}

/** Midnight on the first of this month in the Philippines (UTC+8, no daylight saving), in milliseconds. */
export function manilaMonthStart(nowMillis: number): number {
  const manila = new Date(nowMillis + 8 * 3_600_000);
  return Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), 1) - 8 * 3_600_000;
}
