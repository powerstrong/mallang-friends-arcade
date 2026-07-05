/* rush-engine.js — 말랑 깜짝파티 순수 코어 (window/globalThis 전역, DOM 무의존)
 *
 * 역할: 시드 결정적 미션 순서 · 속도 곡선 · 목숨 · 콤보 · 점수.
 * 같은 seedString 이면 어느 클라에서나 완전히 같은 미션 순서가 나온다.
 * 성공/실패는 순서 rng 스트림을 소비하지 않으므로, 개별 플레이어의 성패가
 * 이후 미션 순서를 바꾸지 않는다 (멀티 공정성의 핵심 계약).
 *
 * Node 테스트 가능: require/import 시 globalThis.SurpriseRushEngine 로 노출.
 */
(function (root) {
  'use strict';

  var MAX_SPEED = 2.0;
  var SPEED_STEP = 0.15;
  var SPEED_EVERY = 4;   // 4라운드마다 스피드 업
  var MIN_DURATION_MS = 1200;
  var START_LIVES = 3;

  // 문자열 → uint32 시드 (FNV-1a)
  function hashSeed(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32 — 가볍고 결정적인 PRNG
  function createRng(seedUint) {
    var a = seedUint >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function speedForRound(round) {
    var s = 1 + Math.floor((round - 1) / SPEED_EVERY) * SPEED_STEP;
    return Math.min(MAX_SPEED, Math.round(s * 100) / 100);
  }

  /* create({ seedString, catalog })
   *   catalog: [{ id, baseMs }] — 미션 메타(렌더 모듈과 분리된 최소 정보)
   */
  function create(opts) {
    opts = opts || {};
    var catalog = (opts.catalog || []).slice();
    if (catalog.length < 2) throw new Error('SurpriseRushEngine: catalog 는 2개 이상 필요합니다.');
    var seqRng = createRng(hashSeed(opts.seedString || 'solo'));

    var state = {
      round: 0,        // 마지막으로 시작한 라운드 (1-based)
      lives: START_LIVES,
      score: 0,
      combo: 0,
      bestCombo: 0,
      dead: false,
    };
    var lastGameId = null;

    return {
      // 다음 라운드를 뽑는다. 죽은 뒤에도 호출 자체는 막지 않는다(관전/리플레이 대비).
      nextRound: function () {
        state.round += 1;
        var speed = speedForRound(state.round);
        // 직전 미션 즉시 반복 금지
        var pick;
        do {
          pick = catalog[Math.floor(seqRng() * catalog.length) % catalog.length];
        } while (catalog.length > 1 && pick.id === lastGameId);
        lastGameId = pick.id;
        // 라운드 내부 배치용 시드 — 순서 스트림에서 파생하므로 전 클라 동일
        var roundSeed = Math.floor(seqRng() * 4294967296) >>> 0;
        return {
          round: state.round,
          gameId: pick.id,
          speed: speed,
          durationMs: Math.max(MIN_DURATION_MS, Math.round(pick.baseMs / speed)),
          roundSeed: roundSeed,
          speedUp: state.round > 1 && (state.round - 1) % SPEED_EVERY === 0,
        };
      },

      // 라운드 결과 보고. rng 를 소비하지 않는다(순서 불변 계약).
      reportResult: function (success) {
        var gained = 0;
        if (success) {
          state.combo += 1;
          if (state.combo > state.bestCombo) state.bestCombo = state.combo;
          gained = 100 + (state.combo - 1) * 25;
          state.score += gained;
        } else {
          state.combo = 0;
          state.lives -= 1;
          if (state.lives <= 0) { state.lives = 0; state.dead = true; }
        }
        return {
          success: !!success,
          gained: gained,
          lives: state.lives,
          score: state.score,
          combo: state.combo,
          dead: state.dead,
        };
      },

      getState: function () {
        return {
          round: state.round, lives: state.lives, score: state.score,
          combo: state.combo, bestCombo: state.bestCombo, dead: state.dead,
        };
      },
    };
  }

  root.SurpriseRushEngine = {
    create: create,
    createRng: createRng,
    hashSeed: hashSeed,
    speedForRound: speedForRound,
    START_LIVES: START_LIVES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
