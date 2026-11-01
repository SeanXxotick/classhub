/** Starts every run from empty emulators. Refuses to run unless the emulators answer on localhost. */
export default async function globalSetup() {
  const project = 'demo-classhub';
  const firestore = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  const auth = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`, { method: 'DELETE' });
  if (!firestore.ok || !auth.ok) throw new Error('Start the Auth and Firestore emulators first (see playwright.config.ts).');
}
