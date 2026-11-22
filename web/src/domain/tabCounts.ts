/*
 * The red numbers on the class tabs: what is new since this user last opened each tab. Their own posts,
 * comments and records never count. Members is different: it counts the join requests waiting for an
 * officer who approves joins, and clears only when they are handled.
 */

export const SEEN_TABS = ['LEDGER', 'SCHEDULE', 'CONTENTS', 'NEWS'] as const;
export type SeenTab = (typeof SEEN_TABS)[number];
export type TabsSeen = Record<SeenTab, number>;

export interface GroupingCountItem {
  courseId: string;
  locked: boolean;
  hasLeader?: boolean;
  shared?: boolean;
  groups: {
    memberUids: string[];
    leaderUid?: string;
    joinRequests?: { uid: string }[];
  }[];
}

/**
 * Counts grouping items that need this member's attention:
 * - Pending join requests waiting for this member (as group leader or officer with MEMBERS_MANAGE).
 * - Open groupings for courses this member takes where they do not have a group yet.
 */
export function groupingAttentionCount(
  groupings: readonly GroupingCountItem[],
  myUid: string,
  canManage: boolean,
  takes: (courseId: string) => boolean,
): number {
  let total = 0;
  for (const g of groupings) {
    if (g.hasLeader) {
      for (const slot of g.groups) {
        const reqs = slot.joinRequests?.length ?? 0;
        if (reqs === 0) continue;
        const leaderUid = slot.leaderUid || slot.memberUids[0] || '';
        if (canManage || (!g.locked && leaderUid === myUid)) total += reqs;
      }
    }
    if (!g.locked && takes(g.courseId)) {
      const inGroup = g.groups.some((slot) => slot.memberUids.includes(myUid));
      if (!inGroup) total += 1;
    }
  }
  return total;
}

export interface CountInput {
  /** When each tab was last opened. null or undefined: nothing counts yet. */
  seen: TabsSeen | null | undefined;
  myUid: string;
  /** Ledger records; only those about this user count. */
  records: { memberId: string; createdByUid: string; createdAtMillis: number; voidedAtMillis: number }[];
  schedule: { courseId: string; createdByUid: string; createdAtMillis: number; status: string }[];
  contents: { courseId: string; createdByUid: string; createdAtMillis: number }[];
  posts: { id: string; createdByUid: string; createdAtMillis: number }[];
  /** Polls (local and shared); new ones from someone else count on News. */
  polls?: { courseId: string; createdByUid: string; createdAtMillis: number; shared?: boolean }[];
  /** Comments and replies (at least those newer than the News time). */
  comments: { id: string; postId: string; parentId: string; uid: string; createdAtMillis: number; removedAtMillis: number }[];
  /** The ids of this user's own comments, to find replies to them. */
  myCommentIds: ReadonlySet<string>;
  /** Join requests waiting (0 unless this user approves joins). */
  joinRequests: number;
  /** Grouping items needing attention (pending requests to approve + open unassigned groupings). */
  groupActions?: number;
  /** False for a course this user does not take. */
  takes: (courseId: string) => boolean;
}

export type TabCounts = Record<SeenTab | 'MEMBERS', number>;

export function unseenCounts(i: CountInput): TabCounts {
  const counts: TabCounts = { LEDGER: 0, SCHEDULE: 0, CONTENTS: 0, NEWS: 0, MEMBERS: i.joinRequests + (i.groupActions ?? 0) };
  const seen = i.seen;
  if (!seen) return counts;
  const fresh = (tab: SeenTab, at: number, by: string) => at > seen[tab] && by !== i.myUid;

  counts.LEDGER = i.records.filter((r) => r.memberId === i.myUid && r.voidedAtMillis === 0 && fresh('LEDGER', r.createdAtMillis, r.createdByUid)).length;
  counts.SCHEDULE = i.schedule.filter((s) => s.status !== 'CANCELLED' && i.takes(s.courseId) && fresh('SCHEDULE', s.createdAtMillis, s.createdByUid)).length;
  counts.CONTENTS = i.contents.filter((c) => i.takes(c.courseId) && fresh('CONTENTS', c.createdAtMillis, c.createdByUid)).length;

  const myPosts = new Set(i.posts.filter((p) => p.createdByUid === i.myUid).map((p) => p.id));
  const newPosts = i.posts.filter((p) => fresh('NEWS', p.createdAtMillis, p.createdByUid)).length;
  const newPolls = (i.polls ?? []).filter((p) => (p.shared || i.takes(p.courseId)) && fresh('NEWS', p.createdAtMillis, p.createdByUid)).length;
  // A comment on my announcement, or a reply to my comment.
  const toMe = i.comments.filter(
    (c) => c.removedAtMillis === 0 && fresh('NEWS', c.createdAtMillis, c.uid) && (myPosts.has(c.postId) || (c.parentId !== '' && i.myCommentIds.has(c.parentId))),
  ).length;
  counts.NEWS = newPosts + newPolls + toMe;
  return counts;
}

/** "9+" past nine, so the tab bar never crowds. */
export const countLabel = (n: number) => (n > 9 ? '9+' : String(n));
