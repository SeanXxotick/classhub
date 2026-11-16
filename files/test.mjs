// Tests for the files Worker, run locally against the Firebase emulators (never the live project):
//   1. emulators running and seeded (web/scripts/seed-emulator.ts)
//   2. npx wrangler dev --env dev --port 8787   (in files/)
//   3. node test.mjs
// It deletes the seeded test class's document at the end (clean-up test): reseed afterwards.

const W = 'http://127.0.0.1:8787';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-classhub/databases/(default)/documents';
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const APP = 'http://127.0.0.1:5173';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
function expect(actual, wanted, what) {
  if (actual !== wanted) throw new Error(`${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);
}

async function signIn(email, password = 'classhub123') {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const b = await r.json();
  if (!b.idToken) throw new Error(`sign-in ${email}: ${JSON.stringify(b)}`);
  return b.idToken;
}
async function signUp(email) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'classhub123', returnSecureToken: true }) });
  return (await r.json()).idToken;
}

const pdf = (size = 2000) => {
  const b = new Uint8Array(size).fill(0x20);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
  return b;
};
const up = (token, classId, name, body, origin = APP) =>
  fetch(`${W}/classes/${classId}/files`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream', Origin: origin },
    body,
  });
const get = (token, path, method = 'GET') => fetch(`${W}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: APP } });

const mayor = await signIn('mayor@test.com');
const student = await signIn('student@test.com');
const outsider = (await signUp(`outsider${Date.now()}@test.com`)) ?? '';
const classes = (await (await fetch(`${FS}/classes?pageSize=50`, { headers: ADMIN })).json()).documents ?? [];
const room = classes.find((d) => d.fields?.name?.stringValue === 'BSM CS 3A (Test)');
if (!room) throw new Error('Seed the emulator first.');
const classId = room.name.split('/').pop();
let uploaded;

