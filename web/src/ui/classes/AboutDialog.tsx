import { useState } from 'react';
import { versionNameOf } from '../../domain/appUpdate';
import { Dialog, shortDateTime } from '../common';
import { installedAppVersion, useLatestRelease } from '../UpdateBanner';

const WEBSITE = 'https://classhub-web.web.app';
const DOWNLOAD = 'https://classhub-975eb.web.app/download';

/**
 * The (i) button on My classes: bottom left on a phone (across from Add a class), top right in the header
 * on a wide screen. Opens About ClassHub.
 */
export function InfoButton({ placement }: { placement: 'corner' | 'header' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={placement === 'corner' ? 'info-btn info-corner phone-only' : 'info-btn info-header wide-only'}
        aria-label="About ClassHub"
        title="About ClassHub"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 7.6v.1" strokeWidth="2.6" />
        </svg>
      </button>
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** About ClassHub: which version this is, whether a newer app is out, and what is new. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [installed] = useState(installedAppVersion);
  const latest = useLatestRelease();
  const inApp = installed !== null;
  const outdated = inApp && latest !== null && latest.versionCode > installed && latest.downloadUrl.startsWith('https://');

  return (
    <Dialog
      title="About ClassHub"
      onClose={onClose}
      actions={
        <button className="btn solid" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="about">
        <p className="muted" style={{ margin: 0 }}>
          The class fund, schedule, files, attendance and announcements of your class, in one place.
        </p>

        <div className="about-row">
          <span className="muted">{inApp ? 'Android app' : 'Using'}</span>
          <span className="semibold">{inApp ? versionNameOf(installed, latest) : 'The website'}</span>
        </div>
        {inApp && (
          <div className="about-row">
            <span className="muted">Status</span>
            {latest === null ? (
              <span className="muted">Checking…</span>
            ) : outdated ? (
              <span className="semibold" style={{ color: 'var(--warning, #b45309)' }}>{`${latest.versionName} is available`}</span>
            ) : (
              <span className="semibold" style={{ color: 'var(--primary)' }}>Up to date</span>
            )}
          </div>
        )}
        <div className="about-row">
          <span className="muted">Website updated</span>
          <span>{shortDateTime(__BUILD_MILLIS__)}</span>
        </div>

        {latest?.notes && (
          <div className="about-notes">
            <div className="small semibold">{inApp ? `What is new in ${latest.versionName}` : `What is new in the Android app ${latest.versionName}`}</div>
            <div className="small muted">{latest.notes}</div>
          </div>
        )}

        <div className="about-links">
          {outdated && latest && (
            <a className="btn solid" href={latest.downloadUrl} target="_blank" rel="noopener noreferrer">
              {`Download ${latest.versionName}`}
            </a>
          )}
          {inApp ? (
            <a className="btn outline" href={WEBSITE} target="_blank" rel="noopener noreferrer">
              Open the website
            </a>
          ) : (
            <a className="btn outline" href={latest?.downloadUrl.startsWith('https://') ? latest.downloadUrl : DOWNLOAD} target="_blank" rel="noopener noreferrer">
              Get the Android app
            </a>
          )}
        </div>
      </div>
    </Dialog>
  );
}
