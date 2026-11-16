import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../data/firebase';
import { Button, Notice } from '../design';
import { installedVersion, updateState, type LatestRelease } from '../domain/appUpdate';

// Later hides the banner only until the app is opened again: a fresh start, or coming back to it after
// AWAY_MS in the background (most people never close an Android app, they switch back to it). Nothing is
// stored, so the reminder keeps coming until they update.
const AWAY_MS = 10 * 60 * 1000;
// Older versions kept Later in this key for good; it is cleared so those users see the banner again.
const OLD_DISMISS_KEY = 'classhub.updateDismissed';

const isAndroidApp = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

function clearOldDismissal() {
  try {
    localStorage.removeItem(OLD_DISMISS_KEY);
  } catch {
    // Without storage there is nothing to clear.
  }
}

/** In the Android app only: a banner when a newer APK is published in appConfig/latest. */
/** The installed APK's versionCode, or null on the website. */
export const installedAppVersion = (): number | null => installedVersion(navigator.userAgent, isAndroidApp());

/**
 * The newest release in appConfig/latest, or null until it loads (or when off). Listened to, so a release
 * published while the app is open shows at once. Used by the update banner and the About dialog.
 */
export function useLatestRelease(enabled = true): LatestRelease | null {
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      doc(db, 'appConfig', 'latest'),
      (snap) => {
        const d = snap.data();
        if (!d) return;
        setLatest({
          versionCode: Number(d.versionCode) || 0,
          versionName: String(d.versionName ?? ''),
          downloadUrl: String(d.downloadUrl ?? ''),
          notes: String(d.notes ?? ''),
          minVersionCode: Number(d.minVersionCode) || 0,
        });
      },
      () => {},
    );
  }, [enabled]);
  return latest;
}

export function UpdateBanner() {
  const [installed] = useState(installedAppVersion);
  const latest = useLatestRelease(installed !== null);
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => {
    if (installed === null) return;
    clearOldDismissal();
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) setDismissed(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [installed]);

  const state = updateState(installed, latest, dismissed);
  if (state === 'none' || !latest) return null;

  const later = () => setDismissed(latest.versionCode);

  return (
    <div className="update-banner">
      <Notice tone={state === 'required' ? 'warning' : 'info'} icon="download" title={state === 'required' ? 'Please update the ClassHub app' : `ClassHub ${latest.versionName} is available`}>
        <div>
          {state === 'required' ? 'This version of the app is too old. Download the new version and install it over this one.' : 'Download the new version and install it over this one. Your classes and sign-in stay.'}
          {latest.notes && <div className="muted small">What is new: {latest.notes}</div>}
        </div>
        <div className="update-banner-actions">
          <a className="ch-btn ch-solid ch-small" href={latest.downloadUrl} target="_blank" rel="noopener noreferrer">
            Download
          </a>
          {state === 'available' && (
            <Button variant="text" size="small" onClick={later}>
              Later
            </Button>
          )}
        </div>
      </Notice>
    </div>
  );
}
