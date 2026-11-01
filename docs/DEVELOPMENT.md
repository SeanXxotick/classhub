# Developing ClassHub

Steps for people who build, test and release the app. The design, data structure and security rules are in [PLAN.md](PLAN.md).

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

## Web app

The web app is in `web/` (React + TypeScript, built with Vite). It uses the same Firebase project, data and security rules as the Android app. It is published at https://classhub-web.web.app.

- First time: `npm --prefix web install`, then put the web app's Firebase config in `web/.env.local` (copy `web/.env.example`; the file is not committed).
- Dev server on the real project: `npm --prefix web run dev` (http://localhost:5173)
- Dev server on the emulators: start `firebase emulators:start --only auth,firestore --project demo-classhub`, then run `npm --prefix web run dev:emu`. Accounts made here are test accounts and are erased when the emulators stop.
- Unit tests (the domain rules, same cases as the Android unit tests): `npm --prefix web test`
- Browser tests (Playwright, headless): `npx playwright install chromium` once (inside `web/`), then `firebase emulators:exec --only auth,firestore --project demo-classhub "npm --prefix web run e2e"`. Screenshots go to `web/test-results/`.
- App icons: `node web/scripts/gen-png-icons.mjs` turns `web/public/icon.svg` into the PNG icons.
- Deploy: `npm --prefix web run build`, then `firebase deploy --only hosting:web`. The invite page and download link are on the other site, deployed with `firebase deploy --only hosting:main`. Always name the target, so one deploy does not replace the other site.
