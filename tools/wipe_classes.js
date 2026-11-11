// 2.0 go-live: deletes every class and everything inside it, so version 2 starts clean.
// Deleted: classes/** (all subcollections), invites/*, classPhotos/*, users/*/memberships/* (version 1 only).
// Kept: users/* (names), avatars/*, appConfig/*, devices/*, clientErrors/* and every sign-in account.
// Uses the Firebase CLI login (run `firebase login` once). Shows what it would delete unless --apply is given.
// THIS CANNOT BE UNDONE. The project lead runs it, nobody else.
//
// Usage:
//   node tools/wipe_classes.js <firebase-tools dir> <project id> [--apply]
// Example:
//   node tools/wipe_classes.js "$(npm root -g)/firebase-tools" classhub-975eb
//
// For a trial on the local emulator set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 (no login is used then).
const path = require('path');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [toolsDir, projectId] = args.filter((a) => a !== '--apply');

if (!toolsDir || !projectId) {
  console.error('Usage: node tools/wipe_classes.js <firebase-tools dir> <project id> [--apply]');
  process.exit(1);
}

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const root = `projects/${projectId}/databases/(default)/documents`;
const base = `${emulator ? `http://${emulator}` : 'https://firestore.googleapis.com'}/v1/`;
let token = 'owner';

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(emulator ? {} : { 'x-goog-user-project': projectId }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status}): ${JSON.stringify(json.error || json)}`);
  return json;
}

/** Every document in a collection, including "missing" ones that only exist as a parent of subcollections. */
async function listDocs(parent, collectionId, field) {
  const docs = [];
  let pageToken = '';
  do {
    const query = `pageSize=300&showMissing=true&mask.fieldPaths=${field}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const page = await call('GET', `${parent}/${collectionId}?${query}`);
    docs.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function subcollections(docName) {
  const ids = [];
  let pageToken = '';
  do {
    const page = await call('POST', `${docName}:listCollectionIds`, { pageSize: 100, pageToken });
    ids.push(...(page.collectionIds || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return ids;
}

const toDelete = [];
const counts = {};
const count = (key) => (counts[key] = (counts[key] || 0) + 1);

/** Adds a document and everything under it, children first. */
async function collect(doc, label) {
  for (const id of await subcollections(doc.name)) {
    for (const child of await listDocs(doc.name, id, '_')) await collect(child, `${label}/${id}`);
  }
  if (doc.createTime) {
    toDelete.push(doc.name);
    count(label);
  }
}

(async () => {
  if (!emulator) {
    const auth = require(path.join(toolsDir, 'lib', 'auth.js'));
    const scopes = require(path.join(toolsDir, 'lib', 'scopes.js'));
    const account = auth.getGlobalDefaultAccount();
    token = (await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM])).access_token;
  }
  console.log(`${apply ? 'DELETING from' : 'Dry run on'} ${projectId}${emulator ? ` (emulator at ${emulator})` : ' (THE LIVE PROJECT)'}\n`);

  const classes = await listDocs(root, 'classes', 'name');
  console.log(`Classes (${classes.length}):`);
  for (const c of classes) {
    console.log(`  ${c.name.split('/').pop()}  ${c.fields?.name?.stringValue ?? '(no class document, only leftovers)'}`);
    await collect(c, 'classes');
  }
  for (const top of ['invites', 'classPhotos']) {
    for (const d of await listDocs(root, top, '_')) await collect(d, top);
  }
  const users = await listDocs(root, 'users', '_');
  for (const u of users) {
    for (const m of await listDocs(u.name, 'memberships', '_')) await collect(m, 'users/memberships');
  }

  console.log('\nDocuments to delete:');
  for (const key of Object.keys(counts).sort()) console.log(`  ${String(counts[key]).padStart(6)}  ${key}`);
  console.log(`  ${String(toDelete.length).padStart(6)}  in total`);
  console.log(`Kept: ${users.length} user profiles, every sign-in account, avatars, appConfig, devices.`);

  if (!apply) return console.log('\nNothing deleted. Add --apply to delete. This cannot be undone.');

  let done = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const names = toDelete.slice(i, i + 200);
    const result = await call('POST', `${root}:batchWrite`, { writes: names.map((name) => ({ delete: name })) });
    const failed = (result.status || []).filter((s) => s.code);
    if (failed.length) throw new Error(`${failed.length} deletes failed after ${done} succeeded: ${JSON.stringify(failed[0])}. Run the script again.`);
    done += names.length;
    console.log(`  deleted ${done} of ${toDelete.length}`);
  }
  console.log('Done. Run the script again without --apply; it should find nothing.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
