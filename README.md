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
