const CACHE = 'tenten-v11';

const PRECACHE = [
  '/',
  '/world/',
  '/world/index.html',
  '/world/style.css',
  '/world/world.js',
  '/manifest.webmanifest',
  '/styles/lab.css',
  '/games/registry.js',
  '/shared/bootstrap.js',
  '/shared/input.js',
  '/shared/config.js',
  '/shared/character_sprites.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Skip non-GET and API/WS requests
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  // Let top-level navigations prefer the network so route and HTML updates
  // are not masked by stale cached documents.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
      return cached || fresh;
    })
  );
});
