/**
 * Seyf App-Shell Service Worker
 *
 * Responsibility: cache the dashboard shell + static assets and serve an
 * offline fallback for navigation requests when the network is unavailable.
 *
 * FCM / push coordination (#44):
 *   This SW is registered at /seyf-sw.js. When PR #44 lands, the FCM push
 *   logic should be merged INTO this file (not registered as a separate SW).
 *   Browsers allow only one active SW per scope; a second registration at the
 *   same scope replaces the first, which would break either push or caching.
 *   Merge strategy: copy the firebase-messaging-sw.js push event handlers here
 *   and remove the separate FCM SW registration from the client.
 *
 * Cache exclusions (per spec):
 *   - /api/seyf/** — live financial data, never stale-serve
 *   - /api/webhooks/** — inbound webhooks, must reach origin
 *   - No user data is written to Cache Storage or IndexedDB.
 */

const SHELL_VERSION = 'seyf-shell-v1';

const SHELL_ASSETS = [
  '/offline.html',
  '/icon.svg',
  '/manifest.webmanifest',
];

const NEVER_CACHE = [
  '/api/seyf/',
  '/api/webhooks/',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept GET requests from our own origin.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache live API routes.
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  // Navigation requests: network-first, fall back to offline shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline.html')
      )
    );
    return;
  }

  // Static shell assets: cache-first.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request))
    );
  }
});

// ─── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    let payload;
    try {
      payload = event.data.json();
    } catch {
      payload = { notification: { title: 'Seyf', body: event.data.text() } };
    }

    const title = payload.notification?.title || 'Seyf';
    const options = {
      body: payload.notification?.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: payload.data || {},
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('[seyf-sw] Error in push event listener:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.pathname === '/dashboard' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/dashboard');
      }
    })
  );
});
