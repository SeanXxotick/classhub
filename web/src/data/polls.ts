/*
 * Class Polls (inside the News tab): officers with ANNOUNCEMENTS_MANAGE create, close and delete polls;
 * every class member votes once (or changes/clears their vote while the poll is open).
 * Supports both single-class polls (classes/{classId}/polls/{id}) and cross-class shared polls
 * (/sharedPolls/{id}, linked to trusted partner classes via classes/{classId}/sharedPollLinks/{id}).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  FieldPath,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  increment,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { newId, nowMillis } from './dataEnv';
import { UserError } from './errors';
import { commitLogged, logToBatch } from './history';
import { fromDoc, useQueryList } from './live';
import { queueNotice } from './notify';
import type { PartnerClass } from './partners';
import { explainRefusal, withoutId } from './paths';

export const POLL_QUESTION_MAX = 150;
export const POLL_OPTION_MAX = 100;
export const POLL_MAX_OPTIONS = 10;

export interface SharedPollClassLink {
  name: string;
  tag: string;
  courseId?: string;
  accentColor?: string;
}

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
  /** True when this poll is shared across multiple partner classes (/sharedPolls/{id}). */
  shared?: boolean;
  hostClassId?: string;
  linkedClassIds?: string[];
  linkedClasses?: Record<string, SharedPollClassLink>;
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
  name?: string;
  classId?: string;
  tag?: string;
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

export const sharedPollsCol = (db: Firestore) => collection(db, 'sharedPolls');
export const sharedPollRef = (db: Firestore, pollId: string) => doc(sharedPollsCol(db), pollId);
export const sharedPollVotesCol = (db: Firestore, pollId: string) => collection(db, 'sharedPolls', pollId, 'votes');
export const sharedPollBallotsCol = (db: Firestore, pollId: string) => collection(db, 'sharedPolls', pollId, 'ballots');
export const sharedPollLinksCol = (db: Firestore, classId: string) => collection(db, 'classes', classId, 'sharedPollLinks');
export const sharedPollLinkRef = (db: Firestore, classId: string, pollId: string) => doc(sharedPollLinksCol(db, classId), pollId);

export interface NewPollInput {
  question: string;
  options: string[];
  courseId: string;
  multi: boolean;
  maxChoices: number;
  anonymous: boolean;
  closesAtMillis: number;
  /** Whether to send a push notification to the posting class. Defaults to true. */
  notifyOwnClass?: boolean;
  /** Optional trusted partner classes to include in a cross-class shared poll. */
  partnerClasses?: PartnerClass[];
  /** Whether to send push notifications to included partner classes. Defaults to true. */
  notifyPartners?: boolean;
  hostClassName?: string;
  hostTag?: string;
  hostAccentColor?: string;
}

