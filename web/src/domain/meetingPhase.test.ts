import { describe, expect, it } from 'vitest';
import { meetingPhase, phMinutes } from './meetingPhase';

// Monday Nov 16, 2026 in the Philippines (UTC+8), at a given PH clock time.
const ph = (h: number, m = 0) => Date.UTC(2026, 10, 16, h - 8, m);

describe('meetingPhase', () => {
  it('reads the Philippine clock', () => {
    expect(phMinutes(ph(8, 30))).toBe(510);
    expect(phMinutes(ph(0, 5))).toBe(5);
  });

  it('a 7:00 to 8:30 AM class is to come, going on, then over', () => {
    expect(meetingPhase(420, 510, ph(6), ph(6, 59))).toBe('LATER');
    expect(meetingPhase(420, 510, ph(6), ph(7))).toBe('NOW');
    expect(meetingPhase(420, 510, ph(6), ph(8, 29))).toBe('NOW');
    expect(meetingPhase(420, 510, ph(6), ph(8, 30))).toBe('ENDED');
    expect(meetingPhase(420, 510, ph(6), ph(23, 59))).toBe('ENDED');
  });

  it('tomorrow is always to come, even late at night', () => {
    expect(meetingPhase(420, 510, ph(6) + 86_400_000, ph(23))).toBe('LATER');
  });

  it('uses the Philippine day, not the UTC day', () => {
    // 1:00 AM Tuesday in the Philippines is still Monday in UTC.
    const tue1am = Date.UTC(2026, 10, 16, 17);
    expect(meetingPhase(420, 510, ph(6), tue1am)).toBe('LATER');
    expect(meetingPhase(0, 90, tue1am, tue1am)).toBe('NOW');
  });
});
