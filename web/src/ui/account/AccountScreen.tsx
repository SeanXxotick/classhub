import { db } from '../../data/firebase';
import { NOTICE_KINDS, NOTICE_LABELS, mutedKinds, pushState, setMutedKinds, turnOffPush, turnOnPush, type NoticeKind, type PushState } from '../../data/notify';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as authRepo from '../../data/authRepo';
import { friendlyMessage } from '../../data/errors';
import type { AppUser } from '../../data/models';
import { removeAvatar, setAvatar, useAvatar } from '../../data/photoRepo';
import { installCard, type InstallCard } from '../../domain/installCard';
import { NameRules, personName, type PersonName } from '../../domain/nameRules';
import { Avatar, Dialog, Field, PasswordInput, Spinner, TopBar, useBack, useNotice, usePhotoPicker } from '../common';
import { replayWelcome } from '../classroom/Onboarding';
import { setThemeMode, themeMode, useSettingsVersion, type ThemeMode } from '../settings';

/** Where the Android app is downloaded from (the same page the Android update prompt opens). */
export const ANDROID_DOWNLOAD_URL = 'https://classhub-975eb.web.app/download';

export function thisDeviceCard(): InstallCard {
  const nav = navigator as Navigator & { standalone?: boolean };
  return installCard({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints || 0,
    standalone: nav.standalone === true || matchMedia('(display-mode: standalone)').matches,
    androidApp: !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
  });
}

type DeleteStep = { kind: 'checking' } | { kind: 'mustHandOver'; classNames: string[] } | { kind: 'confirm'; error: string | null };

