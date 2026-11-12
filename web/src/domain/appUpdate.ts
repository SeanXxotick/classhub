/**
 * Telling Android app users that a newer APK is out.
 *
 * Each APK from 2.0.1 on adds "ClassHubAndroid/<versionCode>" to the browser's user agent (capacitor.config.ts).
 * 2.0.0 (versionCode 7) has no marker, so an Android app without one is taken to be 2.0.0.
 * The newest version is in appConfig/latest, written by tools/publish_release.js.
 */
export const FIRST_CAPACITOR_VERSION = 7;

export interface LatestRelease {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  notes: string;
  /** Apps below this version must update. */
  minVersionCode: number;
}

/** The installed APK's versionCode, or null in a normal browser (no banner there). */
export function installedVersion(userAgent: string, isAndroidApp: boolean): number | null {
  if (!isAndroidApp) return null;
  const match = /ClassHubAndroid\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : FIRST_CAPACITOR_VERSION;
}

export type UpdateState = 'none' | 'available' | 'required';

/** dismissedCode: the versionCode whose banner the user closed with Later. */
export function updateState(installed: number | null, latest: LatestRelease | null, dismissedCode: number | null): UpdateState {
  if (installed === null || !latest || !latest.downloadUrl.startsWith('https://')) return 'none';
  if (installed >= latest.versionCode) return 'none';
  if (installed < latest.minVersionCode) return 'required';
  return dismissedCode === latest.versionCode ? 'none' : 'available';
}
