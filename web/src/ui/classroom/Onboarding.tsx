import { useState } from 'react';
import { db } from '../../data/firebase';
import { pushState, turnOnPush } from '../../data/notify';
import { useAnnouncements, useMeetings } from '../../data/features';
import type { Permission } from '../../data/models';
import { Icon, TypeIcon, type IconName } from '../../design';
import { Dialog } from '../common';
import { useClass, type ClassState } from './ClassContext';

/*
 * Help for new users, remembered on this device only (a second device shows it once more):
 * - Welcome: a few cards the first time someone opens a class.
 * - SetupChecklist: the steps a new class needs, on Home, for every officer who can do one of them.
 */

const WELCOME_KEY = 'classhub.welcomeSeen';
const hiddenKey = (classId: string) => `classhub.setupHidden.${classId}`;

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage is blocked: it shows again next time, which is harmless */
  }
}

/** Account > "Show the welcome again". */
export const replayWelcome = () => write(WELCOME_KEY, '');

const OFFICER_PERMISSIONS: Permission[] = ['RECORDS_MANAGE', 'SCHEDULE_MANAGE', 'MEMBERS_MANAGE', 'ROLES_MANAGE', 'CLASS_SETTINGS', 'CONTENTS_MANAGE', 'ANNOUNCEMENTS_MANAGE', 'ATTENDANCE_MANAGE'];
const isOfficer = (state: ClassState) => OFFICER_PERMISSIONS.some((p) => state.can(p));

// ---------------------------------------------------------------- Welcome cards

interface WelcomeCard {
  icon: IconName;
  title: string;
  text: string;
  push?: boolean;
}

function welcomeCards(state: ClassState): WelcomeCard[] {
  const room = state.room!;
  const cards: WelcomeCard[] = [
    { icon: 'home', title: `Welcome to ${room.name}`, text: 'This is where your class keeps its fund, deadlines, files and announcements. Here is a one-minute look around.' },
  ];
  if (isOfficer(state)) {
    cards.push({ icon: 'list', title: 'Set up your class', text: 'Home has a Getting started list with the steps a new class needs. Other officers see it too and can help.' });
  } else {
    if (room.ledgerEnabled) cards.push({ icon: 'ledger', title: 'Your money', text: 'Home and Ledger show what you owe and what you have paid. After you pay, tap "I paid" so the treasurer can confirm it.' });
    if (room.scheduleEnabled) cards.push({ icon: 'schedule', title: 'Your deadlines', text: 'Schedule lists quizzes, exams and deliverables. Tick the circle when you are done with one.' });
    if (room.announcementsEnabled !== false) cards.push({ icon: 'news', title: 'Announcements', text: 'News is where officers post updates. You can vote and comment there.' });
  }
  if (pushState() === 'off') cards.push({ icon: 'bell', title: 'Do not miss anything', text: 'Turn on notifications to hear about new announcements, deadlines and payment updates on this device.', push: true });
  return cards;
}

