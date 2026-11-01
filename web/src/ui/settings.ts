import { useSyncExternalStore } from 'react';

/*
 * Settings kept in this browser only, like the Android app's per-phone AppSettings: the theme,
 * pinned classes and the tab each class opens on. Storage can be blocked (private windows), so
 * every read and write is guarded and the defaults still work.
 */

export type ThemeMode = 'SYSTEM' | 'LIGHT' | 'DARK';

const KEY_THEME = 'classhub.theme';
const KEY_PINNED = 'classhub.pinned';
const tabKey = (classId: string) => `classhub.tab.${classId}`;

const listeners = new Set<() => void>();
let version = 0;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is blocked; the setting lasts until the page is closed.
  }
  memory.set(key, value);
  version++;
  listeners.forEach((l) => l());
}

// What was set while storage is blocked.
const memory = new Map<string, string | null>();
const get = (key: string) => (memory.has(key) ? memory.get(key)! : read(key));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller whenever a setting changes. */
export function useSettingsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

export function themeMode(): ThemeMode {
  const t = get(KEY_THEME);
  return t === 'LIGHT' || t === 'DARK' ? t : 'SYSTEM';
}

export function setThemeMode(mode: ThemeMode) {
  write(KEY_THEME, mode);
  applyTheme();
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** Puts the chosen light or dark theme on the page. */
export function applyTheme() {
  const mode = themeMode();
  const dark = mode === 'DARK' || (mode === 'SYSTEM' && !!darkQuery?.matches);
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f141c' : '#0F766E');
}

darkQuery?.addEventListener('change', applyTheme);

export function pinnedClasses(): Set<string> {
  try {
    const list = JSON.parse(get(KEY_PINNED) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function setPinned(classId: string, pinned: boolean) {
  const set = pinnedClasses();
  if (pinned) set.add(classId);
  else set.delete(classId);
  write(KEY_PINNED, JSON.stringify([...set]));
}

/** The tab this class opens on (a tab name such as "SCHEDULE"), or null for Home. */
export function startTab(classId: string): string | null {
  return get(tabKey(classId));
}

export function setStartTab(classId: string, tab: string) {
  write(tabKey(classId), tab);
}
