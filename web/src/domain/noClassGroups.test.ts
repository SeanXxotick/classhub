import { describe, expect, it } from 'vitest';
import { groupNoClass } from './noClassGroups';

// Classes on weekdays only: 2026-11-21 and 2026-11-22 are a Saturday and a Sunday.
const weekdays = (dateKey: string) => {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
};
const mark = (id: string, dateKey: string, reason = 'Class suspension', createdByUid = 'mayor', courseId = '') => ({ id, dateKey, courseId, reason, createdByUid });
const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((m) => m.id));

describe('groupNoClass', () => {
  it('joins days in a row with the same reason and officer, in date order', () => {
    expect(ids(groupNoClass([mark('c', '2026-11-25'), mark('a', '2026-11-23'), mark('b', '2026-11-24')], weekdays))).toEqual([['a', 'b', 'c']]);
  });

  it('joins across a weekend without classes, but not across a class day left unmarked', () => {
    expect(ids(groupNoClass([mark('fri', '2026-11-20'), mark('mon', '2026-11-23')], weekdays))).toEqual([['fri', 'mon']]);
    expect(ids(groupNoClass([mark('mon', '2026-11-16'), mark('wed', '2026-11-18')], weekdays))).toEqual([['mon'], ['wed']]);
  });

  it('keeps marks apart when the reason or the officer differs', () => {
    expect(ids(groupNoClass([mark('a', '2026-11-23', 'Holiday'), mark('b', '2026-11-24', 'Class suspension')], weekdays))).toEqual([['a'], ['b']]);
    expect(ids(groupNoClass([mark('a', '2026-11-23', 'Holiday', 'mayor'), mark('b', '2026-11-24', 'Holiday', 'secretary')], weekdays))).toEqual([['a'], ['b']]);
  });

  it('puts several course marks on one day together', () => {
    expect(ids(groupNoClass([mark('or', '2026-11-23', '', 'mayor', 'or'), mark('se', '2026-11-23', '', 'mayor', 'se')], weekdays))).toEqual([['or', 'se']]);
  });

  it('never joins marks more than two weeks apart', () => {
    expect(ids(groupNoClass([mark('a', '2026-11-02'), mark('b', '2026-11-30')], () => false))).toEqual([['a'], ['b']]);
  });
});
