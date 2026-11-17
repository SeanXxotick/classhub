import { describe, expect, it } from 'vitest';
import { forumUnseen } from './forumUnseen';

const q = (id: string, uid: string, at = 200) => ({ id, uid, createdAtMillis: at });
const a = (id: string, questionId: string, uid: string, parentId = '', at = 200, removedAtMillis = 0) => ({ id, questionId, parentId, uid, createdAtMillis: at, removedAtMillis });

describe('forumUnseen', () => {
  // me asked q1 openly and q2 anonymously (uid ''), and wrote answer a9 on someone else's q3.
  const questions = [q('q1', 'me'), q('q2', ''), q('q3', 'kim'), q('q4', 'ben', 50)];
  const mine = new Set(['q2', 'a9']);

  it('counts new questions by others, not my own (anonymous included) or old ones', () => {
    expect(forumUnseen(questions, [], 'me', mine, 100).newQuestions).toBe(1);
  });

  it('counts answers on my questions and replies under my answers, by others, since my last visit', () => {
    const answers = [
      a('x1', 'q1', 'kim'),
      a('x2', 'q2', 'ben'),
      a('x3', 'q3', 'ben', 'a9'),
      a('x4', 'q3', 'ben'), // on someone else's question, not under my answer
      a('x5', 'q1', 'me'), // my own
      a('x6', 'q2', ''), // my own anonymous reply... only if its id is mine
      a('x7', 'q1', 'kim', '', 50), // before my last visit
      a('x8', 'q1', 'kim', '', 200, 300), // removed
    ];
    const result = forumUnseen(questions, answers, 'me', new Set([...mine, 'x6']), 100);
    expect(result.toMe.map((x) => x.id)).toEqual(['x1', 'x2', 'x3']);
    expect(result.total).toBe(4);
  });
});
