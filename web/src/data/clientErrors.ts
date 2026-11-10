import { doc, setDoc, type Firestore } from 'firebase/firestore';
import type { ClientErrorReport } from './models';
import { newId, nowMillis } from './dataEnv';

const clip = (s: unknown, max: number) => String(s ?? '').slice(0, max);

/** Email addresses are removed: the error log keeps no personal data. */
const scrub = (s: string) => s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');

/**
 * Writes one error report to clientErrors/{id} (create only; nobody reads them from the app). The rules
 * allow exactly message, stack, appVersion, platform and atMillis, so not even the uid is stored. Texts are
 * cut to the sizes the rules accept. Never throws (a failing error log must not cause another error on
 * screen); returns whether the server took it. Offline it waits until the write is sent.
 */
export async function reportClientError(
  db: Firestore,
  report: { message: string; stack?: string; appVersion: string; platform: string },
): Promise<boolean> {
  const data: ClientErrorReport = {
    message: clip(scrub(report.message), 1000),
    stack: clip(scrub(report.stack ?? ''), 8000),
    appVersion: clip(report.appVersion, 40),
    platform: clip(report.platform, 20),
    atMillis: nowMillis(),
  };
  try {
    await setDoc(doc(db, 'clientErrors', newId()), data);
    return true;
  } catch {
    // Best effort: nothing else to do.
    return false;
  }
}
