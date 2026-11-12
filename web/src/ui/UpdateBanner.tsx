import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../data/firebase';
import { Button, Notice } from '../design';
import { installedVersion, updateState, type LatestRelease } from '../domain/appUpdate';

const DISMISS_KEY = 'classhub.updateDismissed';

const isAndroidApp = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

function readDismissed(): number | null {
  try {
    const value = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** In the Android app only: a banner when a newer APK is published in appConfig/latest. */
export function UpdateBanner() {
  const [installed] = useState(() => installedVersion(navigator.userAgent, isAndroidApp()));
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    if (installed === null) return;
    getDoc(doc(db, 'appConfig', 'latest'))
      .then((snap) => {
        const d = snap.data();
        if (!d) return;
        setLatest({
          versionCode: Number(d.versionCode) || 0,
          versionName: String(d.versionName ?? ''),
          downloadUrl: String(d.downloadUrl ?? ''),
          notes: String(d.notes ?? ''),
          minVersionCode: Number(d.minVersionCode) || 0,
        });
      })
      .catch(() => {});
  }, [installed]);

  const state = updateState(installed, latest, dismissed);
  if (state === 'none' || !latest) return null;

  const later = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(latest.versionCode));
    } catch {
      // Without storage the banner simply comes back next time.
    }
    setDismissed(latest.versionCode);
  };

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
