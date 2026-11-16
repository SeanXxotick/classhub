# Developing ClassHub

Steps for people who build, test and release the app. What each library and service is for is in [TECH-STACK.md](TECH-STACK.md); the version 2 design, data model and security rules are in [PLAN-V2.md](PLAN-V2.md).

## What you need

- Node.js 22 and npm
- Java 21 (for the Firebase emulators; the JDK that comes with Android Studio works)
- Firebase CLI (`npm i -g firebase-tools`), logged in with `firebase login` for deploys and admin scripts
- Android Studio and the Android SDK, only for building the APK

Run every command below from the repository root unless it says otherwise.

## Web app

- First time: `npm --prefix web install`, then copy `web/.env.example` to `web/.env.local` and fill it in (`firebase apps:sdkconfig WEB <app id>` prints the Firebase values). `.env.local` and `.env.production` are never committed.
- Environment values:
  - `VITE_FIREBASE_*`: the Firebase web config
  - `VITE_FIREBASE_VAPID_KEY`: the web push key (Firebase console, Cloud Messaging, Web Push certificates)
  - `VITE_FILES_URL`: the address of the Files Worker
- Dev server on the emulators (the normal way to work): start `firebase emulators:start --only auth,firestore --project demo-classhub`, then `npm --prefix web run dev:emu`, then seed test data with `npx vite-node scripts/seed-emulator.ts` inside `web/`. Emulator accounts are test accounts and disappear when the emulators stop.
- Dev server on the real project: `npm --prefix web run dev` (http://localhost:5173). Avoid it: it changes real data.
- App icons: `node web/scripts/gen-png-icons.mjs` turns `web/public/icon.svg` into the PNG icons.

## Tests

| What | Command |
|---|---|
| Type check | `npx tsc --noEmit -p .` (inside `web/`) |
| Unit tests | `npm --prefix web test` |
| Security rules | `firebase emulators:exec --only firestore --project demo-classhub "node firestore-tests/rules.test.js"` (run `npm --prefix firestore-tests install` once) |
| Data layer under the real rules | `npm --prefix web run test:emu` |
| Browser tests | `npx playwright install chromium` once inside `web/`, then `firebase emulators:exec --only auth,firestore --project demo-classhub "npm --prefix web run e2e"`. Screenshots go to `web/test-results/` |
| Files Worker | With the emulators up: `npx wrangler dev --env dev --port 8787 --ip 127.0.0.1` in `files/`, then `node test.mjs` in `files/` |
| Sender Worker (dry run) | With the emulators up: `node sender/local.mjs` (add `due` to queue "due tomorrow" first). Nothing is sent |

The browser tests wipe the emulator, so seed it again afterwards. Do not edit source files while they run: the dev server reloads the pages and tests fail.

### Checks on GitHub

`.github/workflows/ci.yml` runs on every push and pull request to `v2` and `main`: type check, unit tests and build; rule tests and data layer tests; browser tests.

## Deploying

Always name the target, so one deploy does not replace another.

1. Security rules first, if `firestore.rules` changed: `firebase deploy --only firestore:rules` (and `firestore:indexes` if the indexes changed).
2. The app: `npm --prefix web run build`, then `firebase deploy --only hosting:web`.
3. The landing site (invite page, download redirect): `firebase deploy --only hosting:main`.
4. Workers: `npx wrangler deploy` inside `sender/` or `files/`. Each needs the `SERVICE_ACCOUNT` secret, set once with `npx wrangler secret put SERVICE_ACCOUNT`. Never put the key in the repository.

The Android app loads the hosted site, so a hosting deploy updates phones too. A new APK is only needed when something in `web/android/` or the Capacitor plugins changes.

## Releasing a new APK

1. Bump `versionCode` and `versionName` in `web/android/app/build.gradle`.
2. Inside `web/`: `npm run build`, then `npx cap sync android`.
3. Inside `web/android/`: `./gradlew assembleRelease` (set `JAVA_HOME` to Android Studio's `jbr` and `ANDROID_HOME` to the SDK). The release key and `keystore.properties` are kept outside git; they must stay the same, or the app will not install over the old one and invite links stop opening in it.
4. Upload the APK to the shared Google Drive file with Manage versions, so the link stays the same. `classhub-975eb.web.app/download` points to it.
5. Publish the version so phones show "Update available": `node tools/publish_release.js "$(npm root -g)/firebase-tools" classhub-975eb <versionCode> <versionName> "https://classhub-975eb.web.app/download" "<notes>" <minVersionCode>`. It shows a dry run; add `--apply` to write.

## Admin scripts

The scripts in `tools/` change live data. Each one shows a dry run until `--apply` is added, and works on the emulator when `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` is set. Only the project lead runs them on the live project. See the comment at the top of each script for its usage.

## Private data

- Real class data (spreadsheets, exports, balances) never goes into the repository; `.gitignore` blocks `*.xlsx`, `*.csv` and `reference/`.
- Use made-up names in test data and seed scripts.
- Do not commit `files/.wrangler/`, `sender/.wrangler/` or `web/dist-emu/` (local caches and test builds).
