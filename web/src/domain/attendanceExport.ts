/**
 * The class attendance export: a sheet per course, a line per student and a column per day attendance was
 * taken. A cell is 1 for present, 0 for absent and L for late; Summary counts the days attended.
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
}

export const LATE_MARK = 'L';

/** "2026-07-01" as "07/01/26". */
const shortDate = (dateKey: string) => `${dateKey.slice(5, 7)}/${dateKey.slice(8, 10)}/${dateKey.slice(2, 4)}`;

/**
 * One sheet per course, in the order given, for courses whose attendance was taken at least once. Only the
 * students who take the course are listed, in the order given. Days run from the earliest to the latest.
 */
export function attendanceExportSheets(courses: ExportCourse[], students: ExportStudent[], sheets: ExportSheet[]): { name: string; rows: (string | number)[][] }[] {
  return courses.flatMap((course) => {
    const taken = sheets.filter((s) => s.courseId === course.id).sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
    const takers = students.filter((s) => !s.excludedCourseIds.includes(course.id));
    if (taken.length === 0 || takers.length === 0) return [];
    const rows = takers.map((student) => {
      // A student marked both ways on one day counts as absent.
      const marks = taken.map((s) => (s.absent.includes(student.id) ? 0 : s.late.includes(student.id) ? LATE_MARK : 1));
      return [student.name, marks.filter((m) => m !== 0).length, ...marks];
    });
    return [{ name: course.name, rows: [['Name', 'Summary', ...taken.map((s) => shortDate(s.dateKey))], ...rows] }];
  });
}
