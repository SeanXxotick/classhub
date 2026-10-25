# ClassHub

An Android app for tracking a class section's fund (ledger), its deadlines, quizzes and exams (schedule), and shared class contents.

Final Course Output (FCO) for Software Engineering, BSM CS 3A.

## Features

- Sign up and sign in; edit your name or delete your account in Account settings
- Create a class or join one with an invite code; several classes per account
- Roles with permission switches (Mayor, Treasurer and others), set by the Mayor
- Ledger: payments, charges by course, withdrawals, pay-outs, balances and cash on hand
- Schedule: deadlines, quizzes and exams; each student marks items done for themselves, and everyone in the class can see who has marked an item done
- Class contents: links to files, videos and websites, by course
- Daily reminders, accent colors and dark mode
- An update notice when a newer version of the app is published

## Stack

- Kotlin + Jetpack Compose
- MVVM architecture
- Firebase Authentication and Cloud Firestore

## Repository layout

| Path | Contents |
|---|---|
| `app/` | Android project |
| `docs/` | Project documentation (`PLAN.md` has the design, data structure and rules) |
| `design/` | Screen mockups (`mockup.html`) |
| `firestore.rules` | Firestore security rules |
| `firestore-tests/` | Tests for the security rules (run on the Firestore emulator) |
| `tools/` | Admin script that publishes a new app version for the update notice |
| `release/` | Built APKs (not committed) |

## Build and test

- Unit tests and release build: `./gradlew testDebugUnitTest assembleRelease`
- Security rule tests: `firebase emulators:exec --only firestore --project demo-classhub "node firestore-tests/rules.test.js"` (run inside the repo; needs Java and the Firebase CLI)
- Deploy the rules: `firebase deploy --only firestore:rules`

## Releasing a new version

1. Raise `versionCode` and `versionName` in `app/build.gradle.kts`.
2. Run the tests and build the release APK.
3. Upload the APK to the shared Drive file, replacing the old one so the link stays the same.
4. Use the direct download form of the Drive link, `https://drive.usercontent.google.com/download?id=FILE_ID&export=download&confirm=t`. The normal share link opens a "virus scan warning" web page for APK files instead of downloading.
5. Update the `appConfig/latest` document with `tools/publish_release.js` (version, notes, link; it uses your Firebase CLI login and shows a dry run until you add `--apply`). Students then see "Update available" the next time they open the app.

## Working in the group

- Do not commit directly to `main`. Make a branch (for example `yourname/schedule-screen`), push it and open a pull request.
- Do not commit real student data, `google-services.json`, keystores or APKs. They are listed in `.gitignore`.
- Use fake sample data when testing.

## Status

Version 1.3.2. The FCO documentation, demo and presentation are due Tuesday, October 27, 2026.
