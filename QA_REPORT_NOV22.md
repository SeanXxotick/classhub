# QA report: Nov 22 deploys (0e95ae8..e1f214e)

Branch `qa/nov22-audit`, Nov 23, 2026. Base `e1f214e`. Nothing was pushed or deployed, and the live project
(`classhub-975eb`) was never read or written: every probe ran on the local emulators (projects `demo-rules`,
`demo-dl`, `demo-gp`, `demo-classhub` and two throwaway probe projects).

Covered: groupings (local and shared, leaders, link, unlink, enable and disable sharing, roster and accent sync),
partner classes and shared polls (notices, anonymous and named votes, edit, close, reopen, delete, listeners),
red tab and sub-tab counts, View as member, rollover rollback, MoreMenu, select chevron, History, reading
width and phone layout.

Method: code review of every commit in range against `firestore.rules`; emulator probes that act as each
role (including a stranger who only knows a share code); a new two-class Playwright flow
(`web/e2e/shared.spec.ts`); and a screen sweep at 360px (dark and light), 390px and 1360px checking for
sideways overflow, menus leaving the screen and console errors.

## Fixes on this branch

| Commit | Fix | Regression test |
| --- | --- | --- |
| `d4fa80c` | Shared polls that are not anonymous counted only this class's voters, so G1 and G2 showed different totals, and the edit dialog could think a poll had no votes | `pollLogic.test.ts`, `e2e/shared.spec.ts` |
| `f452250` | Saving a shared grouping's details, and the automatic roster and color sync, rewrote the whole `linkedClasses` map from the copy on screen and could erase a class that linked meanwhile | `groupingsPolls.emu.ts` |
| `75aeca2` | Test only: a rollover that fails partway leaves no class, invite, member, role, record or marker behind | `groupingsPolls.emu.ts` |
| `d83647d` | Unlinking a class never removed its partner record, so it kept the right to send this class notices and polls | `groupingsPolls.emu.ts` |
| `9614ecd` | Same for deleting a shared grouping or turning its sharing off | `groupingsPolls.emu.ts` |
| `1ea55ff` | Students got a red Members count they could not clear for groupings with self-join off | `tabCounts.test.ts` |
| `bd3f24a` | Linked class chips read "BSM CS 3A (G2) (G2)" | `groupingLogic.test.ts`, `e2e/shared.spec.ts` |
| `7415c5b` | `useSharedPolls` returned a new votes array every render, so every poll card recounted on every render | covered by `e2e/shared.spec.ts` |
| `63b9a1e` | Editing a voted multiple-choice poll could turn multiple choices off or lower the limit | `e2e/shared.spec.ts` |
| `d85d709` | "Anonymous" showed twice on a poll card | none (text only) |
| `248ae83` | The host could not delete a shared poll once a partner class was deleted, and the votes were wiped before the refusal | `groupingsPolls.emu.ts` |
| `aa62b9b` | On a 360px phone "Announcements" was cut off in the News switch | screen sweep (see Verification) |

## Verification

All on the branch head, against the local emulators:

