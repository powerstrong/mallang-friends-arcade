/*
 * 말랑프렌즈 키우기 — 연출 이벤트 버퍼 회귀 테스트 (전투 화면 개편 단계 0)
 *
 *   node games/mallang-idle/tests/queue.test.js
 *
 * 고정하는 것은 두 가지다 (../COMBAT_STAGE_OVERHAUL.md 5절·8절):
 *   1. **사건 유실 0** — 어떤 배속·버스트에서도 pushed === dispatched
 *   2. **밀리지 않는다** — 밀린 큐가 유한 시간에 따라잡히고 backlog 가 발산하지 않는다
 *
 * 사건은 손으로 만들지 않고 **진짜 엔진(combat.js)** 으로 만든다. 손으로 만든 사건은
 * 실제 플레이의 분포를 못 흉내내고, 그러면 이 테스트가 지키는 게 없어진다.
 */
'use strict';

var assert = require('assert');
var Queue = require('../render/queue.js');
var Combat = require('../engine/combat.js');

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

/* 씬 렌더러가 쓰는 것과 같은 계열의 연출 길이 — 시각 beat 만 시간을 차지한다. */
var DUR = {
  mob_spawn: 0.20, mob_kill: 0.55,
  boss_start: 0.70, boss_clear: 0.90, boss_fail: 0.60,
};
function durationOf(ev) { return DUR[ev.type] || 0; }

function makeQueue(sink, opts) {
  opts = opts || {};
  opts.duration = durationOf;
  opts.onEvent = function (ev, info) { sink.push({ type: ev.type, collapsed: info.collapsed }); };
  return Queue.create(opts);
}

/* 엔진을 실제로 굴리면서 큐에 사건을 흘려넣는다.
 * realDt = 화면 프레임 간격, speedMul = 배속(엔진에만 곱해진다 — game.js 와 같은 구조). */
function drive(q, seconds, opts) {
  opts = opts || {};
  var realDt = opts.realDt || 1 / 60;
  var speedMul = opts.speedMul || 1;
  var s = opts.state || Combat.createState();
  // 강화를 좀 해 둬야 실제 플레이처럼 사건이 꾸준히 나온다
  s.gold = 1e6;
  Combat.buy(s, 'atk', 40);
  Combat.buy(s, 'aspd', 12);
  s.events.length = 0;

  var frames = Math.round(seconds / realDt);
  for (var i = 0; i < frames; i++) {
    Combat.step(s, realDt * speedMul);
    q.push(s.events);
    s.events.length = 0;
    q.update(realDt);
  }
  return s;
}

// ── 1. 유실 0 — 이 파일의 핵심 ────────────────────────────────

[1, 5, 20].forEach(function (mul) {
  test('사건 유실 0 — 배속 x' + mul + ' 로 60초 구동', function () {
    var sink = [];
    var q = makeQueue(sink);
    drive(q, 60, { speedMul: mul });
    var st = q.stats();
    assert.ok(st.pushed > 0, '사건이 실제로 발생해야 테스트가 의미 있다: ' + st.pushed);
    // 재생 중인 잔여분까지 포함해 전부 전달되도록 충분히 더 돌린다
    for (var i = 0; i < 1200; i++) q.update(1 / 60);
    st = q.stats();
    assert.strictEqual(st.pushed, st.dispatched,
      '밀어넣은 사건과 전달된 사건 수가 같아야 한다 (유실 0): ' + JSON.stringify(st));
    assert.strictEqual(sink.length, st.pushed, '수신 측 개수도 일치해야 한다');
  });
});

test('사건 유실 0 — dev advance(1시간) 급 대량 투입', function () {
  var sink = [];
  var q = makeQueue(sink);
  var s = Combat.createState();
  s.gold = 1e9;
  Combat.buy(s, 'atk', 120);
  Combat.buy(s, 'aspd', 30);
  s.events.length = 0;

  Combat.step(s, 3600);            // 한 틱에 1시간 — 사건이 통째로 쏟아진다
  var burst = s.events.length;
  assert.ok(burst > 200, '대량 버스트가 실제로 생겨야 한다: ' + burst);
  q.push(s.events);
  s.events.length = 0;
  q.update(1 / 60);

  var st = q.stats();
  assert.strictEqual(st.pushed, st.dispatched,
    '대량 투입에서도 유실이 없어야 한다: ' + JSON.stringify(st));
  assert.ok(st.collapsed > 0, '이 규모는 몰아보기로 처리되어야 한다');
  assert.ok(q.idle(), '몰아본 뒤에는 큐가 비어야 한다');
});

test('사건 유실 0 — 메모리 상한을 넘겨도 (update 없이 push 만)', function () {
  var sink = [];
  var q = makeQueue(sink, { maxQueue: 100 });
  var evs = [];
  for (var i = 0; i < 5000; i++) evs.push({ type: 'mob_kill', gold: 1 });
  q.push(evs);
  var st = q.stats();
  assert.strictEqual(st.pushed, 5000);
  assert.strictEqual(st.dispatched, 5000, 'update 를 안 불러도 상한 초과분은 즉시 전달된다');
});

// ── 2. 페이싱 — 정속 / 가속 / 따라잡기 ────────────────────────

test('정상 플레이에서는 가속하지 않는다 (정속 재생)', function () {
  var sink = [];
  var q = makeQueue(sink);
  drive(q, 30, { speedMul: 1 });
  assert.ok(q.rate() < 1.5,
    '정속 플레이에서 재생 배율이 붙으면 페이싱 설계가 틀린 것: rate=' + q.rate());
  assert.ok(q.backlog() < 2.0, '정속에서 밀림이 쌓이면 안 된다: backlog=' + q.backlog());
});