/** Creates a local or cross-class shared poll (ANNOUNCEMENTS_MANAGE), logs it in History, and optionally notifies classes. */
export async function createPoll(db: Firestore, actorUid: string, classId: string, input: NewPollInput): Promise<string> {
  const question = input.question.trim().slice(0, POLL_QUESTION_MAX);
  if (!question) throw new UserError('NAME_MISSING', 'Write the poll question first.');
  const options = input.options.map((o) => o.trim().slice(0, POLL_OPTION_MAX)).filter(Boolean).slice(0, POLL_MAX_OPTIONS);
  if (options.length < 2) throw new UserError('NAME_MISSING', 'Add at least two choices.');
  const maxChoices = input.multi ? Math.min(options.length, Math.max(2, Math.trunc(input.maxChoices))) : 1;
  const closesAtMillis = input.closesAtMillis > 0 ? input.closesAtMillis : 0;
  const id = newId();
  const now = nowMillis();
  const notifyOwn = input.notifyOwnClass ?? true;
  const partners = (input.partnerClasses ?? []).filter((p) => p.partnerClassId && p.partnerClassId !== classId).slice(0, 3);

  if (partners.length > 0) {
    const hostName = (input.hostClassName ?? '').trim().slice(0, 100) || 'Host class';
    const hostTag = (input.hostTag ?? '').trim().slice(0, 24) || hostName.slice(0, 24);
    const linkedClassIds = [classId, ...partners.map((p) => p.partnerClassId)];
    const linkedClasses: Record<string, SharedPollClassLink> = {
      [classId]: {
        name: hostName,
        tag: hostTag,
        ...(input.courseId ? { courseId: input.courseId } : {}),
        ...(input.hostAccentColor ? { accentColor: input.hostAccentColor } : {}),
      },
    };
    for (const p of partners) {
      linkedClasses[p.partnerClassId] = {
        name: p.name,
        tag: p.tag,
        ...(p.accentColor ? { accentColor: p.accentColor } : {}),
      };
    }
    const sharedDoc = {
      question,
      options,
      multi: input.multi,
      maxChoices,
      anonymous: input.anonymous,
      closesAtMillis,
      closed: false,
      tally: {},
      voters: 0,
      hostClassId: classId,
      linkedClassIds,
      linkedClasses,
      createdByUid: actorUid,
      createdAtMillis: now,
    };
    await explainRefusal(db, classId, () =>
      commitLogged(
        db,
        classId,
        { actorUid, kind: 'POLL_CREATED', text: `Created the shared poll "${question}"` },
        (b) => {
          b.set(sharedPollRef(db, id), sharedDoc);
          b.set(sharedPollLinkRef(db, classId, id), { pollId: id, fromClassId: classId, linkedAtMillis: now });
          for (const p of partners) {
            b.set(sharedPollLinkRef(db, p.partnerClassId, id), { pollId: id, fromClassId: classId, linkedAtMillis: now });
          }
        },
      ),
    );
    const body = options.slice(0, 3).join(' · ');
    if (notifyOwn) {
      void queueNotice(db, actorUid, classId, {
        kind: 'ANNOUNCEMENT',
        audience: 'CLASS',
        audienceId: '',
        title: `New poll: ${question}`,
        body,
      });
    }
    if (input.notifyPartners ?? true) {
      for (const p of partners) {
        void queueNotice(db, actorUid, p.partnerClassId, {
          kind: 'ANNOUNCEMENT',
          audience: 'CLASS',
          audienceId: '',
          title: `New poll: ${question}`,
          body,
          fromClassId: classId,
        });
      }
    }
    return id;
  }

  const poll = newPoll({
    question,
    options,
    courseId: input.courseId,
    multi: input.multi,
    maxChoices,
    anonymous: input.anonymous,
    closesAtMillis,
    closed: false,
    createdByUid: actorUid,
    createdAtMillis: now,
  });
  await explainRefusal(db, classId, () =>
    commitLogged(db, classId, { actorUid, kind: 'POLL_CREATED', text: `Created the poll "${question}"` }, (b) =>
      b.set(doc(pollsCol(db, classId), id), withoutId(poll)),
    ),
  );
  if (notifyOwn) {
    void queueNotice(db, actorUid, classId, {
      kind: 'ANNOUNCEMENT',
      audience: input.courseId ? 'COURSE' : 'CLASS',
      audienceId: input.courseId,
      title: `New poll: ${question}`,
      body: options.slice(0, 3).join(' · '),
    });
  }
  return id;
}

/**
 * Saves or clears (when choices is empty) a member's vote on an open poll. On an anonymous poll the ballot is
 * private and the poll's counts move with it in the same write, so nobody can see who chose what.
 */
