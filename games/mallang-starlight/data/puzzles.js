/*
 * 별빛 구조 퍼즐 콘텐츠.
 * 모든 퍼즐은 tests/puzzles.test.js의 BFS 솔버로 다음을 회귀 검증한다:
 *   (1) beatLimit 안에 풀린다  (2) 무피해(2별) 해법이 존재한다
 *   (3) par == 최적 비트 수(3별 조건)  (4) 능력 없이는 못 푼다(밀기/당기기 필수)
 *   (5) 유닛/장애물이 겹치지 않고 바닥 위에서 시작한다
 *
 * 포탑(turret)은 스스로 움직이거나 수리되지 않으므로, 밀기·당기기로 벽/수리별/다른
 * 장난감에 부딪히게 만들어야만 수리된다 → 재배선 메커니즘이 항상 강제된다.
 *
 * terrain: 0=바닥, 1=벽.  role: pusher=라떼(밀기), puller=민트(당기기).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangPuzzles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var O = 0, W = 1;
  var LATTE = 'assets/runtime/tokens/latte.webp';
  var MINT = 'assets/runtime/tokens/mint.webp';
  var TURRET = 'assets/runtime/tokens/enemy-turret.webp';

  function latte(x, y) { return { id: 'latte', name: '라떼', role: 'pusher', x: x, y: y, mov: 3, hearts: 2, emoji: '🐶', asset: LATTE }; }
  function mint(x, y) { return { id: 'mint', name: '민트', role: 'puller', x: x, y: y, mov: 3, range: 3, hearts: 2, emoji: '🐱', asset: MINT }; }
  function turret(id, x, y, repair) { return { id: id, name: '반짝포탑', kind: 'turret', x: x, y: y, range: 3, repair: repair || 1, emoji: '📡', asset: TURRET }; }
  function star(id, x, y) { return { id: id, kind: 'repair-star', x: x, y: y, label: '수리별' }; }

  var LIST = [
    {
      id: 'p1-push', order: 1, par: 1,
      title: '밀어서 벽으로', location: '장난감 공방 골목',
      brief: '반짝포탑은 스스로 움직이지 못해요. 밀거나 당겨서 벽에 부딪히게 하면 수리됩니다.',
      hint: '민트를 포탑 옆으로 옮겨 포탑을 벽 쪽으로 당기면, 부딪히며 한 번에 수리돼요.',
      width: 5, height: 5,
      terrain: [[O,O,O,O,O],[O,O,O,O,O],[W,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O]],
      objective: { type: 'repair-all', beatLimit: 2 },
      friends: [latte(4, 2), mint(1, 4)],
      toys: [turret('t1', 2, 2, 1)]
    },
    {
      id: 'p2-star', order: 2, par: 1,
      title: '수리별 위로', location: '별빛 정비소',
      brief: '가운데 빛나는 수리별(⭐)에 올라선 장난감은 즉시 수리돼요.',
      hint: '포탑을 밀거나 당겨 한 비트 만에 가운데 수리별 위로 올려 놓으세요.',
      width: 5, height: 5,
      terrain: [[O,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O]],
      objective: { type: 'repair-all', beatLimit: 2 },
      props: [star('star1', 2, 2)],
      friends: [latte(0, 2), mint(4, 2)],
      toys: [turret('t1', 2, 4, 1)]
    },
    {
      id: 'p3-corner', order: 3, par: 2,
      title: '구석으로 몰기', location: '퍼레이드 길',
      brief: '벽이 멀면 한 번에 못 붙여요. 두 비트에 걸쳐 벽까지 몰아 붙이세요.',
      hint: '먼저 포탑을 오른쪽 벽 앞까지 옮기고, 다음 비트에 벽으로 밀어 부딪히게 하세요.',
      width: 5, height: 5,
      terrain: [[O,O,O,O,O],[O,O,O,O,O],[O,O,O,O,W],[O,O,O,O,O],[O,O,O,O,O]],
      objective: { type: 'repair-all', beatLimit: 3 },
      friends: [latte(0, 0), mint(0, 4)],
      toys: [turret('t1', 3, 2, 1)]
    },
    {
      id: 'p4-two', order: 4, par: 1,
      title: '둘을 한 번에', location: '시계탑 앞뜰',
      brief: '포탑이 둘! 두 친구가 각자 하나씩 맡으면 한 비트에 끝낼 수 있어요.',
      hint: '라떼는 왼쪽 위 포탑을, 민트는 오른쪽 아래 포탑을 각자 모서리 벽으로 보내세요.',
      width: 5, height: 5,
      terrain: [[W,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O],[O,O,O,O,W]],
      objective: { type: 'repair-all', beatLimit: 3 },
      friends: [latte(2, 2), mint(2, 3)],
      toys: [turret('t1', 1, 1, 1), turret('t2', 3, 3, 1)]
    },
    {
      id: 'p5-sturdy', order: 5, par: 2,
      title: '튼튼한 포탑', location: '시계탑 제어실',
      brief: '이 포탑은 튼튼해서 세 번 부딪혀야 수리돼요. 벽에 붙여 두고 반복하세요.',
      hint: '두 친구가 같은 비트에 함께 밀고 당겨 부딪힘을 겹치면 두 비트로 끝낼 수 있어요.',
      width: 5, height: 5,
      terrain: [[O,O,O,O,O],[O,O,O,O,O],[W,O,O,O,O],[O,O,O,O,O],[O,O,O,O,O]],
      objective: { type: 'repair-all', beatLimit: 3 },
      friends: [latte(4, 2), mint(1, 4)],
      toys: [turret('t1', 1, 2, 3)]
    }
  ];

  var BY_ID = {}; LIST.forEach(function (p) { BY_ID[p.id] = p; });
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function listIds() { return LIST.map(function (p) { return p.id; }); }
  function create(id) { if (!BY_ID[id]) throw new Error('Unknown puzzle: ' + id); return clone(BY_ID[id]); }
  function list() { return LIST.map(function (p) { return clone(p); }); }
  return { version: 1, listIds: listIds, create: create, list: list };
});
