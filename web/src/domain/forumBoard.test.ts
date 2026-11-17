import { describe, expect, it } from 'vitest';
import { manilaMonthStart, topHelpers } from './forumBoard';

const members = [
  { id: 'kim', name: 'Navarro, Kim' },
  { id: 'mika', name: 'Cruz, Mika' },
  { id: 'ben', name: 'Reyes, Ben' },
];
const q = (bestAnswerUid: string, pickedAtMillis = 100) => ({ bestAnswerUid, pickedAtMillis });

describe('topHelpers', () => {
  it('gives one point per best answer, most first, ties by name', () => {
    expect(topHelpers([q('kim'), q('mika'), q('kim'), q('ben'), q('')], members, new Set(), 0)).toEqual([
      { uid: 'kim', points: 2 },
      { uid: 'mika', points: 1 },
      { uid: 'ben', points: 1 },
    ]);
  });

  it('counts only picks since the given time', () => {
    expect(topHelpers([q('kim', 50), q('mika', 150)], members, new Set(), 100)).toEqual([{ uid: 'mika', points: 1 }]);
  });

  it('leaves out former members and those who chose to be left out', () => {
    expect(topHelpers([q('gone'), q('kim'), q('mika')], members, new Set(['mika']), 0)).toEqual([{ uid: 'kim', points: 1 }]);
  });
});

describe('manilaMonthStart', () => {
  it('is midnight on the 1st in Manila, even when it is still the previous month in UTC', () => {
    // 2026-12-01 03:00 in Manila is 2026-11-30 19:00 UTC.
    expect(manilaMonthStart(Date.UTC(2026, 10, 30, 19))).toBe(Date.UTC(2026, 10, 30, 16));
    expect(new Date(manilaMonthStart(Date.UTC(2026, 10, 17, 5))).toISOString()).toBe('2026-10-31T16:00:00.000Z');
  });
});