test('사건이 최소 화면 시간을 갖는다 (즉사해도 눈에 보인다)', function () {
  var sink = [];
  var q = makeQueue(sink);
  q.push([{ type: 'mob_kill' }, { type: 'mob_spawn' }]);
  q.update(0.1);
  assert.strictEqual(sink.length, 1, '첫 사건만 재생 중이어야 한다 — 한 프레임에 다 소진되면 안 된다');
  q.update(0.1);
  assert.strictEqual(sink.length, 1, '아직 첫 사건의 화면 시간이 남아 있다');
  q.update(0.5);
  assert.strictEqual(sink.length, 2, '첫 사건이 끝나면 다음이 이어진다');
});

test('밀리면 가속해서 따라잡는다 (발산하지 않는다)', function () {
  var sink = [];
  var q = makeQueue(sink);
  var evs = [];
  for (var i = 0; i < 20; i++) evs.push({ type: 'mob_kill' });   // 20 × 0.55 = 11초분
  q.push(evs);
  assert.ok(q.rate() > 1, '밀린 상태에서는 재생이 빨라져야 한다: rate=' + q.rate());

  var before = q.backlog();
  for (var f = 0; f < 120; f++) q.update(1 / 60);   // 실시간 2초
  assert.ok(q.backlog() < before, '따라잡는 방향으로 움직여야 한다');

  for (var g = 0; g < 600; g++) q.update(1 / 60);   // 실시간 10초 더
  assert.ok(q.idle(), '유한 시간에 큐가 비어야 한다 (발산 금지)');
  assert.strictEqual(q.stats().pushed, q.stats().dispatched);
});

test('지속적인 고배속에서도 밀림이 유한하게 유지된다', function () {
  var sink = [];
  var q = makeQueue(sink);
  drive(q, 120, { speedMul: 20 });
  // 구동 직후에는 재생 중인 사건이 남아 있는 것이 정상 — 먼저 "밀림이 유한한가"만 본다
  assert.ok(q.backlog() <= q.config.hardBacklog + 1,
    '고배속 장시간 구동에서 밀림이 발산하면 안 된다: backlog=' + q.backlog());
  // 그 다음 남은 것을 전부 배출시키고 유실을 확인한다
  for (var i = 0; i < 1200; i++) q.update(1 / 60);
  assert.ok(q.idle(), '구동을 멈추면 남은 연출이 유한 시간에 소진되어야 한다');
  assert.strictEqual(q.stats().pushed, q.stats().dispatched);
});

// ── 3. 순서·경계 ──────────────────────────────────────────────

test('사건 순서가 보존된다 (FIFO)', function () {
  var sink = [];
  var q = makeQueue(sink);
  q.push([{ type: 'mob_spawn' }, { type: 'mob_kill' }, { type: 'boss_start' }, { type: 'boss_clear' }]);
  for (var i = 0; i < 600; i++) q.update(1 / 60);
  assert.deepStrictEqual(sink.map(function (x) { return x.type; }),
    ['mob_spawn', 'mob_kill', 'boss_start', 'boss_clear']);
});

test('몰아보기에서도 순서와 개수가 보존된다', function () {
  var sink = [];
  var q = makeQueue(sink, { collapseAt: 4 });
  q.push([{ type: 'mob_spawn' }, { type: 'mob_kill' }, { type: 'boss_start' }, { type: 'boss_clear' }]);
  q.update(1 / 60);
  assert.deepStrictEqual(sink.map(function (x) { return x.type; }),
    ['mob_spawn', 'mob_kill', 'boss_start', 'boss_clear']);
  assert.ok(sink.every(function (x) { return x.collapsed; }), '전부 몰아보기 표시로 전달된다');
});

test('시간이 흐르지 않으면 아무 일도 없다 (dt<=0)', function () {
  var sink = [];
  var q = makeQueue(sink);
  q.push([{ type: 'mob_kill' }]);
  q.update(0);
  q.update(-1);
  assert.strictEqual(sink.length, 0, 'dt<=0 에서는 재생되지 않는다 (일시정지·컷신 중)');
});

test('시간을 차지하지 않는 사건은 한 프레임에 통과한다 (강화·유물)', function () {
  var sink = [];
  var q = makeQueue(sink);
  q.push([{ type: 'upgrade' }, { type: 'relic' }, { type: 'mob_kill' }]);
  q.update(1 / 60);
  assert.deepStrictEqual(sink.map(function (x) { return x.type; }), ['upgrade', 'relic', 'mob_kill'],
    '0초 사건은 뒤 사건의 재생을 막지 않는다');
});

test('reset 은 대기 사건을 버리지만 통계는 유실을 보고한다', function () {
  var sink = [];
  var q = makeQueue(sink);
  q.push([{ type: 'mob_kill' }, { type: 'mob_kill' }]);
  q.update(1 / 60);
  q.reset();
  assert.ok(q.idle());
  var st = q.stats();
  assert.ok(st.pushed > st.dispatched, 'reset 으로 버린 사건은 통계에 그대로 드러난다(숨기지 않는다)');
});

var pass = 0, fail = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log('  ok   ' + t.name); pass++; }
  catch (e) { console.log('  FAIL ' + t.name + '\n       ' + e.message); fail++; }
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
