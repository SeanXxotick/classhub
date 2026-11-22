/*
 * Pure logic for Class Polls (voting, tallies, open/closed status, unvoted roster).
 */

export interface PollLike {
  options: readonly string[];
  courseId: string;
  multi: boolean;
  maxChoices: number;
  closesAtMillis: number;
  closed: boolean;
}

export interface PollVoteLike {
  pollId: string;
  uid: string;
  choices: readonly number[];
}

export function isPollOpen(poll: Pick<PollLike, 'closed' | 'closesAtMillis'>, nowMillis: number): boolean {
  if (poll.closed) return false;
  return poll.closesAtMillis === 0 || poll.closesAtMillis > nowMillis;
}

/** Toggles an option index in a user's current choices, respecting single vs. multi-choice and maxChoices. */
export function togglePollChoice(current: readonly number[], index: number, multi: boolean, maxChoices: number): number[] {
  if (!multi) {
    return current.length === 1 && current[0] === index ? [] : [index];
  }
  if (current.includes(index)) return current.filter((i) => i !== index);
  const limit = Math.max(1, maxChoices);
  if (current.length >= limit) return [...current];
  return [...current, index].sort((a, b) => a - b);
}

export interface PollTally {
  counts: number[];
  totalVotes: number;
  totalVoters: number;
  votedUids: Set<string>;
  unvotedUids: string[];
}

/**
 * Who counts on a poll: this class's eligible members. A shared poll counts every vote, as its anonymous
 * counts do: no class lists the others' members, and every linked class must show the same numbers.
 */
export function pollEligibleUids(localUids: readonly string[], votes: readonly { uid: string }[], shared: boolean): string[] {
  if (!shared) return [...localUids];
  return [...new Set([...localUids, ...votes.map((v) => v.uid)])];
}

/** Computes option counts and unvoted members for a poll, counting only eligible current members. */
export function tallyPoll(
  poll: Pick<PollLike, 'options'>,
  votes: readonly PollVoteLike[],
  eligibleUids: readonly string[],
): PollTally {
  const eligible = new Set(eligibleUids);
  const counts = new Array<number>(poll.options.length).fill(0);
  const votedUids = new Set<string>();
  let totalVotes = 0;

  for (const v of votes) {
    if (!eligible.has(v.uid)) continue;
    const unique = new Set(v.choices.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < poll.options.length));
    if (unique.size === 0) continue;
    votedUids.add(v.uid);
    for (const idx of unique) {
      counts[idx]++;
      totalVotes++;
    }
  }

  const unvotedUids = eligibleUids.filter((uid) => !votedUids.has(uid));
  return { counts, totalVotes, totalVoters: votedUids.size, votedUids, unvotedUids };
}
