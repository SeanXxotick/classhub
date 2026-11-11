import type { CapacitorConfig } from '@capacitor/cli';

/*
 * The Android app is a shell around the hosted web app, so most updates arrive without a new APK.
 * Same package name as the native 1.3.2 app, so it installs over it (with the same signing key).
 *
 * CAP_SERVER_URL overrides the address for testing before go-live, for example a phone on USB with
 * "adb reverse tcp:5173 tcp:5173": CAP_SERVER_URL=http://localhost:5173 npx cap sync android
 */
const testUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.seanxxotick.classhub',
  appName: 'ClassHub',
  webDir: 'dist',
  server: {
    url: testUrl || 'https://classhub-web.web.app',
    cleartext: !!testUrl && testUrl.startsWith('http://'),
    androidScheme: 'https',
  },
  android: { backgroundColor: '#0F766E' },
};

export default config;
