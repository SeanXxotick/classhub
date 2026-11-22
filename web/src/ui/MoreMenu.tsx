import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../design';

export interface MoreItem {
  label: string;
  icon: IconName;
  onClick: () => void;
  /** Red, and set apart below a line. */
  danger?: boolean;
}

/**
 * The ⋮ button at the top right of a card. Holds the card's management actions.
 * A dropdown on wide screens; a sheet from the bottom on phones (styles.css, .more-menu).
 * Renders nothing when the viewer has no actions.
 */
export function MoreMenu({ items, label, title }: { items: (MoreItem | false | null | undefined)[]; label: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = items.filter((i): i is MoreItem => !!i);
  if (shown.length === 0) return null;
  const plain = shown.filter((i) => !i.danger);
  const danger = shown.filter((i) => i.danger);
  const row = (i: MoreItem) => (
    <button
      key={i.label}
      type="button"
      role="menuitem"
      className={'menu-item' + (i.danger ? ' danger' : '')}
      onClick={() => {
        setOpen(false);
        i.onClick();
      }}
    >
      <Icon name={i.icon} size={18} />
      {i.label}
    </button>
  );
  return (
    <div className="menu-anchor more-anchor" ref={ref}>
      <button type="button" className={'icon-btn more-btn' + (open ? ' open' : '')} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="5" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="19" r="1.8" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu end more-menu" role="menu">
          {title && <div className="more-menu-title">{title}</div>}
          {plain.map(row)}
          {plain.length > 0 && danger.length > 0 && <div className="menu-sep" />}
          {danger.map(row)}
        </div>
      )}
    </div>
  );
}
