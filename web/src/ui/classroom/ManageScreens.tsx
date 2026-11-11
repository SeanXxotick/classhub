import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CONTENT_KINDS, PERMISSIONS, SCHEDULE_KINDS, newRole, type ClassRoom, type ContentKind, type Course, type Member, type Permission, type Role, type ScheduleKind } from '../../data/models';
import { ClassRules, CourseRules, MemberRules } from '../../domain/classRules';
import { ContentIcons, IconLibrary, ScheduleIcons } from '../../domain/iconStyles';
import { Ledger } from '../../domain/ledger';
import { LedgerView } from '../../domain/ledgerView';
import { formatMoney } from '../../domain/money';
import { RoleRules } from '../../domain/permissions';
import {
  ACCENT_CHOICES,
  COURSE_COLORS,
  NEUTRAL_ICON,
  Avatar,
  ColorPicker,
  ConfirmDialog,
  Dialog,
  Field,
  ROLE_COLOR_CHOICES,
  RoleChip,
  Spinner,
  StyledIcon,
  Switch,
  hexColor,
  initialsOf,
  useBack,
  usePhotoPicker,
} from '../common';
import { balanceText, EntryRow } from '../ledger/LedgerUi';
import { kindLabel as scheduleKindLabel } from '../schedule/ScheduleUi';
import { setPinned } from '../settings';
import { useClass } from './ClassContext';
import { NoAccess, SubPage } from './SubPage';

/** The title and description of each permission, as in the role editor. */
export function permissionLabel(p: Permission): [string, string] {
  switch (p) {
    case 'RECORDS_MANAGE':
      return ['Manage ledger records', 'Payments, charging students, withdrawals and pay-outs'];
    case 'SCHEDULE_MANAGE':
      return ['Manage schedule', 'Deadlines, quizzes and exams'];
    case 'MEMBERS_MANAGE':
      return ['Manage members', 'Assign roles, set courses, remove members, invite code'];
    case 'ROLES_MANAGE':
      return ['Manage roles', 'Create, edit and delete roles'];
    case 'CLASS_SETTINGS':
      return ['Class settings and courses', 'Name, color, modules and the course list'];
    case 'CONTENTS_MANAGE':
      return ['Manage class contents', 'Add, edit and remove links to files, videos and websites'];
    case 'ANNOUNCEMENTS_MANAGE':
      return ['Manage announcements', 'Post, pin, edit and delete announcements'];
    case 'ATTENDANCE_MANAGE':
      return ['Take attendance', 'Record who was present, late or absent at each class meeting'];
  }
}

const s = (n: number) => (n === 1 ? '' : 's');

function ColorDot({ hex }: { hex: string }) {
  return <span className="color-dot" style={{ background: hexColor(hex, '#6B768A') }} />;
}

// ---------------------------------------------------------------- Member detail

/** /class/:classId/member/:memberId */
export function MemberDetailScreen() {
  const { memberId = '' } = useParams();
  const { state } = useClass();
  const member = state.members.find((m) => m.id === memberId);
  return (
    <SubPage title={member?.name ?? 'Member'}>
      {!member ? (
        <NoAccess what="see this member, or they are no longer in the class" />
      ) : !state.can('MEMBERS_MANAGE') ? (
        <NoAccess what="manage members" />
      ) : (
        <MemberDetailContent key={member.id} member={member} />
      )}
    </SubPage>
  );
}

