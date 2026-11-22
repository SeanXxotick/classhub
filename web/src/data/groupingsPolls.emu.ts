/*
 * Groupings, shared groupings, anonymous polls and the semester rollover on the Firestore emulator, with the
 * real firestore.rules. Every operation runs as a signed-in user through the app's own data functions.
 * Run: npm run test:emu (from web/). Invented names only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { collection, collectionGroup, connectFirestoreEmulator, doc, getDoc, getDocs, initializeFirestore, query, setDoc, where, type Firestore } from 'firebase/firestore';
import { decodeGroups, type Grouping } from '../domain/groupingLogic';
import { createClass, deleteClass } from './classes';
import { resetDataEnv, setDataEnv } from './dataEnv';
import {
  addGuestTeammate,
  approveJoinRequest,
  createGrouping,
  deleteGrouping,
  joinGroup,
  leaveGroup,
  linkSharedGrouping,
  requestJoinGroup,
  setGroupingLocked,
  syncSharedRoster,
  unlinkSharedGrouping,
  updateGroupingMeta,
} from './groupings';
import { newMember, newRole, type ClassRoom, type Member, type Role } from './models';
import { newPartnerClass } from './partners';
import { castPollVote, createPoll, deletePoll, newPoll, type Poll } from './polls';
import { rolloverClass } from './rollover';

const PROJECT = process.env.EMU_PROJECT || 'demo-classhub';
const HOST = '127.0.0.1';
const PORT = 8080;

const apps: FirebaseApp[] = [];
const dbs = new Map<string, Firestore>();

function connect(name: string, token: string | { sub: string; user_id: string }): Firestore {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `emu-gp-${name}-${apps.length}`);
  apps.push(app);
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, HOST, PORT, { mockUserToken: token });
  return db;
}

function as(uid: string): Firestore {
  if (!dbs.has(uid)) dbs.set(uid, connect(uid, { sub: uid, user_id: uid }));
  return dbs.get(uid)!;
}

let adminDb: Firestore;
let counter = 0;

beforeAll(async () => {
  const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');
  const put = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT', body: JSON.stringify({ rules: { files: [{ content: rules }] } }),
  });
  expect(put.ok).toBe(true);
  const cleared = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(cleared.ok).toBe(true);
  adminDb = connect('admin', 'owner');
  setDataEnv({ newId: () => `gp${String(++counter).padStart(5, '0')}` });
});

afterAll(async () => {
  resetDataEnv();
  await Promise.all(apps.map((a) => deleteApp(a)));
});

const MAYOR = { uid: 'gpMayor', name: 'Rina Castro' };
const ANA = { uid: 'gpAna', name: 'Ana Reyes' };
const BEN = { uid: 'gpBen', name: 'Ben Cruz' };
const PARTNER = { uid: 'gpPartner', name: 'Joel Tan' };
const PARTNER_STU = { uid: 'gpPam', name: 'Pam Uy' };
const THIRD = { uid: 'gpThird', name: 'Mia Lim' };

/** A class made through the app, with members added directly (rules off). */
async function classWith(mayor: { uid: string; name: string }, name: string, members: { uid: string; name: string }[]): Promise<string> {
  const { classId } = await createClass(as(mayor.uid), mayor, { name, description: '' });
  for (const m of members) {
    await setDoc(doc(adminDb, 'classes', classId, 'members', m.uid), { uid: m.uid, name: m.name, roleId: 'member', joinedAtMillis: Date.now(), excludedCourseIds: [], approvedByUid: mayor.uid });
  }
  return classId;
}

async function stored(path: string[]): Promise<Grouping> {
  const snap = await getDoc(doc(adminDb, path[0], ...path.slice(1)));
  return { ...(snap.data() as Grouping), id: snap.id, groups: decodeGroups(snap.data() as Record<string, unknown>) };
}

let classId = '';

