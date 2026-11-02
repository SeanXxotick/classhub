import { useState, type FormEvent } from 'react';
import { Dialog, Field, PasswordInput, Spinner, Icon } from '../common';
import { friendlyMessage } from '../../data/errors';
import * as authRepo from '../../data/authRepo';
import { NameRules, personName } from '../../domain/nameRules';
import { PasswordRules } from '../../domain/passwordRules';
import { Logo } from '../Logo';

interface UiState {
  busy: boolean;
  error: string | null;
  notice: string | null;
}

const idle: UiState = { busy: false, error: null, notice: null };

/** Sign in or create an account. */
export function AuthScreen() {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [first, setFirst] = useState('');
  const [initial, setInitial] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ui, setUi] = useState<UiState>(idle);
  const clear = () => ui.error && setUi(idle);

  async function run(block: () => Promise<void>) {
    setUi({ ...idle, busy: true });
    try {
      await block();
      setUi(idle);
    } catch (e) {
      setUi({ ...idle, error: friendlyMessage(e) });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ui.busy) return;
    if (!creating) {
      if (!email.trim() || !password) return setUi({ ...idle, error: 'Enter your email and password.' });
      return void run(() => authRepo.signIn(email, password));
    }
    const name = personName(first, initial, last);
    const problem = NameRules.check(name) ?? (!email.trim() ? 'Enter your email.' : PasswordRules.strength(password, email));
    if (problem) return setUi({ ...idle, error: problem });
    void run(() => authRepo.signUp(name, email, password));
  }

  return (
    <div className="auth">
      <section className="auth-art">
        <div className="auth-art-inner">
          <div className="row" style={{ gap: 12 }}>
            <Logo size={44} />
            <span style={{ fontSize: 26, fontWeight: 800 }}>ClassHub</span>
          </div>
          <h2 style={{ fontSize: 30 }}>{creating ? 'Create your account' : 'Everything your class needs.'}</h2>
          <p style={{ margin: 0, color: '#d9f2ee' }}>
            {creating ? 'After signing up, join your class with the invite code from your officers.' : 'Sign in to see your dues, deadlines and class files.'}
          </p>
          <PreviewCards />
        </div>
      </section>
      <section className="auth-form">
        <div>
          <form className="stack" onSubmit={submit} noValidate>
            <h1 style={{ fontSize: 24 }}>{creating ? 'Create account' : 'Sign in'}</h1>
            {creating && (
              <>
                <Field label="First name">
                  <input value={first} autoComplete="given-name" onChange={(e) => (setFirst(e.target.value.slice(0, NameRules.MAX_PART_LENGTH)), clear())} />
                </Field>
                <div className="field-row">
                  <div style={{ width: 90 }}>
                    <Field label="M.I.">
                      <input value={initial} autoComplete="additional-name" onChange={(e) => (setInitial(NameRules.cleanInitial(e.target.value)), clear())} />
                    </Field>
                  </div>
                  <div className="grow">
                    <Field label="Last name">
                      <input value={last} autoComplete="family-name" onChange={(e) => (setLast(e.target.value.slice(0, NameRules.MAX_PART_LENGTH)), clear())} />
                    </Field>
                  </div>
                </div>
              </>
            )}
            <Field label="Email">
              <input type="email" value={email} autoComplete="email" onChange={(e) => (setEmail(e.target.value), clear())} />
            </Field>
            <PasswordInput
              value={password}
              onChange={(v) => (setPassword(v), clear())}
              autoComplete={creating ? 'new-password' : 'current-password'}
              help={creating ? `At least ${PasswordRules.MIN_LENGTH} characters, with at least one letter.` : undefined}
            />
            {!creating && (
              <div style={{ textAlign: 'right' }}>
                <button type="button" className="btn text small" disabled={ui.busy} onClick={() => (setUi(idle), setResetting(true))}>
                  Forgot password?
                </button>
              </div>
            )}
            {!resetting && ui.error && <p className="error-text" role="alert" style={{ margin: 0 }}>{ui.error}</p>}
            <button className="btn solid big block" type="submit" disabled={ui.busy}>
              {ui.busy ? <Spinner small /> : creating ? 'Create account' : 'Sign in'}
            </button>
            <p className="center muted" style={{ margin: 0 }}>
              {creating ? 'Already have an account?' : 'New here?'}{' '}
              <button type="button" className="btn text" disabled={ui.busy} onClick={() => (setCreating(!creating), setUi(idle))}>
                {creating ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </form>
        </div>
      </section>
      {resetting && <ResetPasswordDialog initialEmail={email} onClose={() => setResetting(false)} />}
    </div>
  );
}