function MemberDetailContent({ member }: { member: Member }) {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}?tab=MEMBERS`);
  const ownerUid = state.room?.ownerUid ?? '';
  const canChangeRole = MemberRules.canChangeRole(state.myUid, member, ownerUid);
  const canRemove = MemberRules.canRemove(state.myUid, member, ownerUid);
  const currentRole = state.roleOf(member);
  const takenNow = state.courses.map((c) => c.id).filter((id) => !member.excludedCourseIds.includes(id));

  const [roleDraft, setRoleDraft] = useState<{ from: string; id: string }>({ from: member.roleId, id: member.roleId });
  const selectedRoleId = roleDraft.from === member.roleId ? roleDraft.id : member.roleId;
  const takenKey = `${member.excludedCourseIds.join(',')}|${state.courses.map((c) => c.id).join(',')}`;
  const [takenDraft, setTakenDraft] = useState<{ key: string; ids: Set<string> } | null>(null);
  const taken = takenDraft?.key === takenKey ? takenDraft.ids : new Set(takenNow);
  const coursesChanged = taken.size !== takenNow.length || takenNow.some((id) => !taken.has(id));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const balance = state.balanceOf(member.id);

  const setTaken = (id: string, on: boolean) => {
    const next = new Set(taken);
    if (on) next.add(id);
    else next.delete(id);
    setTakenDraft({ key: takenKey, ids: next });
  };

  return (
    <div className="stack">
      <div className="card row">
        <Avatar photo={state.avatars.get(member.id)} name={member.name} color={hexColor(currentRole?.colorHex, '#6B768A')} size={52} />
        <span className="grow">
          <span className="bold" style={{ display: 'block' }}>{member.id === state.myUid ? `${member.name} (you)` : member.name}</span>
          <span className="small muted">Current role</span>
        </span>
        <RoleChip name={currentRole?.name ?? 'No role'} color={currentRole?.colorHex ?? '#6B768A'} />
      </div>

      {state.room?.ledgerEnabled !== false && (state.seeAll || member.id === state.myUid) && (
        <div className="card flush">
          <div className="section-label">Balance</div>
          <div className="bold" style={{ fontSize: 18, padding: '0 16px 4px', color: balance < 0 ? 'var(--error)' : undefined }}>{balanceText(balance)}</div>
          {LedgerView.statement(member.id, state.records)
            .slice(0, 5)
            .map((record) => (
              <EntryRow key={record.id} entry={{ kind: 'single', key: 'r:' + record.id, type: record.type, dateMillis: record.dateMillis, record }} state={state} />
            ))}
        </div>
      )}

      <div className="card">
        <div className="section-label" style={{ padding: '0 0 6px' }}>Role</div>
        {!canChangeRole ? (
          <p className="muted" style={{ margin: 0 }}>{member.id === ownerUid ? "The Mayor's role cannot be changed." : 'You cannot change your own role.'}</p>
        ) : (
          <div role="radiogroup" aria-label="Role">
            {MemberRules.assignableRoles(state.roles).map((role) => (
              <label key={role.id} className="radio-row">
                <input type="radio" name="role" checked={role.id === selectedRoleId} onChange={() => setRoleDraft({ from: member.roleId, id: role.id })} />
                <ColorDot hex={role.colorHex} />
                <span className="grow">{role.name}</span>
              </label>
            ))}
            <button
              className="btn solid block"
              style={{ marginTop: 8 }}
              disabled={actions.busy || selectedRoleId === member.roleId}
              onClick={() => actions.setRole(member, selectedRoleId)}
            >
              Save role
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-label" style={{ padding: '0 0 6px' }}>Courses taken</div>
        {state.courses.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>This class has no courses yet. Add them under Home → Courses.</p>
        ) : (
          <>
            {state.courses.map((course) => {
              const takes = taken.has(course.id);
              return <Switch key={course.id} label={course.name} sub={takes ? undefined : 'Skipped when charging this course'} checked={takes} onChange={(on) => setTaken(course.id, on)} />;
            })}
            <button className="btn solid block" style={{ marginTop: 8 }} disabled={actions.busy || !coursesChanged} onClick={() => actions.setCoursesTaken(member, taken)}>
              Save courses
            </button>
          </>
        )}
      </div>

      {canRemove && (
        <button className="btn outline danger block" disabled={actions.busy} onClick={() => setConfirmRemove(true)}>
          Remove from class
        </button>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${member.name}?`}
          text="They lose access to this class. Their past ledger records stay. They can rejoin with the invite code."
          confirm="Remove"
          danger
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => actions.removeMember(member, back)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Roles list

