import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests against the local Auth and Firestore emulators (never the real project).
 * Run from the repo root so the emulators load firestore.rules:
 *   firebase emulators:exec --only auth,firestore --project demo-classhub "npm --prefix web run e2e"
 * The dev server starts in emulator mode by itself.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } }],
  webServer: {
    command: 'npm run dev:emu',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
