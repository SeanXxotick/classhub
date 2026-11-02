import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_MAYOR, ROLE_MEMBER, ROLE_SECRETARY, ROLE_TREASURER, newMember, newRole, newContentItem, type ContentKind } from '../data/models';
import { DefaultRoles, RoleRules, can } from './permissions';
import { ClassRules, CourseRules, MemberRules } from './classRules';
import { NameRules, initialsOf, personName } from './nameRules';
import { PasswordRules } from './passwordRules';
import { InviteCode } from './inviteCode';
import { JoinLinks } from './joinLinks';
import { ContentRules, type ContentSort } from './contentRules';
import { ContentIcons, IconLibrary, ScheduleIcons } from './iconStyles';
import { ImageMath } from './imageMath';

const CONTRACTION = /\b\w+(n't|'re|'ll|'ve|'m|'d)\b/;

describe('Permissions', () => {
  const roles = new Map(DefaultRoles.all().map((r) => [r.id, r]));
  const role = (id: string) => roles.get(id)!;

  it('default roles and what they allow', () => {
    expect(new Set(roles.keys())).toEqual(new Set([ROLE_MAYOR, ROLE_TREASURER, ROLE_SECRETARY, ROLE_MEMBER]));
    for (const p of PERMISSIONS) expect(can(role(ROLE_MAYOR), p)).toBe(true);
    expect(role(ROLE_MAYOR).locked).toBe(true);
    for (const p of PERMISSIONS) expect(can(role(ROLE_TREASURER), p)).toBe(p === 'RECORDS_MANAGE');
    expect(can(role(ROLE_SECRETARY), 'SCHEDULE_MANAGE')).toBe(true);
    expect(can(role(ROLE_SECRETARY), 'CONTENTS_MANAGE')).toBe(true);
    expect(can(role(ROLE_SECRETARY), 'RECORDS_MANAGE')).toBe(false);
    for (const p of PERMISSIONS) expect(can(role(ROLE_MEMBER), p)).toBe(false);
    for (const p of PERMISSIONS) expect(can(null, p)).toBe(false);
    expect(DefaultRoles.all().filter((r) => r.locked).map((r) => r.id)).toEqual([ROLE_MAYOR]);
  });

  it('an old Mayor role still has newer permissions', () => {
    expect(can(newRole({ id: ROLE_MAYOR, name: 'Mayor', permissions: ['RECORDS_MANAGE'], locked: true }), 'CONTENTS_MANAGE')).toBe(true);
  });

  it('role rules', () => {
    expect(RoleRules.canEdit(role(ROLE_MAYOR))).toBe(false);
    expect(RoleRules.canDelete(role(ROLE_MAYOR), ROLE_MEMBER)).toBe(false);
    expect(RoleRules.canDelete(role(ROLE_MEMBER), ROLE_MEMBER)).toBe(false);
    expect(RoleRules.canDelete(role(ROLE_TREASURER), ROLE_MEMBER)).toBe(true);
    const existing = DefaultRoles.all();
    expect(RoleRules.isNameValid('   ', existing)).toBe(false);
    expect(RoleRules.isNameValid('x'.repeat(25), existing)).toBe(false);
    expect(RoleRules.isNameValid('treasurer', existing)).toBe(false);
    expect(RoleRules.isNameValid('PIO', existing)).toBe(true);
    expect(RoleRules.isNameValid('Treasurer', existing, ROLE_TREASURER)).toBe(true);
    expect(RoleRules.isNameValid('Secretary', existing, ROLE_TREASURER)).toBe(false);
    expect(RoleRules.sanitize(['RECORDS_MANAGE', 'FLY_THE_PLANE', 'RECORDS_MANAGE', 'ROLES_MANAGE'])).toEqual(['RECORDS_MANAGE', 'ROLES_MANAGE']);
  });
});

