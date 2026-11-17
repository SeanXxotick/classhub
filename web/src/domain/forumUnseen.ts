/**
 * What is new in the Forum for one member since a moment (their last visit): new questions by others, and
 * answers or replies addressed to them (on their questions, or under their answers). Their own posts, and
 * removed ones, never count. myPostIds are the ids of the member's questions and answers (from their author
 * records, so anonymous ones are included).
 */

export interface UnseenQuestion {
  id: string;
  uid: string;
  createdAtMillis: number;
}

export interface UnseenAnswer {
  id: string;
  questionId: string;
  parentId: string;
  uid: string;
  createdAtMillis: number;
  removedAtMillis: number;
}

export function forumUnseen<A extends UnseenAnswer>(
  questions: UnseenQuestion[], answers: A[], myUid: string, myPostIds: Set<string>, since: number,
): { newQuestions: number; toMe: A[]; total: number } {
  const mine = (id: string, uid: string) => uid === myUid || myPostIds.has(id);
  const myQuestions = new Set(questions.filter((q) => mine(q.id, q.uid)).map((q) => q.id));
  for (const id of myPostIds) myQuestions.add(id);
  const newQuestions = questions.filter((q) => q.createdAtMillis > since && !mine(q.id, q.uid)).length;
  const toMe = answers.filter(
    (a) =>
      a.createdAtMillis > since &&
      a.removedAtMillis === 0 &&
      !mine(a.id, a.uid) &&
      (myQuestions.has(a.questionId) || (a.parentId !== '' && myPostIds.has(a.parentId))),
  );
  return { newQuestions, toMe, total: newQuestions + toMe.length };
}
