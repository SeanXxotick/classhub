# ClassHub - Plan

ClassHub is a Teams-style app for class officers. A Class Mayor creates a class, students join with an invite code, and the Mayor gives members roles with customizable permissions. Each class has a ledger (class fund) and a schedule (deadlines, quizzes, exams).

## Core ideas

- **Class** is the top level. Everything (members, roles, records, schedule) lives inside one class. A student can belong to several classes.
- **Join by invite code.** No email sending, so no server or paid plan is needed.
- **Roles are data, not code.** A role is a name, a color and a list of permissions. The Mayor creates, edits and deletes roles.
- **Permissions are enforced by Firestore security rules**, not only hidden in the UI.
- **Money is stored as whole centavos** (`Long`) so balances never drift.

## Permissions

A fixed list of switches. Roles are bundles of these.

| Key | Allows |
|---|---|
| `RECORDS_MANAGE` | Add and delete ledger records |
| `SCHEDULE_MANAGE` | Add, edit and delete deadlines and exams, and change their status |
| `MEMBERS_MANAGE` | Remove members, assign roles, regenerate the invite code |
| `ROLES_MANAGE` | Create, edit and delete roles |
| `CLASS_SETTINGS` | Rename the class, set accent color, switch modules on or off |

Everyone in a class can view the ledger, schedule and member list (unless a module is switched off).

Default roles created with every class:

| Role | Permissions | Notes |
|---|---|---|
| Mayor | all | The class owner. Cannot be deleted or edited. |
| Treasurer | `RECORDS_MANAGE` | |
| Secretary | `SCHEDULE_MANAGE` | |
| Member | none | Assigned automatically on joining. |

## Firestore structure

```
users/{uid}
    displayName, email                   (theme and start tab are stored on the device)
users/{uid}/memberships/{classId}
    className, joinedAtMillis            (the "My classes" list; a person's role is read from the class itself)

invites/{code}
    classId, className, defaultRoleId    (readable by any signed-in user, one doc at a time)

classes/{classId}
    name, description, ownerUid, accentColor, inviteCode, defaultRoleId,
    ledgerEnabled, scheduleEnabled, createdAtMillis

classes/{classId}/roles/{roleId}
    name, colorHex, permissions: [String], locked   (Mayor is locked)

classes/{classId}/courses/{courseId}
    name

classes/{classId}/members/{uid}
    displayName, roleId, joinedAtMillis, excludedCourseIds: [String], joinCode   (joinCode only used on the first write)

classes/{classId}/records/{id}
    type (PAYMENT|CHARGE|WITHDRAWAL|EXPENSE), amountCentavos, memberUid, memberName, note,
    dateMillis, batchId, courseId, createdByUid

classes/{classId}/schedule/{id}
    course, title, kind, dueMillis, status, createdByUid
```

### Joining with a code (how the rules stay safe)

1. The Mayor's class has `inviteCode`, mirrored as a document `invites/{code}` containing the `classId`.
2. A student types the code. The app reads `invites/{code}` (a single `get`; listing is not allowed).
3. The app creates `classes/{classId}/members/{uid}` with `roleId = defaultRoleId` and `joinCode = code`.
4. The rules allow that create only if `get(invites/{joinCode}).classId == classId`, the user is creating their own member document, and the role is the default one. Nobody can self-promote.
5. Regenerating the code deletes the old `invites` document, so old codes stop working.

### Security rule idea

```
function perm(classId, key) {
  let m = get(/databases/$(db)/documents/classes/$(classId)/members/$(request.auth.uid));
  let r = get(/databases/$(db)/documents/classes/$(classId)/roles/$(m.data.roleId));
  return key in r.data.permissions;
}
// records: read if member of the class; create/delete if perm(classId, 'RECORDS_MANAGE')
```

The Mayor is the document whose `roleId` is the system Mayor role; its permission list holds every key.

## Ledger rules

Modeled on the class spreadsheet, which has Payment, Charge and "Reimbursed" rows.

| What the user sees | Code name | Student balance | Cash on hand | Example |
|---|---|---|---|---|
| Payment | `PAYMENT` | + | + | A student pays P100 in |
| Charge students | `CHARGE` | - | no change | P6 for a quiz, charged to each student taking the course |
| Withdrawal | `WITHDRAWAL` | - | - | A student takes part of their balance out, like a savings account |
| Pay out from fund | `EXPENSE` | no student | - | The class pays P380 for exam printing |

- **Cash on hand** = payments - withdrawals - pay-outs. Charging students does not move cash; the cash leaves later as a pay-out.
- **Member balance** = payments - charges - withdrawals.
- The dashboard shows **Cash on hand** and **Charged to members**.
- The sheet's "Reimbursed" label covered both Withdrawal (with a name) and Pay out from fund (without one); the app separates them.
- Wording note: the class says "expense" for what the code calls `CHARGE`, so the screens use plain action names ("Charge students", "Pay out from fund") instead of the code names.

