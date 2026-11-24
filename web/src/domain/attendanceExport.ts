/**
 * The class attendance export: a sheet per course, a line per student and a column per day attendance was
 * taken. A cell is 1 for present, 0 for absent, L for late and E for excused; Summary counts the days attended
 * (present or late). A meeting cancelled with a "No classes" mark gets its own column of NC, which never counts.
 * When attendance was still taken on a cancelled day, the recorded marks show and the date says "(NC)".
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
  /** Irregular students are excluded from general (non-course) one-time event sheets. */
  irregular?: boolean;
}

export interface ExportSheet {
  courseId: string;
  /** YYYY-MM-DD */
  dateKey: string;
  /** Event title for general (non-course) one-time meetings. */
  eventTitle?: string;
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

/** A weekly or one-time meeting in the timetable. dayOfWeek 0 is Sunday. */
export interface ExportMeeting {
  courseId: string;
  dayOfWeek: number;
  /** Set for one-time meetings so they do not count as meeting every week. */
  dateKey?: string;
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
 * on a weekday the course meets (or on a one-time meeting's exact date). Days when attendance was still taken
 * are left out, so what was recorded shows.
 */
export function cancelledDays(courseId: string, takenKeys: Set<string>, c: ExportCancellations): string[] {
  const courseMeetings = c.meetings.filter((m) => m.courseId === courseId);
  const meetsOn = new Set(courseMeetings.filter((m) => !m.dateKey).map((m) => m.dayOfWeek));
  const oneTimeDates = new Set(courseMeetings.filter((m) => m.dateKey).map((m) => m.dateKey!));
  const days = c.noClass
    .filter((k) => k.dateKey <= c.todayKey && !takenKeys.has(k.dateKey))
    .filter((k) => k.courseId === courseId || (!k.courseId && (meetsOn.has(weekdayOf(k.dateKey)) || oneTimeDates.has(k.dateKey))))
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
  const courseSheets = courses.flatMap((course) => {
    const taken = sheets.filter((s) => s.courseId === course.id);
    const takers = students.filter((s) => !s.excludedCourseIds.includes(course.id));
    if (taken.length === 0 || takers.length === 0) return [];
    const cancelled = cancelledDays(course.id, new Set(taken.map((s) => s.dateKey)), cancellations);
    const markedNoClass = new Set(cancelledDays(course.id, new Set(), cancellations));
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
    const header = columns.map((c) => (c.sheet && markedNoClass.has(c.dateKey) ? `${shortDate(c.dateKey)} (NC)` : shortDate(c.dateKey)));
    return [{ name: course.name, rows: [['Name', 'Summary', ...header], ...rows, [], [LEGEND]] }];
  });

  // Separate sheets for general (non-course) one-time meetings, listing regular block members.
  const knownCourseIds = new Set(courses.map((c) => c.id));
  const extraIds = [...new Set(sheets.map((s) => s.courseId).filter((id) => id && !knownCourseIds.has(id)))];
  const blockStudents = students.filter((s) => !s.irregular);
  const eventSheets = extraIds.flatMap((eventId) => {
    const taken = sheets.filter((s) => s.courseId === eventId).sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
    if (taken.length === 0 || blockStudents.length === 0) return [];
    const sheetName = taken.find((s) => s.eventTitle)?.eventTitle || 'One-time meeting';
    const rows = blockStudents.map((student) => {
      const marks = taken.map((s) =>
        s.absent.includes(student.id) ? 0 : (s.excused ?? []).includes(student.id) ? EXCUSED_MARK : s.late.includes(student.id) ? LATE_MARK : 1,
      );
      return [student.name, marks.filter((m) => m === 1 || m === LATE_MARK).length, ...marks];
    });
    const header = taken.map((s) => shortDate(s.dateKey));
    return [{ name: sheetName, rows: [['Name', 'Summary', ...header], ...rows, [], [LEGEND]] }];
  });

  return [...courseSheets, ...eventSheets];
}

/** A timetable meeting with its id and end time, for finding classes whose attendance was never taken. */
export interface UntakenMeeting {
  id: string;
  courseId: string;
  dayOfWeek: number;
  endMinutes: number;
  dateKey?: string;
  takeAttendance?: boolean;
}

/** One class meeting on one day with no attendance sheet. */
export interface Untaken {
  dateKey: string;
  meetingId: string;
  courseId: string;
}

const addDay = (dateKey: string, n: number) => new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(5, 7) - 1, +dateKey.slice(8, 10) + n)).toISOString().slice(0, 10);

/**
 * Class meetings from the first day attendance was ever taken up to now that have no sheet, leaving out
 * meetings marked "No classes" (the whole day or that course). Today's meetings count once they have ended.
 * Earliest first. Empty when attendance was never taken.
 */
export function untakenMeetings(
  meetings: UntakenMeeting[],
  sheets: { dateKey: string; meetingId: string }[],
  noClass: ExportNoClass[],
  todayKey: string,
  nowMinutes: number,
): Untaken[] {
  if (sheets.length === 0) return [];
  const taken = new Set(sheets.map((s) => `${s.dateKey}|${s.meetingId}`));
  const off = (day: string, courseId: string) => noClass.some((k) => k.dateKey === day && (!k.courseId || (!!courseId && k.courseId === courseId)));
  const out: Untaken[] = [];
  let day = sheets.reduce((min, s) => (s.dateKey < min ? s.dateKey : min), sheets[0].dateKey);
  for (; day <= todayKey; day = addDay(day, 1)) {
    for (const m of meetings) {
      if (m.dateKey && m.takeAttendance === false) continue;
      if (m.dateKey ? m.dateKey !== day : m.dayOfWeek !== weekdayOf(day)) continue;
      if (day === todayKey && m.endMinutes > nowMinutes) continue;
      if (taken.has(`${day}|${m.id}`) || off(day, m.courseId)) continue;
      out.push({ dateKey: day, meetingId: m.id, courseId: m.courseId || `event_${m.id}` });
    }
  }
  return out;
}
