import { useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import * as authRepo from '../data/authRepo';
import type { AppUser } from '../data/models';
import { useAvatar, useClassAccents, useClassPhotos } from '../data/photoRepo';
import { AccountScreen, ANDROID_DOWNLOAD_URL, thisDeviceCard } from './account/AccountScreen';
import { AuthScreen, ChangePasswordScreen } from './auth/AuthScreens';
import { AddClassDialog, ClassesScreen, CreateClassScreen, JoinClassScreen, ShareScreen, useMyClasses } from './classes/ClassesScreens';
import { ClassRoute } from './classroom/ClassScreen';
import { Avatar, Loading, hexColor, useBack } from './common';
import { Logo } from './Logo';
import { UpdateBanner } from './UpdateBanner';

/** Signed out: sign in or create an account. A temporary password must be changed first. Then the app. */
export function App() {
  const session = authRepo.useSession();
  if (session.state === 'loading') return <Loading />;
  // The address is kept, so an invite link opened while signed out still lands on Join after signing in.
  if (session.state === 'signedOut') return <AuthScreen />;
  const user = session.user;
  if (user.mustChangePassword) {
    return <ChangePasswordScreen name={user.displayName} email={user.email} forced onDone={() => {}} onLeave={() => void authRepo.signOut()} />;
  }
  return <SignedIn user={user} />;
}

function SignedIn({ user }: { user: AppUser }) {
  return (
    <div className="app">
      <Sidebar user={user} />
      <main className="main">
        <UpdateBanner />
        <Routes>
          <Route path="/" element={<ClassesScreen user={user} />} />
          <Route path="/account" element={<AccountScreen user={user} />} />
          <Route path="/account/password" element={<PasswordRoute user={user} />} />
          <Route path="/create" element={<CreateClassScreen user={user} />} />
          <Route path="/join" element={<JoinClassScreen user={user} />} />
          <Route path="/share" element={<ShareScreen user={user} />} />
          <Route path="/join/:code" element={<JoinClassScreen user={user} />} />
          <Route path="/class/:classId/*" element={<ClassRoute uid={user.uid} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function PasswordRoute({ user }: { user: AppUser }) {
  const back = useBack('/account');
  return <ChangePasswordScreen name={user.displayName} email={user.email} forced={false} onDone={back} onLeave={back} />;
}

/** The wide-screen sidebar: My classes (pinned first), Add a class, Account and the Android app. Hidden on phones. */
function Sidebar({ user }: { user: AppUser }) {
  const { classes } = useMyClasses(user.uid);
  const classIds = useMemo(() => classes?.map((c) => c.classId) ?? [], [classes]);
  const photos = useClassPhotos(classIds);
  const accents = useClassAccents(classIds);
  const avatar = useAvatar(user.uid);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const itemClass = ({ isActive }: { isActive: boolean }) => 'side-item' + (isActive ? ' active' : '');

  return (
    <aside className="sidebar" aria-label="ClassHub">
      <NavLink to="/" className="brand link-reset">
        <Logo size={34} />
        ClassHub
      </NavLink>
      <NavLink to="/" end className={itemClass}>
        <span className="grow">My classes</span>
      </NavLink>
      <div className="side-label">Classes</div>
      {classes === null ? (
        <div className="side-item muted">Loading…</div>
      ) : (
        classes.map((m) => (
          <NavLink key={m.classId} to={`/class/${m.classId}`} className={itemClass} title={m.className}>
            <Avatar photo={photos.get(m.classId)} name={m.className} color={hexColor(accents.get(m.classId), '#0F766E')} size={30} circle={false} />
            <span className="grow">{m.className}</span>
          </NavLink>
        ))
      )}
      <button type="button" className="side-item" onClick={() => setAdding(true)}>
        <span className="side-plus" aria-hidden>
          +
        </span>
        <span className="grow">Add a class</span>
      </button>
      <div className="side-spacer" />
      {thisDeviceCard() === 'android' && (
        <a className="side-item" href={ANDROID_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
          <span className="grow">Get the Android app</span>
          <span aria-hidden>↗</span>
        </a>
      )}
      <NavLink to="/account" className={itemClass}>
        <Avatar photo={avatar} name={user.displayName} color="#0F766E" size={30} />
        <span className="grow">
          {user.displayName}
          <span className="tiny muted" style={{ display: 'block' }}>Account</span>
        </span>
      </NavLink>
      {adding && <AddClassDialog onClose={() => setAdding(false)} onPick={(to) => (setAdding(false), navigate(to))} />}
    </aside>
  );
}
