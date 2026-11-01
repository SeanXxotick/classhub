import { describe, expect, it } from 'vitest';
import { newMember, newScheduleItem, type ScheduleKind, type ScheduleStatus, type StudentProgress } from '../data/models';
import { ScheduleLogic } from './scheduleLogic';
import { ScheduleForms, ScheduleView } from './scheduleView';
import { dayKey, weekday } from './dates';

// Tests run with TZ=Asia/Manila (vite.config.ts), like the Android tests' zone.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0).getTime();

describe('ScheduleLogic', () => {
  const now = at(2026, 10, 18, 20);
  const item = (id: string, due: number, status: ScheduleStatus = 'PENDING') => newScheduleItem({ id, title: id, dueMillis: due, status });

  it('runs in Manila time', () => {
    expect(new Date(at(2026, 10, 18)).getTimezoneOffset()).toBe(-480);
  });

  it('counts calendar days, not hours', () => {
    expect(ScheduleLogic.daysUntil(at(2026, 10, 18, 1), now)).toBe(0);
    expect(ScheduleLogic.daysUntil(at(2026, 10, 19, 1), now)).toBe(1);
    expect(ScheduleLogic.daysUntil(at(2026, 10, 30), now)).toBe(12);
    expect(ScheduleLogic.daysUntil(at(2026, 10, 16), now)).toBe(-2);
  });

  it('upcoming and overdue are personal', () => {
    const items = [
      item('later', at(2026, 10, 30)),
      item('today', at(2026, 10, 18)),
      item('soon', at(2026, 10, 20)),
      item('past', at(2026, 10, 10)),
      item('iFinished', at(2026, 10, 21)),
      item('cancelled', at(2026, 10, 22), 'CANCELLED'),
    ];
    expect(ScheduleLogic.upcoming(items, now, new Set(['iFinished'])).map((i) => i.id)).toEqual(['today', 'soon', 'later']);
    const old = [item('past', at(2026, 10, 10)), item('today', at(2026, 10, 18)), item('pastButDone', at(2026, 10, 9)), item('pastCancelled', at(2026, 10, 8), 'CANCELLED')];
    expect(ScheduleLogic.overdue(old, now, new Set(['pastButDone'])).map((i) => i.id)).toEqual(['past']);
    const report = [item('report', at(2026, 10, 10))];
    expect(ScheduleLogic.overdue(report, now).length).toBe(1);
    expect(ScheduleLogic.overdue(report, now, new Set(['report'])).length).toBe(0);
    const submitted = item('old', at(2026, 10, 20), 'SUBMITTED');
    expect(ScheduleLogic.isOpen(submitted, new Set())).toBe(true);
    expect(ScheduleLogic.isOpen(submitted, new Set(['old']))).toBe(false);
  });

  it('relative labels', () => {
    expect([0, 1, 5, -1, -3].map(ScheduleLogic.relativeLabel)).toEqual(['Today', 'Tomorrow', 'In 5 days', 'Yesterday', '3 days ago']);
  });
});