export function AccountScreen({ user }: { user: AppUser }) {
  const notice = useNotice();
  const navigate = useNavigate();
  const back = useBack('/');
  const photo = useAvatar(user.uid);
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [deleteStep, setDeleteStep] = useState<DeleteStep | null>(null);
  useSettingsVersion();
  const [card] = useState(thisDeviceCard);

  async function run(success: string | null, block: () => Promise<unknown>, onDone?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await block();
      if (success) notice(success);
      onDone?.();
    } catch (e) {
      notice(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const [pickPhoto, photoInput] = usePhotoPicker((p) => run('Profile photo updated.', () => setAvatar(user.uid, p)), notice);

  /** Opens the delete dialog, first checking that the user is not the Mayor of any class. */
  async function startDelete() {
    setDeleteStep({ kind: 'checking' });
    try {
      const owned = await authRepo.classesIOwn();
      setDeleteStep(owned.length === 0 ? { kind: 'confirm', error: null } : { kind: 'mustHandOver', classNames: owned });
    } catch (e) {
      notice(friendlyMessage(e));
      setDeleteStep(null);
    }
  }

  /** On success the sign-in is gone, so the app returns to the sign-in screen by itself. */
  async function deleteAccount(password: string) {
    if (busy) return;
    if (!password) return setDeleteStep({ kind: 'confirm', error: 'Enter your password.' });
    setBusy(true);
    try {
      await authRepo.deleteAccount(password);
      setDeleteStep(null);
      navigate('/', { replace: true });
    } catch (e) {
      setDeleteStep({ kind: 'confirm', error: friendlyMessage(e).replace('The email or password is incorrect.', 'That password is incorrect.') });
    } finally {
      setBusy(false);
    }
  }

  const themes: [ThemeMode, string][] = [
    ['SYSTEM', 'Device setting'],
    ['LIGHT', 'Light'],
    ['DARK', 'Dark'],
  ];

  return (
    <>
      <TopBar title="Account" back={back} />
      <div className="page narrow">
        {photoInput}
        <div className="stack">
          <div className="card">
            <div className="row" style={{ gap: 14 }}>
              <Avatar photo={photo} name={user.displayName} color="var(--accent, #0F766E)" size={64} />
              <span className="grow">
                <span className="bold" style={{ display: 'block' }}>{user.displayName}</span>
                <span className="small muted" style={{ display: 'block' }}>{user.email}</span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn text small" disabled={busy} onClick={pickPhoto}>
                    {photo ? 'Change photo' : 'Add photo'}
                  </button>
                  {photo && (
                    <button className="btn text small danger" disabled={busy} onClick={() => run('Profile photo removed.', () => removeAvatar(user.uid))}>
                      Remove
                    </button>
                  )}
                </span>
              </span>
            </div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              Your photo shows in every class you are in: on the member list, your member page and your ledger records.
            </p>
          </div>

          <NameCard key={`${user.displayName}|${user.firstName}|${user.middleInitial}|${user.lastName}`} user={user} busy={busy} onSave={(name) => run('Name saved. It now shows in all your classes.', () => authRepo.updateName(name))} />

          <div className="card stack" style={{ gap: 8 }}>
            <div className="bold">Appearance</div>
            <div className="chips" role="radiogroup" aria-label="Appearance">
              {themes.map(([mode, label]) => (
                <button key={mode} type="button" role="radio" aria-checked={themeMode() === mode} className={'chip' + (themeMode() === mode ? ' selected' : '')} onClick={() => setThemeMode(mode)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <NotificationsCard uid={user.uid} notice={notice} />

          {card === 'android' && (
            <div className="card stack" style={{ gap: 8 }}>
              <div className="bold">Get the Android app</div>
              <p className="small muted" style={{ margin: 0 }}>
                ClassHub for Android is this same app on your phone, with notifications for announcements, due dates and other class updates.
              </p>
              <a className="btn outline" href={ANDROID_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                Download for Android
              </a>
            </div>
          )}

          {card === 'iphone' && (
            <div className="card stack" style={{ gap: 8 }}>
              <div className="bold">Install on iPhone</div>
              <p className="small muted" style={{ margin: 0 }}>
                Add ClassHub to your home screen and it opens like an app, full screen with its own icon.
              </p>
              <ol className="small install-steps">
                <li>
                  Tap the <b>Share</b> button in Safari (the square with an arrow pointing up).
                </li>
                <li>
                  Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
                </li>
                <li>Open ClassHub from your home screen and sign in.</li>
              </ol>
              <p className="tiny muted" style={{ margin: 0 }}>
                For reminders, turn on notifications here after opening ClassHub from the home screen. This needs iOS 16.4 or newer.
              </p>
            </div>
          )}

          <button className="btn outline block" onClick={() => (replayWelcome(), notice('The welcome will show the next time you open a class.'))}>
            Show the welcome again
          </button>
          <button className="btn outline block" onClick={() => navigate('/account/password')}>
            Change password
          </button>
          <button className="btn outline danger block" onClick={() => setConfirmSignOut(true)}>
            Sign out
          </button>
          <button className="btn text danger block" disabled={busy} onClick={startDelete}>
            Delete account
          </button>
        </div>
      </div>

      {deleteStep && <DeleteAccountDialog step={deleteStep} busy={busy} onDelete={deleteAccount} onCancel={() => !busy && setDeleteStep(null)} />}

      {confirmSignOut && (
        <Dialog
          title="Sign out?"
          onClose={() => setConfirmSignOut(false)}
          actions={
            <>
              <button className="btn text" onClick={() => setConfirmSignOut(false)}>
                Cancel
              </button>
              <button className="btn text" onClick={() => (setConfirmSignOut(false), navigate('/', { replace: true }), void authRepo.signOut())}>
                Sign out
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>You can sign back in any time with your email and password.</p>
        </Dialog>
      )}
    </>
  );
}

/** First name, middle initial and last name. Saving updates the name in every class the student is in. */
function NameCard({ user, busy, onSave }: { user: AppUser; busy: boolean; onSave: (name: PersonName) => void }) {
  // Older accounts only have one line; split it as a starting point the student can correct.
  const saved: PersonName = user.firstName.trim() || user.lastName.trim() ? personName(user.firstName, user.middleInitial, user.lastName) : NameRules.split(user.displayName);
  const [first, setFirst] = useState(saved.first);
  const [initial, setInitial] = useState(saved.middleInitial);
  const [last, setLast] = useState(saved.last);
  const edited = personName(first, initial, last);
  const a = NameRules.cleaned(edited);
  const b = NameRules.cleaned(saved);
  const changed = a.first !== b.first || a.middleInitial !== b.middleInitial || a.last !== b.last;
  const problem = changed ? NameRules.check(edited) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (changed && !problem) onSave(edited);
  }

  return (
    <form className="card stack" style={{ gap: 8 }} onSubmit={submit} noValidate>
      <div className="bold">Your name</div>
      <p className="small muted" style={{ margin: 0 }}>This is how your classmates and officers see you in every class.</p>
      <Field label="First name">
        <input value={first} autoComplete="given-name" onChange={(e) => setFirst(e.target.value.slice(0, NameRules.MAX_PART_LENGTH))} />
      </Field>
      <div className="field-row">
        <div style={{ width: 90 }}>
          <Field label="M.I.">
            <input value={initial} autoComplete="additional-name" onChange={(e) => setInitial(NameRules.cleanInitial(e.target.value))} />
          </Field>
        </div>
        <div className="grow">
          <Field label="Last name">
            <input value={last} autoComplete="family-name" onChange={(e) => setLast(e.target.value.slice(0, NameRules.MAX_PART_LENGTH))} />
          </Field>
        </div>
      </div>
      {changed && (
        <>
          <p className="small muted" style={{ margin: 0 }}>Shown as: {NameRules.display(edited)}</p>
          {problem && <p className="error-text small" style={{ margin: 0 }}>{problem}</p>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn text" disabled={busy} onClick={() => (setFirst(saved.first), setInitial(saved.middleInitial), setLast(saved.last))}>
              Undo
            </button>
            <button type="submit" className="btn solid" disabled={busy || problem !== null}>
              Save name
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** Checks for classes to hand over, then asks for the password before deleting everything. */
function DeleteAccountDialog({ step, busy, onDelete, onCancel }: { step: DeleteStep; busy: boolean; onDelete: (password: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  if (step.kind === 'checking') {
    return (
      <Dialog
        title="Delete account"
        onClose={onCancel}
        actions={
          <button className="btn text" onClick={onCancel}>
            Cancel
          </button>
        }
      >
        <div className="row">
          <Spinner small />
          Checking your classes.
        </div>
      </Dialog>
    );
  }
  if (step.kind === 'mustHandOver') {
    return (
      <Dialog
        title="Choose a new Mayor first"
        onClose={onCancel}
        actions={
          <button className="btn text" onClick={onCancel}>
            OK
          </button>
        }
      >
        <p style={{ margin: 0 }}>
          You are the Mayor of {step.classNames.join(', ')}. A class always needs a Mayor, so open {step.classNames.length === 1 ? 'that class' : 'each class'}, click My
          settings at the top, and leave the class by making someone else the Mayor. Then come back here.
        </p>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Delete your account?"
      onClose={onCancel}
      actions={
        <>
          <button className="btn text" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn text danger" disabled={busy} onClick={() => onDelete(password)}>
            {busy ? 'Deleting' : 'Delete account'}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        This cannot be undone. You will leave all your classes, and your name, photo and done marks will be erased. Ledger records with your name stay in each class, because
        they are part of the class fund's history.
      </p>
      <p className="semibold" style={{ margin: 0 }}>
        If you still have money left in a class fund, or still owe money, settle it with your class officers first.
      </p>
      <form onSubmit={(e) => (e.preventDefault(), onDelete(password))}>
        <PasswordInput label="Your password" value={password} onChange={setPassword} autoComplete="current-password" help={step.error ?? undefined} />
      </form>
      {step.error && <span className="sr-only" role="alert">{step.error}</span>}
    </Dialog>
  );
}

/** Notifications on this phone or browser: on or off, and which kinds. */
function NotificationsCard({ uid, notice }: { uid: string; notice: (message: string) => void }) {
  const [state, setState] = useState<PushState>(pushState());
  const [muted, setMuted] = useState<NoticeKind[]>(mutedKinds());
  const [working, setWorking] = useState(false);

  async function turnOn() {
    setWorking(true);
    try {
      const next = await turnOnPush(db, uid);
      setState(next);
      notice(next === 'on' ? 'Notifications are on for this device.' : next === 'blocked' ? 'Notifications are blocked. Allow them for ClassHub in your settings.' : 'Notifications were not turned on.');
    } catch {
      notice('Notifications could not be turned on. Check your connection and try again.');
    } finally {
      setWorking(false);
    }
  }

  function toggle(kind: NoticeKind) {
    const next = muted.includes(kind) ? muted.filter((k) => k !== kind) : [...muted, kind];
    setMuted(next);
    setMutedKinds(db, uid, next).catch(() => notice('That could not be saved. Try again.'));
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="bold">Notifications</div>
      {state === 'unsupported' && <p className="small muted" style={{ margin: 0 }}>This browser cannot show notifications. On an iPhone, add ClassHub to the Home Screen first.</p>}
      {state === 'blocked' && <p className="small muted" style={{ margin: 0 }}>Notifications are blocked for ClassHub. Allow them in your settings, then come back here.</p>}
      {state === 'off' && (
        <>
          <p className="small muted" style={{ margin: 0 }}>Get a notification on this device for announcements, new deadlines, reminders and your payment claims.</p>
          <button className="btn solid" disabled={working} onClick={turnOn}>
            Turn on notifications
          </button>
        </>
      )}
      {state === 'on' && (
        <>
          <p className="small muted" style={{ margin: 0 }}>On for this device. Choose what you want to hear about.</p>
          {NOTICE_KINDS.map((kind) => (
            <label key={kind} className="row" style={{ gap: 10 }}>
              <input type="checkbox" checked={!muted.includes(kind)} onChange={() => toggle(kind)} />
              <span>{NOTICE_LABELS[kind]}</span>
            </label>
          ))}
          <button className="btn outline" disabled={working} onClick={() => turnOffPush(db).then(() => (setState('off'), notice('Notifications are off for this device.')))}>
            Turn off notifications
          </button>
        </>
      )}
    </div>
  );
}
