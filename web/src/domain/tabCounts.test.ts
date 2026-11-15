import { describe, expect, it } from 'vitest';
import { countLabel, unseenCounts, type CountInput } from './tabCounts';

const ME = 'me';
const base = (over: Partial<CountInput> = {}): CountInput => ({
  seen: { LEDGER: 100, SCHEDULE: 100, CONTENTS: 100, NEWS: 100 },
  myUid: ME,
  records: [],
  schedule: [],
  contents: [],
  posts: [],
  comments: [],
  myCommentIds: new Set(),
  joinRequests: 0,
  takes: () => true,
  ...over,
});
const comment = (id: string, postId: string, parentId: string, uid: string, at: number, removed = 0) => ({ id, postId, parentId, uid, createdAtMillis: at, removedAtMillis: removed });

describe('unseenCounts', () => {
  it('counts nothing before the first visit, except join requests', () => {
    const counts = unseenCounts(base({ seen: null, joinRequests: 2, posts: [{ id: 'p', createdByUid: 'x', createdAtMillis: 500 }] }));
    expect(counts).toEqual({ LEDGER: 0, SCHEDULE: 0, CONTENTS: 0, NEWS: 0, MEMBERS: 2 });
  });

  it('counts announcements newer than the last visit that others posted', () => {
    const posts = [
      { id: 'a', createdByUid: 'x', createdAtMillis: 150 },
      { id: 'b', createdByUid: 'x', createdAtMillis: 90 },
      { id: 'c', createdByUid: ME, createdAtMillis: 160 },
    ];
    expect(unseenCounts(base({ posts })).NEWS).toBe(1);
  });

  it('counts comments on my announcements and replies to my comments', () => {
    const posts = [
      { id: 'mine', createdByUid: ME, createdAtMillis: 50 },
      { id: 'theirs', createdByUid: 'x', createdAtMillis: 50 },
    ];
    const comments = [
      comment('c1', 'mine', '', 'x', 150), // on my post
      comment('c2', 'mine', 'c1', 'y', 160), // a reply under my post
      comment('c3', 'theirs', 'myc', 'x', 170), // a reply to my comment
      comment('c4', 'theirs', '', 'x', 180), // someone else's thread: not for me
      comment('c5', 'mine', '', ME, 190), // my own
      comment('c6', 'mine', '', 'x', 90), // seen already
      comment('c7', 'mine', '', 'x', 200, 210), // removed
    ];
    expect(unseenCounts(base({ posts, comments, myCommentIds: new Set(['myc']) })).NEWS).toBe(3);
  });

  it('counts ledger records about me, not voided ones or other students', () => {
    const r = (memberId: string, at: number, voided = 0, by = 'treasurer') => ({ memberId, createdByUid: by, createdAtMillis: at, voidedAtMillis: voided });
    const records = [r(ME, 150), r(ME, 160, 170), r('other', 150), r(ME, 50), r(ME, 150, 0, ME)];
    expect(unseenCounts(base({ records })).LEDGER).toBe(1);
  });

  it('counts schedule and contents only for courses I take', () => {
    const takes = (id: string) => id !== 'pe';
    const schedule = [
      { courseId: 'or', createdByUid: 'x', createdAtMillis: 150, status: 'PENDING' },
      { courseId: 'pe', createdByUid: 'x', createdAtMillis: 150, status: 'PENDING' },
      { courseId: '', createdByUid: 'x', createdAtMillis: 150, status: 'CANCELLED' },
      { courseId: 'or', createdByUid: 'x', createdAtMillis: 0, status: 'PENDING' }, // added before counts began
    ];
    const contents = [
      { courseId: 'or', createdByUid: 'x', createdAtMillis: 150 },
      { courseId: 'pe', createdByUid: 'x', createdAtMillis: 150 },
    ];
    const counts = unseenCounts(base({ schedule, contents, takes }));
    expect([counts.SCHEDULE, counts.CONTENTS]).toEqual([1, 1]);
  });
});

describe('countLabel', () => {
  it('caps at 9+', () => {
    expect([countLabel(1), countLabel(9), countLabel(10), countLabel(42)]).toEqual(['1', '9', '9+', '9+']);
  });
});
