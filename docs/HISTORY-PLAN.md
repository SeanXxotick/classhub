# History log overhaul (Nov 22)

Goal: log every officer action that changes records people rely on, and give officers filters that query
Firestore directly, so a busy log still lets them find one entry.

## New kinds and who may write them (firestore.rules, isHistoryEntry)

| Kind | Written when | Permission |
|---|---|---|
| ATTENDANCE_TAKEN | a new sheet is saved | ATTENDANCE_MANAGE |
| ATTENDANCE_REPLACED | a saved sheet is changed (lists the changes) | ATTENDANCE_MANAGE |
| ATTENDANCE_REMOVED | a sheet is removed | ATTENDANCE_MANAGE |
| NO_CLASS_MARKED | days or classes marked No classes | SCHEDULE_MANAGE |
| NO_CLASS_REMOVED | classes are back on | SCHEDULE_MANAGE |
| CONTENT_EDITED, CONTENT_DELETED | a link or file in Contents | CONTENTS_MANAGE |
| COURSE_ADDED, COURSE_EDITED, COURSE_DELETED | courses (rename or color is an edit) | CLASS_SETTINGS |
| MEETING_ADDED, MEETING_EDITED, MEETING_DELETED | timetable meetings | SCHEDULE_MANAGE |
| SCHEDULE_EDITED, SCHEDULE_DELETED | deadlines, quizzes, exams (a status change is an edit) | SCHEDULE_MANAGE |
| FORUM_MODERATED | an officer hides, shows, closes or reopens a question | ANNOUNCEMENTS_MANAGE |
| FORUM_QUESTION_DELETED, FORUM_ANSWER_REMOVED | only when the officer is not the writer | ANNOUNCEMENTS_MANAGE |
| COMMENT_REMOVED | only when the officer is not the writer | ANNOUNCEMENTS_MANAGE |
| ANNOUNCEMENT_POSTED, ANNOUNCEMENT_PINNED | new post (also from the Forum); pin or unpin | ANNOUNCEMENTS_MANAGE |
| MEMBER_LEFT | a member leaves on their own | any member, for themselves |

Texts never name an anonymous asker or answerer.

## Writing

`commitLogged(db, classId, note, write)` in data/history.ts: one batch with the action and its entry.
Writers take an optional `log` note; the screens build the sentence (they have the names).

## Filters (HistoryScreen)

- Group chips, queried with `kind in [...]`: All, Money, Attendance, Schedule, News and Forum,
  Contents, Members and roles, Settings.
- Officer picker: `actorUid ==`.
- "Up to" date: `atMillis <=` the end of that day, to jump back in time.
- Search: words in the entries loaded so far; Show older loads more.

Indexes (firestore.indexes.json, deploy with `--only firestore:indexes`): history (kind, atMillis desc),
(actorUid, atMillis desc), (actorUid, kind, atMillis desc).

## Deploy order

firestore:rules and firestore:indexes first (wait until the indexes finish building), then hosting.