export async function castPollVote(
  db: Firestore,
  classId: string,
  poll: Poll,
  uid: string,
  choices: number[],
  voterMeta?: { name: string; tag: string },
): Promise<void> {
  const pollId = poll.id;
  if (poll.anonymous) {
    const ballotRef = poll.shared
      ? doc(sharedPollBallotsCol(db, pollId), uid)
      : doc(pollBallotsCol(db, classId), pollVoteId(pollId, uid));
    const pollRef = poll.shared ? sharedPollRef(db, pollId) : doc(pollsCol(db, classId), pollId);
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
  const ref = poll.shared
    ? doc(sharedPollVotesCol(db, pollId), uid)
    : doc(pollVotesCol(db, classId), pollVoteId(pollId, uid));
  if (choices.length === 0) {
    await explainRefusal(db, classId, () => deleteDoc(ref));
    return;
  }
  const payload = poll.shared && voterMeta
    ? {
        pollId,
        uid,
        choices,
        votedAtMillis: nowMillis(),
        name: voterMeta.name.trim().slice(0, 100),
        classId,
        tag: voterMeta.tag.trim().slice(0, 24),
      }
    : { pollId, uid, choices, votedAtMillis: nowMillis() };
  await explainRefusal(db, classId, () => setDoc(ref, payload));
}

/** Updates a poll's question, choices, settings, or close date (ANNOUNCEMENTS_MANAGE). */
export async function updatePoll(
  db: Firestore,
  actorUid: string,
  classId: string,
  poll: Poll,
  input: {
    question: string;
    options: string[];
    courseId: string;
    multi: boolean;
    maxChoices: number;
    closesAtMillis: number;
  },
): Promise<void> {
  const question = input.question.trim().slice(0, POLL_QUESTION_MAX);
  if (!question) throw new UserError('NAME_MISSING', 'Write the poll question first.');
  const options = input.options.map((o) => o.trim().slice(0, POLL_OPTION_MAX)).filter(Boolean).slice(0, POLL_MAX_OPTIONS);
  if (options.length < 2) throw new UserError('NAME_MISSING', 'Add at least two choices.');
  const maxChoices = input.multi ? Math.min(options.length, Math.max(2, Math.trunc(input.maxChoices))) : 1;
  const closesAtMillis = input.closesAtMillis > 0 ? input.closesAtMillis : 0;
  const target = poll.shared ? sharedPollRef(db, poll.id) : doc(pollsCol(db, classId), poll.id);
  if (poll.shared) {
    const curLink = poll.linkedClasses?.[classId];
    const ownLink: unknown[] = curLink
      ? [new FieldPath('linkedClasses', classId), { ...curLink, courseId: input.courseId }]
      : [];
    await explainRefusal(db, classId, () =>
      commitLogged(
        db,
        classId,
        { actorUid, kind: 'POLL_UPDATED', text: `Edited the poll "${question}"` },
        (b) =>
          b.update(
            target,
            new FieldPath('question'),
            question,
            new FieldPath('options'),
            options,
            new FieldPath('multi'),
            input.multi,
            new FieldPath('maxChoices'),
            maxChoices,
            new FieldPath('closesAtMillis'),
            closesAtMillis,
            ...ownLink,
          ),
      ),
    );
    return;
  }
  const patch = { question, options, courseId: input.courseId, multi: input.multi, maxChoices, closesAtMillis };
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'POLL_UPDATED', text: `Edited the poll "${question}"` },
      (b) => b.update(target, patch),
    ),
  );
}

/** Closes or reopens a poll (ANNOUNCEMENTS_MANAGE). Reopening past a close date clears the close date. */
export async function setPollClosed(db: Firestore, actorUid: string, classId: string, poll: Poll, closed: boolean): Promise<void> {
  const clearExpired = !closed && poll.closesAtMillis > 0 && poll.closesAtMillis <= nowMillis();
  const patch = clearExpired ? { closed: false, closesAtMillis: 0 } : { closed };
  const target = poll.shared ? sharedPollRef(db, poll.id) : doc(pollsCol(db, classId), poll.id);
  await explainRefusal(db, classId, () =>
    commitLogged(
      db,
      classId,
      { actorUid, kind: 'POLL_CLOSED', text: `${closed ? 'Closed' : 'Reopened'} the poll "${poll.question}"` },
      (b) => b.update(target, patch),
    ),
  );
}

