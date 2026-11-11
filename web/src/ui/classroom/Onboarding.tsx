import { useCallback, useEffect, useState } from 'react';
import { db } from '../../data/firebase';
import { pushState, turnOnPush } from '../../data/notify';
import { useAnnouncements, useMeetings } from '../../data/features';
import type { Permission } from '../../data/models';
import { Icon, TypeIcon, type IconName } from '../../design';
import { Dialog } from '../common';
import { useClass, type ClassState } from './ClassContext';

/*
 * Help for new users, remembered on this device only (a second device shows it once more):
 * - Welcome: a short tour the first time someone opens a class. Real buttons light up and the user taps them.
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

// ---------------------------------------------------------------- Welcome tour

/**
 * One step of the tour.
 * - card: a message in the middle of the screen (the start, and the notifications offer).
 * - tap:  a real button is lit and the user taps it; the tap does what it always does (it opens a tab).
 * - show: a real control is lit and explained, but a tap on it does nothing, so the tour never files
 *         a claim or ticks a deadline by accident. "Got it" moves on.
 * A step whose target is not on the screen (a module is off, or a list is empty) is skipped.
 */
type TourStep =
  | { kind: 'card'; icon: IconName; title: string; text: string; push?: boolean }
  | { kind: 'tap' | 'show'; target: string; title: string; text: string };

function tourSteps(state: ClassState): TourStep[] {
  const room = state.room!;
  const steps: TourStep[] = [
    { kind: 'card', icon: 'home', title: `Welcome to ${room.name}`, text: 'This is where your class keeps its fund, deadlines, files and announcements. Take a one-minute tour: tap what lights up.' },
  ];
  if (isOfficer(state)) {
    steps.push({ kind: 'show', target: 'section[aria-label="Getting started"]', title: 'Set up your class', text: 'These are the steps a new class needs. Tap one any time to do it. Other officers see this list too and can help.' });
  } else {
    if (room.ledgerEnabled) {
      steps.push({ kind: 'tap', target: '[data-tour="tab-LEDGER"]', title: 'Your money', text: 'Tap Ledger to see what you owe and what you have paid.' });
      steps.push({ kind: 'show', target: '[data-tour="i-paid"]', title: 'Tell the treasurer you paid', text: 'After you pay, tap "I paid" here. The treasurer confirms it and your balance updates.' });
    }
    if (room.scheduleEnabled) {
      steps.push({ kind: 'tap', target: '[data-tour="tab-SCHEDULE"]', title: 'Your deadlines', text: 'Tap Schedule to see quizzes, exams and deliverables.' });
      steps.push({ kind: 'show', target: '.done-check', title: 'Tick it when you are done', text: 'Tap the circle beside a deadline when you finish it, so you always know what is left.' });
    }
    if (room.announcementsEnabled !== false) {
      steps.push({ kind: 'tap', target: '[data-tour="tab-NEWS"]', title: 'Announcements', text: 'Tap News to read what the officers post.' });
      steps.push({ kind: 'show', target: '.vote-bar', title: 'Vote and comment', text: 'Vote up or down on an announcement, and open its comments to ask a question.' });
    }
    steps.push({ kind: 'tap', target: '[data-tour="tab-HOME"]', title: 'Back to Home', text: 'Tap Home. It gathers today, what is due and your balance in one place.' });
  }
  if (pushState() === 'off') steps.push({ kind: 'card', icon: 'bell', title: 'Do not miss anything', text: 'Turn on notifications to hear about new announcements, deadlines and payment updates on this device.', push: true });
  return steps;
}

