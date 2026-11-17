/* Service worker: offline shell + Web Push. Bump VERSION on every frontend deploy. */
const VERSION = 'hlidac-v4';
const SHELL = ['/', '/style.css?v=4', '/app.js?v=4', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the app shell only (fresh prices), cache as offline fallback.
// Only the bare "/" page and the versioned assets are ever cached — never a URL
// with a query (tokens!), never manage/unsubscribe pages, never /api/, and never
// a response marked no-store.
function cacheable(req, url, res) {
  if (!res.ok) return false;
  if (/no-store/i.test(res.headers.get('Cache-Control') || '')) return false;
  if (req.mode === 'navigate') return url.pathname === '/' && !url.search;
  return SHELL.includes(url.pathname + url.search);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isShellNav = req.mode === 'navigate' && url.pathname === '/' && !url.search;
  if (req.mode === 'navigate' && !isShellNav) return; // manage/unsubscribe etc.: straight to network
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (cacheable(req, url, res)) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Změna cen paliv', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Změna cen paliv';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: data.url || '/' },
    tag: data.tag || 'price-change',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
