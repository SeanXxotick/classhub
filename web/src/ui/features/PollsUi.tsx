/*
 * Class Polls (inside the News tab): interactive single/multi-choice polls, optional anonymous voting,
 * percentage bars, and an officer-only "Who hasn't voted" list.
 */
import { useMemo, useRef, useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { byLastName, listName } from '../../data/models';
import {
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  castPollVote,
  createPoll,
  deletePoll,
  setPollClosed,
  type Poll,
  type PollVote,
} from '../../data/polls';
import { isPollOpen, tallyPoll, togglePollChoice } from '../../domain/pollLogic';
import { Badge, Button, Card, Notice, Switch } from '../../design';
import { ConfirmDialog, Dialog, Field, shortDateTime } from '../common';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { MoreMenu } from '../MoreMenu';
import { TagBadge, TagSelect } from './ForumUi';

function useRun() {
  const { actions } = useClass();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = (success: string, work: () => Promise<unknown>, onDone?: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    work()
      .then(() => {
        if (success) actions.showNotice(success);
        onDone?.();
      })
      .catch((e) => actions.showNotice(friendlyMessage(e)))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  return Object.assign(run, { busy });
}

export function PollsView({ state, polls, votes }: { state: ClassState; polls: Poll[] | undefined; votes: PollVote[] }) {
  const manage = state.can('ANNOUNCEMENTS_MANAGE');
  const [tag, setTag] = useState('*');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Poll | null>(null);
  const run = useRun();

  const visible = useMemo(() => {
    return (polls ?? []).filter((p) => (manage || state.takes(p.courseId)) && (tag === '*' || p.courseId === tag));
  }, [polls, manage, state, tag]);

  return (
    <div className="stack news-feed">
      {manage && (
        <div className="ch-row">
          <Button icon="plus" onClick={() => setCreating(true)}>
            New poll
          </Button>
        </div>
      )}
      {(polls ?? []).length > 0 && state.courses.length > 0 && (
        <div className="forum-search">
          <TagSelect state={state} value={tag} onChange={setTag} label="Tag" all />
        </div>
      )}
      {polls && visible.length === 0 && (
        <Notice tone="info">{tag === '*' ? 'No polls yet.' : 'No polls with this tag.'}</Notice>
      )}
      {visible.map((poll) => (
        <PollCard
          key={poll.id}
          state={state}
          poll={poll}
          votes={votes.filter((v) => v.pollId === poll.id)}
          manage={manage}
          onToggleClosed={() =>
            run(poll.closed ? 'Poll reopened.' : 'Poll closed.', () => setPollClosed(db, state.myUid, state.classId, poll, !poll.closed))
          }
          onDelete={() => setDeleting(poll)}
        />
      ))}
      {creating && <NewPollDialog state={state} onClose={() => setCreating(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.question}"?`}
          text="The poll and all its votes will be removed for everyone in the class."
          confirm="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => run('Poll deleted.', () => deletePoll(db, state.myUid, state.classId, deleting), () => setDeleting(null))}
        />
      )}
    </div>
  );
}

function PollCard({
  state,
  poll,
  votes,
  manage,
  onToggleClosed,
  onDelete,
}: {
  state: ClassState;
  poll: Poll;
  votes: PollVote[];
  manage: boolean;
  onToggleClosed: () => void;
  onDelete: () => void;
}) {
  const { actions } = useClass();
  const [showUnvoted, setShowUnvoted] = useState(false);
  const [saving, setSaving] = useState(false);
  const open = isPollOpen(poll, Date.now());
  const eligibleMembers = useMemo(
    () => byLastName(poll.courseId ? state.members.filter((m) => !m.excludedCourseIds.includes(poll.courseId)) : state.members),
    [state.members, poll.courseId],
  );
  const tally = useMemo(
    () => tallyPoll(poll, votes, eligibleMembers.map((m) => m.id)),
    [poll, votes, eligibleMembers],
  );
  const myVote = votes.find((v) => v.uid === state.myUid);
  const myChoices = myVote?.choices ?? [];
  const authorName = state.members.find((m) => m.id === poll.createdByUid)?.name ?? 'An officer';
  const unvotedMembers = eligibleMembers.filter((m) => !tally.votedUids.has(m.id));
  const denom = poll.multi ? Math.max(1, tally.totalVoters) : Math.max(1, tally.totalVotes);

  async function pick(index: number) {
    if (!open || saving) return;
    const next = togglePollChoice(myChoices, index, poll.multi, poll.maxChoices);
    if (next.length === myChoices.length && next.every((v, i) => v === myChoices[i])) {
      actions.showNotice(`You can pick up to ${poll.maxChoices} choices.`);
      return;
    }
    setSaving(true);
    try {
      await castPollVote(db, state.classId, poll.id, state.myUid, next);
    } catch (e) {
      actions.showNotice(friendlyMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="stack" style={{ gap: 10 }}>
        <div className="card-head">
          <div className="stack" style={{ gap: 6 }}>
            <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
              <TagBadge state={state} courseId={poll.courseId} />
              {open ? (
                <Badge tone="success">
                  {poll.closesAtMillis ? `Open · Closes ${shortDateTime(poll.closesAtMillis)}` : 'Open'}
                </Badge>
              ) : (
                <Badge tone="warning">Closed</Badge>
              )}
              {poll.anonymous && <Badge tone="neutral">Anonymous</Badge>}
              {poll.multi && <Badge tone="info">{`Up to ${poll.maxChoices} choices`}</Badge>}
            </div>
            <div className="bold" style={{ fontSize: 17, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {poll.question}
            </div>
            <div className="ch-small ch-muted">{`${authorName} · ${shortDateTime(poll.createdAtMillis)}`}</div>
          </div>
          <MoreMenu
            label={`More for "${poll.question}"`}
            title={poll.question}
            items={[
              manage && { label: poll.closed ? 'Reopen poll' : 'Close poll', icon: 'lock', onClick: onToggleClosed },
              manage && { label: 'Delete', icon: 'trash', danger: true, onClick: onDelete },
            ]}
          />
        </div>

        <div className="stack" style={{ gap: 8 }}>
          {poll.options.map((label, idx) => {
            const chosen = myChoices.includes(idx);
            const count = tally.counts[idx] ?? 0;
            const pct = tally.totalVoters > 0 ? Math.round((count / denom) * 100) : 0;
            return (
              <button
                key={idx}
                type="button"
                className={'poll-opt' + (poll.multi ? ' multi' : '') + (chosen ? ' chosen' : '')}
                disabled={!open || saving}
                aria-pressed={chosen}
                onClick={() => void pick(idx)}
              >
                <span className="poll-bar" style={{ width: `${pct}%` }} aria-hidden />
                <span className="poll-radio" aria-hidden>{chosen ? '✓' : ''}</span>
                <span className="poll-label">{label}</span>
                <span className="poll-pct">{`${pct}% (${count})`}</span>
              </button>
            );
          })}
        </div>

        <div className="ch-row ch-wrap ch-gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="ch-small ch-muted">
            {`${tally.totalVoters} of ${eligibleMembers.length} voted`}
            {poll.anonymous ? ' · Anonymous' : ''}
          </span>
          {manage && unvotedMembers.length > 0 && (
            <button type="button" className="btn text small" onClick={() => setShowUnvoted(!showUnvoted)}>
              {`Who hasn't voted (${unvotedMembers.length}) ${showUnvoted ? '▴' : '▾'}`}
            </button>
          )}
        </div>

        {manage && showUnvoted && unvotedMembers.length > 0 && (
          <div className="poll-unvoted">
            <span className="tiny bold muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Haven't voted yet ({unvotedMembers.length}) · Officers only
            </span>
            <div className="poll-chips">
              {unvotedMembers.map((m) => (
                <span key={m.id} className="poll-name-chip">
                  {listName(m)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function NewPollDialog({ state, onClose }: { state: ClassState; onClose: () => void }) {
  const run = useRun();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [courseId, setCourseId] = useState('');
  const [multi, setMulti] = useState(false);
  const [maxChoices, setMaxChoices] = useState(2);
  const [anonymous, setAnonymous] = useState(false);
  const [closeDate, setCloseDate] = useState('');

  const filledOptions = options.map((o) => o.trim()).filter(Boolean);
  const valid = !!question.trim() && filledOptions.length >= 2;
  const updateOption = (i: number, value: string) => setOptions((prev) => prev.map((x, idx) => (idx === i ? value.slice(0, POLL_OPTION_MAX) : x)));
  const removeOption = (i: number) => setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  function save() {
    if (!valid) return;
    const closesAtMillis = closeDate ? new Date(`${closeDate}T23:59:59+08:00`).getTime() : 0;
    run(
      'Poll created.',
      () => createPoll(db, state.myUid, state.classId, { question, options, courseId, multi, maxChoices, anonymous, closesAtMillis }),
      onClose,
    );
  }

  return (
    <Dialog
      title="New poll"
      onClose={run.busy ? () => undefined : onClose}
      actions={
        <>
          <button type="button" className="btn text" disabled={run.busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn solid" disabled={!valid || run.busy} onClick={save}>
            {run.busy ? 'Creating…' : 'Create poll'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Question">
          <input
            value={question}
            maxLength={POLL_QUESTION_MAX}
            placeholder="e.g. Preferred schedule for FCO dry-run?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="small semibold muted">Choices</span>
          {options.map((opt, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <input
                className="input grow"
                value={opt}
                maxLength={POLL_OPTION_MAX}
                placeholder={`Choice ${i + 1}`}
                onChange={(e) => updateOption(i, e.target.value)}
              />
              {options.length > 2 && (
                <button type="button" className="btn text small danger" aria-label={`Remove choice ${i + 1}`} onClick={() => removeOption(i)}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && (
            <button type="button" className="btn outline small" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions([...options, ''])}>
              + Add choice
            </button>
          )}
        </div>
        {state.courses.length > 0 && (
          <Field label="Who votes">
            <TagSelect state={state} value={courseId} onChange={setCourseId} label="Who votes" />
          </Field>
        )}
        <Switch checked={multi} onChange={setMulti} label="Allow multiple choices" />
        {multi && (
          <Field label="Maximum choices per student">
            <select value={Math.min(maxChoices, Math.max(2, filledOptions.length))} onChange={(e) => setMaxChoices(Number(e.target.value))}>
              {Array.from({ length: Math.max(1, filledOptions.length - 1) }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  Up to {n}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Switch
          checked={anonymous}
          onChange={setAnonymous}
          label="Anonymous votes"
          description="Only vote counts are shown. Officers can still see who has not voted yet."
        />
        <Field label="Close automatically after (optional)">
          <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
