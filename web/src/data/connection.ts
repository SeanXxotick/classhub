import { waitForPendingWrites } from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { db } from './firebase';

/*
 * Whether the app can reach the internet, for the offline strip under the top bar.
 * - offline: the phone has no network, or a quick check found no internet behind it (Wi-Fi without internet).
 * - back: the connection just came back. "sending" until the changes made offline are saved, then a few seconds
 *   of "Back online" before it goes quiet again.
 * - online: nothing to show.
 * One tracker for the whole app, started by the first screen that asks.
 */

export type Connection = 'online' | 'offline' | 'sending' | 'back';

// Google's connectivity check: an empty 204 answer, made for exactly this.
const CHECK_URL = 'https://www.gstatic.com/generate_204';
const CHECK_TIMEOUT_MS = 8000;
const BACK_SHOWN_MS = 3000;
const SENDING_MAX_MS = 15000;
// Checked every 20 seconds while offline, every minute while online (only while the app is on screen).
const TICK_MS = 20000;

let state: Connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
const listeners = new Set<() => void>();
let started = false;
let checking = false;
let ticks = 0;
let backTimer: ReturnType<typeof setTimeout> | undefined;

function set(next: Connection) {
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

/** True when the connectivity check gets through. Any answer counts; only a network failure does not. */
async function reachable(): Promise<boolean> {
  if (navigator.onLine === false) return false;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), CHECK_TIMEOUT_MS);
  try {
    await fetch(CHECK_URL, { mode: 'no-cors', cache: 'no-store', signal: control.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function goOffline() {
  clearTimeout(backTimer);
  set('offline');
}

// A slow connection can miss one check: say "offline" only after two misses in a row (or at once when the
// phone itself reports no network). The second check follows RETRY_MS after the first miss.
const RETRY_MS = 5000;
let misses = 0;

async function check() {
  if (checking) return;
  checking = true;
  try {
    if (!(await reachable())) {
      misses++;
      if (navigator.onLine === false || misses >= 2) return goOffline();
      setTimeout(() => void check(), RETRY_MS);
      return;
    }
    misses = 0;
    if (state !== 'offline') return;
    // Back: wait for what was changed offline to reach the server, then say so briefly.
    set('sending');
    await Promise.race([waitForPendingWrites(db), new Promise((resolve) => setTimeout(resolve, SENDING_MAX_MS))]);
    // It may have gone offline again while waiting.
    if ((state as Connection) !== 'sending') return;
    set('back');
    backTimer = setTimeout(() => state === 'back' && set('online'), BACK_SHOWN_MS);
  } finally {
    checking = false;
  }
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('offline', goOffline);
  window.addEventListener('online', () => void check());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
  setInterval(() => {
    ticks++;
    if (document.visibilityState !== 'visible') return;
    if (state === 'offline' || ticks % 3 === 0) void check();
  }, TICK_MS);
  void check();
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, () => state, () => 'online' as const);
}
