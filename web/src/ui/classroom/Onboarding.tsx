import { useCallback, useEffect, useState } from 'react';
import { db } from '../../data/firebase';
import { pushState, turnOnPush } from '../../data/notify';
import { useAnnouncements, useMeetings } from '../../data/features';
import type { Permission } from '../../data/models';
import { Button, Card, Icon, ListRow, Money, TypeIcon, type IconName } from '../../design';
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

/*
 * The tour runs in a practice class made of sample data, so there is always something to tap and
 * nothing the user does in it is saved. One real-looking button is lit at a time and the user taps
 * it. There is no skip: it is short, and it cannot get stuck, because a step whose button is
 * missing is passed over by itself.
 */

type PracticeTab = 'HOME' | 'LEDGER' | 'SCHEDULE' | 'NEWS';

interface TourStep {
  target: string;
  title: string;
  text: string;
}

function tourSteps(state: ClassState): TourStep[] {
  const room = state.room!;
  const steps: TourStep[] = [];
  let lead = '';
  if (room.ledgerEnabled) {
    steps.push({ target: '[data-tour="p-tab-LEDGER"]', title: 'Your money', text: 'Tap Ledger to see what you owe and what you have paid.' });
    steps.push({ target: '[data-tour="p-paid"]', title: 'Tell the treasurer you paid', text: 'You owe 150 pesos here. After you pay, you tap "I paid". Try it now.' });
    lead = 'Your claim now waits for the treasurer to confirm it. ';
  }
  if (room.scheduleEnabled) {
    steps.push({ target: '[data-tour="p-tab-SCHEDULE"]', title: 'Your deadlines', text: `${lead}Tap Schedule to see quizzes, exams and deliverables.` });
    steps.push({ target: '[data-tour="p-done"]', title: 'Tick it when you are done', text: 'Tap the circle beside the quiz to mark it as done.' });
    lead = 'Done. It is off your list. ';
  }
  if (room.announcementsEnabled !== false) {
    steps.push({ target: '[data-tour="p-tab-NEWS"]', title: 'Announcements', text: `${lead}Tap News to read what the officers post.` });
    steps.push({ target: '[data-tour="p-vote"]', title: 'Vote and comment', text: 'You can vote on an announcement and comment under it. Tap the up arrow.' });
  }
  return steps;
}

/** The first element matching the selector that is actually on screen. */
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

const PRACTICE_TABS: { id: PracticeTab; label: string; icon: IconName }[] = [
  { id: 'HOME', label: 'Home', icon: 'home' },
  { id: 'LEDGER', label: 'Ledger', icon: 'ledger' },
  { id: 'SCHEDULE', label: 'Schedule', icon: 'schedule' },
  { id: 'NEWS', label: 'News', icon: 'news' },
];