/** Deletes a poll and its votes (ANNOUNCEMENTS_MANAGE), with a History entry. */
export async function deletePoll(db: Firestore, actorUid: string, classId: string, poll: Poll): Promise<void> {
  if (poll.shared) {
    const votes = await getDocs(sharedPollVotesCol(db, poll.id));
    for (let i = 0; i < votes.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of votes.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
    const batch = writeBatch(db);
    batch.delete(sharedPollRef(db, poll.id));
    batch.delete(sharedPollLinkRef(db, classId, poll.id));
    await logToBatch(batch, db, classId, actorUid, 'POLL_DELETED', `Deleted the shared poll "${poll.question}"`);
    await explainRefusal(db, classId, () => batch.commit());
    // The partner classes' links one by one, after the poll is gone: a partner class deleted since then
    // refuses even the delete of a link it no longer has, and that must not keep the poll. A link left
    // behind points at nothing, and the News tab drops it.
    await Promise.all(
      (poll.linkedClassIds ?? [])
        .filter((cid) => cid !== classId)
        .map((cid) => deleteDoc(sharedPollLinkRef(db, cid, poll.id)).catch(() => undefined)),
    );
    return;
  }
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

/**
 * Called during class deletion (while the Mayor still holds permissions):
 * deletes any shared polls hosted by this class, their votes, and best-effort partner link pointers.
 */
export async function cleanupSharedPollsForDeletedClass(db: Firestore, classId: string): Promise<void> {
  const links = await getDocsFromServer(sharedPollLinksCol(db, classId)).catch(() => null);
  if (!links) return;
  for (const d of links.docs) {
    const pollId = d.id;
    const snap = await getDoc(sharedPollRef(db, pollId)).catch(() => null);
    if (!snap?.exists()) continue;
    const data = snap.data() as { hostClassId?: string; linkedClassIds?: string[] };
    if (data.hostClassId !== classId) continue;
    const votes = await getDocs(sharedPollVotesCol(db, pollId)).catch(() => null);
    if (votes) {
      for (let i = 0; i < votes.docs.length; i += 400) {
        const b = writeBatch(db);
        for (const v of votes.docs.slice(i, i + 400)) b.delete(v.ref);
        await b.commit().catch(() => undefined);
      }
    }
    await deleteDoc(sharedPollRef(db, pollId)).catch(() => undefined);
    for (const cid of data.linkedClassIds ?? []) {
      if (cid !== classId) {
        await deleteDoc(sharedPollLinkRef(db, cid, pollId)).catch(() => undefined);
      }
    }
  }
}

/** All local polls in the class, newest first. */
export function usePolls(db: Firestore, classId: string, enabled: boolean) {
  const live = useQueryList<Poll>(`v2/polls/${classId}/${enabled}`, enabled ? pollsCol(db, classId) : null, (d) => fromDoc(newPoll({}), d));
  return { ...live, data: live.data ? [...live.data].sort((a, b) => b.createdAtMillis - a.createdAtMillis) : live.data };
}

/** All votes on local polls that are not anonymous. */
export const usePollVotes = (db: Firestore, classId: string, enabled: boolean) =>
  useQueryList<PollVote>(`v2/pollVotes/${classId}/${enabled}`, enabled ? pollVotesCol(db, classId) : null, (d) => fromDoc(newPollVote({}), d));

/** The signed-in member's own ballots on local anonymous polls. */
export const useMyBallots = (db: Firestore, classId: string, uid: string, enabled: boolean) =>
  useQueryList<PollVote>(
    `v2/pollBallots/${classId}/${uid}/${enabled}`,
    enabled ? query(pollBallotsCol(db, classId), where('uid', '==', uid)) : null,
    (d) => fromDoc(newPollVote({}), d),
  );

/** Live cross-class shared polls linked to `classId`, plus their votes/ballots when `loadVotes` is true. */
export function useSharedPolls(db: Firestore, classId: string, uid: string, enabled: boolean, loadVotes: boolean) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [votesByPoll, setVotesByPoll] = useState<Record<string, PollVote[]>>({});

  useEffect(() => {
    if (!enabled || !classId) {
      setPolls([]);
      setVotesByPoll({});
      return;
    }
    const pollUnsubs = new Map<string, () => void>();
    const voteUnsubs = new Map<string, () => void>();
    const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const retryCounts = new Map<string, number>();
    const pollAnonState = new Map<string, boolean>();
    const pollsMap = new Map<string, Poll>();
    let disposed = false;

    const emitPolls = () => {
      if (disposed) return;
      setPolls(Array.from(pollsMap.values()).sort((a, b) => b.createdAtMillis - a.createdAtMillis));
    };

    const syncVoteSub = (pollId: string, anonymous: boolean) => {
      if (!loadVotes) {
        voteUnsubs.get(pollId)?.();
        voteUnsubs.delete(pollId);
        pollAnonState.delete(pollId);
        return;
      }
      if (voteUnsubs.has(pollId) && pollAnonState.get(pollId) === anonymous) return;
      voteUnsubs.get(pollId)?.();
      pollAnonState.set(pollId, anonymous);
      if (anonymous) {
        if (!uid) return;
        const unsub = onSnapshot(
          doc(sharedPollBallotsCol(db, pollId), uid),
          (snap) => {
            const list = snap.exists() ? [fromDoc(newPollVote({}), snap)] : [];
            setVotesByPoll((prev) => ({ ...prev, [pollId]: list }));
          },
          () => setVotesByPoll((prev) => ({ ...prev, [pollId]: [] })),
        );
        voteUnsubs.set(pollId, unsub);
      } else {
        const unsub = onSnapshot(
          sharedPollVotesCol(db, pollId),
          (snap) => {
            const list = snap.docs.map((d) => fromDoc(newPollVote({}), d));
            setVotesByPoll((prev) => ({ ...prev, [pollId]: list }));
          },
          () => setVotesByPoll((prev) => ({ ...prev, [pollId]: [] })),
        );
        voteUnsubs.set(pollId, unsub);
      }
    };

    const subscribePoll = (id: string) => {
      if (disposed || pollUnsubs.has(id)) return;
      const unsub = onSnapshot(
        sharedPollRef(db, id),
        (docSnap) => {
          retryCounts.delete(id);
          if (!docSnap.exists()) {
            pollsMap.delete(id);
            voteUnsubs.get(id)?.();
            voteUnsubs.delete(id);
            pollAnonState.delete(id);
          } else {
            const parsed = fromDoc(newPoll({}), docSnap);
            parsed.shared = true;
            parsed.courseId = parsed.linkedClasses?.[classId]?.courseId ?? '';
            pollsMap.set(id, parsed);
            syncVoteSub(id, parsed.anonymous);
          }
          emitPolls();
        },
        () => {
          unsub();
          pollUnsubs.delete(id);
          const attempts = retryCounts.get(id) ?? 0;
          if (!disposed && attempts < 2) {
            retryCounts.set(id, attempts + 1);
            const timer = setTimeout(() => {
              retryTimers.delete(id);
              subscribePoll(id);
            }, 800 * (attempts + 1));
            retryTimers.set(id, timer);
          } else {
            pollsMap.delete(id);
            emitPolls();
          }
        },
      );
      pollUnsubs.set(id, unsub);
    };

    const unsubLinks = onSnapshot(
      sharedPollLinksCol(db, classId),
      { includeMetadataChanges: true },
      (snap) => {
        // Wait until a newly created link doc is committed on the server before attaching a
        // per-doc listener to /sharedPolls/{id}; otherwise a racing LISTEN can hit PERMISSION_DENIED.
        const activeIds = new Set(snap.docs.filter((d) => !d.metadata.hasPendingWrites).map((d) => d.id));
        for (const [id, unsub] of pollUnsubs) {
          if (!activeIds.has(id)) {
            unsub();
            pollUnsubs.delete(id);
            const timer = retryTimers.get(id);
            if (timer) {
              clearTimeout(timer);
              retryTimers.delete(id);
            }
            retryCounts.delete(id);
            voteUnsubs.get(id)?.();
            voteUnsubs.delete(id);
            pollAnonState.delete(id);
            pollsMap.delete(id);
            setVotesByPoll((prev) => {
              if (!(id in prev)) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
        }
        for (const id of activeIds) {
          if (!pollUnsubs.has(id) && !retryTimers.has(id)) {
            subscribePoll(id);
          }
        }
        emitPolls();
      },
      () => {
        setPolls([]);
        setVotesByPoll({});
      },
    );

    return () => {
      disposed = true;
      unsubLinks();
      for (const unsub of pollUnsubs.values()) unsub();
      for (const unsub of voteUnsubs.values()) unsub();
      for (const timer of retryTimers.values()) clearTimeout(timer);
    };
  }, [db, classId, uid, enabled, loadVotes]);

  // The same array until a vote changes, so screens that memoize on it do not recount every poll each render.
  const votes = useMemo(() => Object.values(votesByPoll).flat(), [votesByPoll]);
  // The polls whose votes have arrived (also when there are none).
  const votesLoaded: ReadonlySet<string> = useMemo(() => new Set(Object.keys(votesByPoll)), [votesByPoll]);
  return { polls, votes, votesLoaded };
}
