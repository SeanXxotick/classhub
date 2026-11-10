# ClassHub 2.0 - Plan

ClassHub passed its defense as version 1.3.2 (native Android) plus the web app. Version 2.0 is the overhaul for real, long-term use by the class. This plan replaces [PLAN.md](PLAN.md) for all new work; PLAN.md stays as the record of version 1.

Agreed with the project lead on 2026-11-10.

## Decisions

| Topic | Decision |
|---|---|
| Codebase | One codebase: the web app (React + TypeScript + Vite). The Android app becomes the same app inside a Capacitor shell. |
| Native Kotlin app | Tagged `native-1.3.2`, then removed from `main`. |
| Existing data | Every class and its data is deleted at go-live (they were tests). Sign-in accounts, names and photos are kept. |
| Data model | A new v2 structure. No compatibility with v1 is needed. |
| Design | Refine the current look: teal `#0F766E`, the four-tile logo, Roboto, cards. Make it consistent everywhere. |
| Joining | Invite code or link, then an officer with `MEMBERS_MANAGE` approves the request. |
| Balances | A ledger setting, changed by anyone with `RECORDS_MANAGE`: whole class, officers only, or treasurers only. The Mayor always sees everything. |
| "Officer" | Anyone whose role has at least one permission. |
| Hidden balances | A member still sees their own records, the fund totals and the pay-outs from the fund. |
| Ledger balances | No limits. Any balance may go below zero: a student can withdraw more than they have in, and the cash on hand can go negative. |
| Ledger history | Records are never deleted. They are voided with a reason, and show who made them and when. |
| Payment claims | Amount, method (GCash, Maya, bank, other), reference number, optional screenshot. The screenshot is deleted when the claim is decided. |
| Announcements | Officers post, members read. Pins and "Seen by X of Y". No comments. |
| Timetable | Weekly meetings per course. An officer can mark one course or the whole day as "no classes" on a date, with a reason. |
| Semesters | A new class each semester. Balances move over as opening balances. |
| Notifications | Real push on phone and browser, with a free sender (no Blaze plan). |
| Android delivery | APK, as now. No Play Store. |
| Schedule | No fixed date. Release in stages, each one solid before the next. |

## What changes for the class

- One last APK install replaces the old app (same package name and signing key, so it installs over 1.3.2). After that, most updates arrive by themselves.
- iPhone and laptop users get the same app in the browser, installable to the home screen and usable offline.
- Version 1.3.2 phones see the existing "Update required" dialog at go-live (`appConfig/latest.minVersionCode`).

## Architecture

```
web/                 the app (React + TypeScript + Vite), also what the APK shows
  src/domain/        pure rules (money, ledger, schedule, permissions): unit tested
  src/data/          Firestore and Auth access, one module per feature
  src/features/      one folder per feature: screens, hooks and styles together
  src/design/        tokens (colors, type, spacing) and shared components
android/             Capacitor shell: notifications, share target, invite links
sender/              the notification sender (runs on a schedule, outside the app)
firestore.rules      v2 security rules
firestore-tests/     rules tests
tools/               admin scripts (dry run by default)
```

- **Capacitor shell.** The APK opens the hosted app (`https://classhub-web.web.app`), so a web deploy updates every phone. A service worker keeps it working offline after the first open. A new APK is only needed when the shell itself changes; the existing update dialog covers that.
- **Offline.** A service worker (vite-plugin-pwa) caches the app; Firestore's local cache (already on) keeps the data.
- **Splitting large files.** `styles.css` (1,677 lines), `ManageScreens.tsx` (824) and `ClassContext.tsx` (465) are split by feature during the rebuild. Plain CSS with shared tokens stays; no new UI framework.

## Data model (v2)

