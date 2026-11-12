# ClassHub web app audit plan (Nov 12, 2026)

A full pass over the web app for bugs, outdated text and unclear screens. Part A lists what a first
read of the code already found. Part B is the browser walk that still has to be done. Work through
Part A first, then Part B, and add anything new you find to the list at the bottom.

## Rules for this work

- Branch `v2`. Commit only when the user says so, with no Claude co-author line. Ask before every push.
- User-facing text has no contractions ("does not", "cannot").
- Do not use subagents. Read only what you need, keep command output filtered, few screenshots.
- Never read or commit `BSM CS 3A Ultimate Spreadsheet (1st Semester).xlsx` or anything in `Documents/classhub-backup`.
- The untracked video files in the repo root are not ClassHub's. Leave them alone.
- Deploys are run by the user: `! cd "C:/Users/XxotickSXC/Desktop/SWE FCO" && firebase deploy --only hosting:web`
  (rules first with `--only firestore:rules` if `firestore.rules` changed). Run `npm run build` in `web/` before asking.
- Test only against the local emulator, never the live site.

## Setup and checks

Emulators and the dev server are usually already running (ports 9099, 8080, 5173). If not:
`firebase emulators:start --only auth,firestore --project demo-classhub` (JAVA_HOME = Android Studio jbr) and,
in `web/`, `npm run dev:emu -- --host 127.0.0.1 --port 5173 --strictPort`.
Seed: `npx vite-node scripts/seed-emulator.ts`. Accounts: mayor@test.com and student@test.com, password classhub123.

In `web/`:
- `npx tsc --noEmit -p .`
- `npx vitest run` (118 pass)
- `npx playwright test` (25; wipes the emulator, so reseed after)
- `EMU_PROJECT=demo-emu-test FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run --config vitest.emu.config.ts` (25)
- `cd ../firestore-tests && EMU_PROJECT=demo-rules node rules.test.js` (249)

All five passed on Nov 12 after the last changes.

For one-off browser checks, write a small Playwright script outside the repo that starts with
`createRequire('C:/Users/XxotickSXC/Desktop/SWE FCO/web/package.json')`, signs in, and sets
`localStorage['classhub.welcomeSeen'] = '1'` before opening a class (otherwise the welcome tour covers the page).

## Part A: findings from reading the code

