// Publishes the newest app version to appConfig/latest, so students see "Update available".
// Uses the Firebase CLI login (run `firebase login` once). Shows what it would write unless --apply is given.
//
// Usage:
//   node tools/publish_release.js <firebase-tools dir> <project id> <versionCode> <versionName> <downloadUrl> <notes> [minVersionCode] [--apply]
// Example:
//   node tools/publish_release.js "$(npm root -g)/firebase-tools" classhub-975eb 6 1.3.2 "https://drive.google.com/uc?export=download&id=FILE_ID" "See who marked a deliverable done" --apply
const path = require('path');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [toolsDir, projectId, versionCode, versionName, downloadUrl, notes = '', minVersionCode = '0'] = args.filter((a) => a !== '--apply');

if (!toolsDir || !projectId || !versionCode || !versionName || !downloadUrl) {
  console.error('Usage: node tools/publish_release.js <firebase-tools dir> <project id> <versionCode> <versionName> <downloadUrl> <notes> [minVersionCode] [--apply]');
  process.exit(1);
}
if (!downloadUrl.startsWith('https://')) {
  console.error('The download link must start with https:// (the app ignores anything else).');
  process.exit(1);
}
if (!Number.isInteger(Number(versionCode)) || !Number.isInteger(Number(minVersionCode))) {
  console.error('versionCode and minVersionCode must be whole numbers.');
  process.exit(1);
}

const auth = require(path.join(toolsDir, 'lib', 'auth.js'));
const scopes = require(path.join(toolsDir, 'lib', 'scopes.js'));
const doc = {
  fields: {
    versionCode: { integerValue: String(Number(versionCode)) },
    versionName: { stringValue: versionName },
    notes: { stringValue: notes },
    downloadUrl: { stringValue: downloadUrl },
    minVersionCode: { integerValue: String(Number(minVersionCode)) },
  },
};

(async () => {
  console.log(`${apply ? 'Publishing' : 'Dry run, would publish'} to appConfig/latest:`);
  console.log(`  version ${versionName} (code ${versionCode}), forced below code ${minVersionCode}`);
  console.log(`  link:  ${downloadUrl}`);
  console.log(`  notes: ${notes || '(none)'}`);
  if (!apply) return console.log('Nothing written. Add --apply to publish.');

  const account = auth.getGlobalDefaultAccount();
  const { access_token: token } = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM]);
  const fields = Object.keys(doc.fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/appConfig/latest?${fields}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': projectId },
    body: JSON.stringify(doc),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Publish failed (${res.status}): ${JSON.stringify(json.error || json)}`);
  console.log('Published.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
