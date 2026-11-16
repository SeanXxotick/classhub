# Tech stack, services and APIs

What ClassHub 2 is built with, which outside services it depends on, and why. For setup and commands, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Overview

ClassHub is one React web app. The same build is:

- the website at https://classhub-web.web.app,
- the Android app, through a Capacitor shell that loads that website,
- the iPhone app, as a web app added to the Home Screen.

There is no server of our own. Data lives in Cloud Firestore and is protected by security rules. Two small Cloudflare Workers handle the jobs a browser cannot do safely: sending push notifications and storing uploaded files.

```
 Phone (APK)            Browser / iPhone
 Capacitor shell  ───►  Web app (React)  ◄── Firebase Hosting
                            │    │    │
       Firebase Authentication    │    └──► Files Worker ──► Cloudflare R2
                                  │
                           Cloud Firestore ◄── Sender Worker ──► Firebase Cloud Messaging ──► devices
```

## The app (`web/`)

| Library | Version | What it does |
|---|---|---|
| React, React DOM | 18 | Screens and components |
| TypeScript | 5.8 | Types for the whole app, including the domain rules and money math |
| Vite | 6 | Dev server and production build (`@vitejs/plugin-react`) |
| React Router | 6 | Pages and links (class tabs, join links) |
| Firebase JS SDK | 12 | Sign-in, Firestore (with an offline cache in IndexedDB) and web push tokens |
| PDF.js (`pdfjs-dist`) | 6.5.438 | Shows uploaded PDFs inside the app. The legacy build is used, because the modern one needs browser features that older Android WebViews lack |
| qrcode-generator | 2.0.4 | QR code for class invites |
| Roboto (`@fontsource-variable/roboto`) | 5.3.0 | The app font, bundled with the app (no Google Fonts request) |

The code is split into layers:

- `src/domain`: plain TypeScript with no Firebase: ledger math, permissions, schedule and timetable logic, invite codes, the Excel writer. Most unit tests are here.
- `src/data`: everything that reads or writes Firestore, the Files Worker and the device (notifications, sharing).
- `src/design` and `src/ui`: the components and screens, styled with plain CSS (`src/styles.css`), with no CSS framework.

Some things are written in-house to keep the app small:

- **Excel export** (`domain/xlsx.ts`): writes a small .xlsx file without a spreadsheet library.
- **Profile and class pictures**: small JPEGs stored as Base64 text in Firestore (`avatars`, `classPhotos`), so pictures need no file storage service.
- **Error log**: crashes are written to `clientErrors` in Firestore with email addresses removed, instead of using a crash reporting service.

### Browser features used

| Feature | Used for |
|---|---|
| Service worker and Cache Storage (`public/sw.js`) | Opening the app without a connection |
| IndexedDB (through Firestore) | Saved copy of the class data for offline use |
| Web app manifest | Installing on a phone or iPhone Home Screen |
| Push API and Notifications API | Browser notifications |
| Web Share API | Sharing invites and files |
| Canvas | Saving the weekly timetable and invite card as an image |

## Android app (`web/android/`)