```
users/{uid}
    displayName, firstName, middleInitial, lastName, email, mustChangePassword
users/{uid}/devices/{deviceId}
    token, platform (ANDROID|WEB), updatedAtMillis          (push tokens; only the owner writes)

invites/{code}
    classId, className

classes/{classId}
    name, description, ownerUid, accentColor, inviteCode, defaultRoleId,
    ledgerEnabled, scheduleEnabled, contentsEnabled, announcementsEnabled, timetableEnabled,
    balanceVisibility (EVERYONE|OFFICERS|TREASURERS),
    paymentInfo (text: where to send GCash and so on),
    archivedAtMillis (0 = active), carriedOverTo (classId or empty),
    icon and color maps, createdAtMillis

classes/{classId}/roles/{roleId}            name, colorHex, permissions, locked
classes/{classId}/courses/{courseId}        name
classes/{classId}/members/{uid}
    uid, name, roleId, joinedAtMillis, excludedCourseIds, approvedByUid
classes/{classId}/joinRequests/{uid}
    uid, name, className, joinCode, requestedAtMillis
classes/{classId}/openingBalances/{uid}
    amountCentavos (signed), note           (applied as an OPENING record when that student is approved)

classes/{classId}/records/{id}
    type (PAYMENT|CHARGE|WITHDRAWAL|EXPENSE|OPENING), amountCentavos, memberId, memberName, note,
    dateMillis, batchId, courseId, settlesBatchId, paidTo, claimId,
    createdByUid, createdAtMillis,
    voidedAtMillis, voidedByUid, voidReason
classes/{classId}/summary/fund
    cashOnHandCentavos, waitingPayoutCentavos, balancesTotalCentavos, recordCount, updatedAtMillis

classes/{classId}/claims/{id}
    memberId, memberName, amountCentavos, method, reference, note,
    status (PENDING|CONFIRMED|REJECTED), createdAtMillis,
    decidedByUid, decidedAtMillis, rejectReason, recordId, hasProof
classes/{classId}/claims/{id}/proof/image   photo (small Base64 JPEG), deleted when the claim is decided

classes/{classId}/schedule/{id}             as v1 (deadlines, quizzes, exams)
classes/{classId}/progress/{uid}            done marks, as v1
classes/{classId}/meetings/{id}             courseId, dayOfWeek, startMinutes, endMinutes, room, note
classes/{classId}/noClass/{id}              dateKey (YYYY-MM-DD), courseId (empty = whole day), reason, createdByUid
classes/{classId}/contents/{id}             as v1
classes/{classId}/announcements/{id}        title, body, pinned, createdByUid, createdAtMillis, editedAtMillis
classes/{classId}/seen/{uid}                announcements: { id: seenAtMillis }
classes/{classId}/outbox/{id}               kind, audience, refId, createdByUid, createdAtMillis   (notification requests)

clientErrors/{id}                           message, stack, appVersion, platform, atMillis   (create only)
```

### What this fixes

- **"My classes" has no copy any more.** `users/{uid}/memberships` is gone. The list is a collection-group query on `members` where `uid` is the signed-in user (and on `joinRequests` for classes still waiting). This removes the rejoin bug, the stale class names and the entry that disappeared.
- **Joining needs approval.** A code creates a `joinRequests` entry. An officer approves it, which creates the member entry (default role only), applies any opening balance and deletes the request in one batch. Rejecting deletes the request.
- **The ledger keeps its history.** Records cannot be deleted or edited. Voiding sets the three `voided` fields once; voided records are left out of every total and stay visible, crossed out, with the reason. A paid-out charge still cannot be voided before its pay-out.
- **Opening balances.** `OPENING` moves a student's balance and the cash on hand by the same signed amount, so the books check still holds.

### No limits on balances

- The ledger records what happened; it does not refuse a transaction because of a balance.
- A withdrawal may be larger than the student's balance. They then show as owing the class.
- Charges and pay-outs are not limited by a balance or by the cash on hand either, so cash on hand can be negative.
- The forms show the balance that will result, as information only. Nothing is blocked.
- The security rules do not check balances.
- What stays: an amount must be greater than zero and at most ₱1,000,000 (a typo guard), every pay-out settles exactly one charge for its total, and the books check must still balance.
- Deleting a class, starting the next semester and the go-live import are the only steps that look at balances, because they close or move the books.

### Balance visibility

Security rules cannot filter a list, so the queries change with the setting:

