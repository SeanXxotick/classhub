import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ICONS } from './iconData';
import { photoSrc } from '../data/photoRepo';
import { ImageMath } from '../domain/imageMath';
import { dayKey, dayOf, monthShort, noonMillis, parseDay, weekday, weekdayShort, today } from '../domain/dates';

// ------------------------------------------------------------------ Colors

/** "#0F766E" stays as is; anything that is not a valid #RRGGBB value falls back to the brand color. */
export function hexColor(hex: string | undefined | null, fallback = '#0F766E'): string {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback;
}

/** Accent choices offered when creating a class or editing its settings. */
export const ACCENT_CHOICES = ['#0F766E', '#6366F1', '#DB2777', '#EA580C', '#2563EB', '#7C3AED'];

/** Color choices for roles in the role editor. */
export const ROLE_COLOR_CHOICES = ['#15803D', '#3730A3', '#BE123C', '#EA580C', '#0369A1', '#A21CAF', '#6B768A'];

// ------------------------------------------------------------------ Icons

/** The Android app's own line icons, by file name (ic_tab_home) or by icon key (pencil, globe...). */
export function Icon({ name, size = 24, color = 'currentColor', label }: { name: string; size?: number; color?: string; label?: string }) {
  const icon = ICONS[name] ?? ICONS[iconFile(name)] ?? ICONS.ic_kind_deliverable;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${icon.size} ${icon.size}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: 'none' }}
    >
      {icon.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ? color : 'none'}
          stroke={p.stroke ? color : 'none'}
          strokeWidth={p.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** Icon keys (as saved in class settings) to the Android drawable names. */
function iconFile(key: string): string {
  const kinds: Record<string, string> = { pencil: 'ic_kind_quiz', clipboard: 'ic_kind_exam', mic: 'ic_kind_recitation', flag: 'ic_kind_fco', document: 'ic_kind_deliverable' };
  return kinds[key] ?? `ic_sched_${key}`;
}

/** A plain line icon in its color, with no background so it stays minimal. */
export function StyledIcon({ icon, color, label, size = 26, box = 38 }: { icon: string; color: string; label?: string; size?: number; box?: number }) {
  return (
    <span className="styled-icon" style={{ width: box, height: box }}>
      <Icon name={icon} size={size} color={hexColor(color)} label={label} />
    </span>
  );
}

// ------------------------------------------------------------------ Avatars

/** "BSM CS 3A" -> "3A", "Juan Dela Cruz" -> "JD". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const last = words[words.length - 1];
  if (last.length <= 3) return last.toUpperCase();
  return (words[0].slice(0, 1) + last.slice(0, 1)).toUpperCase();
}

/** A profile or class picture, or the colored initials. circle is false for class pictures (rounded square). */
export function Avatar({ photo, name, color, size = 42, circle = true }: { photo?: string | null; name: string; color: string; size?: number; circle?: boolean }) {
  const radius = circle ? '50%' : `${size * 0.33}px`;
  if (photo) {
    return <img className="avatar" src={photoSrc(photo)} alt={name} width={size} height={size} style={{ borderRadius: radius }} />;
  }
  return (
    <span className="avatar" aria-hidden style={{ width: size, height: size, borderRadius: radius, background: color.startsWith('var(') ? color : hexColor(color), fontSize: size * 0.36 }}>
      {initialsOf(name)}
    </span>
  );
}

/** Small colored pill showing a role name. */
export function RoleChip({ name, color }: { name: string; color: string }) {
  const c = hexColor(color, '#6B768A');
  return (
    <span className="pill" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {name}
    </span>
  );
}

/** A row of round color swatches; the selected one gets a ring. */
export function ColorPicker({ choices, selected, onSelect, label }: { choices: string[]; selected: string; onSelect: (hex: string) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {choices.map((hex) => {
        const on = hex.toLowerCase() === selected.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={hex}
            className={'swatch' + (on ? ' selected' : '')}
            style={{ background: hex }}
            onClick={() => onSelect(hex)}
          />
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Small pieces

export function Spinner({ small }: { small?: boolean }) {
  return <span className={'spinner' + (small ? ' small' : '')} role="status" aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="center-fill">
      <Spinner />
    </div>
  );
}

export function TopBar({ title, back, backLabel = 'Back', actions }: { title: ReactNode; back?: () => void; backLabel?: string; actions?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        {back && (
          <button className="btn text" onClick={back}>
            ‹ {backLabel}
          </button>
        )}
        <h1 className="title">{title}</h1>
        {actions}
      </div>
    </header>
  );
}

/** Goes back one screen, or to the given place when there is no history (a link opened directly). */
export function useBack(fallback: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}

export function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export function Switch({ label, sub, checked, onChange, disabled }: { label: ReactNode; sub?: ReactNode; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label className="switch-row">
      <span className="grow">
        <span className="semibold">{label}</span>
        {sub && <span className="small muted" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function PasswordInput({ value, onChange, autoComplete, label = 'Password', help }: { value: string; onChange: (v: string) => void; autoComplete: string; label?: string; help?: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  // Not wrapped in a label, so the Show button stays out of the field's name.
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="with-suffix">
        <input id={id} type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn text small suffix" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
      {help && <span className="help">{help}</span>}
    </div>
  );
}

/** A field that opens a chooser when clicked, such as a member or a course. */
export function PickerField({ label, value, onClick, supporting, placeholder }: { label: string; value: string | null; onClick: () => void; supporting?: ReactNode; placeholder?: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <button type="button" className={'input picker' + (value ? '' : ' placeholder')} onClick={onClick}>
        <span className="grow">{value ?? placeholder ?? 'Tap to choose'}</span>
        <span aria-hidden>▾</span>
      </button>
      {supporting && <span className="help">{supporting}</span>}
    </div>
  );
}

/** A label and value on one line, used in record and schedule details. */
export function DetailLine({ label, value, width = 100 }: { label: string; value: ReactNode; width?: number }) {
  return (
    <div className="detail-line">
      <span className="muted" style={{ width, flex: 'none' }}>{label}</span>
      <span className="semibold">{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ Dates

/** "Mon, Oct 19, 2026" */
export function longDate(millis: number): string {
  const { year, month, day } = parseDay(dayOf(millis));
  return `${weekdayShort(weekday(dayOf(millis)))}, ${monthShort(month)} ${day}, ${year}`;
}

/** "Oct 19" */
export function shortDate(millis: number): string {
  const { month, day } = parseDay(dayOf(millis));
  return `${monthShort(month)} ${day}`;
}

/**
 * A date field. Records dated today keep the current time (so same-day records stay in order);
 * other days, and every dayOnly date such as a deadline, are stored at local noon.
 */
export function DateField({ millis, onChange, label = 'Date', dayOnly = false }: { millis: number; onChange: (millis: number) => void; label?: string; dayOnly?: boolean }) {
  return (
    <Field label={label} help={longDate(millis)}>
      <input
        type="date"
        value={dayOf(millis)}
        required
        onChange={(e) => {
          if (!e.target.value) return;
          const key = e.target.value;
          onChange(!dayOnly && key === today() ? Date.now() : noonMillis(key));
        }}
      />
    </Field>
  );
}

export { dayKey };

// ------------------------------------------------------------------ Dialogs

export function Dialog({ title, children, actions, onClose }: { title: ReactNode; children?: ReactNode; actions: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
    // Focus only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" ref={ref}>
        <h2>{title}</h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  text: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button
            className={'btn text' + (danger ? ' danger' : '')}
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      <div>{text}</div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Snackbar notices

const NoticeContext = createContext<(message: string) => void>(() => {});

/** Shows one-off messages such as "Role saved" at the bottom of the screen, like the Android snackbar. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), Math.min(9000, 3500 + m.length * 40));
  }, []);
  return (
    <NoticeContext.Provider value={show}>
      {children}
      {message && (
        <div className="snackbar" role="status" aria-live="polite">
          <span className="grow">{message}</span>
          <button className="btn text small" onClick={() => setMessage(null)}>
            OK
          </button>
        </div>
      )}
    </NoticeContext.Provider>
  );
}

export function useNotice(): (message: string) => void {
  return useContext(NoticeContext);
}

// ------------------------------------------------------------------ Photos

/**
 * Turns a picked image into a small square JPEG as Base64 text, like the Android app: crops the
 * centered square and scales it to 256 pixels. The browser applies the camera's rotation itself.
 */
export async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a picture ClassHub can read.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file is not a picture ClassHub can read.');
  }
  const crop = ImageMath.centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = ImageMath.PHOTO_SIZE;
  canvas.height = ImageMath.PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('That picture could not be used. Try another one.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, crop.left, crop.top, crop.size, crop.size, 0, 0, ImageMath.PHOTO_SIZE, ImageMath.PHOTO_SIZE);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** A hidden file input; call the returned function to open the picker. */
export function usePhotoPicker(onPicked: (photo: string) => void, onError: (message: string) => void): [() => void, ReactNode] {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          onPicked(await preparePhoto(file));
        } catch (err) {
          onError(err instanceof Error ? err.message : 'That picture could not be used. Try another one.');
        }
      }}
    />
  );
  return [() => input.current?.click(), element];
}

/** "1 member", "3 members" */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