/** /class/:classId/roles */
export function RolesScreen() {
  const { state } = useClass();
  const navigate = useNavigate();
  const canManage = state.can('ROLES_MANAGE');
  const defaultRoleName = state.roles.find((r) => r.id === state.room?.defaultRoleId)?.name ?? 'Member';
  return (
    <SubPage
      title="Roles"
      actions={
        canManage && (
          <button className="btn text" onClick={() => navigate(`/class/${state.classId}/roles/new`)}>
            + New role
          </button>
        )
      }
    >
      {!canManage ? (
        <NoAccess what="manage roles" />
      ) : (
        <div className="card flush">
          {state.roles.map((role) => {
            const holders = MemberRules.holders(role, state.members);
            const summary = role.locked
              ? 'All permissions'
              : role.permissions.length === 0
                ? 'View only'
                : PERMISSIONS.filter((p) => role.permissions.includes(p))
                    .map((p) => permissionLabel(p)[0].replace(/^Manage /, ''))
                    .join(', ');
            const content = (
              <>
                <ColorDot hex={role.colorHex} />
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>{role.name}</span>
                  <span className="sub">
                    {summary} · {holders} member{s(holders)}
                  </span>
                </span>
                <span className="muted">{role.locked ? 'Locked' : '›'}</span>
              </>
            );
            return role.locked ? (
              <div key={role.id} className="list-row">
                {content}
              </div>
            ) : (
              <button key={role.id} type="button" className="list-row" onClick={() => navigate(`/class/${state.classId}/roles/${role.id}`)}>
                {content}
              </button>
            );
          })}
          <p className="small muted" style={{ margin: 0, padding: 16 }}>
            Tap a role to rename it, change its color or choose what it can do. New members join as {defaultRoleName}.
          </p>
        </div>
      )}
    </SubPage>
  );
}

// ---------------------------------------------------------------- Role editor

/** /class/:classId/roles/:roleId ("new" when creating a role). */
export function RoleEditorScreen() {
  const { roleId = 'new' } = useParams();
  const { state } = useClass();
  const isNew = roleId === 'new';
  const existing = isNew ? undefined : state.roles.find((r) => r.id === roleId);
  return (
    <SubPage title={existing ? 'Edit role' : 'New role'}>
      {!state.can('ROLES_MANAGE') ? (
        <NoAccess what="manage roles" />
      ) : !isNew && !existing ? (
        <NoAccess what="edit this role, or it was deleted" />
      ) : existing && !RoleRules.canEdit(existing) ? (
        <NoAccess what={`edit the ${existing.name} role`} />
      ) : (
        <RoleEditorContent key={existing?.id ?? 'new'} existing={existing} />
      )}
    </SubPage>
  );
}

