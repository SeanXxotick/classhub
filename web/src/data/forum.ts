/*
 * The Forum in the News tab (docs/PLAN-FORUM.md): members ask, answer and reply; the asker or a News
 * officer picks the best answer. Every question and answer has an author record in forumAuthors, readable
 * only by its writer and by News officers, so an anonymous post never names its writer anywhere else.
 */
import { collection, doc, getDocs, increment, query, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { nowMillis, newId } from './dataEnv';
import { UserError } from './errors';
import { fromDoc, useQueryList } from './live';
import { queueNotice } from './notify';
import { explainRefusal, withoutId } from './paths';
import { commitLogged, logToBatch, type LogNote } from './history';

export const QUESTION_TITLE_MAX = 150;
export const QUESTION_BODY_MAX = 2000;
export const ANSWER_MAX = 1000;

export interface ForumQuestion {
  id: string;
  title: string;
  body: string;
  /** The tag: a course id, or '' for General. */
  courseId: string;
  anonymous: boolean;
  /** The asker, or '' when anonymous. */
  uid: string;
  name: string;
  createdAtMillis: number;
  editedAtMillis: number;
  /** Answers and replies ever added (removed ones keep their place, so they count). */
  answerCount: number;
  lastAnswerId: string;
  bestAnswerId: string;
  bestAnswerUid: string;
  pickedBy: '' | 'ASKER' | 'OFFICER';
  pickedAtMillis: number;
  closed: boolean;
  hidden: boolean;
}

export const newQuestion = (q: Partial<ForumQuestion>): ForumQuestion => ({
  id: '', title: '', body: '', courseId: '', anonymous: false, uid: '', name: '', createdAtMillis: 0, editedAtMillis: 0,
  answerCount: 0, lastAnswerId: '', bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0, closed: false, hidden: false, ...q,
});

/** An answer (parentId '') or a reply to an answer (parentId = that answer's id). */
export interface ForumAnswer {
  id: string;
  questionId: string;
  parentId: string;
  uid: string;
  name: string;
  anonymous: boolean;
  text: string;
  createdAtMillis: number;
  removedAtMillis: number;
}

export const newAnswer = (a: Partial<ForumAnswer>): ForumAnswer => ({
  id: '', questionId: '', parentId: '', uid: '', name: '', anonymous: false, text: '', createdAtMillis: 0, removedAtMillis: 0, ...a,
});

/** Who wrote a question or answer (the document id is the post's id). */
export interface ForumAuthor {
  id: string;
  uid: string;
  questionId: string;
}

const col = (db: Firestore, classId: string, name: 'forum' | 'forumAnswers' | 'forumAuthors') => collection(db, 'classes', classId, name);
export const forumCol = (db: Firestore, classId: string) => col(db, classId, 'forum');
export const forumAnswersCol = (db: Firestore, classId: string) => col(db, classId, 'forumAnswers');
export const forumAuthorsCol = (db: Firestore, classId: string) => col(db, classId, 'forumAuthors');

type Actor = { uid: string; name: string };
const label = (actor: Actor, anonymous: boolean) => (anonymous ? 'An anonymous classmate' : actor.name);

// ---------------------------------------------------------------- Questions

/** Asks a question; returns its id. The class, or the course's students for a course tag, are told. */
export async function askQuestion(
  db: Firestore, actor: Actor, classId: string, input: { title: string; body: string; courseId: string; anonymous: boolean },
): Promise<string> {
  const title = input.title.trim().slice(0, QUESTION_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Write your question first.');
  const id = newId();
  const question = newQuestion({
    title, body: input.body.trim().slice(0, QUESTION_BODY_MAX), courseId: input.courseId, anonymous: input.anonymous,
    uid: input.anonymous ? '' : actor.uid, name: input.anonymous ? '' : actor.name, createdAtMillis: nowMillis(),
  });
  const batch = writeBatch(db);
  batch.set(doc(forumCol(db, classId), id), withoutId(question));
  batch.set(doc(forumAuthorsCol(db, classId), id), { uid: actor.uid, questionId: id });
  await explainRefusal(db, classId, () => batch.commit());
  void queueNotice(db, actor.uid, classId, {
    kind: 'FORUM_QUESTION',
    audience: input.courseId ? 'COURSE' : 'CLASS',
    audienceId: input.courseId,
    title: `${label(actor, input.anonymous)} asked: ${title}`,
    body: question.body,
  });
  return id;
}

/** The asker changes the words or the tag. */
export async function editQuestion(db: Firestore, classId: string, questionId: string, input: { title: string; body: string; courseId: string }): Promise<void> {
  const title = input.title.trim().slice(0, QUESTION_TITLE_MAX);
  if (!title) throw new UserError('NAME_MISSING', 'Write your question first.');
  await explainRefusal(db, classId, () =>
    updateDoc(doc(forumCol(db, classId), questionId), { title, body: input.body.trim().slice(0, QUESTION_BODY_MAX), courseId: input.courseId, editedAtMillis: nowMillis() }),
  );
}

/** Deletes a question (its asker or a News officer), then its answers and author records. */
export async function deleteQuestion(db: Firestore, classId: string, questionId: string, log?: LogNote): Promise<void> {
  const first = writeBatch(db);
  first.delete(doc(forumCol(db, classId), questionId));
  first.delete(doc(forumAuthorsCol(db, classId), questionId));
  if (log) await logToBatch(first, db, classId, log.actorUid, log.kind, log.text);
  await explainRefusal(db, classId, () => first.commit());
  // What is left belongs to a question that no longer exists, so anyone in the class may clear it.
  const answers = await getDocs(query(forumAnswersCol(db, classId), where('questionId', '==', questionId)));
  const records = await getDocs(query(forumAuthorsCol(db, classId), where('questionId', '==', questionId))).catch(() => null);
  const refs = [...answers.docs.map((d) => d.ref), ...answers.docs.map((d) => doc(forumAuthorsCol(db, classId), d.id))];
  if (records) for (const d of records.docs) if (!refs.some((r) => r.id === d.id && r.parent.id === 'forumAuthors')) refs.push(d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit().catch(() => undefined);
  }
}

/** News officers: close to new answers, or hide from the class. */
export const setQuestionFlags = (db: Firestore, classId: string, questionId: string, flags: { closed?: boolean; hidden?: boolean }, log?: LogNote) =>
  explainRefusal(db, classId, () => commitLogged(db, classId, log, (b) => b.update(doc(forumCol(db, classId), questionId), flags)));

/** Picks the best answer (null clears it). The asker's pick says so; a News officer's pick says it was an officer. */
export function pickBest(db: Firestore, classId: string, questionId: string, answer: ForumAnswer | null, byAsker: boolean): Promise<void> {
  const fields = answer
    ? { bestAnswerId: answer.id, bestAnswerUid: answer.uid, pickedBy: byAsker ? 'ASKER' : 'OFFICER', pickedAtMillis: nowMillis() }
    : { bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0 };
  return explainRefusal(db, classId, () => updateDoc(doc(forumCol(db, classId), questionId), fields));
}

// ---------------------------------------------------------------- Answers and replies

/**
 * Adds an answer (parentId '') or a reply, with its author record and the question's count, in one batch.
 * The asker hears about answers; a reply also tells the answer's writer. Only the asker may post anonymously.
 */
export async function addAnswer(
  db: Firestore, actor: Actor, classId: string, question: ForumQuestion, parent: ForumAnswer | null, text: string, anonymous: boolean,
): Promise<void> {
  const body = text.trim().slice(0, ANSWER_MAX);
  if (!body) throw new UserError('NAME_MISSING', 'Write something first.');
  const id = newId();
  const answer = newAnswer({
    questionId: question.id, parentId: parent?.id ?? '', uid: anonymous ? '' : actor.uid, name: anonymous ? '' : actor.name,
    anonymous, text: body, createdAtMillis: nowMillis(),
  });
  const batch = writeBatch(db);
  batch.set(doc(forumAnswersCol(db, classId), id), withoutId(answer));
  batch.set(doc(forumAuthorsCol(db, classId), id), { uid: actor.uid, questionId: question.id });
  batch.update(doc(forumCol(db, classId), question.id), { answerCount: increment(1), lastAnswerId: id });
  await explainRefusal(db, classId, () => batch.commit());

  const who = label(actor, anonymous);
  const short = question.title.length > 60 ? `${question.title.slice(0, 57)}...` : question.title;
  // The asker, unless they wrote this themselves (the sender also skips whoever caused a notice).
  void queueNotice(db, actor.uid, classId, {
    kind: 'FORUM_ANSWER', audience: 'AUTHOR', audienceId: question.id,
    title: parent ? `${who} replied on your question "${short}"` : `${who} answered "${short}"`, body,
  });
  // The answer's writer, when that is someone other than the asker.
  const parentIsAsker = !!parent && (parent.anonymous || (!question.anonymous && parent.uid === question.uid));
  if (parent && !parentIsAsker) {
    void queueNotice(db, actor.uid, classId, { kind: 'FORUM_ANSWER', audience: 'AUTHOR', audienceId: parent.id, title: `${who} replied to your answer`, body });
  }
}

/**
 * Removes an answer's text (its writer or a News officer); it keeps its place. A removed best answer
 * stops being the best answer in the same batch.
 */
export async function removeAnswer(db: Firestore, classId: string, answer: ForumAnswer, question: ForumQuestion, log?: LogNote): Promise<void> {
  const batch = writeBatch(db);
  if (log) await logToBatch(batch, db, classId, log.actorUid, log.kind, log.text);
  batch.update(doc(forumAnswersCol(db, classId), answer.id), { text: '', removedAtMillis: nowMillis() });
  if (question.bestAnswerId === answer.id) {
    batch.update(doc(forumCol(db, classId), question.id), { bestAnswerId: '', bestAnswerUid: '', pickedBy: '', pickedAtMillis: 0 });
  }
  await explainRefusal(db, classId, () => batch.commit());
}

// ---------------------------------------------------------------- Reading

/** The questions this member may see, newest first. Hidden ones only reach News officers. */
export function useForum(db: Firestore, classId: string, manage: boolean, enabled: boolean) {
  const q = !enabled ? null : manage ? forumCol(db, classId) : query(forumCol(db, classId), where('hidden', '==', false));
  const live = useQueryList<ForumQuestion>(`v2/forum/${classId}/${manage}/${enabled}`, q, (d) => fromDoc(newQuestion({}), d));
  return { ...live, data: live.data ? [...live.data].sort((a, b) => b.createdAtMillis - a.createdAtMillis) : live.data };
}

/** The answers and replies of one question, oldest first. Loaded only while it is open. */
export function useForumAnswers(db: Firestore, classId: string, questionId: string) {
  const live = useQueryList<ForumAnswer>(
    `v2/forumAnswers/${classId}/${questionId}`,
    query(forumAnswersCol(db, classId), where('questionId', '==', questionId)),
    (d) => fromDoc(newAnswer({}), d),
  );
  return { ...live, data: live.data ? [...live.data].sort((a, b) => a.createdAtMillis - b.createdAtMillis) : live.data };
}

/** Answers and replies written after `since`, for the red counts. */
export const useForumAnswersSince = (db: Firestore, classId: string, since: number, enabled: boolean) =>
  useQueryList<ForumAnswer>(
    `v2/forumAnswersSince/${classId}/${since}/${enabled}`,
    enabled ? query(forumAnswersCol(db, classId), where('createdAtMillis', '>', since)) : null,
    (d) => fromDoc(newAnswer({}), d),
  );

/** Author records: all of them for News officers (to see who wrote anonymous posts), else only this member's own. */
export const useForumAuthors = (db: Firestore, classId: string, uid: string, manage: boolean, enabled: boolean) =>
  useQueryList<ForumAuthor>(
    `v2/forumAuthors/${classId}/${uid}/${manage}/${enabled}`,
    !enabled ? null : manage ? forumAuthorsCol(db, classId) : query(forumAuthorsCol(db, classId), where('uid', '==', uid)),
    (d) => fromDoc<ForumAuthor>({ id: '', uid: '', questionId: '' }, d),
  );

/** Remembers when this member last opened the Forum, for its red count. */
export const markForumSeen = (db: Firestore, classId: string, uid: string) =>
  setDoc(doc(db, 'classes', classId, 'seen', uid), { forumAt: nowMillis() }, { merge: true });

/** Leaves this member out of the top helpers list (they still earn points). */
export const setHideFromBoard = (db: Firestore, classId: string, uid: string, hide: boolean) =>
  setDoc(doc(db, 'classes', classId, 'seen', uid), { hideFromBoard: hide }, { merge: true });
