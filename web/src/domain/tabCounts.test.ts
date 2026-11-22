import { describe, expect, it } from 'vitest';
import { countLabel, groupingAttentionCount, unseenCounts, type CountInput, type GroupingCountItem } from './tabCounts';

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

  it('counts new polls on News for courses I take and shared polls, skipping my own and older polls', () => {
    const takes = (id: string) => id !== 'pe';
    const polls = [
      { courseId: '', createdByUid: 'x', createdAtMillis: 150 },
      { courseId: 'or', createdByUid: 'x', createdAtMillis: 160 },
      { courseId: 'pe', createdByUid: 'x', createdAtMillis: 170 }, // skipped course
      { courseId: '', createdByUid: ME, createdAtMillis: 180 }, // own poll
      { courseId: '', createdByUid: 'x', createdAtMillis: 90 }, // seen already
      { courseId: '', createdByUid: 'partner', createdAtMillis: 190, shared: true },
    ];
    expect(unseenCounts(base({ polls, takes })).NEWS).toBe(3);
  });

  it('includes groupActions in the Members tab count', () => {
    expect(unseenCounts(base({ joinRequests: 1, groupActions: 2 })).MEMBERS).toBe(3);
    expect(unseenCounts(base({ seen: null, joinRequests: 0, groupActions: 2 })).MEMBERS).toBe(2);
  });
});

describe('groupingAttentionCount', () => {
  const mk = (over: Partial<GroupingCountItem> = {}): GroupingCountItem => ({
    courseId: '',
    locked: false,
    hasLeader: true,
    groups: [
      { memberUids: [ME], leaderUid: ME, joinRequests: [{ uid: 'a' }, { uid: 'b' }] },
      { memberUids: ['other'], leaderUid: 'other', joinRequests: [{ uid: 'c' }] },
    ],
    ...over,
  });

  it('counts pending requests for a group leader and unassigned open groupings for a member', () => {
    const takes = (id: string) => id !== 'pe';
    const groupings: GroupingCountItem[] = [
      mk(), // I lead group 1 (2 requests), already in a group
      mk({ groups: [{ memberUids: ['other'], leaderUid: 'other', joinRequests: [{ uid: 'c' }] }] }), // unassigned open grouping (+1)
      mk({ locked: true, groups: [{ memberUids: ['other'] }] }), // locked: does not count
      mk({ courseId: 'pe', groups: [{ memberUids: ['other'] }] }), // skipped course: does not count
    ];
    expect(groupingAttentionCount(groupings, ME, false, takes)).toBe(3);
  });

  it('counts all pending requests across groups for an officer with MEMBERS_MANAGE', () => {
    const groupings: GroupingCountItem[] = [mk()];
    expect(groupingAttentionCount(groupings, ME, true, () => true)).toBe(3);
  });
});

describe('countLabel', () => {
  it('caps at 9+', () => {
    expect([countLabel(1), countLabel(9), countLabel(10), countLabel(42)]).toEqual(['1', '9', '9+', '9+']);
  });
});
