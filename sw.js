/* Muse — service worker.
 * App shell (html/css/js/fonts/cities) is cache-first so the app opens instantly and offline.
 * events.json is NETWORK-FIRST: the agenda changes daily, so a cached copy is only a fallback for
 * when the family is offline (e.g. on the road), never what a connected visit sees.
 * Bump CACHE on every app-shell deploy (node scripts/bump-sw.mjs) so returning users get it. */
const CACHE = 'muse-v201';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './register-sw.js',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './cities.json',
  './fonts/fredoka-latin-600-normal.woff2',
  './fonts/fredoka-latin-700-normal.woff2',
  './fonts/nunito-latin-400-normal.woff2',
  './fonts/nunito-latin-600-normal.woff2',
  './fonts/nunito-latin-700-normal.woff2',
  './fonts/nunito-latin-800-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).then(() => c.add('./events.json').catch(() => {})))
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
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // event images, Supabase, maps: browser default
  if (url.pathname.startsWith('/_vercel/')) return;          // analytics beacons are never cached

  if (url.pathname.endsWith('/events.json')) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./events.json', copy)); }
        return res;
      }).catch(() => caches.match('./events.json'))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => { if (req.mode === 'navigate') return caches.match('./index.html'); }))
  );
});