**Status (Nov 12, late): A1 to A6 are all fixed and checked in the browser against the emulator.**
What was done: A2 exports show "Exporting works in a browser..." inside the Android app and Print is hidden there;
A3 deleting a course deletes its meetings when the person has Manage schedule, and meetings of a missing course are
hidden everywhere (`useLiveMeetings` in `FeatureUi.tsx`); A4 every text listed was updated (claims now say "the
treasurer" in lower case, the generic word the ledger settings already use); A5 announcement delete, comment remove and
meeting delete use `ConfirmDialog`; A6 member row colour, What you can do skips modules that are off, Take attendance
refuses future dates and warns on a No classes day, Class attendance uses "Last, First", Add meeting is disabled with
no courses, the sidebar Android link follows the device. The grep for other hand-typed lists found nothing that drifted.
Outbox notices of a deleted class are cleared by the sender within minutes (clients may not delete them).
Two stale Playwright expectations were fixed (course name message says 80; Getting started keeps its heading after Hide).
Left as an option for the user: a native download and print bridge for the Android app (needs a new APK).
Not checked on a real phone: the export notice inside the Android app (checked with a faked Capacitor object).


Line numbers are from Nov 12 and may have moved. "Confirmed" means the code leaves no doubt.
"Check" means reproduce it in the browser before fixing.

### A1. Timetable module removed (DONE Nov 12)
The user chose to drop the separate Timetable switch: the timetable, attendance and the Classes card on
Home now follow the Schedule module (`scheduleEnabled`). The `timetableEnabled` field stays in the data
and the rules, unused by the screens. Nothing left to do here, but the Playwright suite was not rerun
after this change; run it once.

### A2. Exports and Print do nothing inside the Android app (Confirmed by code, check on a phone if possible)
"Export CSV" (Ledger), "Export to Excel" (Class attendance) and "Print" (My statement) use a blob
download and `window.print()`. Capacitor's Android WebView has no download listener
(`node_modules/@capacitor/android` has no `DownloadListener`) and cannot print, so the buttons fail silently.
Fix (web only, no new APK): inside the Android app (`window.Capacitor.isNativePlatform()`), tapping an
export shows a notice such as "Exporting works in a browser. Open classhub-web.web.app in Chrome or on a
computer.", and the Print button is hidden. A real fix needs native code and a new APK; list it as an
option for the user, do not build it unasked.

### A3. Deleting a course leaves its timetable meetings behind (Check)
`classRepo.deleteCourse` deletes only the course document. Its meetings stay and show as a block named
"Course" in the timetable, Today card and the Take attendance list. No-classes marks, attendance and
schedule items keep the dead id too.
Fix: hide meetings whose course no longer exists everywhere they are listed, and say so in the delete
dialog. If the person deleting also has SCHEDULE_MANAGE, delete those meetings in the same action
(the rules require that permission for meetings; check `firestore.rules` before writing).

### A4. Outdated or wrong text (Confirmed)
- `ManageScreens.tsx` `permissionLabel`: "Manage schedule: Deadlines, quizzes and exams" also covers the
  timetable and no-classes days, and the types are now Deliverable, Quiz, Exam, Recitation, Project.
  "Manage members" also approves join requests. "Class settings and courses" also covers the photo and icons.
- `ManageScreens.tsx` Modules: "Schedule: Deadlines, quizzes and exams" (same type names issue).
- `ManageScreens.tsx` member page: "Skipped when charging this course", and Courses screen hint "charges by
  course will skip them". Not taking a course now also hides its schedule items, contents, timetable
  meetings and attendance.
- `ManageScreens.tsx` Delete class: lists "ledger, schedule, contents, courses and roles" (twice). It also
  deletes announcements, the timetable and attendance.
- `FeatureUi.tsx` timetable empty state: "Add courses in Class settings first". Courses are under
  Home, Manage, Courses.
- `AccountScreen.tsx` Android card: "has everything here, plus reminders on your phone for due dates, new
  class materials and money you owe". The web app sends notifications too, and there are no notifications
  for new materials or money owed (see `NOTICE_KINDS` in `data/notify.ts`).
- `FeatureUi.tsx` claims: "so the Treasurer can confirm it" and "waiting for the Treasurer". Roles can be
  renamed; say "an officer who manages the ledger" or similar. The welcome tour says "treasurer" as well.
- `MySettingsScreen.tsx`: "only for you, in this browser" also shows inside the Android app; "on this
  device" fits both. "To come back, you will need a new invite code" should be "the invite code".
- `data/paths.ts` comment above `CLASS_SUBCOLLECTIONS` says claims, announcements and others "are not open
  yet". They are. Also check whether `outbox` documents are left behind when a class is deleted
  (see how `sender/src/worker.js` clears them, and what the rules allow).

### A5. Browser pop-ups instead of the app's own dialog (Confirmed)
Deleting an announcement and removing a comment use `window.confirm` (`FeatureUi.tsx`). Every other
delete uses `ConfirmDialog`. Switch these two. Deleting a timetable meeting has no confirmation at all;
add one.

### A6. Smaller things to check
- `ClassScreen.tsx` `MemberRow`: the line under a name turns red when the balance is negative, even when
  the balance itself is not shown to this viewer. Colour it only when the balance text is shown.
- Home "What you can do" lists permissions of modules that are turned off (for example Take attendance
  with the timetable off). Consider hiding those lines.
- Take attendance: nothing warns when the chosen date is marked "No classes" or is in the future.
- Class attendance dialog shows "First Last" while every other list shows "Last, First" (`listName`).
- Add meeting can be opened with no courses; Save then fails with a message. Disable the button and say why.
- Sidebar "Get the Android app" shows on iPad too (the Account card is already device-aware through
  `domain/installCard.ts`).
- A hand-typed list that drifted is what caused the "What you can do" bug. Grep for other hand-typed lists
  of permissions, modules, record types, schedule kinds, notice kinds and tabs, and build them from the
  constants in `data/models.ts` and `data/notify.ts` where they are not already.

## Part B: browser walk

Done by script on Nov 12 to 13; see "Found during the walk" for results and what is left. The original brief: do each screen as the mayor and as the student, at 1280 px and at 390 px wide, in light and
dark theme. Watch the console for errors. Check that the page never scrolls sideways
(`document.documentElement.scrollWidth - clientWidth` should be 0).

Screens: sign in, create account, forgot password, My classes, Add a class (create and join with a code,
wrong code, pending approval), Account (name, photo, appearance, notifications, install card, sign out,
delete account), class Home, Ledger (every record type, charge by course, pay-out, void, undo charge,
claims: send, confirm, reject, cancel; My statement; ledger settings; opening balances), Schedule (add,
edit, cancel, done, filters, calendar, day pick), Timetable (add, edit, delete, clash, full week, no
classes), Attendance (take, retake, my attendance, class attendance, export), Contents (add, edit, delete,
search, filters, own icon and colour), News (post, edit, pin, comments off, comment, reply, vote, remove,
seen by), Members (open a member, role, courses, remove, join requests), Roles (new, edit, delete, Mayor
colour), Courses (add, rename, colour, delete), Class settings (every switch, icons, photo, delete class),
My settings (start tab, pin, leave, Mayor hand-over), the welcome tour and Getting started.

Edge cases to try on each form and list:
- The longest text each field allows, and one long word with no spaces (announcement titles and messages
  were fixed on Nov 12; check course names up to 80, class name, role name, member names, schedule titles,
  content titles and links, rooms, professors, notes, reasons, payment info).
- Empty states: a new class with nothing in it; a student who takes no courses; a class with every module off.
- Many items: 30+ members, records, schedule items, contents, announcements, comments.
- Amounts: 0, negative, very large, more than two decimals, commas, letters.
- Dates: today, past, far future, a day with no meetings.
- Each permission alone: make a role with only one permission and check that its tab works and nothing
  else offers buttons that then fail.
- A second browser as another member while the first one changes things (live updates, removal from class).
- Offline and back online.

Visual clarity: cramped rows, text cut off, buttons that wrap badly, low contrast in dark theme, icons
without labels, anything that needs explaining.

## Done when

Every item above is fixed, declined by the user, or written down as needing a decision; the five checks
pass; and the user has a short list of what changed, what was left and why.

## Found during the walk

Walk done Nov 12 to 13 with scripts against the emulator: every tab and sub-screen, as the mayor and as the student,
at 1280 px and 390 px, light and dark, first with the seed data and then with every text stretched to its longest as
one unbroken word. No page errors, no console errors. Also checked: each permission alone (only its own buttons
appear, and a role change arrives without a reload), and a class with every module off.

Fixed:
- Schedule tab scrolled sideways (96 px) on a wide screen when a title was one long word: `.split` second column is
  now `minmax(0, 1fr)` (also used by the Ledger and Charge screens).
- A person with a short surname got the wrong avatar letters ("Ana Lim" showed "LIM", the course-number rule).
  People now use `personInitials` (first and last word). Class initials ignore punctuation ("M(" is now "MT").
- A long role name squeezed the member's name to nothing on a phone: the chip in a list row is capped at 42%.
- Reported by the user from the live class: a role with no permissions ("Vice Mayor") had no chip on announcements
  and comments. The byline now shows the chip for every role except the class's default member role.
- Reported by the user: members whose app never saved the last-name form (joined before it existed) showed first
  name first in Members and every other list. `listName` now works it out from the display name.

Seen, left as they are:
- The floating Add / New record button covers part of a row until the page is scrolled (normal for this kind of button).
- Filter chip rows scroll sideways on a phone by design.

Not done (need a person or a real device):
- Offline and back online; two people editing at the same moment.
- 30+ items of each kind for scrolling and speed; photos; the real Android app and a real iPhone.
- Forms were covered by the Playwright suite and unit tests (amounts: 0, negative, letters, three decimals, commas),
  not retyped by hand in every form.
