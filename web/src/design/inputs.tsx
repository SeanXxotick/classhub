import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import { cx, validHex } from './util';

// ------------------------------------------------------------------ Field

interface FieldContext {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}
const FieldCtx = createContext<FieldContext | null>(null);

/** What a control inside a Field gets: its id, aria-describedby (hint and error) and aria-invalid. */
function useFieldProps() {
  const f = useContext(FieldCtx);
  return f ? { id: f.id, 'aria-describedby': f.describedBy, 'aria-invalid': f.invalid || undefined, 'aria-required': f.required || undefined } : {};
}

export interface FieldProps {
  label: string;
  /** Help under the control. */
  hint?: string;
  /** An error under the control. Marks the control invalid. */
  error?: string;
  required?: boolean;
  children: ReactNode;
}

/**
 * A label, a control and its hint and error. Put one control inside: TextInput, TextArea, AmountInput,
 * Select or SearchInput get their id, aria-describedby and aria-invalid from the Field. A group
 * (RadioGroup, SegmentedControl, FilterChips, Swatches) inside a Field is labelled by it.
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const base = useId();
  const id = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldCtx.Provider value={{ id, labelId: `${base}-label`, describedBy, invalid: !!error, required: !!required }}>
      <div className="ch-field">
        <label className="ch-label" id={`${base}-label`} htmlFor={id}>
          {label}
        </label>
        {children}
        {hint && (
          <span className="ch-hint" id={hintId}>
            {hint}
          </span>
        )}
        {error && (
          <span className="ch-error" id={errorId}>
            <Icon name="alert" size={14} />
            {error}
          </span>
        )}
      </div>
    </FieldCtx.Provider>
  );
}

/** Name for a group control: its own label, or the label of the Field around it. */
function useGroupLabel(label?: string, labelledBy?: string) {
  const f = useContext(FieldCtx);
  if (label) return { 'aria-label': label };
  return { 'aria-labelledby': labelledBy ?? f?.labelId };
}

// ------------------------------------------------------------------ Text controls

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} className={cx('ch-input', className)} {...useFieldProps()} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('ch-input', className)} {...useFieldProps()} {...rest} />;
});

/** The text of the amount in pesos ("1,250.00"); parse it with parsePesos from domain/money. */
export const AmountInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'>>(function AmountInput({ className, ...rest }, ref) {
  return (
    <span className="ch-amount">
      <span className="ch-amount-prefix" aria-hidden="true">
        ₱
      </span>
      <input ref={ref} type="text" inputMode="decimal" autoComplete="off" className={cx('ch-input', className)} {...useFieldProps()} {...rest} />
    </span>
  );
});

/** A search box with a magnifier. It has no visible label, so give it aria-label. */
export const SearchInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { 'aria-label': string }>(function SearchInput({ className, ...rest }, ref) {
  return (
    <span className="ch-search">
      <Icon name="search" size={20} />
      <input ref={ref} type="search" className={cx('ch-input', className)} {...rest} />
    </span>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx('ch-input', className)} {...useFieldProps()} {...rest} />;
});

// ------------------------------------------------------------------ Switch, checkbox, radio

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A row with a label and an on/off switch (role="switch"; Space toggles it). */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <label className={cx('ch-switch-row', disabled && 'ch-disabled')}>
      <span className="ch-grow">
        <span className="ch-semibold">{label}</span>
        {description && <span className="ch-muted ch-small ch-block">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className="ch-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** A row with a label and a checkbox. */
export function Checkbox({ checked, onChange, label, disabled }: Omit<SwitchProps, 'description'>) {
  return (
    <label className={cx('ch-switch-row', disabled && 'ch-disabled')}>
      <span className="ch-grow ch-wrap-any">{label}</span>
      <input type="checkbox" className="ch-check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface GroupProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group name for screen readers. Not needed inside a Field. */
  label?: string;
  labelledBy?: string;
}

/** Native radio buttons in rows. Tab enters the group, the arrow keys move and select. */
export function RadioGroup<T extends string>({ options, value, onChange, label, labelledBy }: GroupProps<T>) {
  const name = useId();
  return (
    <div role="radiogroup" {...useGroupLabel(label, labelledBy)}>
      {options.map((o) => (
        <label key={o.value} className="ch-radio-row">
          <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>
            <span className="ch-semibold">{o.label}</span>
            {o.description && <span className="ch-muted ch-small ch-block">{o.description}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Two to four short choices side by side (theme, payment method). One is always selected. */
export function SegmentedControl<T extends string>({ options, value, onChange, label, labelledBy, full }: GroupProps<T> & { full?: boolean }) {
  return (
    <div className={cx('ch-segmented', full && 'ch-full')} role="group" {...useGroupLabel(label, labelledBy)}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cx(o.value === value && 'ch-selected')} aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Single-selection filter chips. On a phone the row scrolls sideways. */
export function FilterChips<T extends string>({ options, value, onChange, label, labelledBy }: GroupProps<T>) {
  return (
    <div className="ch-chips" role="group" {...useGroupLabel(label, labelledBy)}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cx('ch-chip', o.value === value && 'ch-selected')} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Swatches

export interface SwatchesProps {
  /** #RRGGBB values. */
  colors: string[];
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  labelledBy?: string;
  /** The spoken name of a colour. Default: the hex value. */
  colorName?: (hex: string) => string;
}

/** A colour picker as a radio group: one tab stop, arrow keys move and select. */
export function Swatches({ colors, value, onChange, label, labelledBy, colorName }: SwatchesProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(0, colors.findIndex((c) => c.toLowerCase() === value.toLowerCase()));

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + colors.length) % colors.length;
    onChange(colors[next]);
    refs.current[next]?.focus();
  }

  return (
    <div className="ch-swatches" role="radiogroup" {...useGroupLabel(label, labelledBy)}>
      {colors.map((hex, i) => {
        const on = i === selected && colors[i].toLowerCase() === value.toLowerCase();
        return (
          <button
            key={hex}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={colorName ? colorName(hex) : hex}
            tabIndex={i === selected ? 0 : -1}
            className={cx('ch-swatch', on && 'ch-selected')}
            style={{ background: validHex(hex) ?? undefined }}
            onClick={() => onChange(hex)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {on && <Icon name="check" size={20} />}
          </button>
        );
      })}
    </div>
  );
}