describe('groupings', () => {
  it('students join, add a guest and leave; a locked grouping stops them', async () => {
    classId = await classWith(MAYOR, 'BSIT 3C', [ANA, BEN]);
    const { id } = await createGrouping(as(MAYOR.uid), MAYOR.uid, classId, { title: 'Lab groups', courseId: '', note: '', groupCount: 2, defaultMaxSize: 3, selfJoin: true });
    const path = ['classes', classId, 'groupings', id];
    let g = await stored(path);
    const [g1, g2] = g.groups.map((s) => s.id);
    await joinGroup(as(ANA.uid), classId, id, ANA.uid, g1);
    await joinGroup(as(BEN.uid), classId, id, BEN.uid, g1);
    await addGuestTeammate(as(ANA.uid), classId, id, g1, ANA.uid, 'Irregular Student', 'G2');
    await joinGroup(as(BEN.uid), classId, id, BEN.uid, g2);
    g = await stored(path);
    expect(g.groups[0].memberUids).toEqual([ANA.uid]);
    expect(g.groups[0].leaderUid).toBe(ANA.uid);
    expect(g.groups[0].guests.map((x) => x.name)).toEqual(['Irregular Student']);
    expect(g.groups[1].memberUids).toEqual([BEN.uid]);
    await setGroupingLocked(as(MAYOR.uid), MAYOR.uid, classId, g, true);
    await expect(leaveGroup(as(BEN.uid), classId, id, BEN.uid)).rejects.toBeTruthy();
    await setGroupingLocked(as(MAYOR.uid), MAYOR.uid, classId, g, false);
    await leaveGroup(as(BEN.uid), classId, id, BEN.uid);
    expect((await stored(path)).groups[1].memberUids).toEqual([]);
  });

  it('with leaders on, a student asks and the leader approves', async () => {
    const { id } = await createGrouping(as(MAYOR.uid), MAYOR.uid, classId, { title: 'Thesis', courseId: '', note: '', groupCount: 2, defaultMaxSize: 3, selfJoin: true, hasLeader: true });
    const path = ['classes', classId, 'groupings', id];
    const g1 = (await stored(path)).groups[0].id;
    await joinGroup(as(ANA.uid), classId, id, ANA.uid, g1);
    await expect(joinGroup(as(BEN.uid), classId, id, BEN.uid, g1)).rejects.toBeTruthy();
    await requestJoinGroup(as(BEN.uid), classId, id, g1, BEN.uid, BEN.name, '');
    await approveJoinRequest(as(ANA.uid), classId, id, g1, ANA.uid, BEN.uid);
    const g = await stored(path);
    expect(g.groups[0].memberUids).toEqual([ANA.uid, BEN.uid]);
    expect(g.groups[0].joinRequests ?? []).toEqual([]);
  });

  it('a partner class links a shared grouping by its code, and its students join', async () => {
    const { id, shareCode } = await createGrouping(as(MAYOR.uid), MAYOR.uid, classId, {
      title: 'Joint project', courseId: '', note: '', groupCount: 2, defaultMaxSize: 4, selfJoin: true, shared: true, className: 'BSIT 3C', sectionTag: 'G1',
    });
    expect(shareCode).toMatch(/^GRP-[A-Z2-9]{8}$/);
    const partnerClass = await classWith(PARTNER, 'BSIT 3D', [PARTNER_STU]);
    await linkSharedGrouping(as(PARTNER.uid), PARTNER.uid, partnerClass, 'BSIT 3D', shareCode!.toLowerCase(), 'G2', '');
    const g = await stored(['sharedGroupings', id]);
    expect(g.linkedClassIds).toEqual([classId, partnerClass]);
    expect(g.linkedClasses?.[classId]?.name).toBe('BSIT 3C');
    await joinGroup(as(PARTNER_STU.uid), partnerClass, id, PARTNER_STU.uid, g.groups[1].id, false, true, { name: PARTNER_STU.name, classId: partnerClass, tag: 'G2' });
    const after = await stored(['sharedGroupings', id]);
    expect(after.groups[1].memberUids).toEqual([PARTNER_STU.uid]);
    expect(after.groups[1].memberMeta?.[PARTNER_STU.uid]?.tag).toBe('G2');
    await expect(linkSharedGrouping(as(PARTNER.uid), PARTNER.uid, partnerClass, 'BSIT 3D', shareCode!, 'G2', '')).rejects.toBeTruthy();
  });

  it('unlinking a class stops it from sending this class notices and polls', async () => {
    const { id, shareCode } = await createGrouping(as(MAYOR.uid), MAYOR.uid, classId, {
      title: 'Debate teams', courseId: '', note: '', groupCount: 2, defaultMaxSize: 3, selfJoin: true, shared: true, className: 'BSIT 3C', sectionTag: 'G1',
    });
    const STRANGER = { uid: 'gpStranger', name: 'Ivan Go' };
    const other = await classWith(STRANGER, 'BSIT 3F', []);
    await linkSharedGrouping(as(STRANGER.uid), STRANGER.uid, other, 'BSIT 3F', shareCode!, 'G4', '');
    const trusted = () => getDoc(doc(adminDb, 'classes', classId, 'partners', other)).then((d) => d.exists());
    expect(await trusted()).toBe(true);
    const notice = () =>
      setDoc(doc(as(STRANGER.uid), 'classes', classId, 'outbox', `n${Date.now()}`), {
        kind: 'ANNOUNCEMENT', audience: 'CLASS', audienceId: '', title: 'Fund due today', body: '', createdByUid: STRANGER.uid, createdAtMillis: Date.now(), fromClassId: other,
      });
    await notice();

    await unlinkSharedGrouping(as(MAYOR.uid), MAYOR.uid, classId, { ...(await stored(['sharedGroupings', id])), id, shared: true }, other);
    expect(await trusted()).toBe(false);
    await expect(notice()).rejects.toBeTruthy();
    expect((await stored(['sharedGroupings', id])).linkedClassIds).toEqual([classId]);

    // The same when the host deletes a shared grouping a class is still linked to.
    const second = await createGrouping(as(MAYOR.uid), MAYOR.uid, classId, {
      title: 'Debate teams 2', courseId: '', note: '', groupCount: 1, defaultMaxSize: 3, selfJoin: true, shared: true, className: 'BSIT 3C', sectionTag: 'G1',
    });
    await linkSharedGrouping(as(STRANGER.uid), STRANGER.uid, other, 'BSIT 3F', second.shareCode!, 'G4', '');
    expect(await trusted()).toBe(true);
    await deleteGrouping(as(MAYOR.uid), MAYOR.uid, classId, { ...(await stored(['sharedGroupings', second.id])), id: second.id, shared: true });
    expect(await trusted()).toBe(false);
  });

  it('an officer saving from an older copy keeps a class that linked in the meantime', async () => {
    const { id, shareCode } = await createGrouping(as(MAYOR.uid), MAYOR.uid, classId, {
      title: 'Lab pairs', courseId: '', note: '', groupCount: 2, defaultMaxSize: 2, selfJoin: true, shared: true, className: 'BSIT 3C', sectionTag: 'G1',
    });
    // The host's screen still shows the grouping as it was before the partner linked.
    const stale = { ...(await stored(['sharedGroupings', id])), shared: true };
    const third = await classWith(THIRD, 'BSIT 3E', []);
    await linkSharedGrouping(as(THIRD.uid), THIRD.uid, third, 'BSIT 3E', shareCode!, 'G3', '');
    await updateGroupingMeta(as(MAYOR.uid), MAYOR.uid, classId, stale, { title: 'Lab pairs (final)', courseId: '', note: '', selfJoin: true, hasLeader: false });
    await syncSharedRoster(as(MAYOR.uid), classId, stale, [{ uid: MAYOR.uid, name: 'Castro, Rina' }], '#0F766E');
    const g = await stored(['sharedGroupings', id]);
    expect(g.title).toBe('Lab pairs (final)');
    expect(Object.keys(g.linkedClasses ?? {}).sort()).toEqual([classId, third].sort());
    expect(g.linkedClasses?.[third]).toMatchObject({ name: 'BSIT 3E', tag: 'G3' });
    expect(g.linkedClasses?.[classId]).toMatchObject({ name: 'BSIT 3C', roster: [{ uid: MAYOR.uid, name: 'Castro, Rina' }], accentColor: '#0F766E' });
  });
});

