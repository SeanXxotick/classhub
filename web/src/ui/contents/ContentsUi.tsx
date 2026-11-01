import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { CONTENT_KINDS, newContentItem, type ClassRoom, type ContentItem, type ContentKind, type Course } from '../../data/models';
import { CONTENT_SORTS, ContentRules, type ContentSort } from '../../domain/contentRules';
import { ContentIcons } from '../../domain/iconStyles';
import { ConfirmDialog, Dialog, Field, PickerField, Spinner, StyledIcon, useBack } from '../common';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { NoAccess, SubPage } from '../classroom/SubPage';

// ---------------------------------------------------------------- Shared bits

function kindLabel(kind: ContentKind): string {
  return kind === 'FILE' ? 'File' : kind === 'VIDEO' ? 'Video' : 'Website';
}

function pluralLabel(kind: ContentKind): string {
  return kind === 'FILE' ? 'Files' : kind === 'VIDEO' ? 'Videos' : 'Websites';
}

/** "drive.google.com" from a full link, for the subtitle. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function KindBadge({ kind, room }: { kind: ContentKind; room: ClassRoom | null }) {
  // The class's chosen icon and color for this type (or the defaults).
  return <StyledIcon icon={ContentIcons.iconFor(kind, room?.contentIcons ?? {})} color={ContentIcons.colorFor(kind, room?.contentColors ?? {})} label={kindLabel(kind)} />;
}

/** Only web links open; anything else (such as a javascript: link) is refused. */
export function openLink(url: string, onError: (message: string) => void) {
  if (!ContentRules.isValidUrl(url)) return onError('That link cannot be opened.');
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** A chip that opens a small menu below it. */
function MenuChip({ label, active, children }: { label: string; active: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className={'chip menu-chip' + (active ? ' selected' : '')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ellipsis">{label}</span>&nbsp;&nbsp;▾
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuOption({ text, chosen, leading, onClick }: { text: string; chosen: boolean; leading?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={chosen} className={'menu-item' + (chosen ? ' bold' : '')} onClick={onClick}>
      {leading}
      {text}
    </button>
  );
}

// ---------------------------------------------------------------- Contents tab

const ALL = '*all*';
const GENERAL = '';

export function ContentsTab({ state, onEdit, onError }: { state: ClassState; onEdit: (id: string) => void; onError: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState(ALL);
  const [sort, setSort] = useState<ContentSort>('OLDEST');
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [groupByCourse, setGroupByCourse] = useState(true);
  const canManage = state.can('CONTENTS_MANAGE');

  const knownCourses = new Set(state.courses.map((c) => c.id));
  const shown = state.contents.filter(
    (item) =>
      ContentRules.matches(item, query) &&
      (typeFilter === ALL || item.kind === typeFilter) &&
      (courseFilter === ALL ? true : courseFilter === GENERAL ? !item.courseId || !knownCourses.has(item.courseId) : item.courseId === courseFilter),
  );
  // Without grouping, everything is one list under no heading.
  const groups: [Course | null, ContentItem[]][] = groupByCourse
    ? ContentRules.grouped(shown, state.courses, sort)
    : shown.length > 0
      ? [[null, [...shown].sort(ContentRules.comparator(sort))]]
      : [];

  const pickCourse = (filter: string, group = groupByCourse) => {
    setCourseFilter(filter);
    setGroupByCourse(group);
  };
  const sortLabel = CONTENT_SORTS.find((x) => x.id === sort)?.label ?? '';
  const courseLabel =
    courseFilter === ALL ? (groupByCourse ? 'Course' : 'One list') : courseFilter === GENERAL ? 'General' : state.courses.find((c) => c.id === courseFilter)?.name ?? 'Course';

  return (
    <div className="stack">
      <div className="contents-bar">
        <label className="field grow">
          <span className="sr-only">Search contents</span>
          <input type="search" placeholder="Search contents" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="row wrap">
          <MenuChip label={sortLabel} active={sort !== 'OLDEST'}>
            {(close) =>
              CONTENT_SORTS.map((option) => <MenuOption key={option.id} text={option.label} chosen={option.id === sort} onClick={() => (setSort(option.id), close())} />)
            }
          </MenuChip>
          <MenuChip label={typeFilter === ALL ? 'Type' : pluralLabel(typeFilter as ContentKind)} active={typeFilter !== ALL}>
            {(close) => (
              <>
                <MenuOption text="All types" chosen={typeFilter === ALL} onClick={() => (setTypeFilter(ALL), close())} />
                {CONTENT_KINDS.map((kind) => (
                  <MenuOption
                    key={kind}
                    text={pluralLabel(kind)}
                    chosen={typeFilter === kind}
                    leading={<KindBadge kind={kind} room={state.room} />}
                    onClick={() => (setTypeFilter(kind), close())}
                  />
                ))}
              </>
            )}
          </MenuChip>
          <MenuChip label={courseLabel} active={!(courseFilter === ALL && groupByCourse)}>
            {(close) => (
              <>
                <MenuOption text="All courses, grouped" chosen={courseFilter === ALL && groupByCourse} onClick={() => (pickCourse(ALL, true), close())} />
                <MenuOption text="All courses, one list" chosen={courseFilter === ALL && !groupByCourse} onClick={() => (pickCourse(ALL, false), close())} />
                <hr className="divider" />
                <MenuOption text="General" chosen={courseFilter === GENERAL} onClick={() => (pickCourse(GENERAL), close())} />
                {state.courses.map((c) => (
                  <MenuOption key={c.id} text={c.name} chosen={courseFilter === c.id} onClick={() => (pickCourse(c.id), close())} />
                ))}
              </>
            )}
          </MenuChip>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="card">
          <p className="empty" style={{ padding: 16 }}>
            {state.contents.length === 0 && canManage
              ? 'No class contents yet. Tap "+ Add content" to share a Google Drive file, a recorded discussion or a website.'
              : state.contents.length === 0
                ? 'No class contents yet. Officers who manage class contents can add links here.'
                : 'Nothing matches your search and filters.'}
          </p>
        </div>
      )}

      <div className="contents-grid">
        {groups.map(([course, items]) => (
          <div key={course?.id ?? 'general'} className="card flush">
            <div className="section-label">
              {groupByCourse ? `${course?.name ?? 'General'}  ·  ${items.length}` : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
            </div>
            {items.map((item) => {
              const subtitle = [
                groupByCourse ? '' : state.courses.find((c) => c.id === item.courseId)?.name ?? 'General',
                kindLabel(item.kind),
                hostOf(item.url),
                item.note,
              ]
                .filter((x) => x.trim())
                .join('  ·  ');
              const valid = ContentRules.isValidUrl(item.url);
              return (
                <div key={item.id} className="list-row content-row">
                  <a
                    className="row grow link-reset"
                    href={valid ? item.url : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (!valid) {
                        e.preventDefault();
                        onError('That link cannot be opened.');
                      }
                    }}
                  >
                    <KindBadge kind={item.kind} room={state.room} />
                    <span className="grow ellipsis-box">
                      <span className="title clamp-2">{item.title}</span>
                      <span className="sub ellipsis">{subtitle}</span>
                    </span>
                  </a>
                  {canManage && (
                    <button type="button" className="btn text small" onClick={() => onEdit(item.id)}>
                      Edit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Add / edit form

/** /class/:classId/content/:contentId ("new" when adding). */
export function ContentFormScreen() {
  const { contentId = 'new' } = useParams();
  const { state } = useClass();
  const isNew = contentId === 'new';
  const existing = isNew ? undefined : state.contents.find((c) => c.id === contentId);
  const title = existing ? 'Edit content' : 'Add content';

  if (!state.loading && !state.can('CONTENTS_MANAGE')) {
    return (
      <SubPage title={title}>
        <NoAccess what="manage class contents" />
      </SubPage>
    );
  }
  if (!state.loading && !isNew && !existing) {
    return (
      <SubPage title={title}>
        <p className="empty">This item was deleted.</p>
      </SubPage>
    );
  }
  return (
    <SubPage title={title}>
      <ContentForm key={existing?.id ?? 'new'} existing={existing} />
    </SubPage>
  );
}

function ContentForm({ existing }: { existing: ContentItem | undefined }) {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}?tab=CONTENTS`);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [courseId, setCourseId] = useState(existing?.courseId ?? '');
  const [kind, setKind] = useState<ContentKind>(existing?.kind ?? 'WEBSITE');
  // Until the user picks a kind themselves, it follows the link.
  const [kindChosen, setKindChosen] = useState(!!existing);
  const [pickingCourse, setPickingCourse] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const courseName = state.courses.find((c) => c.id === courseId)?.name ?? 'General (no course)';

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = ContentRules.check(title, url);
    setError(problem);
    if (problem) return;
    actions.saveContent(
      newContentItem({
        id: existing?.id ?? '',
        courseId,
        title,
        url,
        kind,
        note,
        createdByUid: existing?.createdByUid ?? '',
        createdAtMillis: existing?.createdAtMillis ?? 0,
      }),
      back,
    );
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <p className="small muted" style={{ margin: 0 }}>
        Share a link to class material. Files stay in Google Drive (or wherever they are); make sure the link's sharing allows your classmates to open it.
      </p>
      <Field label="Title">
        <input value={title} placeholder="e.g. Unit 1 Module 3 - AdCal" onChange={(e) => (setTitle(e.target.value.slice(0, ContentRules.MAX_TITLE)), setError(null))} />
      </Field>
      <Field label="Link">
        <input
          type="url"
          inputMode="url"
          value={url}
          placeholder="Paste a Google Drive or website link"
          onChange={(e) => {
            const next = e.target.value.trim();
            setUrl(next);
            setError(null);
            if (!kindChosen) setKind(ContentRules.guessKind(ContentRules.normalizeUrl(next)));
          }}
        />
      </Field>
      <span className="small semibold muted">Type</span>
      <div className="chips" role="radiogroup" aria-label="Type">
        {CONTENT_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind} className={'chip' + (k === kind ? ' selected' : '')} onClick={() => (setKind(k), setKindChosen(true))}>
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <PickerField label="Course" value={courseName} onClick={() => setPickingCourse(true)} />
      <Field label="Note (optional)">
        <textarea value={note} placeholder="e.g. Covers Theorems 4 and 5" onChange={(e) => setNote(e.target.value.slice(0, 120))} />
      </Field>
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn solid big block" type="submit" disabled={actions.busy}>
        {actions.busy ? <Spinner small /> : existing ? 'Save changes' : 'Add content'}
      </button>
      <button
        className="btn outline block"
        type="button"
        onClick={() => {
          const normalized = ContentRules.normalizeUrl(url);
          if (ContentRules.isValidUrl(normalized)) openLink(normalized, setError);
          else setError('That does not look like a web link yet.');
        }}
      >
        Test the link
      </button>
      {existing && (
        <button className="btn outline danger block" type="button" disabled={actions.busy} onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      )}

      {pickingCourse && (
        <Dialog
          title="Course"
          onClose={() => setPickingCourse(false)}
          actions={
            <button type="button" className="btn text" onClick={() => setPickingCourse(false)}>
              Cancel
            </button>
          }
        >
          <div className="scroll-list">
            <button type="button" className="list-row" onClick={() => (setCourseId(GENERAL), setPickingCourse(false))}>
              General (no course)
            </button>
            {state.courses.map((c) => (
              <button key={c.id} type="button" className="list-row" onClick={() => (setCourseId(c.id), setPickingCourse(false))}>
                {c.name}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {confirmDelete && existing && (
        <ConfirmDialog
          title={`Delete "${existing.title}"?`}
          text="Only the link is removed from ClassHub. The file itself stays in Google Drive."
          confirm="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => actions.deleteContent(existing, back)}
        />
      )}
    </form>
  );
}
