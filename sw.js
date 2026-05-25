const CACHE = 'tenten-v25';

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
  // 개별 addAll 실패가 전체 install 을 깨뜨리지 않도록 best-effort 로 채운다.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(PRECACHE.map(url => c.add(url))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

// 안전망: 어떤 경우든 valid Response 를 반환해 FetchEvent 가 network error 로
// 떨어지는 것을 막는다. 캐시 쓰기/네트워크 fetch 의 모든 거부는 swallow.
function putInCache(req, res) {
  try {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy).catch(() => {})).catch(() => {});
  } catch { /* ignore */ }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  // Top-level 네비게이션: network 우선, 실패 시 cache, 그것도 없으면 '/' 폴백.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res && res.ok) putInCache(e.request, res);
        return res;
      } catch {
        const cached = await caches.match(e.request, { ignoreSearch: true });
        if (cached) return cached;
        const root = await caches.match('/');
        if (root) return root;
        // 마지막 보루 — 최소 503 응답이라도 돌려줘서 SW promise 가 reject 되지
        // 않게 한다 (uncaught 'Failed to fetch' 회피).
        return new Response('네트워크에 연결할 수 없습니다.', {
          status: 503,
          statusText: 'Network Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // 하위 리소스: cache-first, 없으면 network. 두 경로 모두 거부 swallow.
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) {
      // stale-while-revalidate — 백그라운드로 재페치해 캐시 갱신 (실패해도 무시).
      fetch(e.request).then(res => {
        if (res && res.ok) putInCache(e.request, res);
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(e.request);
      if (res && res.ok) putInCache(e.request, res);
      return res;
    } catch {
      // 캐시도 네트워크도 없으면 빈 504 — SW 가 throw 되어 클라가 broken 페이지를
      // 보지 않도록.
      return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});
