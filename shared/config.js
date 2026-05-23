// Single source of WORKER_URL detection for all pages. Detects any local-like
// host so dev works whether the user types localhost, 127.0.0.1, or hits the
// box via LAN IP. In dev the worker serves both static pages and the API on
// the same origin, so reuse window.location.origin; production points at the
// deployed worker.
(function () {
  const h = window.location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
                  /^192\.168\./.test(h) || /^10\./.test(h) || h.endsWith('.local');
  window.WORKER_URL = isLocal
    ? window.location.origin
    : 'https://game-lobby.powerstrong.workers.dev';
})();
