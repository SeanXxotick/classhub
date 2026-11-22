// Puts documents from a backup made by tools/backup_firestore.js back into Firestore.
//
// By default it only compares and prints what it would do; nothing is written until you add --apply.
// It writes back each backed-up document that is now missing or different, exactly as it was saved.
// It never deletes anything: documents created after the backup are left alone.
//
// Usage:
//   node tools/restore_firestore.js <backup folder> [--only <path prefix>] [--apply] [project id]
// Examples:
//   node tools/restore_firestore.js "C:/Users/me/Documents/ClassHub Backups/2026-11-22_2300"
//   node tools/restore_firestore.js "C:/Users/me/Documents/ClassHub Backups/2026-11-22_2300" --only classes/6ZMSZ367hd0sqDrQM9Ef --apply
// "--only" limits it to one class, one collection or one document (its path under /documents).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] || '').replace(/^\/+|\/+$/g, '') : '';
const rest = args.filter((a, i) => a !== '--apply' && (onlyAt < 0 || (i !== onlyAt && i !== onlyAt + 1)));
const [dir, projectId = 'classhub-975eb'] = rest;
if (!dir || (onlyAt >= 0 && !only)) {
  console.error('Usage: node tools/restore_firestore.js <backup folder> [--only <path prefix>] [--apply] [project id]');
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

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
if (manifest.projectId !== projectId) {
  console.error(`This backup is of ${manifest.projectId}, not ${projectId}.`);
  process.exit(1);
}
const saved = fs.readFileSync(path.join(dir, 'documents.ndjson'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter((d) => !only || d.path === only || d.path.startsWith(only + '/'));

/** Field values in a fixed key order, so two copies of the same document compare equal. */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const same = (a, b) => JSON.stringify(canonical(a || {})) === JSON.stringify(canonical(b || {}));

(async () => {
  let headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
  if (!emulator) {
    const toolsDir = firebaseToolsDir();
    const auth = require(path.join(toolsDir, 'lib', 'auth.js'));
    const scopes = require(path.join(toolsDir, 'lib', 'scopes.js'));
    const { access_token: token } = await auth.getAccessToken(auth.getGlobalDefaultAccount().tokens.refresh_token, [scopes.CLOUD_PLATFORM]);
    headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId, 'Content-Type': 'application/json' };
  }

  // Read the live copies 300 at a time and keep the ones that are missing or changed.
  const toWrite = [];
  let missing = 0;
  let changed = 0;
  for (let i = 0; i < saved.length; i += 300) {
    const chunk = saved.slice(i, i + 300);
    const res = await fetch(`${base}${root}:batchGet`, { method: 'POST', headers, body: JSON.stringify({ documents: chunk.map((d) => `${root}/${d.path}`) }) });
    if (!res.ok) throw new Error(`Reading failed (${res.status}): ${await res.text()}`);
    const live = new Map((await res.json()).filter((r) => r.found).map((r) => [r.found.name, r.found.fields]));
    for (const d of chunk) {
      const now = live.get(`${root}/${d.path}`);
      if (now === undefined) { missing++; toWrite.push(d); }
      else if (!same(now, d.fields)) { changed++; toWrite.push(d); }
    }
  }
  const by = {};
  for (const d of toWrite) { const k = d.path.split('/').slice(0, 3).join('/'); by[k] = (by[k] || 0) + 1; }
  console.log(`Backup ${path.basename(dir)} (${manifest.startedAt}), ${only ? `only ${only}` : 'everything'}: ${saved.length} saved documents.`);
  console.log(`${missing} are missing now and ${changed} differ from the backup.`);
  for (const [k, n] of Object.entries(by).sort()) console.log(`  ${k}: ${n}`);
  if (!toWrite.length) return console.log('Nothing to restore.');
  if (!apply) return console.log('Nothing was written. Run again with --apply to restore these documents.');

  for (let i = 0; i < toWrite.length; i += 400) {
    const writes = toWrite.slice(i, i + 400).map((d) => ({ update: { name: `${root}/${d.path}`, fields: d.fields } }));
    const res = await fetch(`${base}${root}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) });
    if (!res.ok) throw new Error(`Writing failed after ${i} documents (${res.status}): ${await res.text()}`);
  }
  console.log(`Restored ${toWrite.length} documents.`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
