import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Money } from './data-display';
import { cx, toneClass } from './util';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** No padding, for cards that hold list rows. */
  flush?: boolean;
  /** The class-tinted card used for the class header. */
  tinted?: boolean;
}

export function Card({ flush, tinted, className, ...rest }: CardProps) {
  return <div className={cx('ch-card', flush && 'ch-flush', tinted && 'ch-tinted', className)} {...rest} />;
}

export interface HeroCardProps {
  /** Default "Your balance". */
  label?: string;
  /** Signed centavos. Below zero the card turns red and says the student owes the class. */
  centavos: number;
  /** Overrides the status line (default: "You owe the class", "Credit with the class" or "All settled"). */
  status?: string;
  /** A button at the right, for example "My statement". An outline Button picks up the card colours. */
  action?: ReactNode;
  children?: ReactNode;
}

/** The big balance card. */
export function HeroCard({ label = 'Your balance', centavos, status, action, children }: HeroCardProps) {
  const owes = centavos < 0;
  const word = status ?? (owes ? 'You owe the class' : centavos > 0 ? 'Credit with the class' : 'All settled');
  return (
    <div className={cx('ch-card ch-hero', owes && 'ch-owes')}>
      <div className="ch-row">
        <div className="ch-grow">
          <div className="ch-hero-label">{label}</div>
          <Money centavos={centavos} size="big" />
          <div className="ch-hero-status">
            <Icon name={owes ? 'alert' : 'check'} size={14} />
            {word}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A grid of small figures inside a card (use inside HeroCard or Card). */
export function Tiles({ children }: { children: ReactNode }) {
  return <div className="ch-tiles">{children}</div>;
}

export function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ch-tile">
      <span className="ch-tile-label">{label}</span>
      {children}
    </div>
  );
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
const NOTICE_ICON: Record<NoticeTone, IconName> = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' };

export interface NoticeProps {
  tone: NoticeTone;
  title?: string;
  /** Overrides the icon that goes with the tone. */
  icon?: IconName;
  children: ReactNode;
}

/** A message in the page: an icon, an optional bold title and the text. */
export function Notice({ tone, title, icon, children }: NoticeProps) {
  return (
    <div className={cx('ch-notice', toneClass(tone))} role="note">
      <Icon name={icon ?? NOTICE_ICON[tone]} size={22} />
      <div>
        {title && <div className="ch-notice-title">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
  /** Usually a Button. */
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="ch-empty">
      <span className="ch-empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3 className="ch-empty-title">{title}</h3>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

/** A grey shimmering block. Size it with width and height (CSS values or pixels). */
export function Skeleton({ width = '100%', height = 14, circle }: { width?: number | string; height?: number | string; circle?: boolean }) {
  return <span className="ch-skeleton" aria-hidden="true" style={{ width, height, borderRadius: circle ? '50%' : undefined }} />;
}

/** Placeholder rows for a list that is loading. Announced once as "Loading". */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ch-stack" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="ch-row" key={i} aria-hidden="true">
          <Skeleton width={40} height={40} circle />
          <div className="ch-grow ch-stack ch-gap-2">
            <Skeleton height={14} width={i % 2 ? '55%' : '70%'} />
            <Skeleton height={12} width={i % 2 ? '35%' : '45%'} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A round spinner for a whole area that is loading. */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="ch-spinner" role="status" aria-label={label} />;
}
