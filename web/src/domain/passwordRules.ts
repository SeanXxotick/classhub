/** Rules for choosing a password, used on sign-up, the forced first change and in Account. */
export const PasswordRules = {
  MIN_LENGTH: 8,

  /**
   * Returns an error message, or null when the password can be used. The first part of the account's
   * email (before the @) is not allowed as the password because it is easy to guess.
   */
  strength(password: string, email: string): string | null {
    const emailName = email.trim().split('@')[0];
    if (password.length < PasswordRules.MIN_LENGTH) return `Use at least ${PasswordRules.MIN_LENGTH} characters.`;
    if (![...password].some((c) => /\p{L}/u.test(c))) return 'Include at least one letter, so it is not just numbers.';
    if (emailName && password.toLowerCase() === emailName.toLowerCase()) {
      return 'Do not use the first part of your email as your password. It is too easy to guess.';
    }
    return null;
  },

  /** strength, plus the two typed passwords must match. */
  check(password: string, confirm: string, email: string): string | null {
    return PasswordRules.strength(password, email) ?? (password !== confirm ? 'The two passwords do not match.' : null);
  },
};
