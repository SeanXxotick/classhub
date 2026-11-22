/*
 * Class Polls (inside the News tab): officers with ANNOUNCEMENTS_MANAGE create, close and delete polls;
 * every class member votes once (or changes/clears their vote while the poll is open).
 */
import { FieldPath, collection, deleteDoc, doc, getDocs, increment, query, runTransaction, setDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { newId, nowMillis } from './dataEnv';
import { UserError } from './errors';
import { commitLogged, logToBatch } from './history';
import { fromDoc, useQueryList } from './live';
import { queueNotice } from './notify';
import { explainRefusal, withoutId } from './paths';

export const POLL_QUESTION_MAX = 150;
export const POLL_OPTION_MAX = 100;
export const POLL_MAX_OPTIONS = 10;

export interface Poll {
  id: string;
  question: string;
  options: string[];
  /** Course id, or '' for the whole class. */
  courseId: string;
  multi: boolean;
  maxChoices: number;
  anonymous: boolean;
  /** 0 = no automatic closing time. */
  closesAtMillis: number;
  closed: boolean;
  /** Anonymous polls: option index to its count, kept by the voters' own writes (checked by the rules). */
  tally: Record<string, number>;
  /** Anonymous polls: how many members have voted. */
  voters: number;
  createdByUid: string;
  createdAtMillis: number;
}

export const newPoll = (p: Partial<Poll>): Poll => ({
  id: '',
  question: '',
  options: [],
  courseId: '',
  multi: false,
  maxChoices: 1,
  anonymous: false,
  closesAtMillis: 0,
  closed: false,
  tally: {},
  voters: 0,
  createdByUid: '',
  createdAtMillis: 0,
  ...p,
});

export interface PollVote {
  id: string;
  pollId: string;
  uid: string;
  choices: number[];
  votedAtMillis: number;
}

export const newPollVote = (v: Partial<PollVote>): PollVote => ({
  id: '',
  pollId: '',
  uid: '',
  choices: [],
  votedAtMillis: 0,
  ...v,
});

export const pollsCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'polls');
export const pollVotesCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'pollVotes');
/** Anonymous polls keep each ballot here, readable only by the member who cast it. */
export const pollBallotsCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'pollBallots');
export const pollVoteId = (pollId: string, uid: string) => `${pollId}_${uid}`;

export interface NewPollInput {
  question: string;
  options: string[];
  courseId: string;
  multi: boolean;
  maxChoices: number;
  anonymous: boolean;
  closesAtMillis: number;
}

/** Creates a poll (ANNOUNCEMENTS_MANAGE), logs it in History, and notifies the class or course. */
export async function createPoll(db: Firestore, actorUid: string, classId: string, input: NewPollInput): Promise<string> {
  const question = input.question.trim().slice(0, POLL_QUESTION_MAX);
  if (!question) throw new UserError('NAME_MISSING', 'Write the poll question first.');
  const options = input.options.map((o) => o.trim().slice(0, POLL_OPTION_MAX)).filter(Boolean).slice(0, POLL_MAX_OPTIONS);
  if (options.length < 2) throw new UserError('NAME_MISSING', 'Add at least two choices.');
  const maxChoices = input.multi ? Math.min(options.length, Math.max(2, Math.trunc(input.maxChoices))) : 1;
  const id = newId();
  const poll = newPoll({
    question,
    options,
    courseId: input.courseId,
    multi: input.multi,
    maxChoices,
    anonymous: input.anonymous,
    closesAtMillis: input.closesAtMillis > 0 ? input.closesAtMillis : 0,
    closed: false,
    createdByUid: actorUid,
    createdAtMillis: nowMillis(),
  });
  await explainRefusal(db, classId, () =>
    commitLogged(db, classId, { actorUid, kind: 'POLL_CREATED', text: `Created the poll "${question}"` }, (b) =>
      b.set(doc(pollsCol(db, classId), id), withoutId(poll)),
    ),
  );
  void queueNotice(db, actorUid, classId, {
    kind: 'ANNOUNCEMENT',
    audience: input.courseId ? 'COURSE' : 'CLASS',
    audienceId: input.courseId,
    title: `New poll: ${question}`,
    body: options.slice(0, 3).join(' · '),
  });
  return id;
}

