import { InviteCode } from '../domain/inviteCode';

/**
 * The one clock and the id makers every v2 data function uses. The app keeps the defaults; tests swap them
 * so ids are predictable. Times must stay close to the real clock, because the security rules refuse a
 * createdAtMillis, voidedAtMillis, requestedAtMillis or deletingAtMillis that is far from the server's time.
 */
export interface DataEnv {
  /** Milliseconds since 1970, like Date.now. */
  now: () => number;
  /** A new document id: letters, digits, '-' and '_' only (the rules check ids used in paths). */
  newId: () => string;
  /** A new invite code (6 characters from InviteCode.ALPHABET). */
  newInviteCode: () => string;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 20 random characters, like a Firestore auto id. */
function randomId(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  // 62 does not divide 256, so a tiny bias remains; ids only need to be unique, not uniform.
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

const DEFAULTS: DataEnv = {
  now: () => Date.now(),
  newId: randomId,
  newInviteCode: () => InviteCode.generate(),
};

let current: DataEnv = DEFAULTS;

/** Replaces some of the clock and id makers (tests only). */
export function setDataEnv(changes: Partial<DataEnv>): void {
  current = { ...current, ...changes };
}

/** Back to the real clock and random ids. */
export function resetDataEnv(): void {
  current = DEFAULTS;
}

export const nowMillis = (): number => current.now();
export const newId = (): string => current.newId();
export const newInviteCode = (): string => current.newInviteCode();
