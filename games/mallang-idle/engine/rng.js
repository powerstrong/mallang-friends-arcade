/*
 * 말랑프렌즈 키우기 — seeded RNG
 *
 * Math.random() 은 이 게임 어디에서도 쓰지 않는다. 시뮬레이터 결과가 재현되지
 * 않으면 지표를 신뢰할 수 없고, 밸런스 회귀 테스트가 무의미해진다.
 *
 * mulberry32 — 32bit 시드, 빠르고 분포가 충분히 균일하다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleRng = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(seed) {
    var a = (seed >>> 0) || 1;
    function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      // [min, max) 실수
      range: function (min, max) { return min + next() * (max - min); },
      // [0, n) 정수
      int: function (n) { return Math.floor(next() * n); },
      // 확률 p 로 true
      chance: function (p) { return next() < p; },
      // 배열에서 하나
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      // 현재 시드 상태(직렬화용)
      state: function () { return a >>> 0; },
    };
  }

  return { create: create };
});
