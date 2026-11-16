/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // When this copy of the website was built, shown in About ClassHub (helps tell an old saved copy apart).
  define: { __BUILD_MILLIS__: JSON.stringify(Date.now()) },
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      // Firebase and React change less often than the app, so browsers keep them cached across releases.
      output: { manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], react: ['react', 'react-dom', 'react-router-dom'] } },
    },
    chunkSizeWarningLimit: 800,
  },
  test: { include: ['src/**/*.test.ts'], env: { TZ: 'Asia/Manila' } },
});
