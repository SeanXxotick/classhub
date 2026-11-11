/*
 * ClassHub service worker: keeps the app shell so the app opens without a connection.
 * Firestore keeps its own offline copy of the data; this only covers the page, scripts, styles and icons.
 * - Pages: network first, falling back to the cached shell.
 * - /assets/ (file names carry a hash): cache first.
 * Bump VERSION to drop old caches.
 */
const VERSION = 'classhub-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

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

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
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
