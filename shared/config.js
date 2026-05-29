// 모든 페이지가 공유하는 WORKER_URL(API 워커 주소) 결정 로직.
//
// - 로컬(localhost/LAN/.local): same-origin. wrangler dev 가 정적 + API 를 한 곳에서 서빙.
// - 프로덕션 호스트: prod API 워커.
// - Cloudflare Pages 프리뷰(브랜치/PR 배포): staging API 워커 — 단, STAGING_API 가
//   설정된 경우에만. 비어 있으면 프리뷰도 prod API 를 쓴다(릴레이/읽기 게임은 그대로 동작).
//
// 서버 권위형 신규 게임을 프리뷰에서 검증하려면: ① `wrangler deploy --env staging` 로
// staging 워커 배포 → ② 아래 STAGING_API 에 그 URL 입력. (docs/PREVIEW.md 참고)
(function () {
  const PROD_API = 'https://game-lobby.powerstrong.workers.dev';
  // staging 워커 배포 후 URL 입력 시 활성화. 예: 'https://game-lobby-staging.powerstrong.workers.dev'
  const STAGING_API = '';
  // 프로덕션으로 인정할 호스트. 여기에 없는 비로컬 호스트는 프리뷰 배포로 간주한다.
  const PROD_HOSTS = ['web-game-lab.powerstrong.workers.dev', 'mallang-friends-arcade.pages.dev'];

  const h = window.location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
                  /^192\.168\./.test(h) || /^10\./.test(h) ||
                  /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) || h.endsWith('.local');
  const isProdHost = PROD_HOSTS.indexOf(h) !== -1;
  const isPreview = !isLocal && !isProdHost;  // 프리뷰/스테이징 배포로 추정

  let api;
  if (isLocal) {
    api = window.location.origin;
  } else if (isPreview && STAGING_API) {
    api = STAGING_API;
  } else {
    api = PROD_API;
  }
  window.WORKER_URL = api;
})();
