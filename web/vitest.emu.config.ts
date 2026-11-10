import { defineConfig } from 'vitest/config';

/*
 * The data layer tests on the Firestore emulator, with the real firestore.rules. Kept out of "npm test":
 * run "npm run test:emu" (it starts the emulator), or "npm run test:emu:run" when one is already running.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.emu.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { TZ: 'Asia/Manila' },
  },
});
