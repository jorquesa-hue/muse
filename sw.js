/* Muse — service worker (offline-first app shell) */
/* bump this version string on every deploy so returning users get the update */
const CACHE = 'muse-v19';
const ASSETS = [
  './index.html',
  './data.json',
  './manifest.webmanifest',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).then(() => c.add('embeddings.b64.json').catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Cache-first: the whole app (data included) is in the shell, so this works fully offline.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // navigation fallback when offline
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
