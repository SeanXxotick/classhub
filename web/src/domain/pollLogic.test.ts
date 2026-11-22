import { describe, expect, it } from 'vitest';
import { isPollOpen, pollEligibleUids, tallyPoll, togglePollChoice } from './pollLogic';

describe('pollLogic', () => {
  it('detects open vs closed polls by flag and close timestamp', () => {
    expect(isPollOpen({ closed: false, closesAtMillis: 0 }, 1000)).toBe(true);
    expect(isPollOpen({ closed: true, closesAtMillis: 0 }, 1000)).toBe(false);
    expect(isPollOpen({ closed: false, closesAtMillis: 2000 }, 1000)).toBe(true);
    expect(isPollOpen({ closed: false, closesAtMillis: 1000 }, 1000)).toBe(false);
  });

  it('toggles single-choice and multi-choice selections respecting maxChoices', () => {
    expect(togglePollChoice([], 1, false, 1)).toEqual([1]);
    expect(togglePollChoice([1], 1, false, 1)).toEqual([]);
    expect(togglePollChoice([1], 2, false, 1)).toEqual([2]);

    expect(togglePollChoice([], 2, true, 2)).toEqual([2]);
    expect(togglePollChoice([2], 0, true, 2)).toEqual([0, 2]);
    expect(togglePollChoice([0, 2], 1, true, 2)).toEqual([0, 2]); // capped at maxChoices=2
    expect(togglePollChoice([0, 2], 2, true, 2)).toEqual([0]);
  });

  it('tallies votes for eligible members only and reports unvoted uids', () => {
    const poll = { options: ['Thu', 'Fri', 'Sat'] };
    const votes = [
      { pollId: 'p1', uid: 'u1', choices: [0] },
      { pollId: 'p1', uid: 'u2', choices: [0, 1] },
      { pollId: 'p1', uid: 'former', choices: [2] }, // ignored
      { pollId: 'p1', uid: 'u3', choices: [99] }, // out-of-range ignored
    ];
    const t = tallyPoll(poll, votes, ['u1', 'u2', 'u3', 'u4']);
    expect(t.counts).toEqual([2, 1, 0]);
    expect(t.totalVotes).toBe(3);
    expect(t.totalVoters).toBe(2);
    expect(t.unvotedUids).toEqual(['u3', 'u4']);
  });

  it('counts every vote on a shared poll, so each linked class shows the same numbers', () => {
    const poll = { options: ['Mon', 'Fri'] };
    const votes = [
      { pollId: 'p', uid: 'ana', choices: [1] }, // G1
      { pollId: 'p', uid: 'ben', choices: [1] }, // G2
      { pollId: 'p', uid: 'gone', choices: [0] }, // left G1 after voting
    ];
    const g1 = tallyPoll(poll, votes, pollEligibleUids(['ana', 'cara'], votes, true));
    const g2 = tallyPoll(poll, votes, pollEligibleUids(['ben'], votes, true));
    expect(g1.counts).toEqual([1, 2]);
    expect(g2.counts).toEqual(g1.counts);
    expect(g1.totalVoters).toBe(3);
    expect(g1.unvotedUids).toEqual(['cara']);
    // A class poll still counts only current eligible members.
    expect(tallyPoll(poll, votes, pollEligibleUids(['ana'], votes, false)).counts).toEqual([0, 1]);
  });
});
