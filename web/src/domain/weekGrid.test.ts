import { describe, expect, it } from 'vitest';
import { courseShortName, layoutWeek } from './weekGrid';

const m = (id: string, dayOfWeek: number, startMinutes: number, endMinutes: number) => ({ id, dayOfWeek, startMinutes, endMinutes });

describe('layoutWeek', () => {
  it('shows only days with meetings, Monday first and Sunday last', () => {
    const week = layoutWeek([m('a', 0, 480, 540), m('b', 3, 480, 540), m('c', 1, 480, 540)]);
    expect(week.days).toEqual([1, 3, 0]);
  });

  it('runs from the earliest start to the latest end, in whole hours', () => {
    const week = layoutWeek([m('a', 1, 450, 540), m('b', 2, 780, 870)]);
    expect([week.fromMinutes, week.toMinutes]).toEqual([420, 900]);
  });

  it('gives meetings that do not overlap the full width', () => {
    const week = layoutWeek([m('a', 1, 480, 570), m('b', 1, 570, 660)]);
    expect(week.byDay[1].map((b) => [b.lane, b.lanes])).toEqual([[0, 1], [0, 1]]);
  });

  it('puts clashing meetings side by side', () => {
    const week = layoutWeek([m('a', 1, 480, 570), m('b', 1, 540, 630), m('c', 1, 600, 660), m('d', 1, 720, 780)]);
    const lanes = Object.fromEntries(week.byDay[1].map((b) => [b.item.id, [b.lane, b.lanes]]));
    expect(lanes).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });

  it('still draws a meeting whose end is not after its start', () => {
    const week = layoutWeek([m('a', 1, 600, 600)]);
    expect(week.byDay[1][0].endMinutes).toBe(630);
    expect(week.toMinutes).toBe(660);
  });

  it('is empty for no meetings', () => {
    expect(layoutWeek([])).toEqual({ days: [], fromMinutes: 0, toMinutes: 0, byDay: {} });
  });
});

describe('courseShortName', () => {
  it('uses initials for several words and skips small words', () => {
    expect(courseShortName('Operations Research')).toBe('OR');
    expect(courseShortName('Theory of Computation')).toBe('TC');
    expect(courseShortName('Calculus 2')).toBe('C2');
  });

  it('leaves out a course code in brackets', () => {
    expect(courseShortName('Specialization 1 DBA (IT 304D)')).toBe('S1D');
    expect(courseShortName('System Analysis and Design (IT 303*)')).toBe('SAD');
    expect(courseShortName('The Entrepreneurial Mind (SSP 101d)')).toBe('EM');
    expect(courseShortName('(CC107)')).toBe('CC107');
  });

  it('shortens a single word', () => {
    expect(courseShortName('Statistics')).toBe('Stat');
    expect(courseShortName('PE')).toBe('PE');
  });
});
