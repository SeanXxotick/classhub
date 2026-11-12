import { describe, expect, it } from 'vitest';
import { attendanceExportSheets } from './attendanceExport';

const courses = [
  { id: 'or', name: 'Operations Research' },
  { id: 'se', name: 'Software Engineering' },
  { id: 'aa', name: 'Abstract Algebra' },
];
const students = [
  { id: 'ana', name: 'Lim, Ana', excludedCourseIds: [] },
  { id: 'paolo', name: 'Garcia, Paolo', excludedCourseIds: ['se'] },
];
const sheet = (courseId: string, dateKey: string, absent: string[], late: string[]) => ({ courseId, dateKey, absent, late });

describe('attendanceExportSheets', () => {
  it('has a column per day in date order, with 1 for present, 0 for absent and L for late', () => {
    const out = attendanceExportSheets(courses, students, [
      sheet('or', '2026-07-08', ['ana'], []),
      sheet('or', '2026-07-01', [], ['ana']),
      sheet('or', '2026-07-15', ['ana'], ['paolo']),
    ]);
    expect(out).toEqual([
      {
        name: 'Operations Research',
        rows: [
          ['Name', 'Summary', '07/01/26', '07/08/26', '07/15/26'],
          ['Lim, Ana', 1, 'L', 0, 0],
          ['Garcia, Paolo', 3, 1, 1, 'L'],
        ],
      },
    ]);
  });

  it('gives one sheet per course that has attendance, in the order given', () => {
    const out = attendanceExportSheets(courses, students, [sheet('aa', '2026-07-02', [], []), sheet('or', '2026-07-01', [], [])]);
    expect(out.map((s) => s.name)).toEqual(['Operations Research', 'Abstract Algebra']);
  });

  it('leaves out students who do not take the course, even if they have marks', () => {
    const out = attendanceExportSheets(courses, students, [sheet('se', '2026-07-02', ['paolo'], [])]);
    expect(out[0].rows).toEqual([['Name', 'Summary', '07/02/26'], ['Lim, Ana', 1, 1]]);
  });

  it('counts a student marked both absent and late on one day as absent', () => {
    const out = attendanceExportSheets(courses, students, [sheet('aa', '2026-07-03', ['ana'], ['ana'])]);
    expect(out[0].rows[1]).toEqual(['Lim, Ana', 0, 0]);
  });

  it('is empty when no attendance was taken', () => {
    expect(attendanceExportSheets(courses, students, [])).toEqual([]);
  });
});
