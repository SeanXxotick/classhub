// Saves every Firestore document of the project (all collections, all subcollections) into a dated folder.
// Reads only; it changes nothing in the database. Restore with tools/restore_firestore.js.
//
// The backup holds real names and balances, so it must be saved OUTSIDE the repository; the script refuses
// anything else. A backup is written to a temporary folder first and renamed only when complete, so a folder
// without ".partial" in its name is always a full backup. After a good backup, the oldest ones past KEEP are
// removed. Every run adds a line to backups.log in the backup folder.
//
// Usage:
//   node tools/backup_firestore.js [project id] [backup folder]
// Defaults: classhub-975eb and C:/Users/<you>/Documents/ClassHub Backups. Set KEEP to change how many
// backups are kept (default 30). Signs in with the account logged in to firebase-tools.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const projectId = process.argv[2] || 'classhub-975eb';
const backupRoot = path.resolve(process.argv[3] || path.join(os.homedir(), 'Documents', 'ClassHub Backups'));
const keep = Math.max(1, Number(process.env.KEEP) || 30);

const repo = path.resolve(__dirname, '..');
if ((backupRoot + path.sep).toLowerCase().startsWith((repo + path.sep).toLowerCase())) {
  console.error('The backup folder must be outside the repository folder (it holds real names and balances).');
  process.exit(1);
}

/** Where firebase-tools is installed: FIREBASE_TOOLS_DIR, the usual Windows npm folder, or npm's answer. */
function firebaseToolsDir() {
  if (process.env.FIREBASE_TOOLS_DIR) return process.env.FIREBASE_TOOLS_DIR;
  const usual = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools');
  if (fs.existsSync(path.join(usual, 'lib', 'auth.js'))) return usual;
  return path.join(execSync('npm root -g').toString().trim(), 'firebase-tools');
}

const root = `projects/${projectId}/databases/(default)/documents`;
// For a trial on the local emulator set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 (no login is used then).
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const base = emulator ? `http://${emulator}/v1/` : 'https://firestore.googleapis.com/v1/';
let headers = {};

async function call(url, init = {}, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { ...init, headers: { ...headers, 'Content-Type': 'application/json' } });
    if (res.ok) return res.json();
    // Retry the errors that pass on their own (rate limits, brief outages).
    if (i < tries && [429, 500, 502, 503, 504].includes(res.status)) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      continue;
    }
    throw new Error(`${res.status} on ${url}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** The subcollection ids under a document (or under the database root). */
async function collectionIds(parent) {
  const ids = [];
  let pageToken = '';
  do {
    const page = await call(`${base}${parent}:listCollectionIds`, { method: 'POST', body: JSON.stringify({ pageSize: 300, pageToken }) });
    ids.push(...(page.collectionIds || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return ids;
}

/** Every document in a collection, including "missing" ones that have no fields but hold subcollections. */
async function documents(parent, collectionId) {
  const docs = [];
  let pageToken = '';
  do {
    const page = await call(`${base}${parent}/${collectionId}?pageSize=300&showMissing=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    docs.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  fs.appendFileSync(path.join(backupRoot, 'backups.log'), text + '\n');
}

(async () => {
  fs.mkdirSync(backupRoot, { recursive: true });
  const started = new Date();
  const name = stamp(started);
  const partial = path.join(backupRoot, `${name}.partial`);
  const final = path.join(backupRoot, name);
  try {
    if (fs.existsSync(final)) throw new Error(`${final} already exists.`);
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial);

    if (emulator) headers = { Authorization: 'Bearer owner' };
    else {
    const toolsDir = firebaseToolsDir();
    const auth = require(path.join(toolsDir, 'lib', 'auth.js'));
    const scopes = require(path.join(toolsDir, 'lib', 'scopes.js'));
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('No account is logged in to firebase-tools. Run "firebase login".');
    const { access_token: token } = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM]);
    headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId };
    }

    // One document per line: its path under /documents, its fields as Firestore stores them, and its times.
    const out = fs.openSync(path.join(partial, 'documents.ndjson'), 'w');
    const counts = {};
    let total = 0;
    // Walk the tree a few branches at a time, so it is quick without hitting rate limits.
    const queue = [{ parent: root, top: null }];
    const walk = async () => {
      while (queue.length) {
        const { parent, top } = queue.shift();
        for (const id of await collectionIds(parent)) {
          for (const doc of await documents(parent, id)) {
            const rel = doc.name.slice(root.length + 1);
            const group = top || id;
            if (doc.fields || doc.createTime) {
              fs.writeSync(out, JSON.stringify({ path: rel, fields: doc.fields || {}, createTime: doc.createTime, updateTime: doc.updateTime }) + '\n');
              counts[group] = (counts[group] || 0) + 1;
              total++;
            }
            queue.push({ parent: doc.name, top: group });
          }
        }
      }
    };
    // Workers share the queue; a worker that finds it empty waits briefly in case others are still adding to it.
    let active = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (;;) {
        if (queue.length) {
          active++;
          try { await walk(); } finally { active--; }
        } else if (active === 0) return;
        else await new Promise((r) => setTimeout(r, 50));
      }
    }));
    fs.closeSync(out);

    const manifest = { projectId, startedAt: started.toISOString(), finishedAt: new Date().toISOString(), documents: total, byTopCollection: counts };
    fs.writeFileSync(path.join(partial, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.renameSync(partial, final);
    log(`OK ${name}: ${total} documents (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);

    // Remove the oldest complete backups past the limit, and leftovers of failed runs.
    const done = fs.readdirSync(backupRoot).filter((f) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(f)).sort();
    for (const old of done.slice(0, Math.max(0, done.length - keep))) {
      fs.rmSync(path.join(backupRoot, old), { recursive: true, force: true });
      log(`removed old backup ${old}`);
    }
    for (const f of fs.readdirSync(backupRoot).filter((x) => x.endsWith('.partial') && x !== `${name}.partial`)) {
      fs.rmSync(path.join(backupRoot, f), { recursive: true, force: true });
    }
  } catch (e) {
    log(`FAILED ${name}: ${e.message}`);
    process.exitCode = 1;
  }
})();
