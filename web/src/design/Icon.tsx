import type { SVGAttributes } from 'react';

/** The icon set of the approved mockup: 24x24 outline paths drawn with a 1.9 stroke. */
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  ledger: 'M3 7a2 2 0 0 1 2-2h13v3M3 7v11a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1-2-1M16 14h2',
  schedule: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  contents: 'M4 5h6l2 2h8v12H4z',
  members: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 1 0 0-5M17.5 14c2.2.4 3.5 2.4 3.5 6',
  news: 'M4 10v4h3l7 4V6L7 10zM17 9a4 4 0 0 1 0 6',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 5l7 7-7 7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-7 8-7s8 3 8 7',
  pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M10 14h6M10 17h4',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 14h6M10 17h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  slides: 'M3 5h18v11H3zM12 16v4M8 20h8',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  printer: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  income: 'M18 6L7 17M7 8v9h9',
  charge: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  withdrawal: 'M7 17L18 6M9 6h9v9',
  payout: 'M4 14v6h16v-6M12 16V4M7 9l5-5 5 5',
  flag: 'M5 21V4M5 5h12l-2 4 2 4H5',
  ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM6 6l12 12',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  phone: 'M8 3h8v18H8zM11 18h2',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v8h14v-8',
  list: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  dots: 'M12 6h.01M12 12h.01M12 18h.01',
  key: 'M8 14a4 4 0 1 1 3.5-6H21v3h-3v3h-3v-3h-3.5A4 4 0 0 1 8 14z',
  userplus: 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.6 3-6 7-6M18 8v6M15 11h6',
  coins: 'M12 4c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3zM5 7v5c0 1.7 3 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3 3 7 3s7-1.3 7-3v-5',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  book: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'name' | 'width' | 'height'> {
  name: IconName;
  /** Pixel size, default 24. */
  size?: number;
}

/** A decorative icon (aria-hidden). Put the meaning in a label or visible text next to it. */
export function Icon({ name, size = 24, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The ClassHub app icon (the four-tile logo). */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 108 108" width={size} height={size} aria-hidden="true" focusable="false" style={{ borderRadius: size * 0.28, flex: 'none' }}>
      <rect width="108" height="108" fill="#0f766e" />
      <path
        fill="#fff"
        d="M37,32h9a5,5 0 0,1 5,5v9a5,5 0 0,1 -5,5h-9a5,5 0 0,1 -5,-5v-9a5,5 0 0,1 5,-5z M62,32h9a5,5 0 0,1 5,5v9a5,5 0 0,1 -5,5h-9a5,5 0 0,1 -5,-5v-9a5,5 0 0,1 5,-5z M37,57h9a5,5 0 0,1 5,5v9a5,5 0 0,1 -5,5h-9a5,5 0 0,1 -5,-5v-9a5,5 0 0,1 5,-5z"
      />
      <circle cx="66.5" cy="66.5" r="9.5" fill="#99f6e4" />
    </svg>
  );
}