function RoleEditorContent({ existing }: { existing: Role | undefined }) {
  const { state, actions } = useClass();
  const back = useBack(`/class/${state.classId}/roles`);
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.colorHex ?? ROLE_COLOR_CHOICES[0]);
  const [permissions, setPermissions] = useState(() => new Set(existing?.permissions ?? []));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const defaultRoleId = state.room?.defaultRoleId ?? '';
  const defaultRoleName = state.roles.find((r) => r.id === defaultRoleId)?.name ?? 'Member';
  const nameOk = RoleRules.isNameValid(name, state.roles, existing?.id ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!nameOk) return;
    actions.saveRole(
      newRole({ id: existing?.id ?? '', name, colorHex: color, permissions: PERMISSIONS.filter((p) => permissions.has(p)) }),
      back,
    );
  }

  const holders = existing ? MemberRules.holders(existing, state.members) : 0;

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="card stack">
        <Field label="Role name" help={name.trim() && !nameOk ? <span className="error-text">Another role already uses this name.</span> : undefined}>
          <input value={name} placeholder="e.g. PIO, Auditor, Class Rep" onChange={(e) => setName(e.target.value.slice(0, 24))} />
        </Field>
        <span className="small semibold muted">Color</span>
        <ColorPicker label="Role color" choices={ROLE_COLOR_CHOICES} selected={color} onSelect={setColor} />
        <div className="row">
          <span className="muted">Preview</span>
          <RoleChip name={name.trim() || 'Role'} color={color} />
        </div>
      </div>
      <div className="card">
        <div className="section-label" style={{ padding: '0 0 6px' }}>Can do</div>
        {PERMISSIONS.map((p) => {
          const [title, subtitle] = permissionLabel(p);
          return (
            <Switch
              key={p}
              label={title}
              sub={subtitle}
              checked={permissions.has(p)}
              onChange={(on) => {
                const next = new Set(permissions);
                if (on) next.add(p);
                else next.delete(p);
                setPermissions(next);
              }}
            />
          );
        })}
      </div>
      <button className="btn solid big block" type="submit" disabled={actions.busy || !nameOk}>
        {actions.busy ? <Spinner small /> : existing ? 'Save role' : 'Create role'}
      </button>
      {existing && RoleRules.canDelete(existing, defaultRoleId) && (
        <button type="button" className="btn outline danger block" disabled={actions.busy} onClick={() => setConfirmDelete(true)}>
          Delete role
        </button>
      )}
      {confirmDelete && existing && (
        <ConfirmDialog
          title={`Delete ${existing.name}?`}
          text={holders === 0 ? 'No one has this role.' : `${holders} member${s(holders)} with this role will become ${defaultRoleName}.`}
          confirm="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => actions.deleteRole(existing, back)}
        />
      )}
    </form>
  );
}

// ---------------------------------------------------------------- Courses

/** /class/:classId/courses */
export function CoursesScreen() {
  const { state, actions } = useClass();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Course | null>(null);

  if (!state.can('CLASS_SETTINGS')) {
    return (
      <SubPage title="Courses">
        <NoAccess what="edit courses" />
      </SubPage>
    );
  }

  return (
    <SubPage title="Courses">
      <div className="stack">
        <form
          className="card row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) actions.addCourse(newName, () => setNewName(''));
          }}
          noValidate
        >
          <span className="grow">
            <Field label="New course">
              <input value={newName} placeholder="e.g. Operations Research" onChange={(e) => setNewName(e.target.value.slice(0, CourseRules.MAX_NAME))} />
            </Field>
          </span>
          <button className="btn solid" type="submit" style={{ alignSelf: 'flex-end', minHeight: 48 }} disabled={actions.busy || !newName.trim()}>
            Add
          </button>
        </form>
        <div className="card flush">
          {state.courses.length === 0 && (
            <p className="muted" style={{ margin: 0, padding: '8px 16px' }}>
              No courses yet. Add the subjects your class takes, then mark who does not take each one from their member page.
            </p>
          )}
          {state.courses.map((course) => {
            const takers = CourseRules.takers(course, state.members);
            return (
              <button key={course.id} type="button" className="list-row" onClick={() => setEditing(course)}>
                <span className="avatar" aria-hidden style={{ width: 42, height: 42, background: course.color || 'var(--primary)', color: course.color ? '#fff' : 'var(--on-primary)', fontSize: 15 }}>
                  {initialsOf(course.name)}
                </span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>{course.name}</span>
                  <span className="sub">
                    {takers} of {state.members.length} take this
                  </span>
                </span>
                <span className="muted">›</span>
              </button>
            );
          })}
          <p className="small muted" style={{ margin: 0, padding: 16 }}>
            A new course includes everyone. Mark the students who do not take it on their member page, and charges by course will skip them.
          </p>
        </div>
      </div>
      {editing && <CourseDialog key={editing.id} course={editing} onClose={() => setEditing(null)} />}
    </SubPage>
  );
}