describe('anonymous polls', () => {
  it('keeps counts on the poll while each ballot stays private', async () => {
    const pollId = await createPoll(as(MAYOR.uid), MAYOR.uid, classId, { question: 'Review day?', options: ['Mon', 'Tue', 'Wed'], courseId: '', multi: false, maxChoices: 1, anonymous: true, closesAtMillis: 0 });
    const poll = async () => newPoll({ ...((await getDoc(doc(adminDb, 'classes', classId, 'polls', pollId))).data() as Partial<Poll>), id: pollId });
    await castPollVote(as(ANA.uid), classId, await poll(), ANA.uid, [1]);
    await castPollVote(as(BEN.uid), classId, await poll(), BEN.uid, [1]);
    await castPollVote(as(BEN.uid), classId, await poll(), BEN.uid, [2]);
    let p = await poll();
    expect([p.tally['0'] ?? 0, p.tally['1'] ?? 0, p.tally['2'] ?? 0, p.voters]).toEqual([0, 1, 1, 2]);
    await castPollVote(as(ANA.uid), classId, await poll(), ANA.uid, []);
    p = await poll();
    expect([p.tally['1'] ?? 0, p.voters]).toEqual([0, 1]);
    await expect(getDoc(doc(as(ANA.uid), 'classes', classId, 'pollBallots', `${pollId}_${BEN.uid}`))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDocs(collection(adminDb, 'classes', classId, 'pollVotes'))).size).toBe(0);
  });
});

