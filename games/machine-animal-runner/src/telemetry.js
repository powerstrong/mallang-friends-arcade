/* MARTelemetry — 플레이 텔레메트리 수집·전송 (M1 훅)
 * 목적: 난이도 튜닝. 클리어율만으론 부족 — 게이트 선택, 선택 전후 amount/power,
 * 사망 원인, 보스 잔여 HP, assist tier(M2)를 런 단위로 기록한다(DESIGN.md).
 *
 * 전송: 런 종료 시 한 번에 배치 POST(/api/telemetry/runner). 종료 전 이탈 대비
 * pagehide 에서 sendBeacon 폴백. 실패는 조용히 무시 — 게임에 절대 영향 없음.
 * 개인정보 없음: run_id 는 무작위 토큰, 닉네임/계정 미수집. */
(function (global) {
  var GAME = 'machine-animal-runner';
  var MAX_EVENTS = 60; // 한 런에서 이 이상은 버린다(이상 동작 방어)

  var runId = null;
  var stage = 1;
  var events = [];
  var sent = false;
  var startedAt = 0;

  function rid() {
    var s = '';
    for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 0x10000).toString(16);
    return 'r' + Date.now().toString(36) + s;
  }

  function startRun(stageNo, character) {
    runId = rid();
    stage = stageNo || 1;
    events = [];
    sent = false;
    startedAt = Date.now();
    log('run_start', { character: character || 'chick' });
  }

  function log(ev, payload) {
    if (!runId || sent || events.length >= MAX_EVENTS) return;
    events.push({ ev: ev, payload: payload || {}, ts: Date.now() });
  }

  function endRun(payload) {
    if (!runId || sent) return;
    payload = payload || {};
    payload.durationMs = Date.now() - startedAt;
    log('run_end', payload);
    flush();
  }

  function flush() {
    if (!runId || sent || events.length === 0) return;
    sent = true;
    var body = JSON.stringify({ game: GAME, runId: runId, stage: stage, events: events });
    // 프론트(web-game-lab)와 API 워커(game-lobby)는 별도 오리진 — 상대경로 금지(codex 리뷰).
    // shared/config.js 가 환경별(WORKER_URL: 로컬 same-origin / prod / staging)로 결정한다.
    var url = (window.WORKER_URL || window.location.origin) + '/api/telemetry/runner';
    // text/plain = CORS-simple: cross-origin sendBeacon 은 프리플라이트를 못 하므로
    // application/json Blob 이면 차단된다. 워커 request.json() 은 content-type 무관 파싱.
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* sendBeacon 미지원/거부 → fetch 폴백 */ }
    try {
      fetch(url, {
        method: 'POST', body: body, keepalive: true,
        headers: { 'Content-Type': 'text/plain' }
      }).catch(function () {});
    } catch (e) { /* 무시 */ }
  }

  // 런 도중 탭 이탈/닫기: 그때까지 모은 것만이라도 보낸다(사망 직전 이탈 추적).
  window.addEventListener('pagehide', flush);

  global.MARTelemetry = { startRun: startRun, log: log, endRun: endRun };
})(window);