/** Three sample cards: a fund total, a deliverable and a new video. Decoration only. */
function PreviewCards() {
  return (
    <div className="preview-cards" aria-hidden>
      <div className="preview-card" style={{ background: '#0f766e', color: '#fff' }}>
        <div>
          <div className="tiny" style={{ color: '#d9f2ee' }}>Cash on hand</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>₱1,250.00</div>
          <div className="tiny" style={{ color: '#d9f2ee' }}>✓ Books balanced</div>
        </div>
      </div>
      <div className="preview-card">
        <Icon name="ic_kind_deliverable" color="#2563EB" size={26} />
        <div>
          <div className="semibold small">Problem Set 4</div>
          <div className="tiny muted">Due tomorrow</div>
        </div>
      </div>
      <div className="preview-card">
        <Icon name="ic_sched_play" color="#DC2626" size={26} />
        <div>
          <div className="semibold small">New recording</div>
          <div className="tiny muted">Chapter 3 video</div>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [ui, setUi] = useState<UiState>(idle);
  const sent = ui.notice !== null;

  async function send() {
    if (!email.trim()) return setUi({ ...idle, error: 'Enter the email you use to sign in.' });
    setUi({ ...idle, busy: true });
    try {
      await authRepo.sendPasswordReset(email);
      setUi({
        ...idle,
        notice: `If an account exists for ${email.trim()}, a reset link is on its way. Check your inbox and your junk or spam folder.`,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setUi({ ...idle, error: code === 'auth/invalid-email' ? 'That email does not look right. Check it and try again.' : friendlyMessage(e) });
    }
  }

  return (
    <Dialog
      title="Reset your password"
      onClose={() => !ui.busy && onClose()}
      actions={
        sent ? (
          <button className="btn text" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn text" disabled={ui.busy} onClick={onClose}>
              Cancel
            </button>
            <button className="btn text" disabled={ui.busy} onClick={send}>
              {ui.busy ? <Spinner small /> : 'Send reset link'}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <>
          <p style={{ margin: 0 }}>{ui.notice}</p>
          <p className="small muted" style={{ margin: 0 }}>Open the link, choose a new password, then come back and sign in with it.</p>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            Enter the email you use to sign in. We will send a link to that inbox so you can choose a new password.
          </p>
          <Field label="Email">
            <input type="email" value={email} autoComplete="email" onChange={(e) => (setEmail(e.target.value), setUi(idle))} />
          </Field>
          {ui.error && <p className="error-text" style={{ margin: 0 }}>{ui.error}</p>}
        </>
      )}
    </Dialog>
  );
}

/** Choose a new password: forced for accounts the class created with a temporary password, or from Account. */
export function ChangePasswordScreen({ name, email, forced, onDone, onLeave }: { name: string; email: string; forced: boolean; onDone: () => void; onLeave: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ui, setUi] = useState<UiState>(idle);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (ui.busy) return;
    const problem = PasswordRules.check(password, confirm, email);
    if (problem) return setUi({ ...idle, error: problem });
    setUi({ ...idle, busy: true });
    try {
      await authRepo.changePassword(password);
      setUi(idle);
      onDone();
    } catch (err) {
      setUi({ ...idle, error: friendlyMessage(err) });
    }
  }

  return (
    <div className="page narrow" style={{ paddingTop: 48 }}>
      <form className="card stack" onSubmit={submit} noValidate>
        <h1 style={{ fontSize: 24 }}>{forced ? `Welcome, ${name}` : 'Change password'}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {forced
            ? 'Your account was set up with a temporary password. Set your own password now so nobody else can sign in as you.'
            : 'Choose a new password for signing in to ClassHub.'}
        </p>
        <p className="small muted" style={{ margin: 0 }}>At least {PasswordRules.MIN_LENGTH} characters, with at least one letter.</p>
        <PasswordInput label="New password" value={password} onChange={(v) => (setPassword(v), setUi(idle))} autoComplete="new-password" />
        <PasswordInput label="Type it again" value={confirm} onChange={(v) => (setConfirm(v), setUi(idle))} autoComplete="new-password" />
        {ui.error && <p className="error-text" role="alert" style={{ margin: 0 }}>{ui.error}</p>}
        <button className="btn solid big block" type="submit" disabled={ui.busy}>
          {ui.busy ? <Spinner small /> : 'Save new password'}
        </button>
        <button className="btn text block" type="button" disabled={ui.busy} onClick={onLeave}>
          {forced ? 'Sign out' : 'Cancel'}
        </button>
      </form>
    </div>
  );
}