| Viewer | Can read |
|---|---|
| Mayor, roles with `RECORDS_MANAGE` | every record |
| Officers, when the setting is OFFICERS or EVERYONE | every record |
| Members, when the setting is EVERYONE | every record |
| Anyone else | records where `memberId` is their own, plus all `EXPENSE` records, plus `summary/fund` |

- `summary/fund` holds the fund totals so a member can see "Cash on hand" and "Books balanced" without reading other students' records.
- The treasurer's app updates the summary in the same batch as every record write (increments, so two treasurers do not overwrite each other). Whenever someone who can read every record opens the ledger, the app recomputes the totals and repairs the summary if it differs.
- The Members tab shows balances only to people who may read every record.

### Permissions

| Key | Allows | New in v2 |
|---|---|---|
| `RECORDS_MANAGE` | Add and void records, decide payment claims, set balance visibility and payment info | visibility, claims |
| `SCHEDULE_MANAGE` | Deadlines and exams, the timetable, "no classes" marks | timetable |
| `MEMBERS_MANAGE` | Approve or reject join requests, remove members, assign roles, new invite code | approval |
| `ROLES_MANAGE` | Create, edit and delete roles | |
| `CLASS_SETTINGS` | Name, color, modules, courses | |
| `CONTENTS_MANAGE` | Class content links | |
| `ANNOUNCEMENTS_MANAGE` | Post, edit, pin and delete announcements | new |

Default roles: Mayor (all, locked), Treasurer (`RECORDS_MANAGE`), Secretary (`SCHEDULE_MANAGE`, `CONTENTS_MANAGE`, `ANNOUNCEMENTS_MANAGE`), Member (none).

## Features

### Payment claims
- The Ledger shows the class's payment info (for example the Treasurer's GCash number) and an **I paid** button.
- The student enters amount, method and reference number, and may attach a screenshot. It appears as "Waiting for the Treasurer".
- The Treasurer sees a **Claims** list with a count. **Confirm** creates the `PAYMENT` record (linked by `claimId`) in the same batch. **Reject** needs a reason. The student is notified either way.
- A student can cancel a claim that is still waiting. The same reference number twice in one class shows a warning to the Treasurer.

### Statements and export
- **My statement:** a student's records with a running balance, printable or saved as PDF from the browser's print dialog.
- **Export:** people who can read every record can download the ledger and the balances as CSV.

### Announcements
- A feed on Home and its own tab: pinned first, then newest.
- Opening a post marks it seen; officers see "Seen by X of Y" with names.

### Timetable
- A weekly grid of meetings (course, time, room). Home shows "Today" and "Tomorrow".
- **No classes:** pick a date, then one course or the whole day, with an optional reason. The meeting shows as cancelled and the class is notified.
- Times are shown in Philippine time.

### Notifications

| Notification | Goes to | When |
|---|---|---|
| New deadline, quiz or exam | The class (students taking that course) | When posted |
| Due tomorrow | Students who have not marked it done | Evening before |
| No classes | The class | When marked |
| New announcement | The class | When posted |
| Payment claim sent | Roles with `RECORDS_MANAGE` | When sent |
| Claim confirmed or rejected | That student | When decided |
| Join request | Roles with `MEMBERS_MANAGE` | When sent |
| Request approved | That student | When approved |
| You owe X | That student | Weekly at most |

- **How it is sent, for free.** The app writes a small request to `classes/{classId}/outbox` in the same batch as the action. A scheduled sender reads the outbox, finds the device tokens and sends through Firebase Cloud Messaging (which is free). Time-based ones ("due tomorrow") are worked out by the sender.
- **Where the sender runs.** First choice: a Cloudflare Worker on a cron trigger (free, no card, runs every few minutes). This is tried first as a small experiment, because the free tier has a tight CPU limit. Fallback: a GitHub Actions schedule every 30 minutes (15 minutes would use more than the 2,000 free minutes a private repo gets each month).
- Notifications arrive within a few minutes, not instantly. Instant delivery needs the paid plan, which was ruled out.
- Each kind can be switched off in Account. iPhones receive them only when the app is added to the home screen (iOS 16.4 or later).

### Share to ClassHub
- Android shell: ClassHub appears in the share sheet for links; the Add content form opens with the link filled in.
- Installed web app on Android: the same through the manifest's share target.

