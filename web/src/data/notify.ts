/*
 * Notifications (docs/PLAN-V2.md, "Notifications").
 * - The app queues a small request in classes/{classId}/outbox; the sender (sender/, a Cloudflare Worker)
 *   reads the queue and sends through Firebase Cloud Messaging.
 * - Each phone or browser that turned notifications on has a document in devices/{id} with its push token
 *   and the kinds it muted.
 * Queuing is best effort: a notice that cannot be queued never stops the action that caused it.
 */
import { collection, deleteDoc, doc, setDoc, type Firestore } from 'firebase/firestore';
import { app } from './firebase';
import { newId, nowMillis } from './dataEnv';

export const NOTICE_KINDS = ['ANNOUNCEMENT', 'SCHEDULE_NEW', 'DUE_TOMORROW', 'NO_CLASS', 'CLAIM_DECIDED', 'JOIN_APPROVED', 'CLAIM_SENT', 'JOIN_REQUEST'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** What each switch in Account says. The last two only ever reach officers. */
export const NOTICE_LABELS: Record<NoticeKind, string> = {
  ANNOUNCEMENT: 'New announcements',
  SCHEDULE_NEW: 'New deadlines, quizzes and exams',
  DUE_TOMORROW: 'Reminders the evening before something is due',
  NO_CLASS: 'No classes',
  CLAIM_DECIDED: 'My payment claim was confirmed or rejected',
  JOIN_APPROVED: 'I was approved to join a class',
  CLAIM_SENT: 'A student sent a payment claim (officers)',
  JOIN_REQUEST: 'Someone asked to join (officers)',
};

export interface Notice {
  kind: Exclude<NoticeKind, 'DUE_TOMORROW'>;
  /** CLASS: everyone. COURSE: students taking audienceId. PERMISSION: roles with audienceId. USER: the member audienceId. */
  audience: 'CLASS' | 'COURSE' | 'PERMISSION' | 'USER';
  audienceId?: string;
  title: string;
  body?: string;
}

/** Queues a notification for the sender. Never throws. */
export function queueNotice(db: Firestore, actorUid: string, classId: string, notice: Notice): Promise<void> {
  return setDoc(doc(collection(db, 'classes', classId, 'outbox'), newId()), {
    kind: notice.kind,
    audience: notice.audience,
    audienceId: notice.audienceId ?? '',
    title: notice.title.trim().slice(0, 120),
    body: (notice.body ?? '').trim().slice(0, 300),
    createdByUid: actorUid,
    createdAtMillis: nowMillis(),
  }).catch(() => undefined);
}

// ---------------------------------------------------------------- This device

const DEVICE_KEY = 'classhub.deviceId';
const MUTED_KEY = 'classhub.mutedNotices';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported';

const isNative = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private window: the setting lasts until the page closes */
  }
}

export function mutedKinds(): NoticeKind[] {
  return read(MUTED_KEY).split(',').filter((k): k is NoticeKind => (NOTICE_KINDS as readonly string[]).includes(k));
}

/** Whether this browser shows notifications for the signed-in user. */
export function pushState(): PushState {
  if (isNative() || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && read(DEVICE_KEY) ? 'on' : 'off';
}

async function webToken(): Promise<string> {
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) throw new Error('This browser cannot show notifications.');
  // The service worker is only registered in the built app; without it there is nothing to receive a push.
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The app is not fully installed yet. Reload and try again.')), 5000)),
  ]);
  return getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
}

async function saveDevice(db: Firestore, uid: string, token: string): Promise<void> {
  let id = read(DEVICE_KEY);
  if (!id.startsWith(`${uid}_`)) id = `${uid}_${newId()}`;
  await setDoc(doc(db, 'devices', id), { uid, token, platform: 'WEB', muted: mutedKinds(), updatedAtMillis: nowMillis() });
  write(DEVICE_KEY, id);
}

/** Asks for permission (it must follow a tap) and registers this browser. Returns the new state. */
export async function turnOnPush(db: Firestore, uid: string): Promise<PushState> {
  if (pushState() === 'unsupported') return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  await saveDevice(db, uid, await webToken());
  return 'on';
}

/** On opening the app: keeps the stored token fresh when notifications are already on. Never throws. */
export async function refreshPush(db: Firestore, uid: string): Promise<void> {
  try {
    if (pushState() === 'on') await saveDevice(db, uid, await webToken());
  } catch {
    /* offline or the push service is unreachable: the stored token stays */
  }
}

/** Stops notifications on this browser (also called before signing out, so the next person does not get them). */
export async function turnOffPush(db: Firestore): Promise<void> {
  const id = read(DEVICE_KEY);
  write(DEVICE_KEY, '');
  if (id) await deleteDoc(doc(db, 'devices', id)).catch(() => undefined);
}

/** Saves which kinds this device does not want. */
export async function setMutedKinds(db: Firestore, uid: string, muted: NoticeKind[]): Promise<void> {
  write(MUTED_KEY, muted.join(','));
  const id = read(DEVICE_KEY);
  if (id.startsWith(`${uid}_`)) await setDoc(doc(db, 'devices', id), { muted, updatedAtMillis: nowMillis() }, { merge: true });
}