await test('no sign-in is refused', async () => {
  expect((await up('', classId, 'a.pdf', pdf())).status, 401, 'status');
});
await test('a tampered sign-in is refused', async () => {
  const [h, p] = mayor.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, aud: 'another-project' })).toString('base64url')}.`;
  expect((await up(forged, classId, 'a.pdf', pdf())).status, 401, 'status');
});
await test('someone outside the class cannot upload or see usage', async () => {
  expect((await up(outsider, classId, 'a.pdf', pdf())).status, 403, 'upload');
  expect((await get(outsider, `/classes/${classId}/usage`)).status, 403, 'usage');
});
await test('a student without "Manage contents" cannot upload', async () => {
  const r = await up(student, classId, 'a.pdf', pdf());
  expect(r.status, 403, 'status');
  expect((await r.json()).error, 'NOT_ALLOWED', 'code');
});
await test('the Mayor uploads a PDF', async () => {
  const r = await up(mayor, classId, 'Week 1 Handout.pdf', pdf(5000));
  expect(r.status, 201, 'status');
  uploaded = await r.json();
  expect(uploaded.name, 'Week 1 Handout.pdf', 'name');
  expect(uploaded.sizeBytes, 5000, 'size');
  expect(uploaded.mimeType, 'application/pdf', 'type');
  expect(r.headers.get('access-control-allow-origin'), APP, 'CORS');
});
await test('a student in the class downloads it, unchanged and locked down', async () => {
  const r = await get(student, `/classes/${classId}/files/${uploaded.key}`);
  expect(r.status, 200, 'status');
  expect(r.headers.get('content-type'), 'application/pdf', 'type');
  expect(r.headers.get('content-security-policy')?.startsWith('sandbox'), true, 'sandbox');
  expect(r.headers.get('content-disposition'), "inline; filename*=UTF-8''Week%201%20Handout.pdf", 'name');
  const bytes = new Uint8Array(await r.arrayBuffer());
  expect(bytes.length, 5000, 'length');
  expect(bytes[0], 0x25, 'first byte');
});
await test('someone outside the class cannot download it', async () => {
  expect((await get(outsider, `/classes/${classId}/files/${uploaded.key}`)).status, 403, 'status');
});
await test('usage counts the upload', async () => {
  const r = await (await get(student, `/classes/${classId}/usage`)).json();
  expect(r.usedBytes, 5000, 'used');
  expect(r.limitBytes, 26214400, 'limit (dev)');
});
await test('a web page renamed to .pdf is refused', async () => {
  const r = await up(mayor, classId, 'notes.pdf', new TextEncoder().encode('<html><script>alert(1)</script></html>'));
  expect(r.status, 415, 'status');
});
await test('other file types are refused', async () => {
  expect((await up(mayor, classId, 'setup.exe', pdf())).status, 415, '.exe');
  expect((await up(mayor, classId, 'page.html', pdf())).status, 415, '.html');
  expect((await up(mayor, classId, 'no-extension', pdf())).status, 415, 'none');
});
await test('every allowed type with its real first bytes is accepted', async () => {
  const zip = [0x50, 0x4b, 0x03, 0x04];
  const ole = [0xd0, 0xcf, 0x11, 0xe0];
  const cases = { 'a.png': [0x89, 0x50, 0x4e, 0x47], 'a.JPG': [0xff, 0xd8, 0xff, 0xe0], 'a.gif': [0x47, 0x49, 0x46, 0x38], 'a.docx': zip, 'a.pptx': zip, 'a.xlsx': zip, 'a.doc': ole, 'a.ppt': ole, 'a.xls': ole };
  for (const [name, head] of Object.entries(cases)) {
    const b = new Uint8Array(100);
    b.set(head);
    const r = await up(mayor, classId, name, b);
    expect(r.status, 201, name);
    await get(mayor, `/classes/${classId}/files/${(await r.json()).key}`, 'DELETE');
  }
  const webp = new Uint8Array(100);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const r = await up(mayor, classId, 'a.webp', webp);
  expect(r.status, 201, 'webp');
  await get(mayor, `/classes/${classId}/files/${(await r.json()).key}`, 'DELETE');
});
await test('a file over 10 MB is refused', async () => {
  const r = await up(mayor, classId, 'big.pdf', pdf(10 * 1024 * 1024 + 1));
  expect(r.status, 413, 'status');
});
await test('a file of exactly 10 MB is accepted', async () => {
  const r = await up(mayor, classId, 'ten.pdf', pdf(10 * 1024 * 1024));
  expect(r.status, 201, 'status');
});
await test('the class limit is enforced (25 MB in dev)', async () => {
  expect((await up(mayor, classId, 'nine.pdf', pdf(9 * 1024 * 1024))).status, 201, 'second file');
  const r = await up(mayor, classId, 'more.pdf', pdf(9 * 1024 * 1024));
  expect(r.status, 507, 'third file');
  expect((await r.json()).error, 'CLASS_FULL', 'code');
});
await test('a student cannot delete; the Mayor can, and then it is gone', async () => {
  expect((await get(student, `/classes/${classId}/files/${uploaded.key}`, 'DELETE')).status, 403, 'student');
  expect((await get(mayor, `/classes/${classId}/files/${uploaded.key}`, 'DELETE')).status, 200, 'mayor');
  expect((await get(student, `/classes/${classId}/files/${uploaded.key}`)).status, 404, 'after');
});
await test('another site cannot call it from a browser', async () => {
  const pre = await fetch(`${W}/classes/${classId}/files`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  expect(pre.status, 403, 'preflight');
  const ok = await fetch(`${W}/classes/${classId}/files`, { method: 'OPTIONS', headers: { Origin: APP, 'Access-Control-Request-Method': 'POST' } });
  expect(ok.status, 204, 'own site');
});
await test('clean-up keeps files a content item uses and removes the rest', async () => {
  const kept = await (await up(mayor, classId, 'kept.pdf', pdf())).json();
  const loose = await (await up(mayor, classId, 'loose.pdf', pdf())).json();
  const content = { fields: { title: { stringValue: 'Handout' }, file: { mapValue: { fields: { key: { stringValue: kept.key } } } } } };
  await fetch(`${FS}/classes/${classId}/contents/files-test`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify(content) });
  await fetch(`${W}/__sweep`, { method: 'POST' });
  expect((await get(mayor, `/classes/${classId}/files/${kept.key}`)).status, 200, 'kept');
  expect((await get(mayor, `/classes/${classId}/files/${loose.key}`)).status, 404, 'loose');
});
await test('clean-up removes every file of a deleted class', async () => {
  const before = await (await get(mayor, `/classes/${classId}/usage`)).json();
  if (!(before.usedBytes > 0)) throw new Error('expected files before');
  await fetch(`${FS}/classes/${classId}`, { method: 'DELETE', headers: ADMIN });
  const swept = await (await fetch(`${W}/__sweep`, { method: 'POST' })).json();
  if (!(swept.removed >= 1)) throw new Error(`removed ${swept.removed}`);
  // The class document is gone, so ask the bucket through a second sweep: nothing is left to remove.
  expect((await (await fetch(`${W}/__sweep`, { method: 'POST' })).json()).removed, 0, 'second sweep');
});

console.log(`\n${passed} passed, ${failed} failed. Reseed the emulator now (the test class was deleted).`);
process.exit(failed ? 1 : 0);
