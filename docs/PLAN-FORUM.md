# Forum and announcement tags (Nov 17, 2026)

Approved design: `design/forum-mockup.html`, plus one level of replies under each answer.

## Data

`classes/{c}/forum/{questionId}`
- title (1 to 150), body (up to 2000), courseId ('' = General), anonymous
- uid and name: the asker, or both '' when anonymous
- createdAtMillis, editedAtMillis
- answerCount, lastAnswerId (kept by the answer batch, like announcement comments)
- bestAnswerId, bestAnswerUid, pickedBy ('', 'ASKER', 'OFFICER'), pickedAtMillis
- closed, hidden (officers)

`classes/{c}/forumAnswers/{answerId}`
- questionId, parentId ('' = answer, else the answer it replies to; one level only)
- uid and name ('' when anonymous; only the asker may answer or reply anonymously, on their own question)
- anonymous, text (1 to 1000), createdAtMillis, removedAtMillis (removing blanks the text, like comments)

`classes/{c}/forumAuthors/{questionId or answerId}` = { uid, questionId }
- One for every question and answer, written in the same batch.
- Readable only by its writer and by ANNOUNCEMENTS_MANAGE. This is what keeps anonymous posts anonymous,
  and what the sender reads to notify the writer.

`seen/{uid}` gains `forumAt` (when this member last opened the Forum) and `hideFromBoard`.

`announcements/{id}` gains an optional `courseId` (the tag). A course tag sends the notice to that course only.

## Rules (who may do what)

- Any member asks, answers and replies. The asker edits their own question (title, body, tag) and deletes it.
- The best answer: the asker or ANNOUNCEMENTS_MANAGE. It must be a live top-level answer to the same question,
  not anonymous and not by the asker. pickedBy records who picked. Anyone may clear a best answer whose text
  was removed.
- ANNOUNCEMENTS_MANAGE: close or reopen, hide or show, delete any question; remove any answer or reply.
- Hidden questions are read only by ANNOUNCEMENTS_MANAGE (members query `hidden == false`).
- Deleting a question: the question and its record go first; its answers and their records may then be
  deleted by anyone, since they belong to a question that no longer exists.

## Leaderboard

Computed in the app from the visible questions: one point per bestAnswerUid, this month by pickedAtMillis
(Manila), or all time. Current members only, without those who set hideFromBoard. No counters to keep.

## Notifications (new kinds, so they can be muted separately)

- FORUM_QUESTION: CLASS, or COURSE for a course tag.
- FORUM_ANSWER: new audience AUTHOR with audienceId = a question or answer id. The sender looks up
  forumAuthors to find who to tell, so an anonymous asker still hears about answers.
- An answer notifies the asker. A reply notifies the answer's writer and the asker.
- Sender change: audience AUTHOR, links for the two kinds. Needs a sender deploy.

## Steps

1. Rules and rules tests.
2. Data layer (data/forum.ts) and emulator tests.
3. Sender: AUTHOR audience, links, tests.
4. Screens: Announcements | Forum switch, tag picker on both, forum list, question page, ask dialog,
   top helpers, officer menu, tag field on announcements.
5. Red counts, class delete list (CLASS_SUBCOLLECTIONS), e2e test, wrap check at 320px.