describe('ScheduleView', () => {
  const now = at(2026, 10, 19, 20); // Monday, October 19, 2026, 8 PM
  const item = (id: string, kind: ScheduleKind, day: number, status: ScheduleStatus = 'PENDING') =>
    newScheduleItem({ id, title: id, kind, dueMillis: at(2026, 10, day), status });
  const items = [
    item('orMidterm', 'EXAM', 20),
    item('sweQuiz', 'QUIZ', 22),
    item('mgAssign', 'DEADLINE', 22),
    item('sweFco', 'FCO', 27),
    item('lateReport', 'DEADLINE', 16),
    item('cancelledRec', 'RECITATION', 21, 'CANCELLED'),
  ];
  const mine = new Set(['mgAssign']);
  const ids = (list: { id: string }[]) => list.map((i) => i.id);

  it('filters', () => {
    expect(ids(ScheduleView.filter(items, 'UPCOMING', now, mine))).toEqual(['orMidterm', 'sweQuiz', 'sweFco']);
    expect(ids(ScheduleView.filter(items, 'OVERDUE', now, mine))).toEqual(['lateReport']);
    expect(ids(ScheduleView.filter(items, 'TESTS', now, mine))).toEqual(['orMidterm', 'cancelledRec', 'sweQuiz']);
    expect(ids(ScheduleView.filter(items, 'DELIVERABLES', now, mine))).toEqual(['lateReport', 'mgAssign', 'sweFco']);
    expect(ids(ScheduleView.filter(items, 'DONE', now, mine))).toEqual(['mgAssign', 'cancelledRec']);
    expect(ScheduleView.filter(items, 'ALL', now, mine).length).toBe(6);
    expect(ScheduleView.filter(items, 'ALL', now, mine)[0].id).toBe('lateReport');
  });

  it('days, weeks and months', () => {
    expect(new Set(ids(ScheduleView.onDay(items, dayKey(2026, 10, 22))))).toEqual(new Set(['sweQuiz', 'mgAssign']));
    const week = ScheduleView.weekOf(dayKey(2026, 10, 21));
    expect([week.length, week[0], weekday(week[0]), week[6]]).toEqual([7, '2026-10-18', 0, '2026-10-24']);
    expect(ScheduleView.weekOf(dayKey(2026, 10, 18))[0]).toBe('2026-10-18');
    const october = ScheduleView.monthGrid(2026, 10);
    expect(october.length).toBe(35);
    expect(october.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
    expect(october[34]).toBe('2026-10-31');
    const february = ScheduleView.monthGrid(2026, 2);
    expect([february.length, february[0], february.every((d) => d !== null)]).toEqual([28, '2026-02-01', true]);
    const november = ScheduleView.monthGrid(2026, 11);
    expect([november.length, november[29], november[34]]).toEqual([35, '2026-11-30', null]);
  });

  it('open items per day', () => {
    const counts = ScheduleView.openByDay(items, mine);
    expect(counts.get('2026-10-22')).toBe(1);
    expect(counts.get('2026-10-21')).toBeUndefined();
    const busy = [
      item('d1', 'DEADLINE', 23),
      item('q1', 'QUIZ', 23),
      item('e1', 'EXAM', 23),
      item('f1', 'FCO', 23),
      item('doneExam', 'EXAM', 23),
      item('cancelled', 'RECITATION', 23, 'CANCELLED'),
    ];
    expect(ScheduleView.openKindsByDay(busy, new Set(['doneExam'])).get('2026-10-23')).toEqual(['EXAM', 'FCO', 'QUIZ', 'DEADLINE']);
    const kinds = ScheduleView.openKindsByDay(items, mine);
    expect(kinds.get('2026-10-21')).toBeUndefined();
    expect(kinds.get('2026-10-22')).toEqual(['QUIZ']);
  });

  it('labels and overdue', () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(ScheduleView.dueLabel(byId.get('orMidterm')!, now)).toBe('Tomorrow');
    expect(ScheduleView.dueLabel(byId.get('sweQuiz')!, now)).toBe('In 3 days');
    expect(ScheduleView.dueLabel(byId.get('lateReport')!, now)).toBe('Overdue');
    expect(ScheduleView.dueLabel(byId.get('lateReport')!, now, true)).toBe('Done');
    expect(ScheduleView.dueLabel(byId.get('cancelledRec')!, now, true)).toBe('Cancelled');
    expect(ScheduleView.isOverdue(byId.get('lateReport')!, now)).toBe(true);
    expect(ScheduleView.isOverdue(byId.get('lateReport')!, now, true)).toBe(false);
    expect(ScheduleView.isOverdue(byId.get('orMidterm')!, now)).toBe(false);
  });

  it('completion splits the class by who marked it done', () => {
    const members = [newMember({ id: 'u2', name: 'Lito' }), newMember({ id: 'u1', name: 'Ana' }), newMember({ id: 'u3', name: 'Kim' })];
    const progress: StudentProgress[] = [
      { id: 'u1', done: { sweQuiz: 1, mgAssign: 2 } },
      { id: 'u3', done: { mgAssign: 3 } },
      { id: 'someoneWhoLeft', done: { sweQuiz: 4 } },
    ];
    const summary = ScheduleView.completion('sweQuiz', members, progress);
    expect(summary.done.map((m) => m.name)).toEqual(['Ana']);
    expect(summary.notDone.map((m) => m.name)).toEqual(['Kim', 'Lito']);
    expect(summary.total).toBe(3);
  });

  it('form needs a short title', () => {
    expect(ScheduleForms.check('  ')).not.toBeNull();
    expect(ScheduleForms.check('x'.repeat(81))).not.toBeNull();
    expect(ScheduleForms.check('Midterm Exam')).toBeNull();
  });
});
