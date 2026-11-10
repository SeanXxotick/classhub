/** Joins class names, skipping anything falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The colour families of tokens.css. Used by badges, type icons, notices and money. */
export type Tone = 'income' | 'charge' | 'withdrawal' | 'payout' | 'opening' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary';

export const toneClass = (tone: Tone) => `ch-tone-${tone}`;

/** "#0F766E" stays as is; anything that is not a valid #RRGGBB value becomes null. */
export function validHex(hex: string | null | undefined): string | null {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null;
}
