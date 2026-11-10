import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './util';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** solid is the main action, outline a quieter one, text the quietest. Default solid. */
  variant?: 'solid' | 'outline' | 'text';
  /** Red, for actions that remove or void something. */
  danger?: boolean;
  size?: 'normal' | 'small' | 'big';
  /** Fills the width of its container. */
  block?: boolean;
  /** A leading icon. */
  icon?: IconName;
  /** A small count bubble after the label (for example waiting claims). */
  count?: number;
  /**
   * Shows a spinner and ignores clicks. The button stays focusable (aria-disabled, not disabled),
   * so a keyboard user does not lose their place while it works.
   */
  busy?: boolean;
}

/** Always a button, never a link, and type="button" unless you ask for "submit". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', danger, size = 'normal', block, icon, count, busy, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ch-btn', `ch-${variant}`, danger && 'ch-danger', size !== 'normal' && `ch-${size}`, block && 'ch-block', className)}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {busy ? <span className="ch-spinner ch-sm" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'small' ? 18 : 20} />}
      {children}
      {count !== undefined && <span className="ch-count">{count}</span>}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: IconName;
  /** Required: the accessible name, for example "Edit course". */
  label: string;
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, iconSize = 24, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx('ch-icon-btn', className)} aria-label={label} {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
});

export interface FabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The visible text, for example "New record". */
  label: string;
  icon?: IconName;
}

/**
 * The floating action button. Place it inside AppShell (the fab prop), after the page: it floats
 * above the bottom navigation on phones. Give the page hasFab so the last row is not covered.
 */
export function Fab({ label, icon = 'plus', className, type = 'button', ...rest }: FabProps) {
  return (
    <div className="ch-fab-wrap">
      <button type={type} className={cx('ch-fab', className)} {...rest}>
        <Icon name={icon} size={24} />
        <span>{label}</span>
      </button>
    </div>
  );
}