/** The practice class: sample screens that look like the real ones and react to taps, saving nothing. */
function Practice({ state }: { state: ClassState }) {
  const room = state.room!;
  const [tab, setTab] = useState<PracticeTab>('HOME');
  const [paid, setPaid] = useState(false);
  const [done, setDone] = useState(false);
  const [voted, setVoted] = useState(false);
  const tabs = PRACTICE_TABS.filter((t) => t.id === 'HOME' || (t.id === 'LEDGER' && room.ledgerEnabled) || (t.id === 'SCHEDULE' && room.scheduleEnabled) || (t.id === 'NEWS' && room.announcementsEnabled !== false));
  return (
    <div className="practice" aria-label="Practice class">
      <div className="practice-banner">Practice class · sample data, nothing here is saved</div>
      <div className="practice-body">
        {tab === 'HOME' && (
          <Card>
            <div className="bold" style={{ fontSize: 20 }}>Practice class</div>
            <div className="ch-muted">A pretend class for this tour. Your real class opens when the tour ends.</div>
          </Card>
        )}
        {tab === 'LEDGER' && (
          <>
            <Card>
              <div className="ch-small ch-muted">Your balance</div>
              <Money centavos={-15000} size="big" tone="danger" />
              <div className="ch-small ch-muted">You owe this for the class shirt.</div>
            </Card>
            <div className="ch-row">
              <div className="bold" style={{ flex: 1 }}>Payment claims</div>
              <Button data-tour="p-paid" variant="outline" size="small" icon="coins" onClick={() => setPaid(true)}>
                I paid
              </Button>
            </div>
            <Card flush>
              {paid && <ListRow leading={<TypeIcon icon="hourglass" tone="warning" size={36} />} title="GCash · just now" subtitle="Waiting for the treasurer" trailing={<Money centavos={15000} sign tone="success" />} />}
              <ListRow leading={<TypeIcon icon="charge" tone="danger" size={36} />} title="Class shirt" subtitle="Charge" trailing={<Money centavos={-25000} tone="danger" />} />
              <ListRow leading={<TypeIcon icon="income" tone="success" size={36} />} title="Payment" subtitle="Class fund" trailing={<Money centavos={10000} sign tone="success" />} />
            </Card>
          </>
        )}
        {tab === 'SCHEDULE' && (
          <Card flush>
            <ListRow
              leading={<TypeIcon icon="edit" tone="neutral" size={36} />}
              title={<span style={{ textDecoration: done ? 'line-through' : undefined }}>Quiz 3: simplex method</span>}
              subtitle="Operations Research · Quiz · Tomorrow"
              trailing={
                <button type="button" data-tour="p-done" className={'done-check' + (done ? ' on' : '')} aria-pressed={done} aria-label="Mark the quiz as done" onClick={() => setDone(true)}>
                  {done && '✓'}
                </button>
              }
            />
            <ListRow leading={<TypeIcon icon="doc" tone="neutral" size={36} />} title="Group report" subtitle="Software Engineering · Deliverable · Friday" />
          </Card>
        )}
        {tab === 'NEWS' && (
          <Card>
            <div className="stack" style={{ gap: 8 }}>
              <div className="ch-small ch-muted">Maya Reyes · Mayor · today</div>
              <div className="bold" style={{ fontSize: 18 }}>Class shirt sizes due Friday</div>
              <div>Send your size to the Mayor. Small, medium, large or extra large.</div>
              <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
                <div className="vote-bar">
                  <button type="button" data-tour="p-vote" className={'vote' + (voted ? ' on' : '')} aria-pressed={voted} aria-label="Upvote" onClick={() => setVoted(true)}>
                    <Icon name="up" size={16} />
                    {voted ? 7 : 6}
                  </button>
                  <button type="button" className="vote" aria-label="Downvote">
                    <Icon name="down" size={16} />1
                  </button>
                </div>
                <Button size="small" variant="outline" icon="comment">
                  4 comments
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
      <nav className="practice-nav" aria-label="Practice class sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" data-tour={`p-tab-${t.id}`} className={t.id === tab ? 'selected' : ''} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={24} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Shows once per device, the first time a class is opened: a start card, the practice tour, an end card. */
export function Welcome({ state }: { state: ClassState }) {
  const { actions } = useClass();
  const [open, setOpen] = useState(() => !read(WELCOME_KEY));
  const [steps] = useState(() => tourSteps(state));
  // -1 is the start card, steps.length the end card.
  const [index, setIndex] = useState(-1);
  const [box, setBox] = useState<Box | null>(null);
  const [working, setWorking] = useState(false);
  const [canPush] = useState(() => pushState() === 'off');
  const step = open && index >= 0 && index < steps.length ? steps[index] : undefined;

  const close = useCallback(() => {
    write(WELCOME_KEY, '1');
    setOpen(false);
  }, []);
  const next = useCallback(() => {
    setBox(null);
    setIndex((i) => i + 1);
  }, []);

  // Finds the lit button, follows it while the page moves, and passes over the step if it never shows up.
  useEffect(() => {
    if (!step) return;
    let target: HTMLElement | null = null;
    const started = Date.now();
    const onTap = () => window.setTimeout(next, 0);
    const timer = window.setInterval(() => {
      if (!target || !target.isConnected) {
        target?.removeEventListener('click', onTap);
        target = visibleTarget(step.target);
        if (!target) {
          if (Date.now() - started > 2500) next();
          return;
        }
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        target.addEventListener('click', onTap);
      }
      const r = target.getBoundingClientRect();
      setBox((old) => (old && old.top === r.top && old.left === r.left && old.width === r.width && old.height === r.height ? old : { top: r.top, left: r.left, width: r.width, height: r.height }));
    }, 120);
    return () => {
      window.clearInterval(timer);
      target?.removeEventListener('click', onTap);
    };
  }, [step, next]);

  if (!open) return null;

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

  // The start and end cards cannot be dismissed with Escape or a tap outside; only their button moves on.
  const stay = () => undefined;

  if (index < 0) {
    return (
      <Dialog
        title="Getting to know ClassHub"
        onClose={stay}
        actions={
          <button className="btn solid" onClick={next}>
            Start the tour
          </button>
        }
      >
        <div className="welcome-card">
          <TypeIcon icon="home" tone="primary" size={64} />
          <div className="bold" style={{ fontSize: 20, lineHeight: 1.3 }}>
            Welcome to {state.room!.name}
          </div>
          <p style={{ margin: 0, lineHeight: 1.55 }}>Take a one-minute tour in a practice class. Tap what lights up. Nothing you do in it is saved.</p>
        </div>
      </Dialog>
    );
  }

  if (!step) {
    const officer = isOfficer(state);
    return (
      <Dialog
        title="You are ready"
        onClose={stay}
        actions={
          canPush ? (
            <>
              <button className="btn text" disabled={working} onClick={close}>
                Not now
              </button>
              <button className="btn solid" disabled={working} onClick={turnOn}>
                Turn on notifications
              </button>
            </>
          ) : (
            <button className="btn solid" onClick={close}>
              Open my class
            </button>
          )
        }
      >
        <div className="welcome-card">
          <TypeIcon icon={canPush ? 'bell' : 'check'} tone="primary" size={64} />
          <div className="bold" style={{ fontSize: 20, lineHeight: 1.3 }}>
            That was the practice class
          </div>
          <p style={{ margin: 0, lineHeight: 1.55 }}>
            Nothing from it was saved. Your real class is next.
            {officer ? ' As an officer, you will find a Getting started list on Home with the steps a new class needs.' : ''}
            {canPush ? ' Turn on notifications to hear about new announcements, deadlines and payment updates on this device.' : ''}
          </p>
        </div>
      </Dialog>
    );
  }

  const pad = 6;
  const hole = box && {
    top: Math.max(0, Math.floor(box.top - pad)),
    left: Math.max(0, Math.floor(box.left - pad)),
    right: Math.min(window.innerWidth, Math.ceil(box.left + box.width + pad)),
    bottom: Math.min(window.innerHeight, Math.ceil(box.top + box.height + pad)),
  };
  const bubbleWidth = Math.min(340, window.innerWidth - 24);

  return (
    <div role="dialog" aria-label={step.title}>
      <Practice state={state} />
      {/* Until the button is found the whole screen is dimmed, so nothing else can be tapped by mistake. */}
      {!hole && <div className="tour-dim" style={{ inset: 0 }} />}
      {hole && (
        <>
          {/* Four dimmed panels leave a hole over the lit button. */}
          <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div className="tour-dim" style={{ top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }} />
          <div className="tour-dim" style={{ top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top }} />
          <div className="tour-dim" style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
          <div className="tour-ring pulse" style={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top }} />
          <div
            className="tour-bubble"
            style={{
              width: bubbleWidth,
              left: Math.min(Math.max(12, (hole.left + hole.right) / 2 - bubbleWidth / 2), window.innerWidth - bubbleWidth - 12),
              ...(window.innerHeight - hole.bottom > 200 || hole.top < 200 ? { top: Math.min(hole.bottom + 12, window.innerHeight - 180) } : { bottom: window.innerHeight - hole.top + 12 }),
            }}
          >
            <div className="bold" style={{ fontSize: 17 }}>{step.title}</div>
            <p style={{ margin: 0, lineHeight: 1.5 }}>{step.text}</p>
            <span className="small muted">
              Step {index + 1} of {steps.length}
            </span>
          </div>
        </>
      )}
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
  // Watched even while hidden, so the collapsed card still knows whether any step is left.
  const watching = officer;
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
          aria-expanded={!hidden}
          onClick={() => {
            write(hiddenKey(state.classId), hidden ? '' : '1');
            setHidden(!hidden);
          }}
        >
          {hidden ? 'Show' : 'Hide'}
        </button>
      </div>
      {!hidden && (
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
      )}
    </section>
  );
}