describe('Class, member and course rules', () => {
  const owner = newMember({ id: 'owner', name: 'Juan', roleId: ROLE_MAYOR });
  const officer = newMember({ id: 'officer', name: 'Maria', roleId: ROLE_TREASURER });
  const student = newMember({ id: 'student', name: 'Lito', roleId: ROLE_MEMBER, excludedCourseIds: ['or'] });

  it('class names', () => {
    expect(ClassRules.checkName('   ')).toBe('Give the class a name.');
    expect(ClassRules.checkName('x'.repeat(41))).toBe('Keep the class name under 40 characters.');
    expect(ClassRules.checkName('  BSM CS 3A  ')).toBeNull();
  });

  it('who can change roles, remove and hand over', () => {
    expect(MemberRules.canChangeRole('officer', owner, 'owner')).toBe(false);
    expect(MemberRules.canChangeRole('owner', owner, 'owner')).toBe(false);
    expect(MemberRules.canChangeRole('officer', officer, 'owner')).toBe(false);
    expect(MemberRules.canChangeRole('owner', student, 'owner')).toBe(true);
    expect(MemberRules.canChangeRole('officer', student, 'owner')).toBe(true);
    expect(MemberRules.mustHandOver('owner', 'owner')).toBe(true);
    expect(MemberRules.mustHandOver('officer', 'owner')).toBe(false);
    expect(MemberRules.mayorCandidates('owner', [owner, officer, student]).map((m) => m.id)).toEqual(['student', 'officer']);
    expect(MemberRules.mayorCandidates('owner', [owner])).toEqual([]);
    expect(MemberRules.canRemove('officer', owner, 'owner')).toBe(false);
    expect(MemberRules.canRemove('student', student, 'owner')).toBe(false);
    expect(MemberRules.canRemove('owner', student, 'owner')).toBe(true);
    expect(MemberRules.assignableRoles(DefaultRoles.all()).map((r) => r.id)).not.toContain(ROLE_MAYOR);
    expect(MemberRules.assignableRoles(DefaultRoles.all()).length).toBe(3);
    expect(MemberRules.holders(DefaultRoles.all().find((r) => r.id === ROLE_TREASURER)!, [owner, officer, student])).toBe(1);
  });

  it('course names and takers', () => {
    const existing = [{ id: 'or', name: 'Operations Research' }];
    expect(CourseRules.isNameValid('  ', existing)).toBe(false);
    expect(CourseRules.isNameValid('x'.repeat(41), existing)).toBe(false);
    expect(CourseRules.isNameValid('operations research', existing)).toBe(false);
    expect(CourseRules.isNameValid('Modern Geometry', existing)).toBe(true);
    expect(CourseRules.isNameValid('Operations Research', existing, 'or')).toBe(true);
    expect(CourseRules.takers({ id: 'or', name: 'OR' }, [owner, officer, student])).toBe(2);
    expect(CourseRules.takers({ id: 'swe', name: 'SWE' }, [owner, officer, student])).toBe(3);
  });
});