| Check | Command (from `web/`) | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit -p .` | OK |
| Unit tests | `npx vitest run` | 180 passed (baseline 177) |
| Rules | `EMU_PROJECT=demo-rules node rules.test.js` in `firestore-tests/` | 277 of 277 passed |
| Emulator data tests | `EMU_PROJECT=demo-dl npx vitest run --config vitest.emu.config.ts` | 36 passed (baseline 32) |
| Build | `npm run build` | built |
| End to end | `npx playwright test` | 33 passed |

The screen sweep and the role probes were throwaway files, deleted before the last run.

## Critical / High

### H1. A share code alone makes the host class trust the linking class (partly fixed)

- **Where:** `firestore.rules:1785-1805` (partners rule, the `linkCode` branch at 1796), `firestore.rules:910`
  (partner ANNOUNCEMENT notices in `isNewNotice`), `firestore.rules:1817` (partner poll links),
  `web/src/data/groupings.ts:303` (`linkSharedGrouping` writes the host's partner record with `{ linkCode }`),
  `web/src/ui/features/GroupingsUi.tsx:490` (the share code pill is shown to partner officers too).
- **Root cause:** the partner record in the host class is written by the class that links, using the share
  code as proof. Once it exists, that class's officers with ANNOUNCEMENTS_MANAGE may queue ANNOUNCEMENT
  notifications to every member of the host class (any title and body) and add polls to its News.
- **Reproduce (emulator):** stranger creates their own class, links with the code, then writes
  `classes/{host}/outbox/{id}` with `kind: 'ANNOUNCEMENT', audience: 'CLASS', fromClassId: {stranger class}`
  and a poll link: both are allowed. Before `d83647d` this also stayed allowed after the host unlinked them.
- **Fixed here:** unlinking, deleting the grouping, or turning sharing off now removes the partner records.
- **Still open:** while linked, the reach above remains; and an unlinked class can link again with the same
  code (verified), since only turning sharing off deletes the code. Partner officers can also see the code and
  pass it on.
- **Recommended fix:** require an officer of the trusting class to create its own partner record (drop the
  `linkCode` branch, keep the `sharedGroupingId` branch only for the class's own officers), and show the host
  a "New class linked" item to approve. Also rotate the share code when a class is unlinked, and show the code
  only to host officers.

### H2. Shared poll counts dropped partner votes (fixed in `d4fa80c`)

- **Where:** `web/src/ui/features/PollsUi.tsx:169-174` (before the fix).
- **Root cause:** `tallyPoll` counted only `eligibleMembers` of the viewing class. On a shared poll each class
  saw only its own voters ("1 voted" in G1 and G2 while Show voters listed both), and `hasVotes` for the edit
  dialog came from the same count, so the host could remove a choice that only partner students had picked,
  shifting their votes onto other choices.
- **Fix:** shared polls count every vote (`pollEligibleUids`), as their anonymous counts already did.

## Medium

### M1. Deleting a host class orphans its shared groupings and shared polls (open)

- **Where:** `web/src/data/classes.ts:257` (`deleteClass`).
- **Root cause:** class delete removes the class's subcollections only. `sharedGroupings/{id}`,
  `groupingInvites/{code}` and `sharedPolls/{id}` hosted by that class stay, still listed in the partner
  classes. Delete is host-only in the UI and in the rules, so nobody can remove them, and the share code still
  works.
- **Reproduce (verified on the emulator):** G1 hosts a shared grouping and a shared poll with G2; the G1 Mayor
  deletes G1. The grouping, its invite and the poll all remain; G2's officer can still read them but is refused
  deleting either; and a new class can still link with G1's code.
- **Recommended fix:** in `deleteClass`, before the subcollections go, read the class's `sharedGroupingLinks`
  and `sharedPollLinks`: delete what this class hosts (votes first, then the poll; the grouping and its invite),
  and unlink itself from the rest. Needs an emulator test since it is the destructive path.

### M2. Students of an unlinked class stay seated in the shared grouping (open)

- **Where:** `web/src/data/groupings.ts:330` (`unlinkSharedGrouping`).
- **Root cause:** unlinking removes the class from `linkedClassIds` and `linkedClasses` but leaves its students
  in `groups[].memberUids`, `memberMeta` and `joinRequests`. They count toward each group's cap, still appear as
  members, and can no longer open the grouping to leave.
- **Reproduce (verified on the emulator):** G2 student joins Group 1; G1 unlinks G2; Group 1 still lists the
  student, and their own Leave is refused.
- **Recommended fix:** in the same transaction, drop the unlinked class's uids from every slot (memberMeta
  holds each seat's `classId`), or turn them into guests the way `disableGroupingSharing` does.

### M3. Concurrent link erased by an officer's save (fixed in `f452250`)

- **Where:** `web/src/data/groupings.ts` `updateGroupingMeta` and `syncSharedRoster`.
- **Root cause:** both wrote the whole `linkedClasses` map from the copy on screen. A class that linked after
  the screen loaded lost its name, tag and roster while staying in `linkedClassIds`.
- **Fix:** both update only `linkedClasses.{own class}` with a `FieldPath`.

### M4. Shared poll could not be deleted after a partner class was deleted (fixed in `248ae83`)

- **Where:** `web/src/data/polls.ts:358` (`deletePoll`).
- **Root cause:** votes were deleted first, then one batch deleted the poll and every class's link. The delete of
  a missing link in a deleted class is refused (`resource` is null), so the batch failed and left the poll with
  no votes.
- **Fix:** the batch holds the poll and the host's own link; partner links are deleted one by one, ignoring a
  refusal (a link left behind is dropped by the News listener after two retries).

### M5. Editing a voted multiple-choice poll (fixed in `63b9a1e`)

- **Where:** `web/src/ui/features/PollsUi.tsx` `EditPollDialog`.
- **Root cause:** multiple choices could be turned off, or the limit lowered, after votes, leaving ballots with
  more choices than allowed; they kept counting and the voter had to remove extras before changing anything.
- **Fix:** with votes, the switch stays on and the limit can only go up.

## Low / Visual polish

### Open

1. **Partner vote names are not checked.** `firestore.rules:581-583` only check the length of `name`, `classId`
   and `tag` on shared votes. A partner student can vote as "Reyes, Ana" with tag G1 and show up that way in
   Show voters (local voters always show their real name). Fix: require `classId` in the poll's
   `linkedClassIds` with the voter a member there, and `tag == linkedClasses[classId].tag`.
2. **Ballot choice values are not checked.** `firestore.rules:594-608` check the number of choices only. Impact
   is bounded (verified): a choice counts at most once per ballot, single choice ballots cannot hold two, tally
   keys stay within 0-9, so the worst case is one student counting as "voted" with no valid choice. Fix: check
   each choice is an int below `options.size()`.
3. **Anonymous shared ballots are left behind** when a shared poll is deleted (`web/src/data/polls.ts:358`);
   the host cannot list them (`list: if false`). They hold no names on screen but stay in the database. Fix:
   let the host list ballots for deletion, or delete them from a scheduled cleanup.
4. **"No group yet" vs the red count.** `GroupingsUi.tsx:425-428` and `:468` show "No group yet" on locked
   groupings and with self-join off, where the student can do nothing; the count now skips both. A student
   with a pending request is still counted (`domain/tabCounts.ts:47`) though there is nothing to do but wait.
   Fix: show the pill only when the count includes the grouping, or keep it neutral rather than red there.
5. **Deleted partner classes linger.** A class deleted while linked stays in the grouping's `linkedClassIds`,
   its students stay seated (see M2), and the host's `partners` record for it stays, so New poll still offers
   it and creating the poll then fails with a permission message (verified). Fix together with M1. Note for
   that work: on this failing path the emulator reported the shared poll create rule (`firestore.rules:521`)
   reaching the 1000 expression limit, so add checks there with care.
6. **After the host unlinks a class, that class still trusts the host.** Only that class's own officer can
   remove its record. Low risk since the host is the class it chose to link with.
7. **Accent sync writes once per screen open** when a class cleared its accent after it was synced
   (`GroupingsUi.tsx:250-256`: `syncSharedRoster` omits an empty accent, so stored and local never match).
8. **Close date accepts past dates** (`PollsUi.tsx:500`, `:675`): the poll is created already closed. Fix: add
   `min` set to today in Manila time.

### Fixed

- Group badge with self-join off (`1ea55ff`), duplicate tag on linked chips (`bd3f24a`), duplicate "Anonymous"
  (`d85d709`), unstable shared votes array (`7415c5b`), "Announcements" cut off at 360px (`aa62b9b`).

## Edge cases verified clean

- No contractions in any user-facing string added in range or on this branch.
- View as member: every officer surface goes through `can()`, which returns false while previewing; Class
  settings, Roles and Courses show No access; the owner-only Rollover and Delete cards sit inside Class settings.
- Shared groupings with leaders across classes: a G2 student asks, the G1 leader approves, and both sides
  update (`e2e/shared.spec.ts`). The share code works in lower case.
- Re-linking over a stale link pointer works; the roster and partner sync effects run for officers only.
- Rollover rollback leaves nothing behind (emulator test `75aeca2`).
- `CLASS_SUBCOLLECTIONS` includes `partners`, `sharedPollLinks` and `pollBallots`, so class delete clears them.
- Anonymous tallies: a duplicated choice counts once, the voter count moves by at most one per ballot.
- Reopening a poll whose close date passed clears the date, so it really reopens.
- Poll card menu matches the rules: Close and Reopen for officers of any linked class, Edit and Delete for the
  host only. Partner records can be deleted by everyone allowed to unlink.
- The shared poll listener waits for a new link to be committed before listening, and drops a poll whose
  link points at nothing after two retries instead of retrying forever.
- Members tab label reads "need attention"; the Members count includes shared groupings.
- No sideways overflow on 15 screens (Home, Ledger, Schedule, Contents, Announcements, Polls, Members, Groups,
  Class settings, History, My settings, Roles, Courses, My classes, Account) at 360px dark and light, 390px and
  1360px; MoreMenu stays on screen (bottom sheet on phones); select chevrons line up; History chips scroll.
- No console errors in any of the e2e flows.
