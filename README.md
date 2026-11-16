# ClassHub

ClassHub keeps a class section organized in one place: the class fund and each student's balance, deadlines and exams, the weekly timetable and attendance, announcements, and shared class materials. Class officers manage it; students see what concerns them.

It started as the Final Course Output (FCO) for Software Engineering, BSM CS 3A, at Bulacan State University. Version 2 is a rebuild for real, long-term class use.

- Web app: https://classhub-web.web.app
- Android app (APK): https://classhub-975eb.web.app/download
- iPhone: open the web app in Safari and use Add to Home Screen

## Features

- **Classes:** create a class, or join one with an invite code, link or QR code; officers approve join requests. One account can be in several classes.
- **Roles and permissions:** the Mayor sets up roles (Treasurer, Secretary and others) and ticks what each one may do.
- **Ledger:** payments, charges (by course or for everyone), withdrawals and pay-outs, cash on hand and balances. Records are voided, never deleted. Students can send a payment claim (for example a GCash payment) for the treasurer to confirm, and see their own statement.
- **Schedule:** deadlines, quizzes and exams with a month calendar. Each student marks items done.
- **Timetable and attendance:** a weekly timetable with "No classes" days, attendance with Present, Late, Absent and Excused, and Excel export.
- **News:** announcements with comments, votes and "seen by".
- **Contents:** links and uploaded files (PDF, images, Office files) by course.
- **History:** a log of every money, people and announcement action, for officers.
- **Notifications:** push notifications on Android and in the browser, plus payment reminders from the treasurer.
- **Works offline:** the app opens and shows saved data without a connection, and sends changes when it is back online.

## Tech stack at a glance

| Part | Built with |
|---|---|
| App (web and Android) | React 18 + TypeScript, built with Vite |
| Android app | Capacitor 7 shell that loads the hosted web app |
| Sign-in | Firebase Authentication (email and password) |
| Database | Cloud Firestore, protected by security rules |
| Hosting | Firebase Hosting (two sites) |
| Push notifications | Firebase Cloud Messaging, sent by a Cloudflare Worker |
| File uploads | Cloudflare R2, behind a Cloudflare Worker |
| Tests | Vitest, Playwright, Firestore emulator rule tests |
| CI | GitHub Actions |

The full list of libraries, services and outside APIs, with what each one does and why it was picked, is in [docs/TECH-STACK.md](docs/TECH-STACK.md).

## How it fits together

```
 Phone (APK)            Browser / iPhone
 Capacitor shell  ───►  Web app (React)  ◄── Firebase Hosting (classhub-web.web.app)
                            │    │    │
       Firebase Authentication    │    └──► Files Worker ──► Cloudflare R2 (uploads)
                                  │
                           Cloud Firestore ◄── Sender Worker ──► Firebase Cloud Messaging ──► devices
```

There is one codebase. The Android app is a thin shell around the hosted web app, so most updates reach phones without a new APK.

## Repository layout

| Path | Contents |
|---|---|
| `web/` | The app (React + TypeScript). `src/domain` holds the rules and money math, `src/data` talks to Firebase, `src/ui` and `src/design` are the screens |
| `web/android/` | The Capacitor Android project (shell, push notifications, native share and save) |
| `firestore.rules`, `firestore.indexes.json` | Firestore security rules and indexes |
| `firestore-tests/` | Tests for the security rules, run on the Firestore emulator |
| `sender/` | Cloudflare Worker that sends push notifications |
| `files/` | Cloudflare Worker for file uploads (R2) |
| `hosting/` | The small landing site (invite links, APK download link) |
| `tools/` | Admin scripts: publish a new app version, export and import balances, wipe classes |
| `design/` | Screen mockups |
| `docs/` | Plans and developer notes (see below) |

## Documentation

| File | What it covers |
|---|---|
| [docs/TECH-STACK.md](docs/TECH-STACK.md) | Libraries, services, outside APIs, costs and limits |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setting up, running, testing, deploying and releasing |
| [docs/PLAN-V2.md](docs/PLAN-V2.md) | Version 2 design, data model and security rules |
| [docs/FILES-PLAN.md](docs/FILES-PLAN.md) | File uploads design |
| [docs/AUDIT-PLAN.md](docs/AUDIT-PLAN.md), [docs/WRAP-AUDIT-PLAN.md](docs/WRAP-AUDIT-PLAN.md) | Audit records |
| [docs/PLAN.md](docs/PLAN.md) | Version 1 (native Kotlin app), kept for history |

## Versions

- **2.x (current):** one web codebase with a Capacitor Android shell.
- **1.3.2:** the original native Android app (Kotlin, Jetpack Compose, MVVM), kept at the git tag `native-1.3.2`.