describe('NameRules', () => {
  it('display', () => {
    expect(NameRules.display(personName('Juan', 'd', 'Dela Cruz'))).toBe('Juan D. Dela Cruz');
    expect(NameRules.display(personName('  Juan ', '', 'Dela  Cruz'))).toBe('Juan Dela Cruz');
    expect(NameRules.display(personName('Juan', 'dc', 'Santos'))).toBe('Juan D.C. Santos');
  });

  it('split', () => {
    expect(NameRules.split('Maria Clara S. Dela Cruz')).toEqual(personName('Maria Clara', 'S', 'Dela Cruz'));
    expect(NameRules.split('Maria Clara Santos')).toEqual(personName('Maria Clara', '', 'Santos'));
    expect(NameRules.split('juan')).toEqual(personName('juan'));
    expect(NameRules.display(NameRules.split('Jose P. Rizal'))).toBe('Jose P. Rizal');
    expect(NameRules.split('Juan D.C. Santos')).toEqual(personName('Juan', 'DC', 'Santos'));
    expect(NameRules.split('Juan DC. Santos')).toEqual(personName('Juan', 'DC', 'Santos'));
    expect(NameRules.split('Ma. Lhira M. De Leon')).toEqual(personName('Ma. Lhira', 'M', 'De Leon'));
  });

  it('check and clean', () => {
    expect(NameRules.check(personName(' ', '', 'Cruz'))).toBe('Enter your first name.');
    expect(NameRules.check(personName('Juan', '', ''))).toBe('Enter your last name.');
    expect(NameRules.check(personName('Juan', '', 'Cruz'))).toBeNull();
    expect(NameRules.check(personName('Juan', '4', 'Cruz'))).toBe('The middle initial must be letters only.');
    expect(NameRules.cleanInitial('d.c.x')).toBe('DC');
    expect(NameRules.cleaned(personName(' Juan', 'd.', 'Cruz '))).toEqual(personName('Juan', 'D', 'Cruz'));
  });

  it('initials put the year and section first', () => {
    expect(initialsOf('BSM CS 3A-G1')).toBe('3A');
    expect(initialsOf('BSM CS 3A')).toBe('3A');
    expect(initialsOf('BSIT 2-B')).toBe('2B');
    expect(initialsOf('bscs-4c')).toBe('4C');
    expect(initialsOf('BSM 2nd Year')).toBe('BY');
    expect(initialsOf('CS 301')).toBe('301');
    expect(initialsOf('Juan Dela Cruz')).toBe('JC');
    expect(initialsOf('Advanced Calculus I')).toBe('I');
    expect(initialsOf('Physics')).toBe('PH');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('PasswordRules', () => {
  const email = 'jdelacruz2026@school.edu';
  it('checks', () => {
    expect(PasswordRules.check('ClassHub2026', 'ClassHub2026', email)).toBeNull();
    expect(PasswordRules.check('abc123', 'abc123', email)).toBe('Use at least 8 characters.');
    expect(PasswordRules.check('12345678', '12345678', email)).toBe('Include at least one letter, so it is not just numbers.');
    expect(PasswordRules.check('JDelaCruz2026', 'JDelaCruz2026', email)).toBe(
      'Do not use the first part of your email as your password. It is too easy to guess.',
    );
    expect(PasswordRules.strength('ClassHub2026', email)).toBeNull();
    expect(PasswordRules.strength('abc', email)).toBe('Use at least 8 characters.');
    expect(PasswordRules.check('ClassHub2026', 'ClassHub2025', email)).toBe('The two passwords do not match.');
  });
  it('uses no contractions', () => {
    for (const m of [
      PasswordRules.check('a', 'a', email),
      PasswordRules.check('12345678', '12345678', email),
      PasswordRules.check('ClassHub2026', 'x', email),
      PasswordRules.check('jdelacruz2026', 'jdelacruz2026', email),
    ]) expect(CONTRACTION.test(m ?? '')).toBe(false);
  });
});

describe('InviteCode and JoinLinks', () => {
  const seeded = (seed: number) => {
    let s = seed;
    return (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % n;
    };
  };

  it('generates readable valid codes', () => {
    const rnd = seeded(42);
    const all = Array.from({ length: 500 }, () => InviteCode.generate(rnd));
    for (const code of all) expect(InviteCode.isValid(code)).toBe(true);
    for (const c of ['0', 'O', '1', 'I']) expect(all.join('')).not.toContain(c);
    for (let i = 0; i < 50; i++) expect(InviteCode.isValid(InviteCode.generate())).toBe(true);
    expect(InviteCode.generate(seeded(1))).toBe(InviteCode.generate(seeded(1)));
  });

  it('normalizes and validates', () => {
    expect(InviteCode.normalize(' k7m-4qx ')).toBe('K7M4QX');
    expect(InviteCode.normalize('k7m 4qx')).toBe('K7M4QX');
    expect(InviteCode.isValid('K7M4QX')).toBe(true);
    for (const bad of ['K7M4Q', 'K7M4QXX', 'K7M4Q0', 'k7m4qx', '']) expect(InviteCode.isValid(bad)).toBe(false);
  });

  it('reads and builds links', () => {
    expect(JoinLinks.linkFor(' k7m-4qx ')).toBe('https://classhub-975eb.web.app/join/K7M4QX');
    expect(JoinLinks.codeFrom('https://classhub-975eb.web.app/join/K7M4QX')).toBe('K7M4QX');
    expect(JoinLinks.codeFrom('https://classhub-975eb.web.app/join/k7m4qx/')).toBe('K7M4QX');
    expect(JoinLinks.codeFrom('https://CLASSHUB-975EB.web.app/Join/K7M4QX?utm_source=messenger')).toBe('K7M4QX');
    expect(JoinLinks.codeFrom('https://classhub-web.web.app/join/K7M4QX')).toBe('K7M4QX');
    expect(JoinLinks.codeFrom('classhub://join/K7M4QX')).toBe('K7M4QX');
    for (const bad of [
      'https://evil.example.com/join/K7M4QX',
      'https://classhub-975eb.web.app/K7M4QX',
      'https://classhub-975eb.web.app/join/K7M4QX/extra',
      'https://classhub-975eb.web.app/join/K7M4Q0',
      'https://classhub-975eb.web.app/join/',
      'mailto:someone@example.com',
      'not a link',
    ]) expect(JoinLinks.codeFrom(bad)).toBeNull();
    const text = JoinLinks.shareText('BSM CS 3A', 'K7M4QX');
    expect(text).toContain('https://classhub-975eb.web.app/join/K7M4QX');
    expect(text).toContain('enter K7M4QX');
    expect(CONTRACTION.test(text)).toBe(false);
  });
});

describe('ContentRules', () => {
  it('links', () => {
    expect(ContentRules.normalizeUrl('  drive.google.com/file/d/abc ')).toBe('https://drive.google.com/file/d/abc');
    expect(ContentRules.normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(ContentRules.normalizeUrl('   ')).toBe('');
    expect(ContentRules.isValidUrl('https://drive.google.com/file/d/abc/view?usp=sharing')).toBe(true);
    expect(ContentRules.isValidUrl('https://youtu.be/xyz')).toBe(true);
    for (const bad of ['https://localhost', 'ftp://files.example.com/a.pdf', 'javascript:alert(1)', 'https://not a link', 'hello']) {
      expect(ContentRules.isValidUrl(bad)).toBe(false);
    }
    expect(ContentRules.guessKind('https://drive.google.com/file/d/abc/view')).toBe('FILE');
    expect(ContentRules.guessKind('https://docs.google.com/document/d/abc/edit')).toBe('FILE');
    expect(ContentRules.guessKind('https://www.youtube.com/watch?v=abc')).toBe('VIDEO');
    expect(ContentRules.guessKind('https://youtu.be/abc')).toBe('VIDEO');
    expect(ContentRules.guessKind('https://example.com/notes/module1.PDF?dl=1')).toBe('FILE');
    expect(ContentRules.guessKind('https://www.desmos.com/calculator')).toBe('WEBSITE');
  });

  it('check and search', () => {
    expect(ContentRules.check(' ', 'https://drive.google.com/x')).not.toBeNull();
    expect(ContentRules.check('x'.repeat(81), 'https://drive.google.com/x')).not.toBeNull();
    expect(ContentRules.check('Module 1', '')).not.toBeNull();
    expect(ContentRules.check('Module 1', 'not a link')).not.toBeNull();
    expect(ContentRules.check('Module 1', 'drive.google.com/file/d/abc')).toBeNull();
    const item = newContentItem({ title: 'Unit 1 Module 3 - AdCal', note: 'Laplace transform' });
    expect(ContentRules.matches(item, 'module 3')).toBe(true);
    expect(ContentRules.matches(item, 'LAPLACE')).toBe(true);
    expect(ContentRules.matches(item, '  ')).toBe(true);
    expect(ContentRules.matches(item, 'geometry')).toBe(false);
  });

  it('grouping and sorting', () => {
    const courses = [{ id: 'adcal', name: 'Advanced Calculus I' }, { id: 'or', name: 'Operations Research' }, { id: 'mg', name: 'Modern Geometry' }];
    const items = [
      newContentItem({ id: '1', courseId: 'or', title: 'Module 2 notes', createdAtMillis: 20 }),
      newContentItem({ id: '2', courseId: '', title: 'Class calendar', createdAtMillis: 50 }),
      newContentItem({ id: '3', courseId: 'adcal', title: 'Syllabus', createdAtMillis: 5 }),
      newContentItem({ id: '4', courseId: 'or', title: 'Module 10 notes', createdAtMillis: 30 }),
      newContentItem({ id: '5', courseId: 'deleted-course', title: 'Old file', createdAtMillis: 1 }),
      newContentItem({ id: '6', courseId: 'or', title: 'Syllabus', createdAtMillis: 10 }),
    ];
    const groups = ContentRules.grouped(items, courses);
    expect(groups.map(([c]) => c?.id ?? null)).toEqual([null, 'adcal', 'or']);
    expect(groups[0][1].map((i) => i.id)).toEqual(['5', '2']);
    expect(groups[2][1].map((i) => i.id)).toEqual(['6', '1', '4']);
    const tie = [newContentItem({ id: 'b', title: 'Beta', createdAtMillis: 7 }), newContentItem({ id: 'a', title: 'alpha', createdAtMillis: 7 })];
    expect(ContentRules.grouped(tie, [])[0][1].map((i) => i.id)).toEqual(['a', 'b']);
    const titles = ['Module 10', 'module 2', 'Module 1', 'Activity', 'Module 02b', 'Module 2a'];
    expect([...titles].sort(ContentRules.naturalCompare)).toEqual(['Activity', 'Module 1', 'module 2', 'Module 2a', 'Module 02b', 'Module 10']);
    expect(ContentRules.naturalCompare('Syllabus', '  syllabus ')).toBe(0);
    const sample = [
      newContentItem({ id: 'm10', title: 'Module 10', createdAtMillis: 30 }),
      newContentItem({ id: 'm2', title: 'Module 2', createdAtMillis: 10 }),
      newContentItem({ id: 'syl', title: 'Syllabus', createdAtMillis: 20 }),
      newContentItem({ id: 'act', title: 'Activity', createdAtMillis: 20 }),
    ];
    const order = (s: ContentSort) => [...sample].sort(ContentRules.comparator(s)).map((i) => i.id);
    expect(order('OLDEST')).toEqual(['m2', 'act', 'syl', 'm10']);
    expect(order('NEWEST')).toEqual(['m10', 'act', 'syl', 'm2']);
    expect(order('A_Z')).toEqual(['act', 'm2', 'm10', 'syl']);
    expect(order('Z_A')).toEqual(['syl', 'm10', 'm2', 'act']);
    expect(ContentRules.grouped(sample, [], 'NEWEST')[0][1].map((i) => i.id)).toEqual(['m10', 'act', 'syl', 'm2']);
  });

  it('format and source', () => {
    const format = (title: string, url: string, kind: ContentKind = 'FILE') => ContentRules.formatOf({ title, url, kind });
    expect(format('Unit1 Module 1 - Adcal.pdf', 'https://drive.google.com/file/d/abc/view')).toEqual({ label: 'PDF', icon: null });
    expect(format('Lesson 3', 'https://docs.google.com/presentation/d/abc/edit')).toEqual({ label: 'Slides', icon: 'presentation' });
    expect(format('Grades.xlsx', 'https://docs.google.com/spreadsheets/d/abc/edit').label).toBe('Spreadsheet');
    expect(format('Readings', 'https://drive.google.com/drive/folders/abc?usp=sharing')).toEqual({ label: 'Folder', icon: 'folder' });
    expect(format('Discussion 1', 'https://bulsumain.sharepoint.com/:v:/s/Adcal/abc', 'VIDEO')).toEqual({ label: 'Video', icon: 'play' });
    expect(format('Activity files', 'https://bulsumain-my.sharepoint.com/:f:/g/personal/abc', 'WEBSITE').label).toBe('Folder');
    // The first known ending wins, and a version number such as "2.1" is not an ending.
    expect(format('Lab 2.1 notebook.ipynb and data.csv', 'https://drive.google.com/file/d/abc/view')).toEqual({ label: 'Notebook', icon: 'code' });
    expect(format('Notes', 'https://example.com/files/notes.PDF?dl=1').label).toBe('PDF');
    expect(format('Module 2.1', 'https://drive.google.com/file/d/abc/view')).toEqual({ label: 'File', icon: null });
    expect(format('Desmos', 'https://www.desmos.com/calculator', 'WEBSITE').label).toBe('Website');
    expect(ContentRules.sourceOf('https://docs.google.com/document/d/abc')).toBe('Google Drive');
    expect(ContentRules.sourceOf('https://bulsumain-my.sharepoint.com/:v:/g/personal/abc')).toBe('OneDrive');
    expect(ContentRules.sourceOf('https://bulsumain.sharepoint.com/:v:/s/Adcal/abc')).toBe('SharePoint');
    expect(ContentRules.sourceOf('https://youtu.be/abc')).toBe('YouTube');
    expect(ContentRules.sourceOf('https://www.desmos.com/calculator')).toBe('desmos.com');
    expect(ContentRules.sourceOf('not a link')).toBe('');
  });
});

describe('Icon styles', () => {
  it('defaults, choices and sanitizing', () => {
    expect(ScheduleIcons.iconFor('DEADLINE', {})).toBe('document');
    expect(ScheduleIcons.iconFor('FCO', {})).toBe('flag');
    expect(ScheduleIcons.colorFor('EXAM', {})).toBe('#B91C1C');
    expect(ContentIcons.iconFor('VIDEO', {})).toBe('play');
    expect(ContentIcons.colorFor('VIDEO', {})).toBe('#DC2626');
    expect(ScheduleIcons.iconFor('QUIZ', { QUIZ: 'calculator' })).toBe('calculator');
    expect(ScheduleIcons.iconFor('EXAM', { QUIZ: 'calculator' })).toBe('clipboard');
    expect(ScheduleIcons.iconFor('FCO', { FCO: 'rocket' })).toBe('flag');
    expect(ScheduleIcons.colorFor('FCO', { FCO: '#123456' })).toBe('#7C3AED');
    expect(ScheduleIcons.sanitize({ QUIZ: 'calculator', EXAM: 'clipboard', HOMEWORK: 'book', FCO: 'rocket', RECITATION: 'chat' })).toEqual({
      QUIZ: 'calculator',
      RECITATION: 'chat',
    });
    expect(ScheduleIcons.sanitizeColors({ QUIZ: '#15803D', EXAM: '#B91C1C', FCO: '#000000' })).toEqual({ QUIZ: '#15803D' });
    expect(ContentIcons.sanitize({ FILE: 'link', VIDEO: 'play', QUIZ: 'star' })).toEqual({ FILE: 'link' });
    expect(new Set(IconLibrary.ICONS).size).toBe(IconLibrary.ICONS.length);
    expect(new Set(IconLibrary.COLORS).size).toBe(IconLibrary.COLORS.length);
  });
});

describe('ImageMath', () => {
  it('crops and samples', () => {
    expect(ImageMath.centerSquare(3840, 3000)).toEqual({ left: 420, top: 0, size: 3000 });
    expect(ImageMath.centerSquare(1080, 2080)).toEqual({ left: 0, top: 500, size: 1080 });
    expect(ImageMath.centerSquare(512, 512)).toEqual({ left: 0, top: 0, size: 512 });
    expect(ImageMath.sampleSize(4000, 3000)).toBe(8);
    expect(ImageMath.sampleSize(300, 300)).toBe(1);
    expect(ImageMath.sampleSize(1024, 512)).toBe(2);
    expect(() => ImageMath.centerSquare(0, 100)).toThrow();
  });
});
