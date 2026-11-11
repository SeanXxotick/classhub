// 2.0 go-live, after the new class exists: writes the balances saved by export_balances.js into the new
// class as pending opening balances (classes/{new}/openingBalances/{uid}). The treasurer's app turns each
// one into an Opening balance record when the Ledger is opened and that student is in the class.
// Several old classes may be given, separated by commas; a student in more than one gets the sum.
// Shows totals only (never a name) and writes nothing unless --apply is given.
//
// Usage:
//   node tools/import_balances.js <firebase-tools dir> <project id> <export file> <old class id[,old class id]> <new class id> [--allow-unpaid] [--apply]
//
// For a trial on the local emulator set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 (no login is used then).
const fs = require('fs');
const path = require('path');
const flags = ['--apply', '--allow-unpaid'];
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowUnpaid = args.includes('--allow-unpaid');
const [toolsDir, projectId, file, oldIds, newId] = args.filter((a) => !flags.includes(a));

if (!toolsDir || !projectId || !file || !oldIds || !newId) {
  console.error('Usage: node tools/import_balances.js <firebase-tools dir> <project id> <export file> <old class id[,old class id]> <new class id> [--allow-unpaid] [--apply]');
  process.exit(1);
}

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const root = `projects/${projectId}/databases/(default)/documents`;
const base = `${emulator ? `http://${emulator}` : 'https://firestore.googleapis.com'}/v1/`;
let token = 'owner';
const pesos = (centavos) => (centavos / 100).toFixed(2);

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(emulator ? {} : { 'x-goog-user-project': projectId }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status}): ${JSON.stringify(json.error || json)}`);
  return json;
}

(async () => {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const totals = new Map();
  const names = [];
  for (const id of oldIds.split(',')) {
    const old = saved.classes.find((c) => c.id === id);
    if (!old) throw new Error(`The export file has no class ${id}. It has: ${saved.classes.map((c) => c.id).join(', ')}`);
    if (old.booksDifference !== 0) throw new Error(`Class ${id}: the books were off by ${pesos(old.booksDifference)} when exported. Settle that first.`);
    if (old.awaitingPayout !== 0 && !allowUnpaid) {
      throw new Error(`Class ${id}: charges worth ${pesos(old.awaitingPayout)} were not paid out when exported, so the balances do not cover all of its cash. Add --allow-unpaid only when the treasurer accepts that.`);
    }
    names.push(old.name);
    for (const b of old.balances) totals.set(b.uid, (totals.get(b.uid) ?? 0) + b.amountCentavos);
  }
  const entries = [...totals].filter(([, amount]) => amount !== 0);
  for (const [uid, amount] of entries) {
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 100000000 || !/^[A-Za-z0-9]{1,128}$/.test(uid)) throw new Error('The export file has a balance that cannot be imported. Nothing was written.');
  }
  const note = `Carried over from ${names.join(' and ')}`.slice(0, 200);

  if (!emulator) {
    const auth = require(path.join(toolsDir, 'lib', 'auth.js'));
    const scopes = require(path.join(toolsDir, 'lib', 'scopes.js'));
    const account = auth.getGlobalDefaultAccount();
    token = (await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM])).access_token;
  }
  const target = await call('GET', `${root}/classes/${newId}`);
  if (!target) throw new Error(`There is no class ${newId} in ${projectId}. Create it in the app first.`);

  // Never write twice: skip a student who already has a pending entry or an opening record.
  const todo = [];
  let skipped = 0;
  for (const [uid, amount] of entries) {
    const pending = await call('GET', `${root}/classes/${newId}/openingBalances/${uid}`);
    const record = await call('GET', `${root}/classes/${newId}/records/opening-${uid}`);
    if (pending || record) skipped++;
    else todo.push([uid, amount]);
  }
  const amounts = todo.map(([, a]) => a);
  console.log(`${apply ? 'Writing to' : 'Dry run for'} class ${newId} "${target.fields?.name?.stringValue ?? ''}" in ${projectId}${emulator ? ' (emulator)' : ' (THE LIVE PROJECT)'}`);
  console.log(`  Note on each: "${note}"`);
  console.log(`  ${todo.length} opening balances to write (${skipped} skipped because they already have one, ${totals.size - entries.length} students at zero need none)`);
  console.log(`  Credit: ${amounts.filter((a) => a > 0).length} students, total ${pesos(amounts.filter((a) => a > 0).reduce((x, y) => x + y, 0))}`);
  console.log(`  Owing:  ${amounts.filter((a) => a < 0).length} students, total ${pesos(-amounts.filter((a) => a < 0).reduce((x, y) => x + y, 0))}`);
  console.log(`  Net, which becomes the cash of the new class: ${pesos(amounts.reduce((x, y) => x + y, 0))}`);
  if (!apply) return console.log('Nothing written. Add --apply to write.');

  for (let i = 0; i < todo.length; i += 200) {
    const writes = todo.slice(i, i + 200).map(([uid, amount]) => ({
      update: { name: `${root}/classes/${newId}/openingBalances/${uid}`, fields: { amountCentavos: { integerValue: String(amount) }, note: { stringValue: note } } },
      currentDocument: { exists: false },
    }));
    const result = await call('POST', `${root}:batchWrite`, { writes });
    const failed = (result.status || []).filter((s) => s.code);
    if (failed.length) throw new Error(`${failed.length} writes failed: ${JSON.stringify(failed[0])}. Run the script again; finished ones are skipped.`);
  }
  console.log('Written. The treasurer opens the Ledger of the new class to apply them.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
