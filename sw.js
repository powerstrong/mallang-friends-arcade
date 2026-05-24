const CACHE = 'tenten-v14';

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
            // 비동기 caches.open 이 풀리기 전에 클론을 떠둬야 한다.
            // 안 그러면 페이지가 본문을 먼저 소비해서 clone() 이 실패한다.
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        // 오프라인 fallback: 쿼리스트링 무시하고 precache 시도 (특히 게임 복귀
        // URL /world/?worldId=...&from=game), 그래도 실패하면 / 로.
        .catch(() => caches.match(e.request, { ignoreSearch: true })
          .then(cached => cached || caches.match('/')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      });
      return cached || fresh;
    })
  );
});
