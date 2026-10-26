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
