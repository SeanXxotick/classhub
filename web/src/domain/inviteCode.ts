/** Six-character class invite codes. No 0/O or 1/I so a code is easy to read aloud and type. */
export const InviteCode = {
  LENGTH: 6,
  ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

  /** randomInt(n) returns 0..n-1. The app uses the browser's secure random numbers; tests pass their own. */
  generate(randomInt: (n: number) => number = secureRandomInt): string {
    let code = '';
    for (let i = 0; i < InviteCode.LENGTH; i++) code += InviteCode.ALPHABET[randomInt(InviteCode.ALPHABET.length)];
    return code;
  },

  /** Forgives lowercase, spaces and dashes: " k7m-4qx " -> "K7M4QX". */
  normalize(input: string): string {
    return input.trim().toUpperCase().replace(/ /g, '').replace(/-/g, '');
  },

  isValid(code: string): boolean {
    return code.length === InviteCode.LENGTH && [...code].every((c) => InviteCode.ALPHABET.includes(c));
  },
};

function secureRandomInt(n: number): number {
  const buf = new Uint32Array(1);
  // Rejection sampling keeps every character equally likely.
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}
