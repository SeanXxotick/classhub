# Developing ClassHub

Steps for people who build and test the app. The design, data structure and security rules of version 2 are in [PLAN-V2.md](PLAN-V2.md); [PLAN.md](PLAN.md) describes version 1.

## Android app

The native Kotlin app (version 1.3.2) is kept at the git tag `native-1.3.2`. It is no longer on the `v2` branch. The Android app will be rebuilt as a Capacitor shell around the web app (see [PLAN-V2.md](PLAN-V2.md)), so there is no Gradle build here for now.

Publishing an APK stays the same once the shell exists:

1. Upload the APK to the shared Drive file, replacing the old one so the link stays the same.
2. Use the direct download form of the Drive link, `https://drive.usercontent.google.com/download?id=FILE_ID&export=download&confirm=t`. The normal share link opens a "virus scan warning" web page for APK files instead of downloading.
3. Update the `appConfig/latest` document with `tools/publish_release.js` (version, notes, link; it uses your Firebase CLI login and shows a dry run until you add `--apply`). Students then see "Update available" the next time they open the app.

## Security rules

- Rule tests: `firebase emulators:exec --only firestore --project demo-classhub "node firestore-tests/rules.test.js"` (run from the repo root; needs Java and the Firebase CLI; run `npm --prefix firestore-tests install` once)
- Deploy the rules: `firebase deploy --only firestore:rules`

## Checks on GitHub

`.github/workflows/ci.yml` runs on every push and pull request to `v2` and `main`: the web type check, unit tests and build, and the rule tests.

## Web app

The web app is in `web/` (React + TypeScript, built with Vite). It uses the same Firebase project, data and security rules as the old Android app. It is published at https://classhub-web.web.app.

- First time: `npm --prefix web install`, then put the web app's Firebase config in `web/.env.local` (copy `web/.env.example`; the file is not committed).
- Dev server on the real project: `npm --prefix web run dev` (http://localhost:5173)
- Dev server on the emulators: start `firebase emulators:start --only auth,firestore --project demo-classhub`, then run `npm --prefix web run dev:emu`. Accounts made here are test accounts and are erased when the emulators stop.
- Unit tests (the domain rules): `npm --prefix web test`
- Browser tests (Playwright, headless; paused on `v2` until the screens are rebuilt in phase 3, because the old screens do not match the new security rules): `npx playwright install chromium` once (inside `web/`), then `firebase emulators:exec --only auth,firestore --project demo-classhub "npm --prefix web run e2e"`. Screenshots go to `web/test-results/`.
- App icons: `node web/scripts/gen-png-icons.mjs` turns `web/public/icon.svg` into the PNG icons.
- Deploy: `npm --prefix web run build`, then `firebase deploy --only hosting:web`. The invite page and download link are on the other site, deployed with `firebase deploy --only hosting:main`. Always name the target, so one deploy does not replace the other site.
