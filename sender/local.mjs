/*
 * Runs the sender once against the LOCAL Firestore emulator and prints what it would send. Nothing leaves
 * this computer: there is no Cloud Messaging call. From the repo root, with the emulators up:
 *   node sender/local.mjs            (send what is queued)
 *   node sender/local.mjs due        (queue "due tomorrow" first)
 */
import { queueDueTomorrow, runOnce } from './src/worker.js';

const cfg = {
  projectId: process.env.EMU_PROJECT || 'demo-classhub',
  firestore: 'http://127.0.0.1:8080',
  fcm: null,
  authHeader: { Authorization: 'Bearer owner' },
  fetch: (url, init) => fetch(url, init),
  log: (line) => console.log('  ' + line),
  appUrl: 'http://localhost:5173',
  now: Date.now(),
};

if (process.argv[2] === 'due') console.log('due tomorrow:', await queueDueTomorrow(cfg));
console.log('run:', await runOnce(cfg));