describe('shared polls', () => {
  it('the host deletes a shared poll, also after a partner class was deleted', async () => {
    const HOSTM = { uid: 'gpHostM', name: 'Lara Dizon' };
    const PARTM = { uid: 'gpPartM', name: 'Joel Tan' };
    const host = await classWith(HOSTM, 'BSM CS 3A-G1', []);
    const { shareCode } = await createGrouping(as(HOSTM.uid), HOSTM.uid, host, {
      title: 'Thesis', courseId: '', note: '', groupCount: 1, defaultMaxSize: 3, selfJoin: true, shared: true, className: 'BSM CS 3A-G1', sectionTag: 'G1',
    });
    const partner = await classWith(PARTM, 'BSM CS 3A (G2)', []);
    await linkSharedGrouping(as(PARTM.uid), PARTM.uid, partner, 'BSM CS 3A (G2)', shareCode!, 'G2', '');
    const sharedPoll = async (question: string) => {
      const id = await createPoll(as(HOSTM.uid), HOSTM.uid, host, {
        question, options: ['Monday', 'Friday'], courseId: '', multi: false, maxChoices: 1, anonymous: false, closesAtMillis: 0,
        notifyOwnClass: false, notifyPartners: false, hostClassName: 'BSM CS 3A-G1', hostTag: 'G1',
        partnerClasses: [newPartnerClass({ partnerClassId: partner, name: 'BSM CS 3A (G2)', tag: 'G2' })],
      });
      const poll = newPoll({ ...((await getDoc(doc(adminDb, 'sharedPolls', id))).data() as Partial<Poll>), id, shared: true });
      await castPollVote(as(HOSTM.uid), host, poll, HOSTM.uid, [1], { name: 'Dizon, Lara', tag: 'G1' });
      return poll;
    };
    const exists = (...path: string[]) => getDoc(doc(adminDb, path[0], ...path.slice(1))).then((d) => d.exists());

    const first = await sharedPoll('Defense day?');
    expect(await exists('classes', partner, 'sharedPollLinks', first.id)).toBe(true);
    await deletePoll(as(HOSTM.uid), HOSTM.uid, host, first);
    expect(await exists('sharedPolls', first.id)).toBe(false);
    expect(await exists('classes', host, 'sharedPollLinks', first.id)).toBe(false);
    expect(await exists('classes', partner, 'sharedPollLinks', first.id)).toBe(false);

    const second = await sharedPoll('Venue?');
    await deleteClass(as(PARTM.uid), PARTM.uid, partner);
    await deletePoll(as(HOSTM.uid), HOSTM.uid, host, second);
    expect(await exists('sharedPolls', second.id)).toBe(false);
    expect(await exists('classes', host, 'sharedPollLinks', second.id)).toBe(false);
  });
});

