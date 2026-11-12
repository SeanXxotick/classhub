import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { formatMoney } from '../domain/money';
import { personInitials } from '../domain/nameRules';
import { Icon, type IconName } from './Icon';
import { cx, toneClass, validHex, type Tone } from './util';

// ------------------------------------------------------------------ Money

export interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  /** Whole centavos, signed. */
  centavos: number;
  /** Show "+" in front of a positive amount (a negative amount always shows the minus sign). */
  sign?: boolean;
  /** Colours the amount: income, charge, withdrawal, payout, opening (the ledger colours) or a status colour. */
  tone?: Tone;
  size?: 'normal' | 'mid' | 'big';
  /** Crossed out, for a voided record. */
  voided?: boolean;
}

/** An amount in pesos with tabular numerals that never wrap. The colour is never the only signal: keep the sign or a label. */
export function Money({ centavos, sign, tone, size = 'normal', voided, className, ...rest }: MoneyProps) {
  const prefix = centavos < 0 ? '−' : sign && centavos > 0 ? '+' : '';
  const text = formatMoney(Math.abs(centavos)); // "₱4,250.00"
  return (
    <span className={cx('ch-money', size !== 'normal' && `ch-${size}`, tone && 'ch-has-tone', tone && toneClass(tone), voided && 'ch-struck', className)} {...rest}>
      {prefix}
      <span className="ch-peso">{text.slice(0, 1)}</span>
      {text.slice(1)}
    </span>
  );
}

// ------------------------------------------------------------------ Badges

export interface BadgeProps {
  tone: Tone;
  /** A badge that states a status needs an icon as well as the word: use StatusBadge for that. */
  icon?: IconName;
  children: ReactNode;
}

/** A small pill with a word. Colour alone never carries meaning, so the word is required. */
export function Badge({ tone, icon, children }: BadgeProps) {
  return (
    <span className={cx('ch-badge', toneClass(tone))}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export type Status = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATUS_ICON: Record<Status, IconName> = { success: 'check', warning: 'clock', danger: 'alert', info: 'info', neutral: 'ban' };

/** A status pill with its fixed icon (check, clock, alert, info, ban) and a word, never colour alone. */
export function StatusBadge({ status, icon, children }: { status: Status; icon?: IconName; children: ReactNode }) {
  return (
    <Badge tone={status} icon={icon ?? STATUS_ICON[status]}>
      {children}
    </Badge>
  );
}

/** A role name in the role's own colour. */
export function RoleTag({ name, color }: { name: string; color: string }) {
  const c = validHex(color) ?? '#6B768A';
  return (
    <span
      className="ch-badge"
      style={{ color: `color-mix(in srgb, ${c} 62%, var(--ch-text))`, background: `color-mix(in srgb, ${c} 14%, var(--ch-surface))` }}
    >
      {name}
    </span>
  );
}

// ------------------------------------------------------------------ Avatars and type icons

const AVATAR_COLORS = ['#0f766e', '#4f46e5', '#be185d', '#b4400f', '#1d4ed8', '#7e22ce', '#475569', '#15803d'];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export interface AvatarProps {
  name: string;
  /** A picture URL (already resolved). Without one the initials show on a colour picked from the name. */
  photo?: string | null;
  size?: number;
  /** Overrides the colour picked from the name (a #RRGGBB value). */
  color?: string;
  /** A small round type badge at the bottom right, for ledger rows. */
  badge?: { icon: IconName; tone: Tone };
}

/** The name is expected to be written next to the avatar, so the avatar itself is hidden from screen readers. */
export function Avatar({ name, photo, size = 40, color, badge }: AvatarProps) {
  const face = photo ? (
    <img className="ch-avatar" src={photo} alt="" width={size} height={size} />
  ) : (
    <span
      className="ch-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: validHex(color) ?? AVATAR_COLORS[hash(name) % AVATAR_COLORS.length], fontSize: Math.round(size * 0.36) }}
    >
      {personInitials(name)}
    </span>
  );
  if (!badge) return face;
  return (
    <span className={cx('ch-avatar-wrap', toneClass(badge.tone))} aria-hidden="true">
      {face}
      <span className="ch-type-dot">
        <Icon name={badge.icon} size={12} />
      </span>
    </span>
  );
}

/** A round tinted icon, the leading slot of most rows. */
export function TypeIcon({ icon, tone, size = 40 }: { icon: IconName; tone: Tone; size?: number }) {
  return (
    <span className={cx('ch-type-icon', toneClass(tone))} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={icon} size={Math.round(size * 0.55)} />
    </span>
  );
}

// ------------------------------------------------------------------ Rows

export interface ListRowProps {
  /** Usually an Avatar or a TypeIcon. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right side, stacked and right-aligned (an amount and a badge, for example). */
  trailing?: ReactNode;
  /** Inline buttons on the right (Approve, Reject). The row must not be clickable then. */
  actions?: ReactNode;
  /** Extra lines under the subtitle (for example the reason a record was voided). */
  children?: ReactNode;
  /** A chevron at the end, for rows that open something. */
  chevron?: boolean;
  /** Makes the row a button. */
  onClick?: () => void;
  /** For links: return the element (an anchor or a router Link) and put className and children on it. */
  render?: (props: { className: string; children: ReactNode }) => ReactElement;
  /** Crossed out (a voided record). */
  voided?: boolean;
  /** Crossed out and muted (a finished task). */
  done?: boolean;
}

export function ListRow({ leading, title, subtitle, trailing, actions, children, chevron, onClick, render, voided, done }: ListRowProps) {
  const className = cx('ch-list-row', voided && 'ch-void', done && 'ch-done');
  const body = (
    <>
      {leading}
      <span className="ch-grow">
        <span className="ch-list-title">{title}</span>
        {subtitle && <span className="ch-list-sub ch-clamp-2">{subtitle}</span>}
        {children}
      </span>
      {trailing && <span className="ch-end-col">{trailing}</span>}
      {actions && <span className="ch-row ch-gap-2">{actions}</span>}
      {chevron && <Icon name="chev" size={20} className="ch-chev" />}
    </>
  );
  if (render) return render({ className, children: body });
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

/** The small capital label that groups rows by day ("Today", "Yesterday"). */
export function DayHeader({ children }: { children: ReactNode }) {
  return <h3 className="ch-day-header">{children}</h3>;
}