/**
 * Saves or clears (when choices is empty) a member's vote on an open poll. On an anonymous poll the ballot is
 * private and the poll's counts move with it in the same write, so nobody can see who chose what.
 */
export async function castPollVote(db: Firestore, classId: string, poll: Poll, uid: string, choices: number[]): Promise<void> {
  const pollId = poll.id;
  if (poll.anonymous) {
    const ballotRef = doc(pollBallotsCol(db, classId), pollVoteId(pollId, uid));
    const pollRef = doc(pollsCol(db, classId), pollId);
    await explainRefusal(db, classId, () =>
      runTransaction(db, async (tx) => {
        const before = await tx.get(ballotRef);
        const was: number[] = before.exists() ? ((before.data().choices as number[]) ?? []) : [];
        const changes: unknown[] = [];
        for (let i = 0; i < poll.options.length; i++) {
          const delta = Number(choices.includes(i)) - Number(was.includes(i));
          if (delta !== 0) changes.push(new FieldPath('tally', String(i)), increment(delta));
        }
        const voterDelta = Number(choices.length > 0) - Number(was.length > 0);
        if (voterDelta !== 0) changes.push(new FieldPath('voters'), increment(voterDelta));
        if (choices.length === 0) tx.delete(ballotRef);
        else tx.set(ballotRef, { pollId, uid, choices, votedAtMillis: nowMillis() });
        if (changes.length > 0) tx.update(pollRef, changes[0] as FieldPath, changes[1], ...changes.slice(2));
      }),
    );
    return;
  }
  const ref = doc(pollVotesCol(db, classId), pollVoteId(pollId, uid));
  if (choices.length === 0) {
    await explainRefusal(db, classId, () => deleteDoc(ref));
    return;
  }
  await explainRefusal(db, classId, () =>
    setDoc(ref, { pollId, uid, choices, votedAtMillis: nowMillis() }),
  );
}

/** Closes or reopens a poll (ANNOUNCEMENTS_MANAGE). */
export async function setPollClosed(db: Firestore, actorUid: string, classId: string, poll: Poll, closed: boolean): Promise<void> {
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'POLL_CLOSED', text: `${closed ? 'Closed' : 'Reopened'} the poll "${poll.question}"` },
      (b) => b.update(doc(pollsCol(db, classId), poll.id), { closed }),
    ),
  );
}

/** Deletes a poll and its votes (ANNOUNCEMENTS_MANAGE), with a History entry. */
export async function deletePoll(db: Firestore, actorUid: string, classId: string, poll: Poll): Promise<void> {
  const votes = await getDocs(query(pollVotesCol(db, classId), where('pollId', '==', poll.id)));
  for (let i = 0; i < votes.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of votes.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(doc(pollsCol(db, classId), poll.id));
  await logToBatch(batch, db, classId, actorUid, 'POLL_DELETED', `Deleted the poll "${poll.question}"`);
  await explainRefusal(db, classId, () => batch.commit());
}

/** All polls in the class, newest first. */
export function usePolls(db: Firestore, classId: string, enabled: boolean) {
  const live = useQueryList<Poll>(`v2/polls/${classId}/${enabled}`, enabled ? pollsCol(db, classId) : null, (d) => fromDoc(newPoll({}), d));
  return { ...live, data: live.data ? [...live.data].sort((a, b) => b.createdAtMillis - a.createdAtMillis) : live.data };
}

/** All votes on polls that are not anonymous. */
export const usePollVotes = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<PollVote>(`v2/pollVotes/${classId}/${enabled}`, enabled ? pollVotesCol(db, classId) : null, (d) => fromDoc(newPollVote({}), d));

/** The signed-in member's own ballots on anonymous polls. */
export const useMyBallots = (db: Firestore, classId: string, uid: string, enabled: boolean) =>
  useQueryList<PollVote>(
    `v2/pollBallots/${classId}/${uid}/${enabled}`,
    enabled ? query(pollBallotsCol(db, classId), where('uid', '==', uid)) : null,
    (d) => fromDoc(newPollVote({}), d),
  );
