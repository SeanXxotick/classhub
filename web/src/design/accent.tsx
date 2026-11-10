import type { CSSProperties, HTMLAttributes } from 'react';
import { cx, validHex } from './util';

/** Accent choices offered for a class (the same six as the mockup). */
export const ACCENT_COLORS = ['#0F766E', '#585BE8', '#DB2777', '#CC4A0A', '#2563EB', '#7C3AED'];

const BRAND = '#0F766E';

/**
 * Makes everything inside an element use a class accent: adds the ch-accented class and sets
 * --ch-accent. tokens.css derives --ch-primary*, --ch-hero and --ch-focus from it (and picks the
 * light or dark variant from the theme). An invalid colour falls back to the brand teal.
 */
export function applyAccent(element: HTMLElement, hex: string | null | undefined) {
  element.classList.add('ch-accented');
  element.style.setProperty('--ch-accent', validHex(hex) ?? BRAND);
}

/** The React form of applyAccent: a wrapper whose children use the given accent. */
export function Accented({ color, className, style, ...rest }: { color?: string | null } & HTMLAttributes<HTMLDivElement>) {
  const accent = validHex(color) ?? BRAND;
  return <div className={cx('ch-accented', className)} style={{ ['--ch-accent' as string]: accent, ...style } as CSSProperties} {...rest} />;
}
