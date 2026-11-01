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

/** True when Firestore refused because the security rules said no. */
export function isPermissionDenied(error: unknown): boolean {
  return error instanceof FirebaseError && error.code === 'permission-denied';
}
