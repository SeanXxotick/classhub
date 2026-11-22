import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { checkFile, classUsage, deleteFile, FILE_ACCEPT, filesEnabled, sizeText, uploadFile, type Usage } from '../../data/files';
import { CONTENT_KINDS, newContentItem, type ClassRoom, type ContentFile, type ContentItem, type ContentKind, type Course } from '../../data/models';
import { CONTENT_SORTS, ContentRules, type ContentFormat, type ContentSort } from '../../domain/contentRules';
import { ContentIcons, IconLibrary } from '../../domain/iconStyles';
import { IconStylePicker } from '../classroom/ManageScreens';
import { ConfirmDialog, CourseDot, NEUTRAL_ICON, Dialog, Field, PickerField, Spinner, StyledIcon, useBack } from '../common';
import { useClass, type ClassState } from '../classroom/ClassContext';
import { NoAccess, SubPage } from '../classroom/SubPage';

// ---------------------------------------------------------------- Shared bits

function kindLabel(kind: ContentKind): string {
  return kind === 'FILE' ? 'File' : kind === 'VIDEO' ? 'Video' : 'Website';
}

function pluralLabel(kind: ContentKind): string {
  return kind === 'FILE' ? 'Files' : kind === 'VIDEO' ? 'Videos' : 'Websites';
}

function KindBadge({ kind, room }: { kind: ContentKind; room: ClassRoom | null }) {
  // The class's chosen icon and color for this type (or the defaults).
  return <StyledIcon icon={ContentIcons.iconFor(kind, room?.contentIcons ?? {})} color={NEUTRAL_ICON} label={kindLabel(kind)} />;
}

/** The row's icon: a format icon (slides, folder...) in the type's color, unless the class picked its own icon for the type. */
function ContentBadge({ item, format, room }: { item: ContentItem; format: ContentFormat; room: ClassRoom | null }) {
  const icon = ContentIcons.iconFor(item.kind, room?.contentIcons ?? {});
  const own = icon !== ContentIcons.DEFAULTS[item.kind];
  const typeColor = NEUTRAL_ICON;
  // An icon or color picked for this one item wins over the type's; without one the icon stays grey.
  const itemIcon = IconLibrary.ICONS.includes(item.icon) ? item.icon : '';
  const color = IconLibrary.COLORS.includes(item.color) ? item.color : typeColor;
  return <StyledIcon icon={itemIcon || (own || !format.icon ? icon : format.icon)} color={color} label={format.label} box={40} tint />;
}

/** Only web links open; anything else (such as a javascript: link) is refused. */
export function openLink(url: string, onError: (message: string) => void) {
  if (!ContentRules.isValidUrl(url)) return onError('That link cannot be opened.');
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Open state for a small menu that closes on a click outside it or on Escape. */
function useMenu(): [boolean, (open: boolean) => void, RefObject<HTMLDivElement>] {
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
  return [open, setOpen, ref];
}

/** A chip that opens a small menu below it. */
function MenuChip({ label, active, children }: { label: string; active: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen, ref] = useMenu();
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

/** The ⋮ button on a row: copy the link for everyone, and edit for officers. */
function RowMenu({ item, onEdit, onNotice }: { item: ContentItem; onEdit: (() => void) | null; onNotice: (message: string) => void }) {
  const [open, setOpen, ref] = useMenu();
  const copy = () => {
    setOpen(false);
    navigator.clipboard.writeText(item.url).then(
      () => onNotice('Link copied.'),
      () => onNotice('The link could not be copied.'),
    );
  };
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`More for "${item.title}"`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="5" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="19" r="1.8" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu end" role="menu">
          {!item.file && (
            <button type="button" role="menuitem" className="menu-item" onClick={copy}>
              Copy link
            </button>
          )}
          {onEdit && (
            <button type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), onEdit())}>
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One link: the whole row opens it, and the ⋮ menu holds the other actions. */
function ContentRow({
  item,
  state,
  showCourse,
  onEdit,
  onNotice,
}: {
  item: ContentItem;
  state: ClassState;
  showCourse: boolean;
  onEdit: ((id: string) => void) | null;
  onNotice: (message: string) => void;
}) {
  const format = ContentRules.formatOf(item);
  const source = item.file ? `Uploaded, ${sizeText(item.file.sizeBytes)}` : ContentRules.sourceOf(item.url);
  const subtitle = [showCourse ? state.courses.find((c) => c.id === item.courseId)?.name ?? 'General' : '', state.takes(item.courseId) ? '' : 'Not your course', format.label, source, item.note]
    .filter((x) => x.trim())
    .join('  ·  ');
  const valid = ContentRules.isValidUrl(item.url);
  const inner = (
    <>
      <ContentBadge item={item} format={format} room={state.room} />
      <span className="grow ellipsis-box">
        <span className="title clamp-2">{item.title}</span>
        <span className="sub ellipsis">
          {showCourse && <CourseDot color={state.courses.find((c) => c.id === item.courseId)?.color} />}
          {subtitle}
        </span>
      </span>
    </>
  );
  if (item.file) {
    return (
      <div className="list-row content-row">
        <Link className="row grow link-reset" to={`/class/${state.classId}/file/${item.id}`}>
          {inner}
        </Link>
        <RowMenu item={item} onEdit={onEdit && (() => onEdit(item.id))} onNotice={onNotice} />
      </div>
    );
  }
  return (
    <div className="list-row content-row">
      <a
        className="row grow link-reset"
        href={valid ? item.url : undefined}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (!valid) {
            e.preventDefault();
            onNotice('That link cannot be opened.');
          }
        }}
      >
        {inner}
      </a>
      <RowMenu item={item} onEdit={onEdit && (() => onEdit(item.id))} onNotice={onNotice} />
    </div>
  );
}

