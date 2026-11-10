import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './actions';
import { Icon } from './Icon';
import { Field, TextArea, TextInput } from './inputs';
import { Notice } from './surfaces';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && !el.hidden && el.offsetParent !== null);
}

export interface DialogProps {
  open: boolean;
  title: string;
  /** Called for Escape and a click on the dim background. Neither works while busy. */
  onClose: () => void;
  /** Something is being saved: the dialog cannot be dismissed. */
  busy?: boolean;
  /** The buttons, right aligned (put the main one last). */
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * A modal dialog. Focus moves to the first control when it opens, Tab stays inside it, and focus
 * returns to whatever opened it when it closes. It is drawn in document.body, so a button inside
 * it can never submit a form that the opener lives in.
 */
export function Dialog({ open, title, onClose, busy, actions, children }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const downOnScrim = useRef(false);
  const [accent, setAccent] = useState<string>('');
  // The newest callbacks, so the key handler below does not have to be re-attached on every render.
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    // Keep the class accent: the dialog lives in <body>, outside the Accented wrapper of its opener.
    if (opener instanceof HTMLElement) setAccent(getComputedStyle(opener).getPropertyValue('--ch-accent').trim());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = dialogRef.current ? focusables(dialogRef.current)[0] : undefined;
    (first ?? dialogRef.current)?.focus({ preventScroll: true });

    // On the document, so Escape and Tab still work when focus has dropped to the page (a button that became disabled).
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!latest.current.busy) latest.current.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(dialog);
      if (!items.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!inside || (e.shiftKey && (active === firstItem || active === dialog))) {
        e.preventDefault();
        (e.shiftKey ? lastItem : firstItem).focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="ch-scrim ch-accented"
      style={accent ? { ['--ch-accent' as string]: accent } : undefined}
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Only a click that started and ended on the dim background closes it (not a text selection dragged out of a field).
        if (e.target === e.currentTarget && downOnScrim.current && !busy) onClose();
      }}
    >
      <div ref={dialogRef} className="ch-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined} tabIndex={-1}>
        <h2 className="ch-dialog-title" id={titleId}>
          {title}
        </h2>
        {children}
        {actions && <div className="ch-dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The question or the consequences. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button (default true: most confirmations remove or void something). */
  danger?: boolean;
  busy?: boolean;
  /** An error from the last attempt, shown inside the dialog. */
  error?: string;
  /** Asks for a reason. The confirm button stays disabled until one is typed. */
  reason?: { label: string; hint?: string; placeholder?: string; /** Longest reason allowed (default 200, the limit in the security rules). */ maxLength?: number };
  /** Asks to type a name (the class name) exactly before the confirm button works. */
  typeToConfirm?: { label: string; expected: string };
  /** Receives the trimmed reason ("" when none was asked for). */
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** A question with Cancel and a confirm button, optionally gated by a reason or by typing a name. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmBody {...props} />;
}

function ConfirmBody({ title, children, confirmLabel, cancelLabel = 'Cancel', danger = true, busy, error, reason, typeToConfirm, onConfirm, onCancel }: ConfirmDialogProps) {
  const [reasonText, setReasonText] = useState('');
  const [typed, setTyped] = useState('');
  const ready = (!reason || reasonText.trim() !== '') && (!typeToConfirm || typed.trim() === typeToConfirm.expected);
  return (
    <Dialog
      open
      title={title}
      onClose={onCancel}
      busy={busy}
      actions={
        <>
          <Button variant="text" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button danger={danger} busy={busy} disabled={!ready} onClick={() => onConfirm(reasonText.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {reason && (
        <Field label={reason.label} hint={reason.hint ?? 'A reason is required.'} required>
          <TextArea value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder={reason.placeholder ?? 'Write the reason'} maxLength={reason.maxLength ?? 200} disabled={busy} />
        </Field>
      )}
      {typeToConfirm && (
        <Field label={typeToConfirm.label}>
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={typeToConfirm.expected} autoComplete="off" disabled={busy} />
        </Field>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Snackbar

/** The message bar. The live region always exists so screen readers announce each new message politely. */
export function Snackbar({ message }: { message: string | null }) {
  return (
    <div className="ch-snackbar" role="status" aria-live="polite">
      {message && (
        <div className="ch-snackbar-msg">
          <Icon name="check" size={18} />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

/**
 * const { show, snackbar } = useSnackbar();  show('Record voided.');  return <>...{snackbar}</>;
 * The message goes away by itself after a few seconds (default 4).
 */
export function useSnackbar(seconds = 4) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback(
    (text: string) => {
      window.clearTimeout(timer.current);
      setMessage(text);
      timer.current = window.setTimeout(() => setMessage(null), seconds * 1000);
    },
    [seconds],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { show, snackbar: <Snackbar message={message} /> };
}
