import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, ColorPicker, ACCENT_CHOICES, Dialog, Field, Spinner, TopBar, useBack, Loading } from '../common';
import { db } from '../../data/firebase';
import { useMyClasses as useMyClassesLive } from '../../data/hooks';
import { createClass } from '../../data/classes';
import { cancelJoinRequest, lookupInvite, requestToJoin } from '../../data/membership';
import { useClassPhotos } from '../../data/photoRepo';
import { friendlyMessage } from '../../data/errors';
import type { AppUser, ClassMembership, JoinRequest } from '../../data/models';
import { ClassRules } from '../../domain/classRules';
import { InviteCode } from '../../domain/inviteCode';
import { compareStrings } from '../../domain/classRules';
import { pinnedClasses, useSettingsVersion } from '../settings';

/** The "My classes" list, sorted by name with pinned classes first. Null while loading. */
export function useMyClasses(uid: string): { classes: ClassMembership[] | null; requests: JoinRequest[]; error: string | null } {
  const live = useMyClassesLive(db, uid);
  useSettingsVersion();
  const pinned = pinnedClasses();
  const classes = live.data
    ? live.data.classes
        // A class that no longer exists, or is being deleted, is not listed.
        .filter((c) => c.room !== null && !(c.room && c.room.deletingAtMillis > 0))
        .map((c) => ({ classId: c.classId, className: c.room?.name ?? '', joinedAtMillis: c.member.joinedAtMillis }))
        .sort((a, b) => compareStrings(a.className.toLowerCase(), b.className.toLowerCase()))
        .sort((a, b) => Number(pinned.has(b.classId)) - Number(pinned.has(a.classId)))
    : null;
  const requests = (live.data?.requests ?? []).map((r) => ({ ...r.request, id: r.classId }));
  return { classes, requests, error: live.error ? friendlyMessage(live.error) : null };
}