// ---------------------------------------------------------------- Contents tab

const ALL = '*all*';
const GENERAL = '';
/** Rows a course shows before "Show all". */
const FOLDED_ROWS = 5;
const NEW_KEY = '*new*';
const WEEK_MILLIS = 7 * 24 * 3600 * 1000;
/** "New this week" repeats links that are also in their course, so it only shows once the list is long enough to need it. */
const NEW_SECTION_MIN_ITEMS = 10;

export function ContentsTab({ state, onEdit, onNotice }: { state: ClassState; onEdit: (id: string) => void; onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState(ALL);
  const [sort, setSort] = useState<ContentSort>('NEWEST');
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [groupByCourse, setGroupByCourse] = useState(true);
  // Sections opened with "Show all".
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
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
  // The plain grouped view folds long sections and starts with what was added this week.
  // A search or a course filter shows every match.
  const browsing = groupByCourse && courseFilter === ALL && !query.trim();
  const weekAgo = Date.now() - WEEK_MILLIS;
  const fresh =
    browsing && typeFilter === ALL && state.contents.length > NEW_SECTION_MIN_ITEMS
      ? state.contents.filter((c) => c.createdAtMillis >= weekAgo).sort(ContentRules.comparator('NEWEST'))
      : [];

  const pickCourse = (filter: string, group = groupByCourse) => {
    setCourseFilter(filter);
    setGroupByCourse(group);
  };
  const toggleFold = (key: string) =>
    setUnfolded((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const sortLabel = CONTENT_SORTS.find((x) => x.id === sort)?.label ?? '';
  const courseLabel =
    courseFilter === ALL ? (groupByCourse ? 'Course' : 'One list') : courseFilter === GENERAL ? 'General' : state.courses.find((c) => c.id === courseFilter)?.name ?? 'Course';

  // Sections that mix courses (New this week, one list) take the full width, with their rows in columns on wide screens.
  const section = (key: string, heading: string, items: ContentItem[], mixed: boolean, color?: string) => {
    const foldable = browsing && items.length > FOLDED_ROWS;
    const folded = foldable && !unfolded.has(key);
    return (
      <section key={key} className={'card flush content-card' + (mixed ? ' wide' : '')} aria-label={heading}>
        <div className="content-card-head">
          <h3 className="grow ellipsis">
            <CourseDot color={color} />
            {heading}
          </h3>
          <span className="count">{items.length}</span>
        </div>
        <div className="content-rows">
          {(folded ? items.slice(0, FOLDED_ROWS) : items).map((item) => (
            <ContentRow key={item.id} item={item} state={state} showCourse={mixed} onEdit={canManage ? onEdit : null} onNotice={onNotice} />
          ))}
        </div>
        {foldable && (
          <button type="button" className="btn text small show-all" aria-expanded={!folded} onClick={() => toggleFold(key)}>
            {folded ? `Show all ${items.length}` : 'Show fewer'}
          </button>
        )}
      </section>
    );
  };

  return (
    <div className="stack">
      <div className="contents-bar">
        <label className="field grow">
          <span className="sr-only">Search contents</span>
          <input type="search" placeholder="Search contents" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="row wrap">
          <MenuChip label={sortLabel} active={sort !== 'NEWEST'}>
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
                {state.courses.filter((c) => canManage || state.takes(c.id)).map((c) => (
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

      {fresh.length > 0 && section(NEW_KEY, 'New this week', fresh, true)}

      {groupByCourse ? (
        <div className="contents-grid">{groups.map(([course, items]) => section(course?.id ?? 'general', course?.name ?? 'General', items, false, course?.color))}</div>
      ) : (
        groups.map(([, items]) => section('all', 'All items', items, true))
      )}
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
  // A link shared to ClassHub arrives in the address (see ShareScreen).
  const [shared] = useSearchParams();
  const [title, setTitle] = useState(existing?.title ?? shared.get('title') ?? '');
  const [url, setUrl] = useState(existing?.url ?? shared.get('url') ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [courseId, setCourseId] = useState(existing?.courseId ?? '');
  const [kind, setKind] = useState<ContentKind>(existing?.kind ?? 'WEBSITE');
  // Until the user picks a kind themselves, it follows the link.
  const [kindChosen, setKindChosen] = useState(!!existing);
  const [pickingCourse, setPickingCourse] = useState(false);
  const [icon, setIcon] = useState(existing?.icon ?? '');
  const [color, setColor] = useState(existing?.color ?? '');
  const [pickingIcon, setPickingIcon] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A link, or an uploaded file (when the files Worker is set up, or the item already has one).
  const [source, setSource] = useState<'LINK' | 'FILE'>(existing?.file ? 'FILE' : 'LINK');
  const [file, setFile] = useState<ContentFile | null>(existing?.file ?? null);
  const [progress, setProgress] = useState<number | null>(null);
  const [sending, setSending] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canUpload = filesEnabled || !!existing?.file;
  // A file uploaded in this form but not saved yet. It is deleted when another file replaces it, or when the
  // form is left without saving, so it does not use up the class's storage. (If the app is closed instead,
  // the files Worker's daily clean-up removes it.)
  const unsaved = useRef<string | null>(null);
  const left = useRef(false);
  const discard = (key: string | null | undefined) => {
    if (key) void deleteFile(state.classId, key).catch(() => undefined);
  };
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
      discard(unsaved.current);
      unsaved.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (source === 'FILE' && filesEnabled && !usage) classUsage(state.classId).then(setUsage, () => undefined);
  }, [source, state.classId, usage]);
  async function pick(chosen: File | undefined) {
    if (!chosen) return;
    const problem = checkFile(chosen);
    setError(problem);
    if (problem) return;
    setProgress(0);
    setSending(chosen.name);
    try {
      const done = await uploadFile(state.classId, chosen, setProgress);
      // Left the form while it was uploading: nothing will save it.
      if (left.current) return discard(done.key);
      // The upload it replaces is deleted now, so it no longer counts.
      const replaced = unsaved.current && file?.key === unsaved.current ? file.sizeBytes : 0;
      discard(unsaved.current);
      unsaved.current = done.key;
      setFile({ key: done.key, name: done.name, sizeBytes: done.sizeBytes, mimeType: done.mimeType });
      setUsage({ usedBytes: done.usedBytes - replaced, limitBytes: done.limitBytes });
      // A new upload is named after its file; an uploaded item being edited keeps its (maybe renamed) title.
      if (!existing?.file) setTitle(done.name.replace(/\.[A-Za-z0-9]+$/, '').trim().slice(0, ContentRules.MAX_TITLE) || done.name.slice(0, ContentRules.MAX_TITLE));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      if (picker.current) picker.current.value = '';
    }
  }
  // An uploaded file is always of the File kind; a link has the kind picked below.
  const shownKind: ContentKind = source === 'FILE' ? 'FILE' : kind;
  const typeIcon = ContentIcons.iconFor(shownKind, state.room?.contentIcons ?? {});
  const typeColor = NEUTRAL_ICON;
  const courseName = state.courses.find((c) => c.id === courseId)?.name ?? 'General (no course)';

  function submit(e: FormEvent) {
    e.preventDefault();
    const asFile = source === 'FILE';
    const problem = asFile && !file ? 'Choose a file to upload.' : ContentRules.check(title, url, asFile);
    setError(problem);
    if (problem) return;
    actions.saveContent(
      newContentItem({
        id: existing?.id ?? '',
        courseId,
        title,
        url: asFile ? '' : url,
        file: asFile ? file : null,
        kind: asFile ? 'FILE' : kind,
        note,
        icon,
        color,
        createdByUid: existing?.createdByUid ?? '',
        createdAtMillis: existing?.createdAtMillis ?? 0,
      }),
      () => {
        // Saved: drop the uploads this item no longer uses (an unsaved one, or the file it replaced).
        const kept = asFile ? file?.key : undefined;
        if (unsaved.current !== kept) discard(unsaved.current);
        if (existing?.file && existing.file.key !== kept) discard(existing.file.key);
        unsaved.current = null;
        back();
      },
    );
  }

  return (
    <>
      {pickingIcon && (
        <IconStylePicker
          title="Icon of this content"
          icon={icon || typeIcon}
          color={color || typeColor}
          defaultIcon={typeIcon}
          defaultColor={typeColor}
          onDone={(pickedIcon, pickedColor) => {
            setIcon(pickedIcon === typeIcon ? '' : pickedIcon);
            setColor(pickedColor === typeColor ? '' : pickedColor);
            setPickingIcon(false);
          }}
          onDismiss={() => setPickingIcon(false)}
        />
      )}
    <form className="card stack" onSubmit={submit} noValidate>
      {canUpload && (
        <div className="chips" role="radiogroup" aria-label="Content is">
          {(['LINK', 'FILE'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={s === source} className={'chip' + (s === source ? ' selected' : '')} onClick={() => (setSource(s), setError(null))}>
              {s === 'LINK' ? 'Link' : 'Upload a file'}
            </button>
          ))}
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {source === 'FILE'
          ? 'Upload a PDF, picture, Word, PowerPoint, Excel or ZIP file of up to 10 MB. Only your classmates can open it.'
          : 'Make sure the link is shared with your classmates.'}
      </p>
      {source === 'FILE' && (
        <div className="card stack upload-box">
          <input ref={picker} type="file" accept={FILE_ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} />
          {progress !== null ? (
            <span className="upload-name small">{`Uploading ${sending}…`}</span>
          ) : file ? (
            <span className="upload-name">
              <span className="semibold">{file.name}</span>
              <span className="small muted">{` · ${sizeText(file.sizeBytes)}`}</span>
            </span>
          ) : (
            <span className="small muted">No file chosen yet.</span>
          )}
          {progress !== null ? (
            <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          ) : (
            <button type="button" className="btn outline block" disabled={!filesEnabled} onClick={() => picker.current?.click()}>
              {file ? 'Replace file' : 'Choose a file'}
            </button>
          )}
          {usage && <span className="small muted">{`This class has used ${sizeText(usage.usedBytes)} of ${sizeText(usage.limitBytes)} for files.`}</span>}
        </div>
      )}
      {/* Uploading asks for no title (the file's name is used); it can be renamed later with Edit. */}
      {(source === 'LINK' || existing?.file) && (
        <Field label={source === 'FILE' ? 'Name' : 'Title'}>
          <input value={title} placeholder="e.g. Unit 1 Module 3 - AdCal" onChange={(e) => (setTitle(e.target.value.slice(0, ContentRules.MAX_TITLE)), setError(null))} />
        </Field>
      )}
      {source === 'LINK' && (
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
      )}
      {source === 'LINK' && (
        <>
          <span className="small semibold muted">Type</span>
          <div className="chips" role="radiogroup" aria-label="Type">
            {CONTENT_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={k === kind} className={'chip' + (k === kind ? ' selected' : '')} onClick={() => (setKind(k), setKindChosen(true))}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="small semibold muted">Icon</span>
      <div className="row" style={{ gap: 12 }}>
        <StyledIcon icon={icon || typeIcon} color={color || typeColor} box={40} tint />
        <span className="grow small muted">{icon || color ? 'Its own icon' : `Same as other ${pluralLabel(shownKind).toLowerCase()}`}</span>
        {(icon || color) && (
          <button type="button" className="btn text" onClick={() => (setIcon(''), setColor(''))}>
            Reset
          </button>
        )}
        <button type="button" className="btn outline small" onClick={() => setPickingIcon(true)}>
          Change icon
        </button>
      </div>
      <PickerField label="Course" value={courseName} onClick={() => setPickingCourse(true)} />
      <Field label="Note (optional)">
        <textarea value={note} placeholder="e.g. Covers Theorems 4 and 5" onChange={(e) => setNote(e.target.value.slice(0, 120))} />
      </Field>
      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn solid big block" type="submit" disabled={actions.busy || progress !== null}>
        {actions.busy ? <Spinner small /> : existing ? 'Save changes' : 'Add content'}
      </button>
      {source === 'LINK' && (
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
      )}
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
          text={existing.file ? 'The uploaded file is deleted too.' : 'Only the link is removed from ClassHub.'}
          confirm="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => actions.deleteContent(existing, back)}
        />
      )}
    </form>
    </>
  );
}
