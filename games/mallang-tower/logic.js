/*
 * 말랑 타워 — 순수 로직(렌더·DOM 없음).
 *
 * 블록은 { x, w } 로 표현한다(x = 왼쪽 끝, w = 폭, 논리 픽셀).
 * 이 파일은 브라우저(window.TowerLogic)와 Node(require) 양쪽에서 쓸 수 있어
 * tests/logic.test.js 가 스택 판정을 결정론적으로 회귀 검증한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TowerLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * 떨어뜨린 블록(block)을 맨 위 블록(top) 위에 얹은 결과를 계산한다.
   *   - hit=false  : 겹치는 부분이 없다 → 완전히 빗나감(게임 오버).
   *   - perfect    : 어긋남이 perfectTol 이하 → 잘림 없이 딱 맞음.
   *   - newBlock   : 새로 얹힌 블록의 { x, w }(겹친 영역, perfect면 top에 정렬).
   *   - slices     : 잘려 떨어지는 조각들의 { x, w } 목록.
   */
  function computeDrop(top, block, perfectTol) {
    var tol = perfectTol || 0;
    var left = Math.max(top.x, block.x);
    var right = Math.min(top.x + top.w, block.x + block.w);
    var overlap = right - left;
    if (overlap <= 0) return { hit: false, perfect: false, newBlock: null, slices: [] };

    var perfect = Math.abs(block.x - top.x) <= tol;
    if (perfect) {
      return { hit: true, perfect: true, newBlock: { x: top.x, w: top.w }, slices: [] };
    }

    var slices = [];
    if (block.x < left) slices.push({ x: block.x, w: left - block.x });                    // 왼쪽 삐져나온 조각
    if (block.x + block.w > right) slices.push({ x: right, w: (block.x + block.w) - right }); // 오른쪽 삐져나온 조각
    return { hit: true, perfect: false, newBlock: { x: left, w: overlap }, slices: slices };
  }

  // 딱 맞출 때마다 폭을 조금 되살린다(상한 = 최초 폭). 살아남는 손맛.
  function grow(width, amount, maxWidth) {
    return Math.min(maxWidth, width + amount);
  }

  // 층이 오를수록 블록이 빨라진다(상한 있음).
  function speedForFloor(floor, base, inc, max) {
    return Math.min(max, base + floor * inc);
  }

  // 별 3개 기준(결과 화면용 선택 지표): 높이에 따른 등급.
  function ratingForFloors(floors) {
    if (floors >= 25) return 3;
    if (floors >= 12) return 2;
    if (floors >= 5) return 1;
    return 0;
  }

  return { computeDrop: computeDrop, grow: grow, speedForFloor: speedForFloor, ratingForFloors: ratingForFloors };
});
