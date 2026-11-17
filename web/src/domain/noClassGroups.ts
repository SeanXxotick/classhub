/**
 * "No classes" marks shown together: a suspension saved as Mon, Tue and Wed is one entry in the Schedule tab,
 * not three. The database does not record which marks were saved together, so marks are grouped when the same
 * officer gave them the same reason and no class day lies between them unmarked.
 */

export interface GroupableMark {
  id: string;
  /** YYYY-MM-DD */
  dateKey: string;
  courseId: string;
  reason: string;
  createdByUid: string;
}

const nextDay = (dateKey: string) => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Marks grouped in date order. hasClasses tells whether the timetable has any meeting on a date; days without
 * classes (a weekend) do not break a group.
 */
export function groupNoClass<T extends GroupableMark>(marks: T[], hasClasses: (dateKey: string) => boolean): T[][] {
  const sorted = [...marks].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  const groups: T[][] = [];
  for (const mark of sorted) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (group && last.createdByUid === mark.createdByUid && last.reason === mark.reason && onlyEmptyDaysBetween(last.dateKey, mark.dateKey, hasClasses)) {
      group.push(mark);
    } else {
      groups.push([mark]);
    }
  }
  return groups;
}

/** True when every day strictly between the two dates has no classes (or they are the same day or next to each other). */
function onlyEmptyDaysBetween(from: string, to: string, hasClasses: (dateKey: string) => boolean): boolean {
  // At most two weeks apart, so a long gap never joins.
  let day = nextDay(from);
  for (let i = 0; day < to; i++, day = nextDay(day)) {
    if (i > 14 || hasClasses(day)) return false;
  }
  return true;
}
