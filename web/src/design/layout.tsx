import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { initialsOf } from '../domain/nameRules';
import { Button } from './actions';
import { Icon, Logo, type IconName } from './Icon';
import { cx, validHex } from './util';

// ------------------------------------------------------------------ Small layout pieces

export function Stack({ gap, className, ...rest }: { gap?: 'tight' | 'small' | 'large' } & HTMLAttributes<HTMLDivElement>) {
  const g = gap === 'tight' ? 'ch-gap-1' : gap === 'small' ? 'ch-gap-2' : gap === 'large' ? 'ch-gap-5' : undefined;
  return <div className={cx('ch-stack', g, className)} {...rest} />;
}

export function Row({ wrap, top, className, ...rest }: { wrap?: boolean; top?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ch-row', wrap && 'ch-wrap', top && 'ch-top', className)} {...rest} />;
}

export function Divider() {
  return <hr className="ch-divider" />;
}

/** A titled block: the title (a level 2 heading), an optional action at the right, then the content. */
export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ch-stack ch-gap-2" aria-labelledby={id}>
      <div className="ch-section-head">
        <h2 className="ch-section-title" id={id}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface PageProps extends HTMLAttributes<HTMLElement> {
  /** The narrow column (680px) used by forms and detail screens. */
  narrow?: boolean;
  /** Adds room at the bottom for a floating action button. */
  hasFab?: boolean;
}

/** The main content column. AppShell renders one for you; use this on its own only outside the shell. */
export function Page({ narrow, hasFab, className, ...rest }: PageProps) {
  return <main className={cx('ch-page', narrow && 'ch-narrow', hasFab && 'ch-has-fab', className)} {...rest} />;
}

/** A class logo: the initials on the class colour (the accent of the surrounding Accented, or a colour you pass). */
export function ClassLogo({ name, color, size = 30 }: { name: string; color?: string; size?: number }) {
  return (
    <span
      className="ch-class-logo"
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), fontSize: Math.round(size * 0.36), background: validHex(color) ?? undefined }}
    >
      {initialsOf(name)}
    </span>
  );
}

// ------------------------------------------------------------------ Top bar

export interface TopBarProps {
  title: ReactNode;
  /** Shows a back button that calls this. */
  onBack?: () => void;
  /** Where back goes, for example "Classes". Spoken as "Back to Classes". */
  backLabel?: string;
  /** Icon buttons at the right. */
  actions?: ReactNode;
}

export function TopBar({ title, onBack, backLabel, actions }: TopBarProps) {
  return (
    <header className="ch-topbar">
      <div className="ch-topbar-in">
        {onBack && (
          <Button variant="text" className="ch-back-btn" onClick={onBack} aria-label={`Back to ${backLabel ?? 'the previous screen'}`}>
            <Icon name="back" size={22} />
            <span>{backLabel ?? 'Back'}</span>
          </Button>
        )}
        <h1 className="ch-topbar-title">{title}</h1>
        {actions}
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ Class tabs

export interface TabDef {
  id: string;
  label: string;
  /** A shorter label for the phone bottom bar (for example "News" for "Announcements"). */
  shortLabel?: string;
  icon: IconName;
  /** A number shown on the tab, for example waiting join requests. */
  badge?: number;
}

export interface ClassTabsProps {
  tabs: TabDef[];
  current: string;
  onSelect: (id: string) => void;
  /** top: the tab strip for wide screens. bottom: the navigation bar for phones. Each hides itself at the other width. */
  variant: 'top' | 'bottom';
}

/** The class sections, from one list of tab definitions. AppShell shows both variants when you give it tabs. */
export function ClassTabs({ tabs, current, onSelect, variant }: ClassTabsProps) {
  if (variant === 'top') {
    return (
      <nav className="ch-tabs ch-wide-only" aria-label="Class sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={cx('ch-tab', t.id === current && 'ch-selected')} aria-current={t.id === current ? 'page' : undefined} onClick={() => onSelect(t.id)}>
            <Icon name={t.icon} size={20} />
            {t.label}
            {t.badge ? <span className="ch-count">{t.badge}</span> : null}
          </button>
        ))}
      </nav>
    );
  }
  return (
    <nav className="ch-bottom-nav ch-phone-only" aria-label="Class sections">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={cx(t.id === current && 'ch-selected')} aria-current={t.id === current ? 'page' : undefined} onClick={() => onSelect(t.id)}>
          <span className="ch-nav-icon">
            <Icon name={t.icon} size={24} />
            {t.badge ? <span className="ch-count ch-nav-badge">{t.badge}</span> : null}
          </span>
          {t.shortLabel ?? t.label}
        </button>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ Sidebar pieces

export function SidebarBrand() {
  return (
    <div className="ch-brand">
      <Logo size={34} />
      ClassHub
    </div>
  );
}

export function SidebarLabel({ children }: { children: ReactNode }) {
  return <h2 className="ch-side-label">{children}</h2>;
}

export function SidebarSpacer() {
  return <div className="ch-side-spacer" />;
}

/** One entry of the sidebar. leading is a ClassLogo, an Avatar or a SidebarPlus. */
export function SidebarItem({ leading, active, onClick, children }: { leading?: ReactNode; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cx('ch-side-item', active && 'ch-active')} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {leading}
      <span className="ch-grow">{children}</span>
    </button>
  );
}

/** The dashed plus square for "Join with a code" and "Create a class". */
export function SidebarPlus() {
  return (
    <span className="ch-side-plus" aria-hidden="true">
      <Icon name="plus" size={16} />
    </span>
  );
}

// ------------------------------------------------------------------ App shell

export interface AppShellProps {
  /** Sidebar content for wide screens (hidden below 900px): SidebarBrand, SidebarLabel, SidebarItem... */
  sidebar?: ReactNode;
  sidebarLabel?: string;
  /** A TopBar. */
  topBar?: ReactNode;
  /** Class sections: tab strip on wide screens, bottom navigation on phones. */
  tabs?: Omit<ClassTabsProps, 'variant'>;
  /** A Fab. It sits above the bottom navigation on phones. */
  fab?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}

/**
 * The frame of every signed-in screen: sidebar and a column on wide screens, a single column with
 * a bottom navigation below 900px. The page content is the children.
 */
export function AppShell({ sidebar, sidebarLabel = 'Classes', topBar, tabs, fab, narrow, children }: AppShellProps) {
  return (
    <div className="ch-app">
      {sidebar && (
        <aside className="ch-sidebar" aria-label={sidebarLabel}>
          <div className="ch-sidebar-in">{sidebar}</div>
        </aside>
      )}
      <div className={cx('ch-main', tabs && 'ch-main-has-nav')}>
        {topBar}
        <Page narrow={narrow} hasFab={!!fab}>
          {tabs && <ClassTabs {...tabs} variant="top" />}
          {children}
        </Page>
        {fab}
        {tabs && <ClassTabs {...tabs} variant="bottom" />}
      </div>
    </div>
  );
}