/** The first element matching the selector that is actually on screen (the phone and wide menus both exist). */
function visibleTarget(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Shows once per device, the first time a class is opened. */
export function Welcome({ state }: { state: ClassState }) {
  const { actions } = useClass();
  const [open, setOpen] = useState(() => !read(WELCOME_KEY));
  const [steps] = useState(() => tourSteps(state));
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [working, setWorking] = useState(false);
  const step = open ? steps[index] : undefined;

  const close = useCallback(() => {
    write(WELCOME_KEY, '1');
    setOpen(false);
  }, []);
  const next = useCallback(() => {
    setBox(null);
    setIndex((i) => {
      if (i + 1 < steps.length) return i + 1;
      write(WELCOME_KEY, '1');
      setOpen(false);
      return i;
    });
  }, [steps.length]);

  // Finds the lit control, keeps its place while the page moves, and skips the step if it never shows up.
  useEffect(() => {
    if (!step || step.kind === 'card') return;
    let target: HTMLElement | null = null;
    const started = Date.now();
    const onTap = () => next();
    const timer = window.setInterval(() => {
      if (!target || !target.isConnected) {
        target?.removeEventListener('click', onTap);
        target = visibleTarget(step.target);
        if (!target) {
          if (Date.now() - started > 2500) next();
          return;
        }
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (step.kind === 'tap') target.addEventListener('click', onTap);
      }
      const r = target.getBoundingClientRect();
      setBox((old) => (old && old.top === r.top && old.left === r.left && old.width === r.width && old.height === r.height ? old : { top: r.top, left: r.left, width: r.width, height: r.height }));
    }, 120);
    return () => {
      window.clearInterval(timer);
      target?.removeEventListener('click', onTap);
    };
  }, [step, next]);

  useEffect(() => {
    if (!step || step.kind === 'card') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, close]);

  if (!step) return null;

  async function turnOn() {
    setWorking(true);
    try {
      const result = await turnOnPush(db, state.myUid);
      actions.showNotice(result === 'on' ? 'Notifications are on for this device.' : result === 'blocked' ? 'Notifications are blocked. Allow them for ClassHub in your settings.' : 'Notifications were not turned on. You can turn them on in Account.');
    } catch {
      actions.showNotice('Notifications could not be turned on. You can try again in Account.');
    }
    close();
  }

  if (step.kind === 'card') {
    return (
      <Dialog
        title="Getting to know ClassHub"
        onClose={close}
        actions={
          step.push ? (
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
              <button className="btn text" onClick={close}>
                Skip
              </button>
              <button className="btn solid" onClick={next}>
                Start the tour
              </button>
            </>
          )
        }
      >
        <div className="welcome-card">
          <TypeIcon icon={step.icon} tone="primary" size={64} />
          <div className="bold" style={{ fontSize: 20, lineHeight: 1.3 }}>
            {step.title}
          </div>
          <p style={{ margin: 0, lineHeight: 1.55 }}>{step.text}</p>
        </div>
      </Dialog>
    );
  }

  // Until the control is found the whole screen is dimmed, so nothing else can be tapped by mistake.
  if (!box) return <div className="tour-dim" style={{ inset: 0 }} />;

  const pad = 6;
  const top = Math.max(0, Math.floor(box.top - pad));
  const left = Math.max(0, Math.floor(box.left - pad));
  const right = Math.min(window.innerWidth, Math.ceil(box.left + box.width + pad));
  const bottom = Math.min(window.innerHeight, Math.ceil(box.top + box.height + pad));
  const below = window.innerHeight - bottom > 230 || top < 230;
  const bubbleWidth = Math.min(340, window.innerWidth - 24);
  const bubbleLeft = Math.min(Math.max(12, (left + right) / 2 - bubbleWidth / 2), window.innerWidth - bubbleWidth - 12);
  const position = below ? { top: Math.min(bottom + 12, window.innerHeight - 210) } : { bottom: window.innerHeight - top + 12 };
  const count = steps.filter((s) => s.kind !== 'card').length;
  const at = steps.slice(0, index + 1).filter((s) => s.kind !== 'card').length;

  return (
    <div role="dialog" aria-label={step.title}>
      {/* Four dimmed panels leave a hole over the lit control. */}
      <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: top }} />
      <div className="tour-dim" style={{ top, left: 0, width: left, height: bottom - top }} />
      <div className="tour-dim" style={{ top, left: right, right: 0, height: bottom - top }} />
      <div className="tour-dim" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      {step.kind === 'show' && <div className="tour-shield" style={{ top, left, width: right - left, height: bottom - top }} />}
      <div className={'tour-ring' + (step.kind === 'tap' ? ' pulse' : '')} style={{ top, left, width: right - left, height: bottom - top }} />
      <div className="tour-bubble" style={{ left: bubbleLeft, width: bubbleWidth, ...position }}>
        <div className="bold" style={{ fontSize: 17 }}>{step.title}</div>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{step.text}</p>
        <div className="row" style={{ marginTop: 4 }}>
          <span className="small muted grow">
            {at} of {count}
          </span>
          <button type="button" className="btn text" onClick={close}>
            Skip the tour
          </button>
          {step.kind === 'show' && (
            <button type="button" className="btn solid" onClick={next}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
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
