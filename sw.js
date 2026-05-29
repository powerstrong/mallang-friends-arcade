const CACHE = 'tenten-v30';

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
  '/shared/relay.js',
  '/shared/input.js',
  '/shared/config.js',
  '/shared/character_sprites.js',
];

self.addEventListener('install', e => {
  // 개별 addAll 실패가 전체 install 을 깨뜨리지 않도록 best-effort.
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

function putInCache(req, res) {
  try {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy).catch(() => {})).catch(() => {});
  } catch { /* ignore */ }
}

// Network-first 전략 — deploy 시점에 새 코드가 즉시 클라에 전달되도록.
// 캐시는 *오프라인 fallback* 용도로만 유지. (cache-first 였을 때 사용자가
// 캐시된 옛 world.js 를 계속 받아 버그 수정이 반영되지 않던 문제 해결.)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res && res.ok) putInCache(e.request, res);
      return res;
    } catch {
      // 네트워크 실패 → 캐시 폴백.
      const cached = e.request.mode === 'navigate'
        ? (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('/'))
        : await caches.match(e.request);
      if (cached) return cached;
      // 그것도 없으면 valid Response 라도 돌려줘서 FetchEvent reject 방지.
      return new Response(
        e.request.mode === 'navigate' ? '네트워크에 연결할 수 없습니다.' : '',
        {
          status: e.request.mode === 'navigate' ? 503 : 504,
          statusText: e.request.mode === 'navigate' ? 'Network Unavailable' : 'Gateway Timeout',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }
      );
    }
  })());
});
