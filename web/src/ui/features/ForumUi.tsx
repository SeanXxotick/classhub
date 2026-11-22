/*
 * The Forum in the News tab (docs/PLAN-FORUM.md): questions with a tag, answers with one level of replies,
 * a best answer picked by the asker or a News officer, and the month's top helpers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import {
  ANSWER_MAX,
  QUESTION_BODY_MAX,
  QUESTION_TITLE_MAX,
  addAnswer,
  askQuestion,
  deleteQuestion,
  editQuestion,
  markForumSeen,
  pickBest,
  removeAnswer,
  setHideFromBoard,
  setQuestionFlags,
  useForumAnswers,
  useForumAnswersSince,
  type ForumAnswer,
  type ForumAuthor,
  type ForumQuestion,
} from '../../data/forum';
import { newAnnouncement, type Announcement, type SeenMarks } from '../../data/features';
import { ROLE_MEMBER } from '../../data/models';
import { manilaMonthStart, topHelpers } from '../../domain/forumBoard';
import { forumUnseen } from '../../domain/forumUnseen';
import { Avatar, ConfirmDialog, CourseDot, Dialog, Field, RoleChip, hexColor, shortDateTime } from '../common';
import { Badge, Button, Card, FilterChips, Icon, Notice, SearchInput, SegmentedControl, Switch } from '../../design';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { MoreMenu } from '../MoreMenu';

type Filter = 'ALL' | 'OPEN' | 'DONE' | 'MINE';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Unanswered' },
  { value: 'DONE', label: 'Answered' },
  { value: 'MINE', label: 'Mine' },
];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Runs a write once at a time (a double tap does not post twice); `run.busy` greys out the button meanwhile. */
function useRun() {
  const { actions } = useClass();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = (done: string, write: () => Promise<unknown>, after?: () => void) => {
    if (inFlight.current) return Promise.resolve();
    inFlight.current = true;
    setBusy(true);
    return write()
      .then(
        () => {
          if (done) actions.showNotice(done);
          after?.();
        },
        (e) => actions.showNotice(friendlyMessage(e)),
      )
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };
  return Object.assign(run, { busy });
}

/** Who wrote a post: named in it, or (anonymous) in an author record this viewer can read. '' when unknown. */
const writerOf = (authors: ForumAuthor[], id: string, uid: string) => uid || authors.find((a) => a.id === id)?.uid || '';

/** A course tag, or nothing for General (the list does not need to say "General" on every card). */
export function TagBadge({ state, courseId }: { state: ClassState; courseId: string }) {
  const course = state.courses.find((c) => c.id === courseId);
  if (!courseId || !course) return null;
  return (
    <span className="forum-tag">
      <CourseDot color={course.color} />
      {course.name}
    </span>
  );
}