export function ClassesScreen({ user }: { user: AppUser }) {
  const { classes, requests, error } = useMyClasses(user.uid);
  const photos = useClassPhotos(useMemo(() => classes?.map((c) => c.classId) ?? [], [classes]));
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  useSettingsVersion();
  const pinned = pinnedClasses();

  return (
    <>
      <TopBar
        title="My classes"
        actions={
          <Link className="btn text phone-only" to="/account">
            Account
          </Link>
        }
      />
      <div className="page">
        {classes === null ? (
          <Loading />
        ) : classes.length === 0 && requests.length === 0 ? (
          <div className="empty" style={{ paddingTop: 80 }}>
            <h2 style={{ fontSize: 22, color: 'var(--on-surface)' }}>Hi, {user.displayName}!</h2>
            <p>You are not in any classes yet. Tap "Add a class" to create one or join with a code.</p>
            {error && <p className="error-text">{error}</p>}
          </div>
        ) : (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Signed in as {user.displayName}
            </p>
            <div className="grid-2">
              {classes.map((m) => (
                <Link key={m.classId} to={`/class/${m.classId}`} className="card row" style={{ textDecoration: 'none', color: 'inherit', padding: 14 }}>
                  <Avatar photo={photos.get(m.classId)} name={m.className} color="#0F766E" circle={false} />
                  <span className="grow">
                    <span className="semibold" style={{ display: 'block', fontSize: 16 }}>{m.className}</span>
                    {pinned.has(m.classId) && <span className="small" style={{ color: 'var(--primary)' }}>Pinned</span>}
                  </span>
                </Link>
              ))}
            </div>
            {requests.length > 0 && (
              <>
                <span className="small semibold muted">Waiting for approval</span>
                {requests.map((r) => (
                  <div key={r.id} className="card row" style={{ padding: 14 }}>
                    <span className="grow">
                      <span className="semibold" style={{ display: 'block', fontSize: 16 }}>{r.className}</span>
                      <span className="small muted">An officer of the class has to approve your request.</span>
                    </span>
                    <button className="btn text" onClick={() => cancelJoinRequest(db, user.uid, r.id).catch(() => {})}>
                      Cancel request
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <button className="btn solid fab" onClick={() => setAdding(true)}>
        +&nbsp; Add a class
      </button>
      {adding && <AddClassDialog onClose={() => setAdding(false)} onPick={(to) => (setAdding(false), navigate(to))} />}
    </>
  );
}

export function AddClassDialog({ onClose, onPick }: { onClose: () => void; onPick: (route: string) => void }) {
  return (
    <Dialog
      title="Add a class"
      onClose={onClose}
      actions={
        <button className="btn text" onClick={onClose}>
          Close
        </button>
      }
    >
      <button className="card list-row" style={{ display: 'block', padding: 16 }} onClick={() => onPick('/create')}>
        <span className="bold" style={{ display: 'block' }}>Create a class</span>
        <span className="small muted">For class officers. You become the Class Mayor.</span>
      </button>
      <button className="card list-row" style={{ display: 'block', padding: 16 }} onClick={() => onPick('/join')}>
        <span className="bold" style={{ display: 'block' }}>Join with a code</span>
        <span className="small muted">For students. Ask your Mayor for the invite code.</span>
      </button>
    </Dialog>
  );
}

export function CreateClassScreen({ user }: { user: AppUser }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accent, setAccent] = useState(ACCENT_CHOICES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const back = useBack('/');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = ClassRules.checkName(name);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const { classId } = await createClass(db, { uid: user.uid, name: user.displayName }, { name: name.trim(), description, accentColor: accent });
      navigate(`/class/${classId}`, { replace: true });
    } catch (err) {
      setError(friendlyMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="Create class" back={busy ? undefined : back} backLabel="Cancel" />
      <div className="page narrow">
        <form className="card stack" onSubmit={submit} noValidate>
          <Field label="Class name">
            <input value={name} placeholder="e.g. BSM CS 3A" maxLength={60} onChange={(e) => (setName(e.target.value), setError(null))} />
          </Field>
          <Field label="Description (optional)">
            <input value={description} placeholder="e.g. 1st Semester, AY 2026-2027" maxLength={ClassRules.MAX_DESCRIPTION} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <span className="small semibold muted">Accent color</span>
          <ColorPicker label="Accent color" choices={ACCENT_CHOICES} selected={accent} onSelect={setAccent} />
          <p className="small muted" style={{ margin: 0 }}>
            Default roles are created for you: Mayor, Treasurer, Secretary and Member. You can change them later.
          </p>
          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button className="btn solid big block" type="submit" disabled={busy}>
            {busy ? <Spinner small /> : 'Create class'}
          </button>
        </form>
      </div>
    </>
  );
}

export function JoinClassScreen({ user }: { user: AppUser }) {
  const params = useParams();
  const [code, setCode] = useState(() => InviteCode.normalize(params.code ?? '').slice(0, InviteCode.LENGTH));
  const [preview, setPreview] = useState<{ code: string; className: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const back = useBack('/');

  // Look the class up as soon as a full code is there (typed, or from an invite link).
  useEffect(() => {
    if (code.length !== InviteCode.LENGTH || !InviteCode.isValid(code) || preview?.code === code) return;
    let live = true;
    lookupInvite(db, code)
      .catch(() => null)
      .then((invite) => live && setPreview({ code, className: invite?.className ?? null }));
    return () => {
      live = false;
    };
  }, [code, preview?.code]);

  const className = preview?.code === code ? preview.className : null;
  const noMatch = preview !== null && preview.code === code && preview.className === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!InviteCode.isValid(code)) return setError(`Invite codes have ${InviteCode.LENGTH} letters and numbers.`);
    setBusy(true);
    try {
      await requestToJoin(db, { uid: user.uid, name: user.displayName }, code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(friendlyMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="Join a class" back={busy ? undefined : back} backLabel="Cancel" />
      <div className="page narrow">
        <form className="card stack" onSubmit={submit} noValidate>
          <p className="muted" style={{ margin: 0 }}>Ask your Class Mayor for the {InviteCode.LENGTH}-character invite code.</p>
          <Field label="Invite code">
            <input
              value={code}
              className="mono"
              style={{ fontSize: 26, letterSpacing: 6, textAlign: 'center', textTransform: 'uppercase' }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => (setCode(InviteCode.normalize(e.target.value).slice(0, InviteCode.LENGTH)), setError(null))}
            />
          </Field>
          {className !== null ? (
            <div className="card hero">
              <div className="small soft">You are invited to</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{className}</div>
            </div>
          ) : (
            noMatch && <p className="error-text" style={{ margin: 0 }}>That code does not match any class. Check it with your Class Mayor.</p>
          )}
          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button className="btn solid big block" type="submit" disabled={busy || code.length !== InviteCode.LENGTH}>
            {busy ? <Spinner small /> : className ? `Ask to join ${className}` : 'Ask to join'}
          </button>
          <p className="small muted" style={{ margin: 0 }}>An officer of the class approves your request. You then join as a Member, and the Mayor can give you an officer role afterward.</p>
        </form>
      </div>
    </>
  );
}