/** Shows once per device, the first time a class is opened. */
export function Welcome({ state }: { state: ClassState }) {
  const { actions } = useClass();
  const [open, setOpen] = useState(() => !read(WELCOME_KEY));
  const [cards] = useState(() => welcomeCards(state));
  const [step, setStep] = useState(0);
  const [working, setWorking] = useState(false);
  if (!open) return null;
  const card = cards[step];
  const last = step === cards.length - 1;
  const close = () => {
    write(WELCOME_KEY, '1');
    setOpen(false);
  };

  async function turnOn() {
    setWorking(true);
    try {
      const next = await turnOnPush(db, state.myUid);
      actions.showNotice(next === 'on' ? 'Notifications are on for this device.' : next === 'blocked' ? 'Notifications are blocked. Allow them for ClassHub in your settings.' : 'Notifications were not turned on. You can turn them on in Account.');
    } catch {
      actions.showNotice('Notifications could not be turned on. You can try again in Account.');
    }
    close();
  }

  return (
    <Dialog
      title="Getting to know ClassHub"
      onClose={close}
      actions={
        card.push ? (
          <>
            <button className="btn text" disabled={working} onClick={close}>
              Not now
            </button>
            <button className="btn solid" disabled={working} onClick={turnOn}>
              Turn on notifications
            </button>
          </>
        ) : (
          <>
            {!last && (
              <button className="btn text" onClick={close}>
                Skip
              </button>
            )}
            <button className="btn solid" onClick={() => (last ? close() : setStep(step + 1))}>
              {last ? 'Done' : 'Next'}
            </button>
          </>
        )
      }
    >
      <div className="welcome-card">
        <TypeIcon icon={card.icon} tone="primary" size={64} />
        <div className="bold" style={{ fontSize: 20, lineHeight: 1.3 }}>
          {card.title}
        </div>
        <p style={{ margin: 0, lineHeight: 1.55 }}>{card.text}</p>
        <div className="welcome-dots" aria-label={`Card ${step + 1} of ${cards.length}`}>
          {cards.map((c, i) => (
            <i key={c.title} className={i === step ? 'on' : ''} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Officer checklist

interface SetupStep {
  id: string;
  label: string;
  permission: Permission;
  done: boolean;
  go: () => void;
}

/**
 * The Getting started card on Home. Steps tick themselves from what the class holds, so progress is
 * shared by all officers. A step the viewer may not do is greyed with the roles that may.
 */
export function SetupChecklist({ state, go }: { state: ClassState; go: { courses: () => void; timetable: () => void; ledger: () => void; invite: () => void; news: () => void } }) {
  const room = state.room!;
  const officer = isOfficer(state);
  const [hidden, setHidden] = useState(() => !!read(hiddenKey(state.classId)));
  const watching = officer && !hidden;
  const timetableOn = room.timetableEnabled !== false;
  const newsOn = room.announcementsEnabled !== false;
  const meetings = useMeetings(db, state.classId, watching && timetableOn).data;
  const posts = useAnnouncements(db, state.classId, watching && newsOn).data;
  if (!watching) return null;
  // Wait for both lists, so a finished class never flashes the card.
  if ((timetableOn && !meetings) || (newsOn && !posts)) return null;

  const steps: SetupStep[] = [
    { id: 'courses', label: 'Add your courses', permission: 'CLASS_SETTINGS', done: state.courses.length > 0, go: go.courses },
    ...(timetableOn ? [{ id: 'timetable', label: 'Set the weekly timetable', permission: 'SCHEDULE_MANAGE' as Permission, done: (meetings ?? []).length > 0, go: go.timetable }] : []),
    ...(room.ledgerEnabled ? [{ id: 'payment', label: 'Add payment details in Ledger settings', permission: 'RECORDS_MANAGE' as Permission, done: !!room.paymentInfo.trim(), go: go.ledger }] : []),
    { id: 'invite', label: 'Share the invite code', permission: 'MEMBERS_MANAGE', done: state.members.length > 1, go: go.invite },
    ...(newsOn ? [{ id: 'news', label: 'Post your first announcement', permission: 'ANNOUNCEMENTS_MANAGE' as Permission, done: (posts ?? []).length > 0, go: go.news }] : []),
  ];
  const open = steps.filter((s) => !s.done);
  if (!open.some((s) => state.can(s.permission))) return null;

  const whoCan = (p: Permission) => {
    const names = state.roles.filter((r) => r.locked || r.permissions.includes(p)).map((r) => r.name);
    return names.length ? `Needs the ${names.join(' or ')}` : 'Needs an officer';
  };

  return (
    <section className="home-section home-order-1" aria-label="Getting started">
      <div className="section-head">
        <span className="grow">
          <h2>Getting started</h2>
        </span>
        <button
          type="button"
          className="btn text"
          onClick={() => {
            write(hiddenKey(state.classId), '1');
            setHidden(true);
          }}
        >
          Hide
        </button>
      </div>
      <div className="card flush">
        <p className="small muted" style={{ margin: 0, padding: '14px 16px 6px' }}>
          {steps.length - open.length} of {steps.length} done. Every officer sees this list.
        </p>
        {steps.map((s) => {
          const allowed = state.can(s.permission);
          const body = (
            <>
              <span className={'setup-tick' + (s.done ? ' done' : '')} aria-hidden>
                {s.done && <Icon name="check" size={16} />}
              </span>
              <span className="grow">
                <span className="title" style={{ display: 'block', textDecoration: s.done ? 'line-through' : undefined }}>{s.label}</span>
                {!s.done && !allowed && <span className="sub">{whoCan(s.permission)}</span>}
              </span>
              {!s.done && allowed && <span className="muted">›</span>}
            </>
          );
          return s.done || !allowed ? (
            <div key={s.id} className={'list-row' + (s.done || !allowed ? ' setup-quiet' : '')} aria-label={`${s.label}${s.done ? ', done' : ''}`}>
              {body}
            </div>
          ) : (
            <button key={s.id} type="button" className="list-row" onClick={s.go}>
              {body}
            </button>
          );
        })}
      </div>
    </section>
  );
}