| Part | What it does |
|---|---|
| Capacitor 7 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`) | Wraps the hosted web app in an Android app (package `com.seanxxotick.classhub`, Android 6.0 and up, targets API 35) |
| `@capacitor/push-notifications` | Registers the phone with Firebase Cloud Messaging and shows notifications |
| `ClassHubNativePlugin.java` | Native share, saving files to Downloads, and sharing files, which the WebView cannot do alone |
| `MainActivity.java` | Shows an offline page only if the app has never loaded on that phone |
| Android App Links (`web/public/.well-known/assetlinks.json`) | Invite links (`/join/...`) open in the app when it is installed |

The app tells the web app its version through the user agent (`ClassHubAndroid/<versionCode>`). The web app compares it with `appConfig/latest` in Firestore and shows an update banner when a newer APK is out.

The native Kotlin app (version 1.3.2: Jetpack Compose, MVVM) is kept at the git tag `native-1.3.2`.

## Firebase (Google)

Project `classhub-975eb`, on the free Spark plan.

| Service | What it does |
|---|---|
| Firebase Authentication | Sign-up and sign-in with email and password |
| Cloud Firestore | All app data: classes, members, roles, ledger records, schedule, timetable, attendance, news, contents, history. Every read and write is checked by `firestore.rules`, so permissions hold even if someone bypasses the app |
| Firebase Hosting | Two sites: `classhub-web.web.app` (the app) and `classhub-975eb.web.app` (landing page, invite links, APK download redirect) |
| Firebase Cloud Messaging (FCM) | Delivers push notifications to Android phones and browsers |
| Firebase Local Emulator Suite | Auth and Firestore on your own computer for development and tests |

## Cloudflare

Both Workers are plain JavaScript with no dependencies, deployed with Wrangler on the free Workers plan.

### Sender Worker (`sender/`)

Sends push notifications. A Firestore-triggered Cloud Function would need the paid Blaze plan, so a Worker on a cron trigger does the job instead.

- Every minute it reads the queued notices in `classes/{classId}/outbox`, works out who each one is for, and sends them through FCM.
- At 6 PM Philippine time it queues "due tomorrow" reminders.
- The free plan allows 50 outside requests per run, so a large notice is sent over several runs and remembers where it stopped.

### Files Worker (`files/`)

Stores files uploaded to Contents in a private Cloudflare R2 bucket (`classhub-files`). R2 was picked over Firebase Storage because Firebase Storage also needs the Blaze plan.

- Upload, download, delete and usage endpoints under `/classes/{classId}/...`.
- Every request carries the user's Firebase sign-in token. The Worker checks it against Google's public keys, then reads membership from Firestore as that user, so the Firestore rules decide who may upload or download.
- The first bytes of each file are checked against its type, so a renamed program or web page is refused.
- Limits: 10 MB per file, 1 GB per class. Allowed types: PDF, JPEG, PNG, WebP, GIF, Word, PowerPoint and Excel.
- A daily clean-up (3:30 AM Philippine time) removes files whose content item or class is gone.

## Outside APIs called directly

| API | Called by | For |
|---|---|---|
| Firestore REST API (`firestore.googleapis.com`) | Both Workers | Reading and updating data on the server side |
| Google OAuth 2.0 token endpoint (`oauth2.googleapis.com/token`) | Both Workers | Trading the service account key for an access token |
| FCM HTTP v1 API (`fcm.googleapis.com`) | Sender Worker | Sending each notification |
| Google public keys for Firebase sign-in tokens (`googleapis.com/service_accounts/v1/jwk/securetoken`) | Files Worker | Checking that a sign-in token is real |
| Connectivity check (`www.gstatic.com/generate_204`) | Web app | The offline strip: telling "no connection" from "connected" |

The Workers use a Google service account, stored only as a Wrangler secret (`SERVICE_ACCOUNT`), never in the repository.

## Other services

| Service | Used for |
|---|---|
| Google Drive | Hosts the APK. `classhub-975eb.web.app/download` redirects to it, so the link never changes when a new APK replaces the file |
| GitHub | Source code |
| GitHub Actions (`.github/workflows/ci.yml`) | On every push and pull request to `v2` and `main`: type check, unit tests, build, rule tests, data layer tests and browser tests |

ClassHub uses no ads, no analytics and no tracking services.

## Testing

| Tool | What it tests |
|---|---|
| Vitest | Unit tests of the domain rules (`web/src/domain/*.test.ts`), and the data layer against the Firestore emulator under the real rules |
| `@firebase/rules-unit-testing` | The security rules (`firestore-tests/rules.test.js`) |
| Playwright (Chromium) | Browser tests of whole user flows (`web/e2e/`), against the emulators |
| `files/test.mjs` | The Files Worker, against `wrangler dev` and the emulators |
| `sender/local.mjs` | A dry run of the Sender Worker against the emulator (nothing is sent) |

## Admin tools (`tools/`)

Node.js scripts run by the project lead with the Firebase CLI login (`firebase-tools`). Each shows a dry run until `--apply` is added.

| Script | What it does |
|---|---|
| `publish_release.js` | Publishes a new Android version to `appConfig/latest` for the update banner |
| `export_balances.js`, `import_balances.js` | Moved balances from version 1 classes into version 2 (go-live only) |
| `wipe_classes.js` | Deleted all version 1 classes at go-live |

## Costs and free tier limits

Everything runs on free plans. The limits that matter as more classes join:

| Service | Free limit | What uses it |
|---|---|---|
| Cloud Firestore (Spark) | 50,000 reads, 20,000 writes and 20,000 deletes a day; 1 GiB stored | Every screen. This is the first limit more classes would reach |
| Firebase Hosting (Spark) | 10 GB stored, 360 MB transferred a day | Loading the app (later visits use the cached copy) |
| Firebase Authentication | Free for email and password | Sign-in |
| Firebase Cloud Messaging | Free | Notifications |
| Cloudflare Workers (Free) | 100,000 requests a day; 50 outside requests per run | Sender (one run a minute) and file requests |
| Cloudflare R2 (Free) | 10 GB stored a month, no download fees | Uploaded files (each class is capped at 1 GB) |

Free limits change, so check the Firebase and Cloudflare pricing pages before planning around them.