### Pay-outs settle charges (the cross-check)

- **Every pay-out settles exactly one charge**, for exactly that charge's total (`settlesBatchId` links them; the amount is filled in and cannot be edited). There are no unlinked pay-outs, so money never leaves the fund without being charged to someone. An optional `paidTo` names who received it.
- A charge is either **Not yet paid out** or **Paid out**. The "To pay out" filter lists unpaid charges, oldest first. A charge's details have a **Record pay-out** button.
- The **Charge students** form has "Also record the pay-out now" for money spent the same day; the charge and its pay-out are saved in one batch.
- A paid-out charge cannot be undone until its pay-out is deleted. One student's share of a charge cannot be deleted on its own.
- Dashboard: **Waiting to be paid out** (unpaid charges), **Available cash** (cash on hand minus that), and the **books check**: cash on hand must equal all balances plus charges waiting to be paid out. "Books balanced" or "Books off by X".

### Charging by course

- The class has a list of **courses**. Each member stores the courses they do **not** take (`excludedCourseIds`), so a new course includes everyone and only exceptions are marked.
- **Charge students** screen: amount per student, description, course. The app selects everyone who takes that course, shows a preview (for example "P6 x 29 students = P174, 3 skipped"), and lets the treasurer include or exclude individuals.
- Saving creates **one CHARGE record per student**, all sharing a `batchId` and written in one Firestore batch (all or nothing). The ledger shows them as one grouped line; **undo** deletes the whole batch.
- Records are history: members who join later are not charged for earlier charges, and changing someone's exclusions does not rewrite old charges.

## Customization

**Per class** (needs `CLASS_SETTINGS`): name, accent color, ledger and schedule modules on or off.
**Per user** (saved on the device): light, dark or system theme, and which tab opens first.
**Roles:** fully editable by anyone with `ROLES_MANAGE`.

## Phases

### Phase 1 (required for the POC)
1. Sign up and sign in
2. Create a class (default roles are created with it)
3. Join with an invite code
4. Member list; the Mayor assigns roles
5. Role manager: create, edit and delete roles with permission switches
6. Courses, and which courses each member takes
7. Ledger: payments, charging students by course (with preview and undo), withdrawals, pay-outs from the fund, member balances, cash on hand
8. Schedule: deadlines, quizzes and exams with status
9. Accent color and dark mode
10. Firestore security rules matching the permissions
11. Unit tests for balances, charge planning, schedule logic and permission checks

### Phase 2 (if time allows)
- Module toggles
- Per-user start tab
- Class switcher for several classes
- Deadline reminders (local notifications)

### Later
- Email invites and push notifications (need Cloud Functions and a paid plan)

## Architecture

- Kotlin, Jetpack Compose, MVVM
- Layers: `data/model`, `data/repository` (Firestore), `domain` (pure logic, unit tested), `ui` (screens and ViewModels)
- Firebase Authentication and Cloud Firestore (free Spark plan)

## What carries over from the code written so far

- Done: `Money`, `Ledger` (four record types), `ChargePlanner` (charge by course), `ScheduleLogic`, `Permissions` (default roles and role rules), `InviteCode`.
- Done (class refactor): models for classes, roles, members and courses; repositories for auth, classes (create, join by code, regenerate code, settings), roles, members, courses, ledger and schedule, all working inside `classes/{classId}`; 48 unit tests.
- Known limitation: a person's "My classes" entry lives in their own account area, so it can show a stale class name after a rename, and it stays until they open the class and find they were removed. The app handles that by dropping the entry when the class no longer lists them.

## Deadline

**FCO due Tuesday, October 27, 2026.** Feature freeze Saturday, October 24. See the schedule below.

| Date | Goal |
|---|---|
| Sun Oct 18 - Mon Oct 19 | Class refactor, sign-up and sign-in, create a class, join by code, default roles. Push to GitHub. |
| Tue Oct 20 | Member list, assign roles, role editor, courses and exclusions |
| Wed Oct 21 | Ledger: payments, charge students (preview, undo), withdrawals, pay-outs, balances, dashboard |
| Thu Oct 22 | Schedule screens, Firestore security rules |
| Fri Oct 23 | Dark mode and accent color, polish, test on the phone, fix bugs |
| Sat Oct 24 | **Feature freeze.** Test cases and results, screenshots, user manual |
| Sun Oct 25 | Finish documentation |
| Mon Oct 26 | Buffer, final review, demo rehearsal |
| Tue Oct 27 | Submit |

If we fall behind, cut in this order: Phase 2 items, accent color, module toggles. Never cut: roles and permissions, join by code, the ledger, the schedule, security rules.

## Open questions

- Is the documentation due on the same day, and is there a demo or presentation?
