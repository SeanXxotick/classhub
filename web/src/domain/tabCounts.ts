/*
 * The red numbers on the class tabs: what is new since this user last opened each tab. Their own posts,
 * comments and records never count. Members is different: it counts the join requests waiting for an
 * officer who approves joins, and clears only when they are handled.
 */

export const SEEN_TABS = ['LEDGER', 'SCHEDULE', 'CONTENTS', 'NEWS'] as const;
export type SeenTab = (typeof SEEN_TABS)[number];
export type TabsSeen = Record<SeenTab, number>;

export interface CountInput {
  /** When each tab was last opened. null or undefined: nothing counts yet. */
  seen: TabsSeen | null | undefined;
  myUid: string;
  /** Ledger records; only those about this user count. */
  records: { memberId: string; createdByUid: string; createdAtMillis: number; voidedAtMillis: number }[];
  schedule: { courseId: string; createdByUid: string; createdAtMillis: number; status: string }[];
  contents: { courseId: string; createdByUid: string; createdAtMillis: number }[];
  posts: { id: string; createdByUid: string; createdAtMillis: number }[];
  /** Comments and replies (at least those newer than the News time). */
  comments: { id: string; postId: string; parentId: string; uid: string; createdAtMillis: number; removedAtMillis: number }[];
  /** The ids of this user's own comments, to find replies to them. */
  myCommentIds: ReadonlySet<string>;
  /** Join requests waiting (0 unless this user approves joins). */
  joinRequests: number;
  /** False for a course this user does not take. */
  takes: (courseId: string) => boolean;
}

export type TabCounts = Record<SeenTab | 'MEMBERS', number>;

export function unseenCounts(i: CountInput): TabCounts {
  const counts: TabCounts = { LEDGER: 0, SCHEDULE: 0, CONTENTS: 0, NEWS: 0, MEMBERS: i.joinRequests };
  const seen = i.seen;
  if (!seen) return counts;
  const fresh = (tab: SeenTab, at: number, by: string) => at > seen[tab] && by !== i.myUid;

  counts.LEDGER = i.records.filter((r) => r.memberId === i.myUid && r.voidedAtMillis === 0 && fresh('LEDGER', r.createdAtMillis, r.createdByUid)).length;
  counts.SCHEDULE = i.schedule.filter((s) => s.status !== 'CANCELLED' && i.takes(s.courseId) && fresh('SCHEDULE', s.createdAtMillis, s.createdByUid)).length;
  counts.CONTENTS = i.contents.filter((c) => i.takes(c.courseId) && fresh('CONTENTS', c.createdAtMillis, c.createdByUid)).length;

  const myPosts = new Set(i.posts.filter((p) => p.createdByUid === i.myUid).map((p) => p.id));
  const newPosts = i.posts.filter((p) => fresh('NEWS', p.createdAtMillis, p.createdByUid)).length;
  // A comment on my announcement, or a reply to my comment.
  const toMe = i.comments.filter(
    (c) => c.removedAtMillis === 0 && fresh('NEWS', c.createdAtMillis, c.uid) && (myPosts.has(c.postId) || (c.parentId !== '' && i.myCommentIds.has(c.parentId))),
  ).length;
  counts.NEWS = newPosts + toMe;
  return counts;
}

/** "9+" past nine, so the tab bar never crowds. */
export const countLabel = (n: number) => (n > 9 ? '9+' : String(n));
