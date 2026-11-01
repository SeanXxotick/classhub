import type { ScheduleItem } from '../data/models';
import { dayOf, daysBetween } from './dates';

/**
 * Deadlines are shared by the class, but finishing them is personal: each student marks items done
 * for themselves. doneIds is the signed-in student's own set of finished item ids.
 * At class level an item is only active or cancelled (an older "submitted" status counts as active).
 */
export const ScheduleLogic = {
  /** Whole calendar days from now to the due date. Negative when the date has passed. */
  daysUntil(dueMillis: number, nowMillis: number): number {
    return daysBetween(dayOf(nowMillis), dayOf(dueMillis));
  },

  isCancelled(item: ScheduleItem): boolean {
    return item.status === 'CANCELLED';
  },

  /** Still to do for this student: not cancelled for the class and not marked done by them. */
  isOpen(item: ScheduleItem, doneIds: Set<string>): boolean {
    return !ScheduleLogic.isCancelled(item) && !doneIds.has(item.id);
  },

  /** Open items due today or later, soonest first. */
  upcoming(items: ScheduleItem[], nowMillis: number, doneIds: Set<string> = new Set()): ScheduleItem[] {
    return items
      .filter((it) => ScheduleLogic.isOpen(it, doneIds) && ScheduleLogic.daysUntil(it.dueMillis, nowMillis) >= 0)
      .sort((a, b) => a.dueMillis - b.dueMillis);
  },

  /** Open items whose date has already passed. */
  overdue(items: ScheduleItem[], nowMillis: number, doneIds: Set<string> = new Set()): ScheduleItem[] {
    return items
      .filter((it) => ScheduleLogic.isOpen(it, doneIds) && ScheduleLogic.daysUntil(it.dueMillis, nowMillis) < 0)
      .sort((a, b) => a.dueMillis - b.dueMillis);
  },

  /** "Today", "Tomorrow", "In 5 days", "3 days ago" */
  relativeLabel(days: number): string {
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days > 1) return `In ${days} days`;
    if (days === -1) return 'Yesterday';
    return `${-days} days ago`;
  },
};