/** The tag picker: all tags, General, or one course. */
export function TagSelect({ state, value, onChange, label, all }: { state: ClassState; value: string; onChange: (v: string) => void; label: string; all?: boolean }) {
  return (
    <select className="input forum-tag-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {all && <option value="*">All tags</option>}
      <option value="">{all ? 'General' : 'General (the whole class)'}</option>
      {state.courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** A name with photo and role, or the anonymous classmate (with the real name for News officers). */
function Who({ state, uid, name, anonymous, realUid, when, asker, size = 28 }: {
  state: ClassState; uid: string; name: string; anonymous: boolean; realUid: string; when: number; asker?: boolean; size?: number;
}) {
  const manage = state.can('ANNOUNCEMENTS_MANAGE');
  if (anonymous) {
    const real = state.members.find((m) => m.id === realUid)?.name;
    return (
      <div className="byline">
        <Avatar name="?" color="var(--ch-text-muted)" size={size} />
        <div className="byline-text">
          <span className="bold comment-name">
            {asker ? 'The asker' : 'Anonymous classmate'}
            {realUid === state.myUid ? ' (you)' : ''}
          </span>
          <span className="ch-small ch-muted">{shortDateTime(when)}</span>
          {manage && real && realUid !== state.myUid && <span className="forum-real">{`Posted by ${real}. Only officers see this.`}</span>}
        </div>
      </div>
    );
  }
  const member = state.members.find((m) => m.id === uid);
  const role = member ? state.roles.find((r) => r.id === member.roleId) : undefined;
  const titled = !!role && role.id !== (state.room?.defaultRoleId || ROLE_MEMBER);
  const shown = member?.name ?? (name || 'A former member');
  return (
    <div className="byline">
      <Avatar photo={state.avatars.get(uid)} name={shown} color={hexColor(role?.colorHex, '#6B768A')} size={size} />
      <div className="byline-text">
        <span className="bold comment-name">{shown}</span>
        {asker && <span className="pill forum-asker">Asker</span>}
        {titled && role && <RoleChip name={role.name} color={role.colorHex} />}
        <span className="ch-small ch-muted">{shortDateTime(when)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- The Forum

export function ForumView({ state, questions, authors, seen, lastVisit, openId, onOpen, onPromote }: {
  state: ClassState;
  /** useForum and useForumAuthors, loaded by the News tab (it also needs them for the red count). */
  questions: ForumQuestion[] | undefined;
  authors: ForumAuthor[];
  seen: SeenMarks[];
  /** When this member last opened the Forum, before this visit. */
  lastVisit: number;
  /** The open question, or '' for the list. */
  openId: string;
  onOpen: (questionId: string) => void;
  onPromote: (post: Announcement) => void;
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [tag, setTag] = useState('*');
  const [search, setSearch] = useState('');
  const [asking, setAsking] = useState(false);
  const wide = useWide();
  const mine = (q: ForumQuestion) => writerOf(authors, q.id, q.uid) === state.myUid;
  // Kept from when the Forum opened, so what was new stays marked during this visit.
  const [since] = useState(lastVisit);
  const myPostIds = new Set(authors.filter((a) => a.uid === state.myUid).map((a) => a.id));
  const answersSince = useForumAnswersSince(db, state.classId, since, true).data ?? [];
  const newFor = new Set(forumUnseen(questions ?? [], answersSince, state.myUid, myPostIds, since).toMe.map((a) => a.questionId));
  const newest = questions?.[0]?.createdAtMillis ?? 0;

  // Opening the Forum counts as seeing what is in it.
  useEffect(() => {
    markForumSeen(db, state.classId, state.myUid).catch(() => {});
  }, [state.classId, state.myUid, newest]);

  const open = questions?.find((q) => q.id === openId);
  if (openId && questions) {
    if (!open) {
      return (
        <div className="stack">
          <BackToForum onBack={() => onOpen('')} />
          <Notice tone="info">This question was deleted or hidden.</Notice>
        </div>
      );
    }
    return <QuestionPage state={state} q={open} authors={authors} onBack={() => onOpen('')} onPromote={onPromote} />;
  }

  const words = search.trim().toLowerCase();
  const list = (questions ?? []).filter(
    (q) =>
      (filter === 'ALL' || (filter === 'OPEN' && !q.bestAnswerId && !q.closed) || (filter === 'DONE' && !!q.bestAnswerId) || (filter === 'MINE' && mine(q))) &&
      (tag === '*' || q.courseId === tag) &&
      (!words || `${q.title} ${q.body}`.toLowerCase().includes(words)),
  );
  const plain = filter === 'ALL' && tag === '*' && !words;

  return (
    <div className="forum-layout">
    <div className="stack forum-main">
      <div className="ch-row">
        <Button icon="plus" onClick={() => setAsking(true)}>
          Ask a question
        </Button>
      </div>
      <FilterChips label="Show" options={FILTERS} value={filter} onChange={setFilter} />
      <div className="forum-search">
        <SearchInput aria-label="Search the Forum" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <TagSelect state={state} value={tag} onChange={setTag} label="Tag" all />
      </div>
      {!wide && plain && questions && <TopHelpers state={state} questions={questions} seen={seen} rail={false} />}
      {questions && list.length === 0 && <Notice tone="info">{plain ? 'No questions yet. Ask the first one.' : 'No questions match.'}</Notice>}
      {list.map((q) => (
        <button key={q.id} type="button" className="forum-card" onClick={() => onOpen(q.id)}>
          {(q.hidden || newFor.has(q.id)) && (
            <span className="forum-meta">
              {newFor.has(q.id) && <span className="news-count">New answers</span>}
              {q.hidden && <Badge tone="warning">Hidden from the class</Badge>}
            </span>
          )}
          <span className="forum-title">{q.title}</span>
          <span className="forum-meta">
            <TagBadge state={state} courseId={q.courseId} />
            {q.closed ? <Badge tone="warning">Closed</Badge> : q.bestAnswerId ? <Badge tone="success" icon="check">Answered</Badge> : null}
            <span>{`${q.anonymous ? 'Anonymous classmate' : (state.members.find((m) => m.id === q.uid)?.name ?? (q.name || 'A former member'))} · ${shortDateTime(q.createdAtMillis)} · ${plural(q.answerCount, 'answer')}`}</span>
          </span>
        </button>
      ))}
      {asking && <AskDialog state={state} onClose={() => setAsking(false)} onAsked={onOpen} />}
    </div>
    {wide && questions && <TopHelpers state={state} questions={questions} seen={seen} rail />}
    </div>
  );
}

function BackToForum({ onBack }: { onBack: () => void }) {
  return (
    <div className="ch-row">
      <Button size="small" variant="text" icon="back" onClick={onBack}>
        Forum
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- One question

function QuestionPage({ state, q, authors, onBack, onPromote }: {
  state: ClassState; q: ForumQuestion; authors: ForumAuthor[]; onBack: () => void; onPromote: (post: Announcement) => void;
}) {
  const run = useRun();
  const manage = state.can('ANNOUNCEMENTS_MANAGE');
  const answers = useForumAnswers(db, state.classId, q.id).data;
  const askerUid = writerOf(authors, q.id, q.uid);
  const isAsker = askerUid === state.myUid;
  const me = { uid: state.myUid, name: state.members.find((m) => m.id === state.myUid)?.name ?? '' };
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [replyText, setReplyText] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState<ForumAnswer | null>(null);
  // The asker of an anonymous question stays anonymous when they answer or reply.
  const anonymous = isAsker && q.anonymous;
  const canPick = !q.closed && (isAsker || manage);
  const best = answers?.find((a) => a.id === q.bestAnswerId) ?? null;
  const tops = (answers ?? []).filter((a) => !a.parentId).sort((a, b) => Number(b.id === q.bestAnswerId) - Number(a.id === q.bestAnswerId) || a.createdAtMillis - b.createdAtMillis);
  const isAskerPost = (a: ForumAnswer) => a.anonymous || (!!askerUid && a.uid === askerUid);
  const pickable = (a: ForumAnswer) => canPick && !a.parentId && !a.removedAtMillis && !a.anonymous && !!a.uid && a.uid !== askerUid;

  // History entries for officer moderation. Anonymous writers stay anonymous in the log too.
  const writerName = (p: { anonymous: boolean; uid: string; name: string }) =>
    p.anonymous ? 'an anonymous classmate' : (state.members.find((m) => m.id === p.uid)?.name ?? (p.name || 'a former member'));
  const cut = (t: string, max = 60) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
  const modNote = (text: string) => ({ actorUid: state.myUid, kind: 'FORUM_MODERATED' as const, text });
  const setFlags = (flags: { closed?: boolean; hidden?: boolean }, done: string, what: string) =>
    run(done, () => setQuestionFlags(db, state.classId, q.id, flags, modNote(`${what} the Forum question "${cut(q.title, 80)}" by ${writerName(q)}`)));

  const promote = () =>
    onPromote(
      newAnnouncement({
        title: q.title.slice(0, 120),
        body: `${q.body ? `${q.body}\n\n` : ''}Answer: ${best?.text ?? ''}`.slice(0, 4000),
        courseId: q.courseId,
      }),
    );

  const answerBlock = (a: ForumAnswer, top: ForumAnswer) => (
    <div className={'comment' + (a.id === q.bestAnswerId ? ' forum-best' : '')} key={a.id}>
      {a.id === q.bestAnswerId && <span className="forum-best-tag">{`✓ Best answer · Picked by ${q.pickedBy === 'OFFICER' ? 'an officer' : 'the asker'}`}</span>}
      <div className="card-head">
        <Who state={state} uid={a.uid} name={a.name} anonymous={a.anonymous} realUid={writerOf(authors, a.id, a.uid)} when={a.createdAtMillis} asker={isAskerPost(a)} />
        {!a.removedAtMillis && (
          <MoreMenu
            label="More for this answer"
            title={a.text}
            items={[
              pickable(a) && {
                label: a.id === q.bestAnswerId ? 'Remove best answer' : 'Mark as best answer',
                icon: a.id === q.bestAnswerId ? 'x' : 'check',
                onClick: () =>
                  a.id === q.bestAnswerId
                    ? run('Best answer removed.', () => pickBest(db, state.classId, q.id, null, isAsker))
                    : run('Marked as the best answer.', () => pickBest(db, state.classId, q.id, a, isAsker)),
              },
              (writerOf(authors, a.id, a.uid) === state.myUid || manage) && { label: 'Remove', icon: 'trash', danger: true, onClick: () => setRemoving(a) },
            ]}
          />
        )}
      </div>
      {a.removedAtMillis ? (
        <div className="ch-muted" style={{ fontStyle: 'italic' }}>Removed</div>
      ) : (
        <>
          <div className="comment-text">{a.text}</div>
          <div className="ch-row ch-wrap ch-gap-2" style={{ alignItems: 'center' }}>
            {!q.closed && (
              <button type="button" className="btn text" onClick={() => { setReplyTo(top.id); setReplyText(''); }}>
                Reply
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="stack news-feed">
      <BackToForum onBack={onBack} />
      {q.hidden && <Notice tone="warning">Hidden from the class. Only officers see it.</Notice>}
      <Card>
        <div className="stack" style={{ gap: 8 }}>
          <div className="card-head">
            <div className="stack" style={{ gap: 8 }}>
              <div className="forum-meta">
                <TagBadge state={state} courseId={q.courseId} />
                {q.closed ? <Badge tone="warning">Closed</Badge> : q.bestAnswerId ? <Badge tone="success" icon="check">Answered</Badge> : null}
              </div>
              <div className="bold" style={{ fontSize: 18, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {q.title}
              </div>
            </div>
            <MoreMenu
              label="More for this question"
              title={q.title}
              items={[
                isAsker && { label: 'Edit', icon: 'edit', onClick: () => setEditing(true) },
                manage && { label: q.closed ? 'Reopen' : 'Close', icon: 'lock', onClick: () => setFlags({ closed: !q.closed }, q.closed ? 'Open to new answers.' : 'Closed to new answers.', q.closed ? 'Reopened' : 'Closed') },
                manage && { label: q.hidden ? 'Show' : 'Hide', icon: 'eye', onClick: () => setFlags({ hidden: !q.hidden }, q.hidden ? 'Shown to the class.' : 'Hidden from the class.', q.hidden ? 'Showed' : 'Hid') },
                manage && best && !best.removedAtMillis && { label: 'Post as announcement', icon: 'bell', onClick: promote },
                (isAsker || manage) && { label: 'Delete', icon: 'trash', danger: true, onClick: () => setDeleting(true) },
              ]}
            />
          </div>
          {q.body && <div className="prose">{q.body}</div>}
          <Who state={state} uid={q.uid} name={q.name} anonymous={q.anonymous} realUid={askerUid} when={q.createdAtMillis} size={36} />
        </div>
      </Card>

      <div className="thread">
        {answers && answers.length === 0 && <div className="ch-small ch-muted">No answers yet.</div>}
        {tops.map((top) => {
          const replies = (answers ?? []).filter((a) => a.parentId === top.id);
          const shown = expanded[top.id] ? replies : replies.slice(0, 2);
          const more = replies.length - shown.length;
          return (
            <div className="comment-group" key={top.id}>
              {answerBlock(top, top)}
              {(replies.length > 0 || replyTo === top.id) && (
                <div className="replies">
                  {shown.map((r) => answerBlock(r, top))}
                  {more > 0 && (
                    <button type="button" className="btn text" onClick={() => setExpanded({ ...expanded, [top.id]: true })}>
                      {`View ${more} more ${more === 1 ? 'reply' : 'replies'}`}
                    </button>
                  )}
                  {replyTo === top.id && (
                    <div className="stack" style={{ gap: 8 }}>
                      <Field label="Your reply">
                        <textarea autoFocus value={replyText} rows={2} maxLength={ANSWER_MAX} onChange={(e) => setReplyText(e.target.value)} />
                      </Field>
                      <div className="ch-row ch-gap-2">
                        <Button
                          size="small"
                          disabled={!replyText.trim() || run.busy}
                          onClick={() =>
                            run('Reply posted.', () => addAnswer(db, me, state.classId, q, top, replyText, anonymous), () => {
                              setReplyTo('');
                              setExpanded({ ...expanded, [top.id]: true });
                            })
                          }
                        >
                          Post reply
                        </Button>
                        <Button size="small" variant="text" onClick={() => setReplyTo('')}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {q.closed ? (
          <Notice tone="info">Closed by an officer. No new answers.</Notice>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <Field label={anonymous ? 'Your answer (stays anonymous)' : 'Your answer'}>
              <textarea value={text} rows={3} maxLength={ANSWER_MAX} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="ch-row">
              <Button size="small" disabled={!text.trim() || run.busy} onClick={() => run('Answer posted.', () => addAnswer(db, me, state.classId, q, null, text, anonymous), () => setText(''))}>
                Post answer
              </Button>
            </div>
          </div>
        )}
      </div>

      {editing && <AskDialog state={state} question={q} onClose={() => setEditing(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this question?"
          text="The question and all its answers will be removed for everyone in the class."
          confirm="Delete"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            run(
              'Question deleted.',
              () =>
                deleteQuestion(
                  db, state.classId, q.id,
                  isAsker ? undefined : { actorUid: state.myUid, kind: 'FORUM_QUESTION_DELETED', text: `Deleted the Forum question "${cut(q.title, 80)}" by ${writerName(q)} (${plural(q.answerCount, 'answer')})` },
                ),
              onBack,
            )
          }
        />
      )}
      {removing && (
        <ConfirmDialog
          title={removing.parentId ? 'Remove this reply?' : 'Remove this answer?'}
          text="It will be removed for everyone in the class."
          confirm="Remove"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            run('Removed.', () =>
              removeAnswer(
                db, state.classId, removing, q,
                writerOf(authors, removing.id, removing.uid) === state.myUid
                  ? undefined
                  : {
                      actorUid: state.myUid,
                      kind: 'FORUM_ANSWER_REMOVED',
                      text: `Removed ${removing.parentId ? 'a reply' : 'an answer'} by ${writerName(removing)} on "${cut(q.title, 60)}": "${cut(removing.text)}"`,
                    },
              ),
            )
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Asking and editing

function AskDialog({ state, question, onClose, onAsked }: { state: ClassState; question?: ForumQuestion; onClose: () => void; onAsked?: (id: string) => void }) {
  const run = useRun();
  const [title, setTitle] = useState(question?.title ?? '');
  const [body, setBody] = useState(question?.body ?? '');
  const [courseId, setCourseId] = useState(question?.courseId ?? '');
  const [anonymous, setAnonymous] = useState(false);
  const course = state.courses.find((c) => c.id === courseId);
  const me = { uid: state.myUid, name: state.members.find((m) => m.id === state.myUid)?.name ?? '' };
  const save = () =>
    question
      ? run('Question saved.', () => editQuestion(db, state.classId, question.id, { title, body, courseId }), onClose)
      : run('Question posted.', async () => onAsked?.(await askQuestion(db, me, state.classId, { title, body, courseId, anonymous })), onClose);
  return (
    <Dialog
      title={question ? 'Edit question' : 'Ask a question'}
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" disabled={!title.trim() || run.busy} onClick={save}>
            {question ? 'Save' : 'Ask'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Question">
          <input value={title} maxLength={QUESTION_TITLE_MAX} placeholder="e.g. Is the quiz on Friday open notes?" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Details (optional)">
          <textarea value={body} rows={4} maxLength={QUESTION_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label="Tag">
          <TagSelect state={state} value={courseId} onChange={setCourseId} label="Tag" />
        </Field>
        {!question && (
          <Switch
            checked={anonymous}
            onChange={setAnonymous}
            label="Ask anonymously"
            description="Classmates will not see your name. Officers who manage News can, in case of misuse."
          />
        )}
        {!question && <p className="small muted" style={{ margin: 0 }}>{course ? `Students taking ${course.name} get a notification.` : 'The whole class gets a notification.'}</p>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Top helpers

const HELPERS_OPEN_KEY = 'classhub.helpersOpen';

/** True on screens wide enough for the Forum's side column. */
function useWide(): boolean {
  const query = '(min-width: 1200px)';
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** This month's top three: a side column on wide screens, a medal strip that opens in place on narrow ones. Same look in both. */
function TopHelpers({ state, questions, seen, rail }: { state: ClassState; questions: ForumQuestion[]; seen: SeenMarks[]; rail: boolean }) {
  const run = useRun();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HELPERS_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(HELPERS_OPEN_KEY, v ? '1' : '0');
    } catch {
      /* storage blocked: it just starts closed next time */
    }
  };
  const monthName = new Date().toLocaleString('en-US', { month: 'long', timeZone: 'Asia/Manila' });
  const [range, setRange] = useState<'MONTH' | 'ALL'>('MONTH');
  const leftOut = useMemo(() => new Set(seen.filter((s) => s.hideFromBoard).map((s) => s.id)), [seen]);
  const since = manilaMonthStart(Date.now());
  const month = topHelpers(questions, state.members, leftOut, since);
  const allTime = topHelpers(questions, state.members, leftOut, 0);
  const shownList = range === 'MONTH' ? month : allTime;
  // Anyone ever picked, counting those who left themselves out (so they can still come back on the list).
  const anyHelper = useMemo(() => topHelpers(questions, state.members, new Set(), 0).length > 0, [questions, state.members]);
  const iAmOut = leftOut.has(state.myUid);
  const nameOf = (uid: string) => state.members.find((m) => m.id === uid)?.name ?? '';

  const rows = (list: typeof month) =>
    list.map((h, i) => (
      <div className="forum-helper" key={h.uid}>
        <span className={`forum-rank r${i + 1}`}>{i + 1}</span>
        <Avatar photo={state.avatars.get(h.uid)} name={nameOf(h.uid)} color="#6B768A" size={26} />
        <span className="grow forum-helper-name">{nameOf(h.uid)}</span>
        <span className="ch-small ch-muted" aria-label={plural(h.points, 'best answer')}>{h.points}</span>
      </div>
    ));

  // Hidden only when nobody has ever had a best answer. Early in a month the block stays, so All time and the
  // "Leave me out" switch are still reachable.
  if (!anyHelper) return null;
  const top = month.slice(0, 3);
  const openAll = () => {
    setRange(month.length > 0 ? 'MONTH' : 'ALL');
    setAll(true);
  };
  const quietMonth = <span className="ch-small ch-muted">{`No best answers yet in ${monthName}.`}</span>;
  const head = (
    <>
      <span className="helpers-trophy"><Icon name="trophy" size={18} /></span>
      <span className="bold">Top helpers</span>
      <span className="ch-small ch-muted helpers-month">{monthName}</span>
    </>
  );
  const panel = (
    <>
      {top.length > 0 ? rows(top) : quietMonth}
      <button type="button" className="btn text helpers-all" onClick={openAll}>
        See all
      </button>
    </>
  );

  return (
    <>
      {rail ? (
        <aside className="helpers helpers-rail" aria-label="Top helpers">
          <div className="helpers-head">{head}</div>
          {panel}
        </aside>
      ) : (
        <div className={'helpers helpers-strip' + (open ? ' open' : '')}>
          <button type="button" className="helpers-head" aria-expanded={open} onClick={() => toggle(!open)}>
            {open ? (
              head
            ) : (
              <>
                <span className="helpers-trophy"><Icon name="trophy" size={18} /></span>
                {top.length === 0 && <span className="grow">{quietMonth}</span>}
                <span className="helpers-medals" aria-label={top.map((h, i) => `${i + 1}. ${nameOf(h.uid)}, ${plural(h.points, 'best answer')}`).join('; ')}>
                  {top.map((h, i) => (
                    <span className="helpers-medal" key={h.uid}>
                      <span className={`helpers-ring r${i + 1}`}>
                        <Avatar photo={state.avatars.get(h.uid)} name={nameOf(h.uid)} color="#6B768A" size={28} />
                      </span>
                      <span className="bold">{h.points}</span>
                    </span>
                  ))}
                </span>
              </>
            )}
            <span className={'helpers-chev' + (open ? ' up' : '')}>
              <Icon name="chev" size={18} />
            </span>
          </button>
          {open && panel}
        </div>
      )}
      {all && (
        <Dialog
          title="Top helpers"
          onClose={() => setAll(false)}
          actions={
            <button className="btn text" onClick={() => setAll(false)}>
              Close
            </button>
          }
        >
          <div className="stack">
            <SegmentedControl label="When" full options={[{ value: 'MONTH', label: 'This month' }, { value: 'ALL', label: 'All time' }]} value={range} onChange={setRange} />
            {shownList.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No best answers yet.</p> : <div>{rows(shownList)}</div>}
            <Switch
              checked={iAmOut}
              onChange={(v) => run(v ? 'You are left out of the list.' : 'You are back on the list.', () => setHideFromBoard(db, state.classId, state.myUid, v))}
              label="Leave me out of this list"
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
