/*
 * ClassHub service worker: keeps the app shell so the app opens without a connection.
 * Firestore keeps its own offline copy of the data; this only covers the page, scripts, styles and icons.
 * - Pages: network first, but after NAV_WAIT_MS on a slow connection the cached shell is used and the
 *   network answer only refreshes the cache (the new version then shows on the next open). In the Android
 *   app, Capacitor's proxy waits up to 30 seconds to connect, so without this a slow connection stalled.
 * - /assets/ (file names carry a hash): cache first.
 * - The icons and the manifest (same name after a change): network first, so a new icon shows at once.
 * Bump VERSION to drop old caches.
 */
const VERSION = 'classhub-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];
const NAV_WAIT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The Android app's built-in "needs the internet" page has this address but comes from inside the APK:
  // never save it as the app shell.
  if (url.pathname === '/offline.html') return;

  if (request.mode === 'navigate') {
    const network = fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put('/', copy));
      }
      return response;
    });
    // Keep the worker alive until the network answer is saved, even when the cached shell was used.
    event.waitUntil(network.catch(() => undefined));
    event.respondWith(
      caches.match('/').then((cached) => {
        if (!cached) return network;
        const slow = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_WAIT_MS));
        return Promise.race([network.catch(() => cached), slow]);
      }),
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// ---------------------------------------------------------------- Notifications
// Firebase Cloud Messaging delivers a push as JSON: { notification: { title, body }, data: { url, ... } }.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {};
  }
  const note = payload.notification || {};
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(note.title || 'ClassHub', {
      body: note.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.kind && data.classId ? data.kind + ':' + data.classId : undefined,
      data: { url: data.url || '/' },
    }),
  );
});

// A tap opens the class at the right tab, in the open ClassHub window when there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