function CourseDialog({ course, onClose }: { course: Course; onClose: () => void }) {
  const { actions } = useClass();
  const [rename, setRename] = useState(course.name);
  const [color, setColor] = useState(course.color ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (confirmDelete) {
    return (
      <ConfirmDialog
        title={`Delete ${course.name}?`}
        text="Past charges stay in the ledger. You will not be able to charge by this course anymore."
        confirm="Delete"
        danger
        onClose={onClose}
        onConfirm={() => actions.deleteCourse(course)}
      />
    );
  }
  const renamed = rename.trim() !== course.name;
  const recolored = color !== (course.color ?? '');
  const canSave = !!rename.trim() && (renamed || recolored);
  const save = () => {
    if (renamed) actions.renameCourse(course, rename);
    if (recolored) actions.setCourseColor(course, color);
    onClose();
  };
  return (
    <Dialog
      title="Edit course"
      onClose={onClose}
      actions={
        <>
          <button className="btn text danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
          <button className="btn text" onClick={onClose}>
            Cancel
          </button>
          <button className="btn text" disabled={!canSave} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        <Field label="Course name">
          <input value={rename} onChange={(e) => setRename(e.target.value.slice(0, CourseRules.MAX_NAME))} />
        </Field>
        <div className="small semibold muted" style={{ margin: '14px 0 6px' }}>
          Color in the timetable
        </div>
        <ColorPicker label="Course color" choices={COURSE_COLORS} selected={color} onSelect={setColor} />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Class settings

function contentKindLabel(kind: ContentKind): string {
  return kind === 'FILE' ? 'File' : kind === 'VIDEO' ? 'Video' : 'Website';
}

const sameMap = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** /class/:classId/settings */
export function ClassSettingsScreen() {
  const { state } = useClass();
  const room = state.room;
  return (
    <SubPage title="Class settings">
      {!room ? null : !state.can('CLASS_SETTINGS') ? <NoAccess what="change class settings" /> : <ClassSettingsContent key={room.id} room={room} />}
    </SubPage>
  );
}

function ClassSettingsContent({ room }: { room: ClassRoom }) {
  const { state, actions } = useClass();
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [accent, setAccent] = useState(room.accentColor);
  const [ledger, setLedger] = useState(room.ledgerEnabled);
  const [schedule, setSchedule] = useState(room.scheduleEnabled);
  const [contents, setContents] = useState(room.contentsEnabled);
  const [news, setNews] = useState(room.announcementsEnabled);
  const [timetable, setTimetable] = useState(room.timetableEnabled);
  const [scheduleIcons, setScheduleIcons] = useState(room.scheduleIcons);
  const scheduleColors = room.scheduleColors;
  const [contentIcons, setContentIcons] = useState(room.contentIcons);
  const contentColors = room.contentColors;
  const [pickingSchedule, setPickingSchedule] = useState<ScheduleKind | null>(null);
  const [pickingContent, setPickingContent] = useState<ContentKind | null>(null);
  const error = ClassRules.checkName(name);
  const [pickPhoto, photoInput] = usePhotoPicker(actions.setClassPhoto, actions.showNotice);
  const changed =
    name.trim() !== room.name ||
    description.trim() !== room.description ||
    accent.toLowerCase() !== room.accentColor.toLowerCase() ||
    ledger !== room.ledgerEnabled ||
    schedule !== room.scheduleEnabled ||
    contents !== room.contentsEnabled ||
    news !== room.announcementsEnabled ||
    timetable !== room.timetableEnabled ||
    !sameMap(ScheduleIcons.sanitize(scheduleIcons), ScheduleIcons.sanitize(room.scheduleIcons)) ||
    !sameMap(ScheduleIcons.sanitizeColors(scheduleColors), ScheduleIcons.sanitizeColors(room.scheduleColors)) ||
    !sameMap(ContentIcons.sanitize(contentIcons), ContentIcons.sanitize(room.contentIcons)) ||
    !sameMap(ContentIcons.sanitizeColors(contentColors), ContentIcons.sanitizeColors(room.contentColors));

  function save() {
    actions.saveSettings({
      ...room,
      name,
      description,
      accentColor: accent,
      ledgerEnabled: ledger,
      scheduleEnabled: schedule,
      contentsEnabled: contents,
      announcementsEnabled: news,
      timetableEnabled: timetable,
      scheduleIcons,
      scheduleColors,
      contentIcons,
      contentColors,
    });
  }

  // Preview the chosen accent on this screen before saving.
  return (
    <div className="stack accented" style={{ '--accent': hexColor(accent) } as CSSProperties}>
      {photoInput}
      <div className="card stack">
        <div className="hero preview-hero row">
          <Avatar photo={state.classPhoto} name={name.trim() || 'Class'} color="var(--accent, #0F766E)" size={56} circle={false} />
          <span className="grow">
            <span className="bold" style={{ display: 'block', fontSize: 20 }}>{name.trim() || 'Class name'}</span>
            {description.trim() && <span className="soft" style={{ display: 'block' }}>{description}</span>}
            <span className="small" style={{ opacity: 0.7 }}>Preview</span>
          </span>
        </div>
        <div className="row">
          <span className="small semibold muted grow">Class photo</span>
          <button type="button" className="btn text" disabled={actions.busy} onClick={pickPhoto}>
            {state.classPhoto ? 'Change photo' : 'Add photo'}
          </button>
          {state.classPhoto && (
            <button type="button" className="btn text danger" disabled={actions.busy} onClick={actions.removeClassPhoto}>
              Remove
            </button>
          )}
        </div>
        <Field label="Class name" help={error ? <span className="error-text">{error}</span> : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, ClassRules.MAX_NAME))} />
        </Field>
        <Field label="Description (optional)">
          <input value={description} placeholder="e.g. 1st Semester, AY 2026-2027" onChange={(e) => setDescription(e.target.value.slice(0, ClassRules.MAX_DESCRIPTION))} />
        </Field>
        <span className="small semibold muted">Accent color</span>
        <ColorPicker label="Accent color" choices={ACCENT_CHOICES} selected={accent} onSelect={setAccent} />
      </div>

      <div className="card">
        <div className="section-label" style={{ padding: '0 0 6px' }}>Modules</div>
        <p className="small muted" style={{ margin: 0 }}>
          Turn off what your class does not use. Turning a module off hides its tab for everyone and stops its reminders. Nothing is deleted, so turning it back on brings everything back.
        </p>
        <Switch label="Ledger" sub="Class fund, charges, payments and balances" checked={ledger} onChange={setLedger} />
        <Switch label="Schedule" sub="Deadlines, quizzes and exams" checked={schedule} onChange={setSchedule} />
        <Switch label="Contents" sub="Links to files, videos and websites" checked={contents} onChange={setContents} />
        <Switch label="News" sub="Announcements from the officers" checked={news} onChange={setNews} />
        <Switch label="Timetable" sub="Weekly class meetings and no-classes days, shown on Home and Schedule" checked={timetable} onChange={setTimetable} />
        <Switch label="Members" sub="Always on" checked disabled onChange={() => {}} />
      </div>

      <div className="card">
        <div className="section-label" style={{ padding: '0 0 6px' }}>Schedule icons</div>
        <p className="small muted" style={{ margin: 0 }}>
          The icon each type of schedule item shows for everyone in the class. Its color comes from the item's course.
        </p>
        {SCHEDULE_KINDS.map((kind) => {
          const icon = ScheduleIcons.iconFor(kind, scheduleIcons);
          const color = NEUTRAL_ICON;
          return (
            <IconStyleRow
              key={kind}
              label={scheduleKindLabel(kind)}
              icon={icon}
              color={color}
              isDefault={icon === ScheduleIcons.DEFAULTS[kind]}
              onChange={() => setPickingSchedule(kind)}
            />
          );
        })}
      </div>

      <div className="card">
        <div className="section-label" style={{ padding: '0 0 6px' }}>Content icons</div>
        <p className="small muted" style={{ margin: 0 }}>The icon for each type of link in Contents. One link can have its own icon and color from its edit screen.</p>
        {CONTENT_KINDS.map((kind) => {
          const icon = ContentIcons.iconFor(kind, contentIcons);
          const color = NEUTRAL_ICON;
          return (
            <IconStyleRow
              key={kind}
              label={contentKindLabel(kind)}
              icon={icon}
              color={color}
              isDefault={icon === ContentIcons.DEFAULTS[kind]}
              onChange={() => setPickingContent(kind)}
            />
          );
        })}
      </div>

      <button className="btn solid big block" disabled={actions.busy || !changed || error !== null} onClick={save}>
        {actions.busy ? <Spinner small /> : 'Save settings'}
      </button>

      {room.ownerUid === state.myUid && <DeleteClassCard room={room} />}

      {pickingSchedule && (
        <IconStylePicker
          title={scheduleKindLabel(pickingSchedule)}
          icon={ScheduleIcons.iconFor(pickingSchedule, scheduleIcons)}
          color={NEUTRAL_ICON}
          defaultIcon={ScheduleIcons.DEFAULTS[pickingSchedule]}
          defaultColor={NEUTRAL_ICON}
          noColor
          onDone={(icon) => {
            setScheduleIcons({ ...scheduleIcons, [pickingSchedule]: icon });
            setPickingSchedule(null);
          }}
          onDismiss={() => setPickingSchedule(null)}
        />
      )}
      {pickingContent && (
        <IconStylePicker
          title={contentKindLabel(pickingContent)}
          icon={ContentIcons.iconFor(pickingContent, contentIcons)}
          color={NEUTRAL_ICON}
          defaultIcon={ContentIcons.DEFAULTS[pickingContent]}
          defaultColor={NEUTRAL_ICON}
          noColor
          onDone={(icon) => {
            setContentIcons({ ...contentIcons, [pickingContent]: icon });
            setPickingContent(null);
          }}
          onDismiss={() => setPickingContent(null)}
        />
      )}
    </div>
  );
}

/** People listed by name before "and N more". */
const SHOWN_UNSETTLED = 5;

/**
 * The Mayor deletes the class for everyone. Allowed only once the books are closed: every balance
 * (former members too) is zero and the class fund is empty, so no money is lost track of.
 */
function DeleteClassCard({ room }: { room: ClassRoom }) {
  const { state, actions } = useClass();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const unsettled = Ledger.unsettled(state.records);
  const cash = Ledger.cashOnHand(state.records);
  const waiting = Ledger.awaitingPayout(state.records);
  const ready = unsettled.length === 0 && cash === 0;
  const others = state.members.length - 1;

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="bold error-text">Delete class</div>
      <p className="small muted" style={{ margin: 0 }}>
        Deletes {room.name} for everyone, with its ledger, schedule, contents, courses and roles. This cannot be undone.
      </p>
      {!ready && (
        <div className="small" role="status">
          <p className="semibold" style={{ margin: 0 }}>You can delete the class once everyone is settled and the class fund is empty.</p>
          <ul className="plain-list">
            {unsettled.slice(0, SHOWN_UNSETTLED).map((p) => (
              <li key={p.memberId}>
                {p.balanceCentavos < 0 ? `${p.name} owes ${formatMoney(-p.balanceCentavos)}` : `${p.name} has ${formatMoney(p.balanceCentavos)} left`}
              </li>
            ))}
            {unsettled.length > SHOWN_UNSETTLED && <li>and {unsettled.length - SHOWN_UNSETTLED} more</li>}
            {waiting > 0 && <li>{formatMoney(waiting)} of charges is waiting to be paid out</li>}
            {/* Balances and charges explain the money in the fund; anything else means the books are off. */}
            {unsettled.length === 0 && waiting === 0 && cash !== 0 && <li>The class fund still shows {formatMoney(cash)}. A record may be missing.</li>}
          </ul>
        </div>
      )}
      <button type="button" className="btn outline danger block" disabled={!ready || actions.busy} onClick={() => (setTyped(''), setConfirming(true))}>
        Delete class
      </button>

      {confirming && (
        <Dialog
          title={`Delete ${room.name}?`}
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button type="button" className="btn text" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn text danger"
                disabled={typed.trim() !== room.name.trim() || actions.busy}
                onClick={() =>
                  actions.deleteClass(() => {
                    setPinned(state.classId, false);
                    navigate('/', { replace: true });
                  })
                }
              >
                {actions.busy ? <Spinner small /> : 'Delete class'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {others > 0
              ? `The class disappears for you and the ${others} other member${others === 1 ? '' : 's'}. Its ledger history, schedule, contents, courses and roles are deleted for good.`
              : 'Its ledger history, schedule, contents, courses and roles are deleted for good.'}
          </p>
          <Field label="Type the class name to confirm">
            <input value={typed} placeholder={room.name} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

/** One type's current icon and color, with "Change". */
function IconStyleRow({ label, icon, color, isDefault, onChange }: { label: string; icon: string; color: string; isDefault: boolean; onChange: () => void }) {
  return (
    <div className="row" style={{ padding: '6px 0' }}>
      <StyledIcon icon={icon} color={color} label={label} />
      <span className="grow">
        <span className="semibold" style={{ display: 'block' }}>{label}</span>
        {isDefault && <span className="small muted">Default</span>}
      </span>
      <button type="button" className="btn text" onClick={onChange}>
        Change
      </button>
    </div>
  );
}

/** A grid of icons and a row of colors for one type. */
export function IconStylePicker({
  title,
  icon,
  color,
  defaultIcon,
  defaultColor,
  onDone,
  onDismiss,
  noColor,
}: {
  title: string;
  icon: string;
  color: string;
  defaultIcon: string;
  defaultColor: string;
  /** Icon only: the color is not the user's to choose here. */
  noColor?: boolean;
  onDone: (icon: string, color: string) => void;
  onDismiss: () => void;
}) {
  const [pickedIcon, setPickedIcon] = useState(icon);
  const [pickedColor, setPickedColor] = useState(color);
  return (
    <Dialog
      title={
        <span className="row">
          <StyledIcon icon={pickedIcon} color={pickedColor} />
          {title}
        </span>
      }
      onClose={onDismiss}
      actions={
        <>
          <button className="btn text" style={{ marginRight: 'auto' }} onClick={() => (setPickedIcon(defaultIcon), setPickedColor(defaultColor))}>
            Use default
          </button>
          <button className="btn text" onClick={onDismiss}>
            Cancel
          </button>
          <button className="btn text" onClick={() => onDone(pickedIcon, pickedColor)}>
            Done
          </button>
        </>
      }
    >
      <span className="small semibold muted">Icon</span>
      <div className="icon-grid" role="radiogroup" aria-label="Icon">
        {IconLibrary.ICONS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === pickedIcon}
            aria-label={key}
            className={'icon-choice' + (key === pickedIcon ? ' selected' : '')}
            onClick={() => setPickedIcon(key)}
          >
            <StyledIcon icon={key} color={pickedColor} size={24} box={34} />
          </button>
        ))}
      </div>
      {!noColor && <span className="small semibold muted">Color</span>}
      {!noColor && <ColorPicker label="Icon color" choices={IconLibrary.COLORS} selected={pickedColor} onSelect={setPickedColor} />}
    </Dialog>
  );
}
