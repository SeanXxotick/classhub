import { describe, expect, it } from 'vitest';
import { classWeekNumber, earliestAttendanceDate, mondayKey } from './classWeek';

describe('mondayKey', () => {
  it('returns the Monday of any day in a Mon-Sun week', () => {
    expect(mondayKey('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(mondayKey('2026-11-18')).toBe('2026-11-16'); // Wednesday
    expect(mondayKey('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(mondayKey('2026-11-23')).toBe('2026-11-23'); // Next Monday
  });

  it('rejects invalid date keys', () => {
    expect(mondayKey('')).toBeNull();
    expect(mondayKey('2026-02-31')).toBeNull();
    expect(mondayKey('not-a-date')).toBeNull();
  });
});

describe('classWeekNumber', () => {
  it('counts Week 1 for the entire calendar week of the first attendance', () => {
    expect(classWeekNumber('2026-11-16', '2026-11-16')).toBe(1);
    expect(classWeekNumber('2026-11-16', '2026-11-22')).toBe(1);
    // Even if first attendance was on Wednesday, the same Monday-Sunday week is Week 1.
    expect(classWeekNumber('2026-11-18', '2026-11-16')).toBe(1);
    expect(classWeekNumber('2026-11-18', '2026-11-22')).toBe(1);
  });

  it('advances to Week 2 on the following Monday', () => {
    expect(classWeekNumber('2026-11-16', '2026-11-23')).toBe(2);
    expect(classWeekNumber('2026-11-18', '2026-11-23')).toBe(2);
    expect(classWeekNumber('2026-11-18', '2026-11-26')).toBe(2);
    expect(classWeekNumber('2026-11-16', '2026-12-07')).toBe(4);
  });

  it('returns null before Week 1 or when no first attendance exists', () => {
    expect(classWeekNumber(null, '2026-11-26')).toBeNull();
    expect(classWeekNumber('', '2026-11-26')).toBeNull();
    expect(classWeekNumber('2026-11-23', '2026-11-22')).toBeNull();
  });
});

describe('earliestAttendanceDate', () => {
  it('ignores courses with zero taken count and picks the earliest valid date', () => {
    expect(
      earliestAttendanceDate([
        { taken: 0, firstDateKey: '2026-08-01' },
        { taken: 3, firstDateKey: '2026-11-18' },
        { taken: 2, firstDateKey: '2026-11-16' },
      ]),
    ).toBe('2026-11-16');
  });

  it('falls back to full sheets when totals do not yet have firstDateKey', () => {
    expect(
      earliestAttendanceDate(
        [{ taken: 2, firstDateKey: '' }],
        [{ dateKey: '2026-11-20' }, { dateKey: '2026-11-16' }],
      ),
    ).toBe('2026-11-16');
  });

  it('returns null when no attendance has been taken', () => {
    expect(earliestAttendanceDate([], [])).toBeNull();
    expect(earliestAttendanceDate([{ taken: 0, firstDateKey: '' }])).toBeNull();
  });
});
