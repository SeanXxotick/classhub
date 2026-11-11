// 2.0 go-live, before the wipe: saves every student's final balance (and every ledger record, as a backup)
// from the version 1 classes into one JSON file. Reads only; it changes nothing in the database.
// The file holds real names and balances: it must be saved OUTSIDE the repository, and the script refuses
// anything else. The screen shows totals only, never a name.
//
// Usage:
//   node tools/export_balances.js <firebase-tools dir> <project id> <output file>
// Example:
//   node tools/export_balances.js "$(npm root -g)/firebase-tools" classhub-975eb "C:/Users/me/Documents/classhub-balances.json"
//
// For a trial on the local emulator set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 (no login is used then).
const fs = require('fs');
const path = require('path');
const [toolsDir, projectId, outFile] = process.argv.slice(2);

if (!toolsDir || !projectId || !outFile) {
  console.error('Usage: node tools/export_balances.js <firebase-tools dir> <project id> <output file>');
  process.exit(1);
}
const out = path.resolve(outFile);
const repo = path.resolve(__dirname, '..');
if ((out + path.sep).toLowerCase().startsWith((repo + path.sep).toLowerCase())) {
  console.error('The output file must be outside the repository folder (it holds real names and balances).');
  process.exit(1);
}
if (fs.existsSync(out)) {
  console.error(`${out} already exists. Choose another name, so an earlier export is never overwritten.`);
  process.exit(1);
}

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const root = `projects/${projectId}/databases/(default)/documents`;
const base = `${emulator ? `http://${emulator}` : 'https://firestore.googleapis.com'}/v1/`;
let token = 'owner';

async function listDocs(parent, collectionId) {
  const docs = [];
  let pageToken = '';
  do {
    const res = await fetch(`${base}${parent}/${collectionId}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, ...(emulator ? {} : { 'x-goog-user-project': projectId }) },
    });
    const page = await res.json();
    if (!res.ok) throw new Error(`Reading ${collectionId} failed (${res.status}): ${JSON.stringify(page.error || page)}`);
    docs.push(...(page.documents || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/** A Firestore REST document as a plain object (only the value kinds a ledger record uses). */
function plain(doc) {
  const o = { id: doc.name.split('/').pop() };
  for (const [key, v] of Object.entries(doc.fields || {})) {
    o[key] = 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'stringValue' in v ? v.stringValue : null;
  }
  return o;
}

// Same math as version 1 (web/src/domain/ledger.ts on main).
const memberDelta = (r) => (r.type === 'PAYMENT' ? r.amountCentavos : r.type === 'CHARGE' || r.type === 'WITHDRAWAL' ? -r.amountCentavos : 0);
const cashDelta = (r) => (r.type === 'PAYMENT' ? r.amountCentavos : r.type === 'WITHDRAWAL' || r.type === 'EXPENSE' ? -r.amountCentavos : 0);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const pesos = (centavos) => (centavos / 100).toFixed(2);

(async () => {
  if (!emulator) {
    const auth = require(path.join(toolsDir, 'lib', 'auth.js'));
    const scopes = require(path.join(toolsDir, 'lib', 'scopes.js'));
    const account = auth.getGlobalDefaultAccount();
    token = (await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM])).access_token;
  }
  const classes = [];
  for (const c of await listDocs(root, 'classes')) {
    const info = plain(c);
    const members = (await listDocs(c.name, 'members')).map(plain);
    const records = (await listDocs(c.name, 'records')).map(plain);
    for (const r of records) {
      if (!['PAYMENT', 'CHARGE', 'WITHDRAWAL', 'EXPENSE'].includes(r.type) || !Number.isSafeInteger(r.amountCentavos)) {
        throw new Error(`Class ${info.id}: record ${r.id} has an unknown type or amount. Nothing was saved.`);
      }
    }
    // Everyone who ever had a record counts, including people who left; a current member's name wins.
    const people = new Map(members.map((m) => [m.id, { uid: m.id, name: m.name || '', amountCentavos: 0, isMember: true }]));
    for (const r of records) {
      if (!r.memberId) continue;
      const p = people.get(r.memberId) ?? { uid: r.memberId, name: r.memberName || '', amountCentavos: 0, isMember: false };
      p.amountCentavos += memberDelta(r);
      people.set(r.memberId, p);
    }
    const balances = [...people.values()];
    const paidOut = new Set(records.filter((r) => r.type === 'EXPENSE' && r.settlesBatchId).map((r) => r.settlesBatchId));
    const cashOnHand = sum(records.map(cashDelta));
    const awaitingPayout = sum(records.filter((r) => r.type === 'CHARGE' && r.batchId && !paidOut.has(r.batchId)).map((r) => r.amountCentavos));
    const totalBalances = sum(balances.map((b) => b.amountCentavos));
    const booksDifference = cashOnHand - totalBalances - awaitingPayout;
    classes.push({ id: info.id, name: info.name || '', cashOnHand, awaitingPayout, totalBalances, booksDifference, balances, records });

    const owing = balances.filter((b) => b.amountCentavos < 0);
    const credit = balances.filter((b) => b.amountCentavos > 0);
    console.log(`\n${info.id}  ${info.name || ''}`);
    console.log(`  ${members.length} members, ${records.length} records, ${balances.filter((b) => !b.isMember && b.amountCentavos !== 0).length} people who left with a balance`);
    console.log(`  ${credit.length} students with credit, total ${pesos(sum(credit.map((b) => b.amountCentavos)))}`);
    console.log(`  ${owing.length} students who owe, total ${pesos(-sum(owing.map((b) => b.amountCentavos)))}`);
    console.log(`  Cash on hand ${pesos(cashOnHand)}; sum of all balances ${pesos(totalBalances)}; charges not yet paid out ${pesos(awaitingPayout)}`);
    console.log(booksDifference === 0 ? '  The books balance.' : `  WARNING: the books are off by ${pesos(booksDifference)}.`);
    if (awaitingPayout !== 0) console.log('  WARNING: some charges are not paid out yet. Carried-over balances will not cover that money.');
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), projectId, classes }, null, 1));
  console.log(`\nSaved ${classes.length} classes to ${out}`);
  console.log('Keep this file private and outside the repository.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