### New class each semester
- **Start next semester** (Mayor): creates a new class copied from the current one (roles, settings, payment info), writes each student's closing balance to the new class's `openingBalances`, and archives the old class.
- An archived class is read-only (enforced by the rules) and stays in "My classes" under Past classes.
- Students join the new class with its code; on approval their opening balance is applied.
- The same `openingBalances` step is used at go-live to bring in the balances from the class spreadsheet.

## Looking after the app

- **CI (GitHub Actions):** on every push: type check, unit tests, rules tests on the emulator, browser tests, build.
- **Error log:** unexpected errors in the app are written to `clientErrors` (no personal data beyond the version and screen), so crashes on classmates' phones are visible.
- **Backups:** a weekly scheduled job exports the database to an encrypted file kept as a private workflow artifact. Real student data never goes into the git history.
- **Admin scripts** keep the v1 habit: dry run by default, `--apply` to write, and the project lead runs anything that deletes.

## Phases

Each phase ends with all tests passing. Work happens on a `v2` branch against the emulators and a Hosting preview channel; the live site stays on v1 until the 2.0 go-live.

| Phase | What | Result |
|---|---|---|
| 0. Prepare | Tag `native-1.3.2`, create `v2`, remove the Kotlin app from the branch, set up CI | Clean branch with CI |
| 1. Foundation | v2 models, rules and rules tests; domain changes (void, `OPENING`, visibility, summary); join requests; "My classes" query | Data layer and rules done and tested |
| 2. Design | Tokens and shared components; clickable mockups of Home, Ledger, Schedule, Contents, Members, Account in light and dark, phone and desktop | Mockups approved by the project lead |
| 3. Rebuild | Every existing screen on the new design and data layer; void with reason; balance visibility; join approval; files split by feature | Feature parity with v1, new look |
| 4. Shell and offline | Capacitor Android shell, invite links, share target, service worker, update dialog | Installable APK and offline web app |
| **2.0 go-live** | Wipe test classes (script run by the project lead), deploy rules and site, publish the APK, raise `minVersionCode`, import opening balances | The class starts using it |
| 5. Payments | Payment claims, statements, CSV export | 2.1 |
| 6. Notifications | Device tokens, outbox, sender, per-kind switches | 2.2 |
| 7. Announcements | Feed, pins, seen marks | 2.3 |
| 8. Timetable | Weekly meetings, "no classes" | 2.4 |
| 9. Next semester | Start next semester, archived classes | 2.5 |

**Where the strongest model matters:** phases 1 and 5 and the go-live (security rules, money math, live data), and the sender in phase 6. Phases 2, 3, 7 and 8 are mostly screens and are fine on a cheaper model.

## Testing

- Unit tests (Vitest) for every domain rule, including void, opening balances, the summary totals and the visibility decision.
- Rules tests for every permission, each visibility setting, join approval, void-once, archived classes and claims.
- Browser tests (Playwright on the emulators) for each flow, with several users.
- Before go-live: a full run on the Oppo A16 with the APK, and on an iPhone browser if a classmate can lend one.

## Rules that carry over from v1

- No contractions in any text the app shows.
- Money is whole centavos.
- Commit messages have no co-author line; ask before every push.
- Deploy with a named target only (`--only hosting:web`, `--only hosting:main`, `--only firestore:rules`).
- The class spreadsheet and any real student data stay out of the repository.

## Open points

1. The Cloudflare Worker sender has to be proven in a small experiment before phase 6 relies on it.
2. "Start next semester" as described above was designed from the "new class each semester" decision and has not been reviewed in detail.
3. Payment info is plain text for now; a QR image can be added later if the class wants it.
4. Opening balances only match the real fund when the earlier books have no charge waiting to be paid out. "Start next semester" and the go-live import must refuse to run until every charge is paid out (or voided).
5. A pay-out gets a fixed document id made from its charge (`payout-{batchId}`), so two treasurers cannot pay the same charge out twice, and the rules can refuse to void a charge whose pay-out still stands. A replacement after a voided pay-out needs a numbered id; settle the exact scheme with the rules in phase 1.
