import { FirebaseError } from 'firebase/app';
import { PasswordRules } from '../domain/passwordRules';

/** Turns an error into a sentence a classmate can act on (the same wording as the Android app). */
export function friendlyMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/weak-password':
        return `Use a stronger password: at least ${PasswordRules.MIN_LENGTH} characters, with at least one letter.`;
      case 'auth/requires-recent-login':
        return 'For your security, sign out, sign in again, then change your password.';
      case 'auth/email-already-in-use':
        return 'An account with that email already exists. Try signing in instead.';
      case 'auth/user-not-found':
      case 'auth/user-disabled':
        return 'No account was found for that email.';
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/wrong-password':
      case 'auth/invalid-email':
        return 'The email or password is incorrect.';
      case 'auth/too-many-requests':
        return 'Too many tries. Wait a few minutes, then try again.';
      case 'auth/network-request-failed':
        return 'No internet connection. Check your connection and try again.';
      case 'permission-denied':
        return 'You do not have permission to do that.';
      case 'unavailable':
        return 'Cannot reach the server. Check your connection and try again.';
    }
    if (!error.code.startsWith('auth/')) return `Something went wrong (${error.code.toUpperCase().replace(/-/g, '_')}). Please try again.`;
    return 'Something went wrong. Please try again.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Something went wrong. Please try again.';
}

/**
 * The cases the v2 data layer refuses before (or after) asking the server, with the sentence the screen shows.
 * Thrown as UserError, so friendlyMessage passes the sentence through unchanged.
 */
export const USER_MESSAGES = {
  NOT_A_MEMBER: 'You are not in this class.',
  NOT_APPROVED_YET: 'An officer has not approved your request to join yet.',
  CLASS_DELETING: 'This class is being deleted, so nothing in it can be changed any more.',
  NO_PERMISSION: 'You do not have permission to do that.',
  INVITE_FORMAT: 'Invite codes have 6 letters and numbers.',
  INVITE_NOT_FOUND: 'That code does not match any class.',
  INVITE_CODE_UNAVAILABLE: 'Could not make an unused invite code. Try again.',
  ALREADY_MEMBER: 'You are already in this class.',
  ALREADY_REQUESTED: 'You already asked to join this class. An officer still has to approve you.',
  JOIN_REFUSED: 'This class cannot take your request right now. Ask an officer for a new code.',
  REQUEST_GONE: 'That request was cancelled or has already been decided.',
  NAME_MISSING: 'Add your name in Account first.',
  NAME_TOO_LONG: 'That name is too long. Use at most 90 characters.',
  CLASS_NAME_MISSING: 'Give the class a name.',
  MUST_HAND_OVER: 'You are the Mayor. Make someone else the Mayor before you leave.',
  OWN_ROLE: 'You cannot change your own role.',
  OWNER_ROLE: 'The Mayor keeps the Mayor role. They can hand it over when they leave.',
  EDIT_OWN_ROLE: 'You cannot edit the role you hold.',
  ROLE_LOCKED: 'The Mayor role cannot be changed.',
  ROLE_DEFAULT: 'The role new members get cannot be deleted.',
  ROLE_NAME: 'Give the role a name of at most 24 characters that no other role uses.',
  TOO_MANY_MEMBERS: 'Too many members hold this role to move them in one step.',
  BAD_VISIBILITY: 'Choose who can see balances: everyone, officers or treasurers.',
  PAYMENT_INFO_TOO_LONG: 'Keep the payment info under 500 characters.',
  AMOUNT_INVALID: 'Enter an amount greater than zero, with up to 2 decimal places.',
  AMOUNT_TOO_LARGE: 'That amount is too large. The limit is ₱1,000,000.00.',
  OPENING_AMOUNT_INVALID: 'Enter an opening balance that is not zero and at most ₱1,000,000.00 either way.',
  MEMBER_MISSING: 'Choose a student.',
  NOTE_TOO_LONG: 'Keep the note under 200 characters.',
  CHARGE_NOTE_MISSING: 'Describe the charge, for example "Quiz - Operations Research".',
  CHARGE_NOBODY: 'Choose at least one student to charge.',
  CHARGE_TOO_MANY: 'You can charge up to 497 students at once.',
  CHARGE_TWICE: 'A student can be charged only once in the same charge.',
  CHARGE_TOTAL_TOO_LARGE: 'The total of this charge is too large. The limit is ₱1,000,000.00.',
  CHARGE_NOT_FOUND: 'That charge no longer exists.',
  CHARGE_VOIDED: 'That charge was voided.',
  ALREADY_PAID_OUT: 'That charge has already been paid out.',
  PAID_TO_TOO_LONG: 'Keep "Paid to" under 100 characters.',
  PAID_OUT_VOID_PAYOUT_FIRST: 'This charge has been paid out. Void its pay-out first, then the charge.',
  RECORD_NOT_FOUND: 'That record no longer exists.',
  ALREADY_VOIDED: 'This record has already been voided.',
  VOID_REASON_MISSING: 'Give a reason for voiding.',
  VOID_REASON_TOO_LONG: 'Keep the reason under 200 characters.',
  VOID_SHARE_ALONE: 'A charge is voided as a whole. Open the charge and void it there.',
  OPENING_EXISTS: 'This student already has an opening balance. Void it first if it is wrong.',
  CANNOT_REPAIR: 'Only people who manage records can check the fund totals.',
  ONLY_MAYOR_DELETES: 'Only the Mayor can delete the class.',
  NOT_SETTLED: 'Everyone must be settled and the class fund must be empty before the class can be deleted.',
  CLASS_GONE: 'This class no longer exists.',
  OFFLINE: 'Cannot reach the server. Check your connection and try again.',
} as const;

export type UserErrorCode = keyof typeof USER_MESSAGES;

/** A refusal the app explains in plain words. code lets screens and tests tell the cases apart. */
export class UserError extends Error {
  readonly code: UserErrorCode;

  constructor(code: UserErrorCode, message: string = USER_MESSAGES[code]) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}

/** True when the error is a UserError with this code. */
export function isUserError(error: unknown, code?: UserErrorCode): error is UserError {
  return error instanceof UserError && (code === undefined || error.code === code);
}

/** True when Firestore refused because the security rules said no. */
export function isPermissionDenied(error: unknown): boolean {
  return error instanceof FirebaseError && error.code === 'permission-denied';
}
