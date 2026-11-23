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

/** Names of the APKs released so far; a newer one takes its name from appConfig/latest. */
const VERSION_NAMES: Record<number, string> = { 7: '2.0.0', 8: '2.0.1', 9: '2.0.2', 10: '2.0.3' };

/** The installed APK's name ("2.0.1"), from its versionCode. */
export function versionNameOf(code: number, latest: LatestRelease | null): string {
  if (latest && latest.versionCode === code && latest.versionName) return latest.versionName;
  return VERSION_NAMES[code] ?? `build ${code}`;
}

export type UpdateState = 'none' | 'available' | 'required';

/** dismissedCode: the versionCode whose banner the user closed with Later since the app was last opened. */
export function updateState(installed: number | null, latest: LatestRelease | null, dismissedCode: number | null): UpdateState {
  if (installed === null || !latest || !latest.downloadUrl.startsWith('https://')) return 'none';
  if (installed >= latest.versionCode) return 'none';
  if (installed < latest.minVersionCode) return 'required';
  return dismissedCode === latest.versionCode ? 'none' : 'available';
}

/**
 * Rewrites a drive.google.com file link to Google's direct download host (drive.usercontent.google.com).
 * Android's Google Drive app claims drive.google.com links via App Links, then immediately exits on APK
 * download URLs and bounces the user back to ClassHub without downloading anything.
 */
export function browserDownloadUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname !== 'drive.google.com') return rawUrl;
    const fromQuery = u.searchParams.get('id');
    const fromPath = /^\/file\/d\/([^/]+)/.exec(u.pathname)?.[1];
    const id = fromQuery || fromPath;
    if (!id) return rawUrl;
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  } catch {
    return rawUrl;
  }
}
