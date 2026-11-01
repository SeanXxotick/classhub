import type { Member, ScheduleItem, ScheduleKind, StudentProgress } from '../data/models';
import { dayKey, dayOf, daysInMonth, plusDays, weekday, type DayKey } from './dates';
import { ScheduleLogic } from './scheduleLogic';
import { sortByName } from './classRules';

export const SCHEDULE_FILTERS = [
  { id: 'UPCOMING', label: 'Upcoming' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'TESTS', label: 'Quizzes and exams' },
  { id: 'DELIVERABLES', label: 'Deliverables' },
  { id: 'DONE', label: 'Done' },
  { id: 'ALL', label: 'All' },
] as const;
export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number]['id'];

/** Who has and has not marked an item done. */
export interface CompletionSummary {
  done: Member[];
  notDone: Member[];
  total: number;
}

const TEST_KINDS = new Set<ScheduleKind>(['QUIZ', 'EXAM', 'RECITATION']);
const DELIVERABLE_KINDS = new Set<ScheduleKind>(['DEADLINE', 'FCO']);
const soonestFirst = (list: ScheduleItem[]) => [...list].sort((a, b) => a.dueMillis - b.dueMillis);

export const ScheduleView = {
  /**
   * Applies a filter chip for the signed-in student (doneIds are the items they marked done).
   * Done lists their finished items and cancelled ones, newest first; everything else is soonest first.
   */
  filter(items: ScheduleItem[], filter: ScheduleFilter, nowMillis: number, doneIds: Set<string> = new Set()): ScheduleItem[] {
    switch (filter) {
      case 'UPCOMING':
        return ScheduleLogic.upcoming(items, nowMillis, doneIds);
      case 'OVERDUE':
        return ScheduleLogic.overdue(items, nowMillis, doneIds);
      case 'TESTS':
        return soonestFirst(items.filter((it) => TEST_KINDS.has(it.kind)));
      case 'DELIVERABLES':
        return soonestFirst(items.filter((it) => DELIVERABLE_KINDS.has(it.kind)));
      case 'DONE':
        return items.filter((it) => !ScheduleLogic.isOpen(it, doneIds)).sort((a, b) => b.dueMillis - a.dueMillis);
      case 'ALL':
        return soonestFirst(items);
    }
  },

  /** Items due on the day. */
  onDay(items: ScheduleItem[], day: DayKey): ScheduleItem[] {
    return soonestFirst(items.filter((it) => dayOf(it.dueMillis) === day));
  },

  /** The Sunday-to-Saturday week containing the day. */
  weekOf(day: DayKey): DayKey[] {
    const sunday = plusDays(day, -weekday(day));
    return [0, 1, 2, 3, 4, 5, 6].map((i) => plusDays(sunday, i));
  },

  /**
   * The days of the month laid out Sunday to Saturday. Cells before the 1st and after the last day
   * are null, so the list splits evenly into weeks of 7.
   */
  monthGrid(year: number, month: number): (DayKey | null)[] {
    const lead = weekday(dayKey(year, month, 1));
    const cells: (DayKey | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(dayKey(year, month, d));
    return cells.concat(Array((7 - (cells.length % 7)) % 7).fill(null));
  },

  /** How many items this student still has open on each day. */
  openByDay(items: ScheduleItem[], doneIds: Set<string> = new Set()): Map<DayKey, number> {
    const counts = new Map<DayKey, number>();
    for (const it of items) {
      if (!ScheduleLogic.isOpen(it, doneIds)) continue;
      const day = dayOf(it.dueMillis);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return counts;
  },

  /** Which kind shows first when a day has several items: exams matter most, plain deliverables least. */
  KIND_PRIORITY: ['EXAM', 'FCO', 'QUIZ', 'RECITATION', 'DEADLINE'] as ScheduleKind[],

  /** The kinds of this student's open items on each day, most important first, one entry per item. */
  openKindsByDay(items: ScheduleItem[], doneIds: Set<string> = new Set()): Map<DayKey, ScheduleKind[]> {
    const byDay = new Map<DayKey, ScheduleKind[]>();
    for (const it of items) {
      if (!ScheduleLogic.isOpen(it, doneIds)) continue;
      const day = dayOf(it.dueMillis);
      const list = byDay.get(day);
      if (list) list.push(it.kind);
      else byDay.set(day, [it.kind]);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => ScheduleView.KIND_PRIORITY.indexOf(a) - ScheduleView.KIND_PRIORITY.indexOf(b));
    }
    return byDay;
  },

  /** The tag shown on an item: "Cancelled", "Done", "Overdue", "Today", "Tomorrow" or "In 5 days". */
  dueLabel(item: ScheduleItem, nowMillis: number, done = false): string {
    if (ScheduleLogic.isCancelled(item)) return 'Cancelled';
    if (done) return 'Done';
    const days = ScheduleLogic.daysUntil(item.dueMillis, nowMillis);
    return days < 0 ? 'Overdue' : ScheduleLogic.relativeLabel(days);
  },

  isOverdue(item: ScheduleItem, nowMillis: number, done = false): boolean {
    return !done && !ScheduleLogic.isCancelled(item) && ScheduleLogic.daysUntil(item.dueMillis, nowMillis) < 0;
  },

  /** Splits the class into who marked the item done and who has not, each sorted by name. */
  completion(itemId: string, members: Member[], progress: StudentProgress[]): CompletionSummary {
    const doneUids = new Set(progress.filter((p) => itemId in p.done).map((p) => p.id));
    const sorted = sortByName(members);
    const done = sorted.filter((m) => doneUids.has(m.id));
    const notDone = sorted.filter((m) => !doneUids.has(m.id));
    return { done, notDone, total: done.length + notDone.length };
  },
};

export const ScheduleForms = {
  MAX_TITLE: 80,

  check(title: string): string | null {
    if (!title.trim()) return 'Give it a title, for example "Midterm Exam" or "Assignment #3".';
    if (title.trim().length > ScheduleForms.MAX_TITLE) return `Keep the title under ${ScheduleForms.MAX_TITLE} characters.`;
    return null;
  },
};
