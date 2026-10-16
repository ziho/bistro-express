// Bistro Express service worker.
// Caches ONLY the public app shell and static build assets. API calls, media and auth are never
// cached or intercepted. There is no offline submission queue — drafts live in localStorage.
const CACHE = 'bistro-shell-v1';
const BASE = '/bistro/';
const SHELL = [BASE, `${BASE}manifest.webmanifest`, `${BASE}icons/icon.svg`, `${BASE}icons/icon-192.png`];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('bistro-shell-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableStatic(url) {
  return (
    url.pathname.startsWith(`${BASE}assets/`) ||
    url.pathname.startsWith(`${BASE}icons/`) ||
    url.pathname === `${BASE}manifest.webmanifest`
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  // Never touch API, media, auth or admin traffic.
  if (url.pathname.startsWith(`${BASE}api/`) || url.pathname.startsWith(`${BASE}admin`)) return;

  if (request.mode === 'navigate') {
    // Network first so deploys are picked up; fall back to the cached shell when offline.
    event.respondWith(
      fetch(request).catch(() => caches.match(BASE).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
