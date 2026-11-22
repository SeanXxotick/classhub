import { describe, expect, it } from 'vitest';
import { LEGEND, attendanceExportSheets, untakenMeetings } from './attendanceExport';

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
/** The rows without the blank line and legend at the end. */
const table = (rows: (string | number)[][]) => rows.slice(0, -2);

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
          [],
          [LEGEND],
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
    expect(table(out[0].rows)).toEqual([['Name', 'Summary', '07/02/26'], ['Lim, Ana', 1, 1]]);
  });

  it('counts a student marked both absent and late on one day as absent', () => {
    const out = attendanceExportSheets(courses, students, [sheet('aa', '2026-07-03', ['ana'], ['ana'])]);
    expect(table(out[0].rows)[1]).toEqual(['Lim, Ana', 0, 0]);
  });

  it('marks excused days E, which do not count as attended, and reads sheets saved before Excused existed', () => {
    const out = attendanceExportSheets(courses, students, [
      { ...sheet('or', '2026-07-01', [], []), excused: ['ana'] },
      sheet('or', '2026-07-08', [], ['ana']),
      { ...sheet('or', '2026-07-15', ['paolo'], []), excused: ['paolo'] },
    ]);
    expect(table(out[0].rows)).toEqual([
      ['Name', 'Summary', '07/01/26', '07/08/26', '07/15/26'],
      ['Lim, Ana', 2, 'E', 'L', 1],
      ['Garcia, Paolo', 2, 1, 1, 0],
    ]);
  });

  it('adds an NC column for each cancelled meeting up to today, which is not counted', () => {
    // OR meets on Wednesdays (3) and Fridays (5). 2026-07-01 and 2026-07-08 are Wednesdays, 2026-07-10 a Friday.
    const out = attendanceExportSheets(courses, students, [sheet('or', '2026-07-01', [], []), sheet('or', '2026-07-15', ['paolo'], [])], {
      meetings: [
        { courseId: 'or', dayOfWeek: 3 },
        { courseId: 'or', dayOfWeek: 5 },
        { courseId: 'se', dayOfWeek: 2 },
      ],
      noClass: [
        { dateKey: '2026-07-08', courseId: '' }, // whole day, OR meets: NC
        { dateKey: '2026-07-10', courseId: 'or' }, // OR only: NC
        { dateKey: '2026-07-09', courseId: '' }, // whole day, but OR does not meet on Thursdays
        { dateKey: '2026-07-07', courseId: 'se' }, // another course
        { dateKey: '2026-07-22', courseId: '' }, // after today
      ],
      todayKey: '2026-07-20',
    });
    expect(out[0].rows).toEqual([
      ['Name', 'Summary', '07/01/26', '07/08/26', '07/10/26', '07/15/26'],
      ['Lim, Ana', 2, 1, 'NC', 'NC', 1],
      ['Garcia, Paolo', 1, 1, 'NC', 'NC', 0],
      [],
      [LEGEND],
    ]);
  });

  it('keeps the recorded attendance when it was taken on a cancelled day, and lists a day marked twice once', () => {
    const out = attendanceExportSheets(courses, students, [sheet('or', '2026-07-01', ['ana'], [])], {
      meetings: [{ courseId: 'or', dayOfWeek: 3 }],
      noClass: [
        { dateKey: '2026-07-01', courseId: '' },
        { dateKey: '2026-07-08', courseId: '' },
        { dateKey: '2026-07-08', courseId: 'or' },
      ],
      todayKey: '2026-07-20',
    });
    expect(table(out[0].rows)).toEqual([
      ['Name', 'Summary', '07/01/26 (NC)', '07/08/26'],
      ['Lim, Ana', 0, 0, 'NC'],
      ['Garcia, Paolo', 1, 1, 'NC'],
    ]);
  });

  it('is empty when no attendance was taken', () => {
    expect(attendanceExportSheets(courses, students, [])).toEqual([]);
  });
});

describe('untakenMeetings', () => {
  // 2026-07-01 is a Wednesday. OR meets Wednesdays (ends 10:00), SE meets Wednesdays (ends 15:00) and Fridays.
  const meetings = [
    { id: 'orW', courseId: 'or', dayOfWeek: 3, endMinutes: 600 },
    { id: 'seW', courseId: 'se', dayOfWeek: 3, endMinutes: 900 },
    { id: 'seF', courseId: 'se', dayOfWeek: 5, endMinutes: 600 },
  ];

  it('lists meetings without a sheet since the first sheet, earliest first', () => {
    const out = untakenMeetings(meetings, [{ dateKey: '2026-07-01', meetingId: 'orW' }], [], '2026-07-03', 24 * 60);
    expect(out).toEqual([
      { dateKey: '2026-07-01', meetingId: 'seW', courseId: 'se' },
      { dateKey: '2026-07-03', meetingId: 'seF', courseId: 'se' },
    ]);
  });

  it('leaves out No classes days, for the whole day or one course', () => {
    const sheets = [{ dateKey: '2026-07-01', meetingId: 'orW' }];
    const noClass = [
      { dateKey: '2026-07-01', courseId: 'se' },
      { dateKey: '2026-07-08', courseId: '' },
    ];
    expect(untakenMeetings(meetings, sheets, noClass, '2026-07-08', 24 * 60)).toEqual([{ dateKey: '2026-07-03', meetingId: 'seF', courseId: 'se' }]);
  });

  it('counts a meeting today only once it has ended', () => {
    const sheets = [{ dateKey: '2026-07-01', meetingId: 'orW' }, { dateKey: '2026-07-01', meetingId: 'seW' }, { dateKey: '2026-07-03', meetingId: 'seF' }];
    expect(untakenMeetings(meetings, sheets, [], '2026-07-08', 700)).toEqual([{ dateKey: '2026-07-08', meetingId: 'orW', courseId: 'or' }]);
  });

  it('is empty when attendance was never taken', () => {
    expect(untakenMeetings(meetings, [], [], '2026-07-08', 0)).toEqual([]);
  });
});
