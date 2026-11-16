/**
 * The class attendance export: a sheet per course, a line per student and a column per day attendance was
 * taken. A cell is 1 for present, 0 for absent, L for late and E for excused; Summary counts the days attended
 * (present or late). A meeting cancelled with a "No classes" mark gets its own column of NC, which never counts.
 */

export interface ExportCourse {
  id: string;
  name: string;
}

export interface ExportStudent {
  id: string;
  /** As it should appear in the file, for example "Garcia, Paolo". */
  name: string;
  excludedCourseIds: string[];
}

export interface ExportSheet {
  courseId: string;
  /** YYYY-MM-DD */
  dateKey: string;
  absent: string[];
  late: string[];
  /** Missing on sheets saved before Excused existed. */
  excused?: string[];
}

/** A "No classes" mark: a whole day (courseId empty) or one course on one day. */
export interface ExportNoClass {
  /** YYYY-MM-DD */
  dateKey: string;
  courseId: string;
}

/** A weekly meeting in the timetable. dayOfWeek 0 is Sunday. */
export interface ExportMeeting {
  courseId: string;
  dayOfWeek: number;
}

export interface ExportCancellations {
  noClass: ExportNoClass[];
  meetings: ExportMeeting[];
  /** Today, YYYY-MM-DD in Philippine time. Later marks are left out: those meetings have not happened yet. */
  todayKey: string;
}

export const LATE_MARK = 'L';
export const EXCUSED_MARK = 'E';
export const NO_CLASS_MARK = 'NC';
export const LEGEND = '1 present, 0 absent, L late, E excused, NC no classes (not counted)';

/** "2026-07-01" as "07/01/26". */
const shortDate = (dateKey: string) => `${dateKey.slice(5, 7)}/${dateKey.slice(8, 10)}/${dateKey.slice(2, 4)}`;

/** 0 (Sunday) to 6, for a YYYY-MM-DD date. */
const weekdayOf = (dateKey: string) => new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(5, 7) - 1, +dateKey.slice(8, 10))).getUTCDay();

/**
 * The days up to today on which this course was cancelled: a mark for the course itself, or a whole-day mark
 * on a weekday the course meets. Days when attendance was still taken are left out, so what was recorded shows.
 */
export function cancelledDays(courseId: string, takenKeys: Set<string>, c: ExportCancellations): string[] {
  const meetsOn = new Set(c.meetings.filter((m) => m.courseId === courseId).map((m) => m.dayOfWeek));
  const days = c.noClass
    .filter((k) => k.dateKey <= c.todayKey && !takenKeys.has(k.dateKey))
    .filter((k) => k.courseId === courseId || (!k.courseId && meetsOn.has(weekdayOf(k.dateKey))))
    .map((k) => k.dateKey);
  return [...new Set(days)];
}

/**
 * One sheet per course, in the order given, for courses whose attendance was taken at least once. Only the
 * students who take the course are listed, in the order given. Days run from the earliest to the latest,
 * cancelled days included, and a legend line follows the table.
 */
export function attendanceExportSheets(
  courses: ExportCourse[],
  students: ExportStudent[],
  sheets: ExportSheet[],
  cancellations: ExportCancellations = { noClass: [], meetings: [], todayKey: '' },
): { name: string; rows: (string | number)[][] }[] {
  return courses.flatMap((course) => {
    const taken = sheets.filter((s) => s.courseId === course.id);
    const takers = students.filter((s) => !s.excludedCourseIds.includes(course.id));
    if (taken.length === 0 || takers.length === 0) return [];
    const cancelled = cancelledDays(course.id, new Set(taken.map((s) => s.dateKey)), cancellations);
    // Each column is a day: an attendance sheet, or null for a cancelled day.
    const columns = [...taken.map((s) => ({ dateKey: s.dateKey, sheet: s as ExportSheet | null })), ...cancelled.map((dateKey) => ({ dateKey, sheet: null }))].sort(
      (a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0),
    );
    const rows = takers.map((student) => {
      // A student marked more than one way on one day counts as absent, then excused, then late.
      const marks = columns.map(({ sheet: s }) =>
        !s ? NO_CLASS_MARK : s.absent.includes(student.id) ? 0 : (s.excused ?? []).includes(student.id) ? EXCUSED_MARK : s.late.includes(student.id) ? LATE_MARK : 1,
      );
      return [student.name, marks.filter((m) => m === 1 || m === LATE_MARK).length, ...marks];
    });
    return [{ name: course.name, rows: [['Name', 'Summary', ...columns.map((c) => shortDate(c.dateKey))], ...rows, [], [LEGEND]] }];
  });
}