describe('semester rollover', () => {
  it('copies the members of the class into a new one', async () => {
    const room = (await getDoc(doc(adminDb, 'classes', classId))).data() as ClassRoom;
    const roles = (await getDocs(collection(adminDb, 'classes', classId, 'roles'))).docs.map((d) => newRole({ ...(d.data() as Partial<Role>), id: d.id }));
    const members = (await getDocs(collection(adminDb, 'classes', classId, 'members'))).docs.map((d) => newMember({ ...(d.data() as Partial<Member>), id: d.id }));
    const result = await rolloverClass(as(MAYOR.uid), MAYOR.uid, { room: { ...room, id: classId }, roles, members, balances: new Map() }, { name: 'BSIT 4C', description: '', carryBalances: true, carryPaymentSettings: true });
    const copied = await getDocs(collection(adminDb, 'classes', result.classId, 'members'));
    expect(copied.docs.map((d) => d.id).sort()).toEqual([ANA.uid, BEN.uid, MAYOR.uid].sort());
  });

  it('removes the half-made class when copying the members fails', async () => {
    const room = (await getDoc(doc(adminDb, 'classes', classId))).data() as ClassRoom;
    const roles = (await getDocs(collection(adminDb, 'classes', classId, 'roles'))).docs.map((d) => newRole({ ...(d.data() as Partial<Role>), id: d.id }));
    const members = (await getDocs(collection(adminDb, 'classes', classId, 'members'))).docs.map((d) => newMember({ ...(d.data() as Partial<Member>), id: d.id }));
    // Someone who is not in the old class: the rules refuse to copy them, partway through the rollover.
    const outsider = newMember({ id: 'gpOutsider', uid: 'gpOutsider', name: 'Out Sider', roleId: 'member' });
    const traces = async () => [
      (await getDocs(query(collectionGroup(adminDb, 'members'), where('uid', '==', MAYOR.uid)))).size,
      (await getDocs(query(collectionGroup(adminDb, 'members'), where('uid', '==', ANA.uid)))).size,
      (await getDocs(collectionGroup(adminDb, 'rollover'))).size,
      (await getDocs(collectionGroup(adminDb, 'roles'))).size,
      (await getDocs(collectionGroup(adminDb, 'records'))).size,
    ];
    const before = await traces();
    await expect(
      rolloverClass(as(MAYOR.uid), MAYOR.uid, { room: { ...room, id: classId }, roles, members: [...members, outsider], balances: new Map([[ANA.uid, 5000]]) }, { name: 'BSIT 9Z', description: '', carryBalances: true, carryPaymentSettings: true }),
    ).rejects.toBeTruthy();
    const left = await getDocs(query(collection(adminDb, 'classes'), where('name', '==', 'BSIT 9Z')));
    expect(left.size).toBe(0);
    const invites = await getDocs(query(collection(adminDb, 'invites'), where('className', '==', 'BSIT 9Z')));
    expect(invites.size).toBe(0);
    expect(await traces()).toEqual(before);
  });
});
