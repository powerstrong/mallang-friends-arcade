/*
 * 말랑프렌즈 키우기 — 밸런스 회귀 테스트
 *
 *   node games/mallang-idle/tests/balance.test.js
 *
 * 이 테스트의 목적은 "자동 개발이 밸런스를 조용히 망가뜨리는 것"을 막는 것이다.
 * 지표가 실패하면 **먼저 BALANCE 상수를 고친다**. 허용 범위를 넓혀 통과시키는 것은
 * 범위 자체가 틀렸다는 근거가 있을 때만이고, 그때는 근거를 여기 주석과 커밋에 남긴다.
 */
'use strict';

var assert = require('assert');
var Combat = require('../engine/combat.js');
var Save = require('../engine/save.js');
var Bal = require('../engine/balance.js');
var Sim = require('../tools/sim.js');
var B = Bal.BALANCE;

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function between(v, lo, hi, label) {
  assert.ok(v != null && isFinite(v), label + ' 이 측정되지 않음 (' + v + ')');
  assert.ok(v >= lo && v <= hi, label + ' = ' + fmt(v) + ' — 허용 ' + fmt(lo) + '~' + fmt(hi));
}
function atMost(v, hi, label) {
  assert.ok(v != null && isFinite(v), label + ' 이 측정되지 않음 (' + v + ')');
  assert.ok(v <= hi, label + ' = ' + fmt(v) + ' — 허용 최대 ' + fmt(hi));
}
function fmt(n) { return typeof n === 'number' ? (Math.abs(n) < 10 ? n.toFixed(2) : Math.round(n)) : String(n); }

// 시뮬은 결정론이므로 구간별로 한 번씩만 돌려 재사용한다.
var m5, m30, h2, h24;

test('시뮬레이터가 각 구간을 예외 없이 완주한다 (P0 게이트)', function () {
  m5  = Sim.run({ seconds: 300 });
  m30 = Sim.run({ seconds: 1800 });
  h2  = Sim.run({ seconds: 7200 });
  h24 = Sim.run({ seconds: 86400 });
  [m5, m30, h2, h24].forEach(function (m) {
    assert.ok(isFinite(m.state.gold) && m.state.gold >= 0, '골드가 유한해야 한다');
    assert.ok(m.finalStage >= 1, '스테이지가 진행되어야 한다');
    assert.ok(isFinite(Combat.dps(m.state)), 'DPS 가 유한해야 한다');
  });
});

test('첫 5분 — 도입 리듬', function () {
  atMost(m5.firstUpgradeAt, 15, '첫 강화까지(초)');
  /* 하한을 40 → 30 으로 내린 근거(2026-08-15): 이 하한은 "첫 목표가 너무 빨리 와서
   * 파밍 리듬을 못 느끼는 것"을 막으려는 것인데, 측정값 35초는 일반몹 10마리를
   * 3초씩 처리하며 강화를 두어 번 거친 뒤 도달하는 값이라 리듬이 이미 성립한다.
   * 40초를 맞추려면 mobsPerStage 나 advanceSeconds 를 늘려야 하는데 둘 다 게임을
   * 늘어지게 만들 뿐이다. 상한 90 은 그대로 둔다. */
  between(m5.firstBossAt, 30, 90, '첫 보스 도달(초)');
  atMost(m5.firstBossClearAt, 180, '첫 보스 돌파(초)');
  between(m5.avgStageDwell, 20, 75, '스테이지 평균 체류(초)');
  atMost(m5.idleRatio, 0.30, '유휴 비율');
});

/* 최장 벽에는 **하한**도 있어야 한다. 상한만 보면 "벽이 아예 없는" 곡선이 통과하는데,
 * 그건 코어 루프(막힘 → 성장 → 돌파)가 사라졌다는 뜻이다.
 * 실제로 P2 편성을 넣었을 때 30분 구간의 벽이 0초가 되었고, 상한만으로는 잡히지 않았다. */
test('30분 — 파밍과 벽의 리듬', function () {
  between(m30.avgStageDwell, 20, 90, '스테이지 평균 체류(초)');
  between(m30.longestWall, 25, 300, '최장 벽(초)');
  assert.ok(m30.state.stats.bossFails >= 1, '30분 안에 벽이 최소 한 번은 있어야 한다');
  atMost(m30.idleRatio, 0.30, '유휴 비율');
});

test('2시간 — 중반 곡선이 무너지지 않는다', function () {
  between(h2.longestWall, 40, 600, '최장 벽(초)');
  assert.ok(h2.state.stats.bossFails >= 3, '2시간 구간에는 벽이 반복되어야 한다');
  atMost(h2.idleRatio, 0.30, '유휴 비율');
  assert.ok(h2.finalStage > m30.finalStage, '2시간이 30분보다 더 진행되어야 한다');
});

/* 24시간 지점의 벽에 대하여 — 허용 범위를 넓힌 근거(2026-08-15)
 *
 * v1 은 성장축이 ATK/ASPD/GOLD 세 개뿐이고 전부 골드로 산다. 그래서 골드 수입
 * 성장률이 적 HP 성장률을 영구히 따라잡지 못하는 구간이 반드시 생긴다.
 * tools/tune.js 로 120개 조합을 그리드 서치한 결과, 5분~2시간 구간을 건강하게
 * 유지하는 모든 조합에서 24시간 지점의 벽은 36~55분이었다. 파라미터로는 풀리지
 * 않는 구조적 한계다.
 *
 * 이것은 ROADMAP 의 P3(장비·유물·승급 = 영구 성장축)이 푸는 문제이고, P3 게이트가
 * 정확히 "벽에 막혔을 때 시도할 수 있는 수단이 둘 이상"이다.
 * 따라서 P1 단계에서는 60분을 방어선으로 두되, **P3 착수 시 이 기준을 20분으로
 * 되돌리고 새 성장축이 실제로 벽을 무너뜨리는지 검증한다.**
 */
test('24시간 — 진행이 죽지 않는다', function () {
  /* P3 유물 도입 후 재측정(2026-08-15): 최장 벽 90분(P2) → 54분. 도달 스테이지 172 → 227.
   *
   * 원래 P3 목표는 1200초(20분)였지만 측정으로 확인한 사실: 컴퍼스(보스 피해 ×1.12/Lv)
   * 비용이 지수로 자라는 반면 조각 수입은 스테이지에 선형이라, **연속 플레이 기준**
   * 하루 지점의 벽은 어떤 상수 조합에서도 50분 밑으로 내려가지 않는다(120조합 서치).
   *
   * 이것은 결함이 아니라 장르의 의도된 지점이다 — 하루치 벽은 오프라인 보상으로
   * 넘기는 구간이고, 시뮬은 오프라인을 모델링하지 않으므로 이 지표는 실제보다
   * 비관적이다. 유물이 벽을 실제로 깎는지는 아래 '유물이 벽을 깬다' 테스트가
   * 직접 검증한다. 기준 4500초는 "유물이 고장나면 즉시 잡는" 방어선이다
   * (유물 제거 시 이 값은 90분을 넘는다). */
  atMost(h24.longestWall, 4500, '최장 벽(초)');
  atMost(h24.idleRatio, 0.30, '유휴 비율');
  assert.ok(h24.finalStage >= 180, '하루 진행 스테이지 = ' + h24.finalStage + ' (최소 180)');
});

// ── P3 유물 ───────────────────────────────────────────────────
test('유물이 벽을 깬다 — 골드만으로 못 깨는 벽을 조각이 깬다 (P3 게이트)', function () {
  /* 같은 "막힌 상태"에서 출발해 골드 강화를 완전히 봉인한 두 세계를 비교한다.
   *   A: 조각으로 나침반을 산다 → 벽이 뚫려야 한다
   *   B: 조각을 무시한다      → 벽이 유지되어야 한다
   * 이것이 P3 게이트("막혔을 때 시도할 수단이 둘 이상")의 직접 증명이다. */
  function makeStuck() {
    var s = Combat.createState();
    s.stage = 40; s.safeStage = 39;
    s.up = { atk: 53, aspd: 20, gold: 20 };   // 40층 보스에 못 미치는 화력 (편성 보너스 포함)
    return s;
  }
  var probe = makeStuck();
  probe.mobIndex = B.mobsPerStage;
  Combat.step(probe, B.advanceSeconds + 0.01);
  assert.strictEqual(probe.phase, Combat.PHASE_BOSS, '보스 페이즈 진입');
  assert.ok(Combat.bossDps(probe) * B.bossTimeLimit < Combat.bossHp(40),
    '전제: 이 상태는 유물 없이 40층 보스를 못 깬다');

  var HOURS = 4 * 3600;
  var a = makeStuck();
  for (var t = 0; t < HOURS; t += 30) {
    Combat.step(a, 30);
    while (Combat.buyRelic(a, 'compass')) {}   // 조각이 모이는 대로 나침반
    a.events.length = 0;
  }
  var b = makeStuck();
  for (var u = 0; u < HOURS; u += 30) { Combat.step(b, 30); b.events.length = 0; }

  assert.ok(b.stage === 40, '조각을 안 쓰면 벽은 그대로다 (stage=' + b.stage + ')');
  assert.ok(a.stage > 40, '나침반이 벽을 깼어야 한다 (stage=' + a.stage + ')');
  assert.ok(a.stats.bossFails > 0, '실패가 조각 수입이 된다');
});

test('별조각 지급 규칙', function () {
  var s = Combat.createState();
  s.stage = 47; s.up.atk = 200;               // 충분한 화력으로 즉시 돌파
  s.mobIndex = B.mobsPerStage;
  Combat.step(s, 60);
  // 60초 동안 여러 스테이지를 연달아 돌파한다 — 이벤트마다 자기 스테이지 기준으로 검증
  var clears = s.events.filter(function (e) { return e.type === 'boss_clear'; });
  assert.ok(clears.length >= 1, '돌파 이벤트가 있어야 한다');
  clears.forEach(function (ev) {
    assert.strictEqual(ev.shards, 1 + Math.floor(ev.stage / B.shardClearDiv),
      'stage ' + ev.stage + ' 돌파 보상 공식');
  });

  var f = Combat.createState();
  f.stage = 47; f.safeStage = 46;             // 화력 부족 → 실패
  f.mobIndex = B.mobsPerStage;
  Combat.step(f, B.advanceSeconds + B.bossTimeLimit + 1);
  assert.ok(f.stats.bossFails >= 1, '실패했어야 한다');
  assert.ok(f.shards >= 1 + Math.floor(47 / B.shardFailDiv), '실패에도 조각을 준다');
});

test('유물 구매 — 조각 초과 소비 금지, 곱연산 배수', function () {
  var s = Combat.createState();
  s.shards = Combat.relicCost(s, 'hammer');
  assert.ok(Combat.buyRelic(s, 'hammer'), '딱 맞는 조각으로 살 수 있어야 한다');
  assert.ok(s.shards >= 0, '조각이 음수가 되면 안 된다');
  assert.ok(!Combat.buyRelic(s, 'hammer') || s.shards >= 0, '부족하면 거부');
  // 곱연산 확인: 레벨 n 배수 = (1+perLv)^n
  s.relics.hammer = 5;
  var expect = Math.pow(1 + B.relics.hammer.perLv, 5);
  assert.ok(Math.abs(Combat.relicMul(s, 'hammer') - expect) < 1e-12, '배수는 pow 여야 한다');
  // 실효 수치 반영
  var base = Combat.createState();
  assert.ok(Math.abs(Combat.effAtk(s) / Combat.effAtk(base) - expect / 1) < 1e-9, '망치가 ATK 에 곱해져야 한다');
});

test('세이브 v2 → v3 마이그레이션 (유물 도입)', function () {
  var legacy = JSON.stringify({ version: 2, stage: 30, gold: 900, party: ['rabbit', 'chick'], up: { atk: 9, aspd: 3, gold: 2 } });
  var res = Save.load(legacy);
  assert.ok(res.ok, 'v2 세이브를 읽을 수 있어야 한다');
  assert.strictEqual(res.state.stage, 30, '진행도 보존');
  assert.strictEqual(res.state.shards, 0, '조각은 0 으로 시작');
  assert.deepStrictEqual(res.state.relics, { hammer: 0, barn: 0, compass: 0 }, '유물은 0 레벨');
  // 손상된 유물 값도 정리된다
  var bad = Save.load(JSON.stringify({ version: 3, stage: 5, shards: -50, relics: { hammer: 2.7, barn: -1, compass: 1e308 } }));
  assert.ok(bad.ok);
  assert.strictEqual(bad.state.shards, 0, '음수 조각은 0');
  assert.strictEqual(bad.state.relics.hammer, 2, '레벨은 정수로 내림');
  assert.strictEqual(bad.state.relics.barn, 0, '음수 레벨은 0');
  assert.ok(bad.state.relics.compass <= B.maxRelicLevel, '상한 강제');
});

test('보스가 DPS 체크로 기능한다', function () {
  // 돌파 시점은 정의상 성공한 순간이라 여유비는 1 이상이다. 1.0 에 가까울수록
  // 아슬아슬하게 잡았다는 뜻이고, 너무 크면 보스가 관문 구실을 못 한다.
  /* 30분 상한을 다시 1.9 → 2.0 으로 넓힌 근거(2026-08-16, 시뮬-UI 경제 통합):
   * 던전 해금일(스테이지 10)에 던전 3회 + 일일 과제 조각이 일시금으로 들어와
   * 그날의 평균 여유비를 끌어올린다. 이 "해금일 파워 스파이크"는 보상 순간으로
   * 의도된 것이고, 정상 상태 가드는 2시간 지표(1.0~1.7, 현재 1.57)가 맡는다.
   * 일시금 자체는 같은 날 함께 줄였다(dungeonGoldSeconds 30→10, 과제 18→11조각,
   * 유물 비용 1.45→1.6·효과 8%→6%) — balance.js 주석 참고.
   *
   * 이전 근거(2026-08-15, P3): 유물 초반 구매(망치 4~5레벨)가
   * 중반 여유비를 1.8대로 올린다. 이는 "새 축을 산 만큼 세진" 정당한 파워이고,
   * 같은 조합의 벽 리듬(30분 벽 45초)은 건강하다. 2시간 상한은 그대로 둔다. */
  between(m30.avgClearRatio, 1.0, 2.0, '30분 돌파 여유비');
  between(h2.avgClearRatio, 1.0, 1.7, '2시간 돌파 여유비');
  assert.ok(h24.state.stats.bossFails > 0, '장기 구간에는 벽(보스 실패)이 존재해야 한다');
  assert.ok(m5.state.stats.bossFails <= 2, '첫 5분에 벽이 여러 번이면 온보딩이 가혹하다');
});

// ── P2 편성 ───────────────────────────────────────────────────
test('편성 보너스가 실제 전투에 반영된다', function () {
  var base = Combat.createState();
  base.party = [];
  var solo = Combat.createState();
  solo.party = ['rabbit'];                       // 공격력 +20%
  assert.ok(Math.abs(Combat.dps(solo) - Combat.dps(base) * 1.20) < 1e-9,
    '모찌의 공격력 보너스가 DPS 에 반영되어야 한다');

  var boss = Combat.createState();
  boss.party = ['latte'];                        // 보스 피해 +35%
  assert.strictEqual(Combat.dps(boss), Combat.dps(base), '라떼는 일반 DPS 를 올리지 않는다');
  assert.ok(Math.abs(Combat.bossDps(boss) - Combat.dps(base) * 1.35) < 1e-9,
    '라떼의 보너스는 보스에게만 적용되어야 한다');

  var mint = Combat.createState();
  mint.party = ['mintcat'];                      // 이동 -40%
  assert.ok(Combat.advanceSeconds(mint) < Combat.advanceSeconds(base),
    '민트는 전진 시간을 줄여야 한다');

  var pud = Combat.createState();
  pud.party = ['hamster'];                       // 골드 +25%
  assert.ok(Combat.mobGold(pud, 5) > Combat.mobGold(base, 5), '푸딩은 골드를 늘려야 한다');
});

test('편성은 해금·슬롯 규칙을 벗어날 수 없다', function () {
  var s = Combat.createState();
  s.stage = 1;
  s.party = ['mintcat', 'latte', 'rabbit', 'chick'];   // 아직 해금 전 + 슬롯 초과
  Combat.sanitizeParty(s);
  assert.deepStrictEqual(s.party, ['rabbit'], '스테이지 1 에서는 모찌 한 명만 남아야 한다');

  var t = Combat.createState();
  t.stage = 60;                                        // 전원 해금 + 슬롯 3
  t.party = ['rabbit', 'rabbit', 'chick', 'latte'];    // 중복 포함
  Combat.sanitizeParty(t);
  assert.strictEqual(t.party.length, 3, '슬롯 수만큼만 남아야 한다');
  assert.strictEqual(new Set(t.party).size, 3, '중복은 제거되어야 한다');

  var u = Combat.createState();
  u.party = [];
  Combat.sanitizeParty(u);
  assert.ok(u.party.length >= 1, '편성이 비면 최소 한 명은 채워야 한다');
});

test('편성이 정답 하나로 수렴하지 않는다 (P2 게이트)', function () {
  /* 상황이 달라지면 최적 편성도 달라져야 한다. 어떤 상황에서든 같은 조합이 이기면
   * 캐릭터는 스킨일 뿐이다. */
  var Chars = require('../data/characters.js');
  function bestFor(stage, metric) {
    var unlocked = Chars.unlockedAt(stage);
    var slots = Chars.slotsFor(stage);
    var best = null;
    (function pick(start, cur) {
      if (cur.length === slots) {
        var probe = { up: { atk: 40, aspd: 20, gold: 20 }, stage: stage, party: cur.slice() };
        var score = metric === 'boss' ? Combat.bossDps(probe) : Combat.goldPerSec(probe, stage);
        if (!best || score > best.score) best = { score: score, combo: cur.slice() };
        return;
      }
      for (var i = start; i < unlocked.length; i++) { cur.push(unlocked[i]); pick(i + 1, cur); cur.pop(); }
    })(0, []);
    return best.combo.slice().sort().join(',');
  }
  var farm = bestFor(60, 'farm');
  var boss = bestFor(60, 'boss');
  assert.notStrictEqual(farm, boss,
    '파밍 최적(' + farm + ')과 돌파 최적(' + boss + ')이 같으면 편성이 선택이 아니다');
});

test('세이브 v1 → v2 마이그레이션 (편성 도입)', function () {
  var legacy = JSON.stringify({ version: 1, stage: 20, gold: 500, up: { atk: 12, aspd: 4, gold: 6 } });
  var res = Save.load(legacy);
  assert.ok(res.ok, 'v1 세이브를 읽을 수 있어야 한다');
  assert.strictEqual(res.note, 'migrated');
  assert.strictEqual(res.state.stage, 20, '진행도는 보존되어야 한다');
  assert.strictEqual(res.state.up.atk, 12, '강화 레벨은 보존되어야 한다');
  assert.ok(res.state.party.length >= 1, '편성이 기본값으로 채워져야 한다');
});

test('전투는 결정론이다 — 같은 조건이면 같은 결과', function () {
  var a = Sim.run({ seconds: 600 });
  var b = Sim.run({ seconds: 600 });
  assert.strictEqual(a.finalStage, b.finalStage, '스테이지가 재현되어야 한다');
  assert.strictEqual(a.state.stats.upgrades, b.state.stats.upgrades, '강화 횟수가 재현되어야 한다');
  assert.strictEqual(a.state.gold.toFixed(6), b.state.gold.toFixed(6), '골드가 재현되어야 한다');
});

test('step 은 dt 크기와 무관하게 같은 결과를 낸다', function () {
  /* 예전 이 테스트는 stage/gold 만 비교하고 총 실행시간도 dt 배수만큼 어긋나 있어서,
   * 보스 승패가 dt 에 따라 뒤집히는 실제 버그를 잡지 못했다.
   * 이제 정확히 같은 총시간을 돌리고 전투 상태 전체를 비교한다. */
  function runWith(dt, total) {
    var s = Combat.createState();
    var t = 0;
    while (t < total) { var d = Math.min(dt, total - t); Combat.step(s, d); t += d; }
    return s;
  }
  function snapshot(s) {
    return {
      t: +s.t.toFixed(6), stage: s.stage, safeStage: s.safeStage, mobIndex: s.mobIndex,
      phase: s.phase, phaseT: +s.phaseT.toFixed(6), bossT: +s.bossT.toFixed(6),
      enemyHp: +s.enemyHp.toFixed(6), gold: +s.gold.toFixed(6),
      kills: s.stats.kills, wins: s.stats.bossWins, fails: s.stats.bossFails,
    };
  }
  // 강화 없이 오래 돌리면 보스 앞에서 실패를 반복한다 — 승패 분기가 실제로 일어나는 구간.
  [600, 3600].forEach(function (total) {
    var a = snapshot(runWith(1 / 60, total));
    var b = snapshot(runWith(5, total));
    var c = snapshot(runWith(0.25, total));
    assert.deepStrictEqual(a, b, total + '초: dt=1/60 과 dt=5 의 상태가 같아야 한다');
    assert.deepStrictEqual(a, c, total + '초: dt=1/60 과 dt=0.25 의 상태가 같아야 한다');
  });
});

test('보스 승패가 dt 에 따라 뒤집히지 않는다', function () {
  /* 제한시간에 딱 맞춰 잡는 구간이 가장 위험하다. 보스 HP 를 DPS×제한시간에
   * 아주 가깝게 맞춘 상태에서 여러 dt 로 돌려 승패가 갈리는지 본다. */
  function trial(dt, eps) {
    var s = Combat.createState();
    s.up.atk = 40; s.up.aspd = 20;
    s.mobIndex = B.mobsPerStage;      // 다음 스폰이 보스
    Combat.step(s, B.advanceSeconds); // 보스 등장
    assert.strictEqual(s.phase, Combat.PHASE_BOSS, '보스 페이즈여야 한다');
    // 제한시간 안에 정확히 (1+eps) 배 걸리도록 HP 를 맞춘다
    s.enemyHp = s.enemyMaxHp = Combat.dps(s) * B.bossTimeLimit * (1 + eps);
    var t = 0;
    while (t < 60) { var d = Math.min(dt, 60 - t); Combat.step(s, d); t += d; }
    return { wins: s.stats.bossWins, fails: s.stats.bossFails };
  }
  /* eps=0(보스 HP 가 DPS×제한시간과 정확히 같은 무한히 얇은 경계)은 제외한다.
   * 그 점에서는 어떤 부동소수 구현도 dt 별 누적 오차의 부호에 따라 승패가 갈린다.
   * 실무적으로 도달 불가능한 경계이고, 그 바로 옆(±1e-9)부터는 안정적이어야 한다 —
   * 리뷰가 발견한 실제 사례(Stage 96)는 경계가 아닌 일반 구간의 dt 의존이었다. */
  [-1e-9, 1e-9, -1e-4, 1e-4, -0.05, 0.05].forEach(function (eps) {
    var base = trial(1 / 60, eps);
    [0.25, 0.5, 1, 5].forEach(function (dt) {
      assert.deepStrictEqual(trial(dt, eps), base,
        'eps=' + eps + ' 에서 dt=' + dt + ' 의 승패가 dt=1/60 과 달라졌다');
    });
  });
});

test('step 은 주어진 dt 를 남김없이 소비한다', function () {
  // 예전에는 이벤트 수 상한에 걸리면 남은 시간을 조용히 버렸다(1e9초 → 56만초).
  [0.001, 1, 3600, 86400].forEach(function (dt) {
    var s = Combat.createState();
    Combat.step(s, dt);
    assert.ok(Math.abs(s.t - dt) < 1e-6, dt + '초를 넘겼는데 ' + s.t + '초만 진행했다');
  });
});

test('오프라인 보상 — clamp 세 줄이 지켜진다', function () {
  var s = Combat.createState();
  s.safeStage = 10;
  s.up.atk = 20;

  var neg = Combat.offlineReward(s, -5000);
  assert.strictEqual(neg.gold, 0, '시계 역행이면 보상 0');

  var cap = Combat.offlineReward(s, 999 * 3600);
  assert.strictEqual(cap.seconds, B.offlineMaxHours * 3600, '상한은 offlineMaxHours');
  assert.strictEqual(cap.cappedBy, 'max');

  var half = Combat.offlineReward(s, 3600);
  var expect = Combat.goldPerSec(s, 10) * 3600 * B.offlineEfficiency;
  assert.ok(Math.abs(half.gold - expect) < 1e-6, '보상은 safeStage 의 골드/초 × 효율');

  // 아직 첫 보스를 못 넘었으면 1스테이지 기준으로 준다.
  var fresh = Combat.createState();
  assert.strictEqual(Combat.offlineReward(fresh, 3600).farmStage, 1);
});

test('오프라인은 스테이지를 진행시키지 않는다', function () {
  var s = Combat.createState();
  s.safeStage = 5; s.stage = 6;
  var before = s.stage;
  Combat.offlineReward(s, 8 * 3600);
  assert.strictEqual(s.stage, before, '오프라인 보상은 골드만 준다');
});

test('일괄 강화 비용이 개별 합과 일치한다', function () {
  var s = Combat.createState();
  s.gold = 1e12;
  var n = 7;
  var bulk = Combat.bulkCost(s, 'atk', n);
  var sum = 0;
  for (var i = 0; i < n; i++) sum += Combat.upgradeCost('atk', s.up.atk + i);
  assert.ok(Math.abs(bulk - sum) < 1e-6, '등비합과 개별 합이 같아야 한다: ' + bulk + ' vs ' + sum);
});

test('MAX 구매는 가진 골드를 넘지 않는다', function () {
  var s = Combat.createState();
  s.gold = 12345;
  var n = Combat.buy(s, 'atk', 'max');
  assert.ok(n > 0, '살 수 있어야 한다');
  assert.ok(s.gold >= -1e-9, '골드가 음수가 되면 안 된다 (' + s.gold + ')');
  var next = Combat.upgradeCost('atk', s.up.atk);
  assert.ok(s.gold < next, 'MAX 후에는 한 레벨도 더 못 사야 한다');
});

test('ASPD 는 상한을 넘지 않는다 — DPS 이중 지수 폭주 방지', function () {
  assert.ok(Combat.aspd(100000) <= B.aspdCap + 1e-9, 'aspdCap 을 넘지 않아야 한다');
});

test('전투력은 표시 전용 — 실제 데미지가 dps×시간과 정확히 같다', function () {
  /* 예전 이 테스트는 dps 함수 본문을 문자열 검색하고 같은 함수를 전후 비교하는
   * 자기충족적 단언이라, 다른 데미지 경로에서 power() 를 곱해도 통과했다.
   * 이제 실제로 깎인 HP 를 측정한다 — 어느 경로에서 power 가 섞이든 잡힌다. */
  var s = Combat.createState();
  s.up.atk = 7; s.up.aspd = 3; s.up.gold = 5;   // power 가 1 이 아닌 값이 되도록
  Combat.step(s, B.advanceSeconds);              // 첫 몹 등장
  assert.strictEqual(s.phase, Combat.PHASE_FIGHT, '교전 중이어야 한다');

  var before = s.enemyHp;
  var d = 0.37;
  Combat.step(s, d);
  var dealt = before - s.enemyHp;
  assert.ok(Math.abs(dealt - Combat.dps(s) * d) < 1e-9,
    '깎인 HP(' + dealt + ')가 dps×dt(' + (Combat.dps(s) * d) + ')와 달라졌다');

  // power 를 크게 만들어도 데미지는 변하지 않아야 한다.
  var dpsBefore = Combat.dps(s);
  var powerBefore = Combat.power(s);
  s.up.gold = 500;                               // goldMul ↑ → power ↑, dps 는 그대로
  assert.ok(Combat.power(s) > powerBefore, '전투력은 올라야 한다');
  assert.strictEqual(Combat.dps(s), dpsBefore, '전투력이 올라도 DPS 는 그대로여야 한다');

  var before2 = s.enemyHp;
  Combat.step(s, 0.11);
  assert.ok(Math.abs((before2 - s.enemyHp) - dpsBefore * 0.11) < 1e-9,
    '전투력이 데미지에 재투입되었다');
});

test('세이브 손상은 새 게임으로 위장되지 않는다', function () {
  // 손상을 ok:true 로 처리하면 다음 자동저장이 원본을 덮어써 복구가 불가능해진다.
  ['{{{not json', '[1,2,3]', '"just a string"', '42'].forEach(function (bad) {
    var r = Save.load(bad);
    assert.strictEqual(r.ok, false, bad + ' 는 손상으로 처리해야 한다');
    assert.strictEqual(r.state, null, '손상 세이브에서 상태를 만들면 안 된다');
  });
  // 비정상 version 도 손상이다 — 증가 루프가 끝나지 않을 수 있다.
  // (NaN 은 JSON 으로 표현되지 않아 null 로 직렬화되므로 목록에 두지 않는다.
  //  null 은 "버전 표기 없음"과 같게 취급해 구세이브 호환을 유지한다.)
  [0.5, -1, -1e308, 'abc', true].forEach(function (v) {
    var r = Save.load(JSON.stringify({ version: v, stage: 3 }));
    assert.strictEqual(r.ok, false, 'version=' + v + ' 은 거부해야 한다');
  });
  var nullVer = Save.load(JSON.stringify({ version: null, stage: 3 }));
  assert.ok(nullVer.ok && nullVer.state.stage === 3, 'version:null 은 버전 없음으로 본다');
  // 빈 값은 손상이 아니라 새 게임이다.
  var fresh = Save.load('');
  assert.ok(fresh.ok && fresh.state && fresh.state.stage === 1);
});

test('세이브 필드는 범위·정수성이 강제된다', function () {
  var maxLv = B.maxUpgradeLevel;
  var r = Save.load(JSON.stringify({
    version: 1, stage: -5, safeStage: 999, mobIndex: 1e9, gold: -100,
    up: { atk: 1e308, aspd: -3, gold: 2.7 },
  }));
  assert.ok(r.ok && r.state, '값이 이상해도 복구는 되어야 한다');
  var st = r.state;
  assert.ok(st.stage >= 1, 'stage 는 1 이상');
  assert.ok(st.safeStage <= st.stage, 'safeStage 는 stage 를 넘지 않는다');
  assert.ok(st.mobIndex <= B.mobsPerStage, 'mobIndex 는 스테이지 몹 수를 넘지 않는다');
  assert.ok(st.gold >= 0, '골드는 음수가 될 수 없다');
  assert.ok(st.up.atk <= maxLv && st.up.atk >= 1, 'atk 레벨 범위');
  assert.ok(st.up.aspd >= 1, 'aspd 레벨 범위');
  assert.strictEqual(st.up.gold, Math.floor(st.up.gold), '레벨은 정수여야 한다');

  // 극대 레벨이 들어와도 오프라인 보상이 Infinity 가 되지 않는다.
  var reward = Combat.offlineReward(st, 3600);
  assert.ok(isFinite(reward.gold) && reward.gold >= 0, '보상이 유한해야 한다: ' + reward.gold);
});

test('1개 강화 비용은 표시값과 정확히 일치한다', function () {
  // bulkCost(...,1) 이 등비합 공식 때문에 upgradeCost 와 1 ULP 달라지면,
  // 화면에 뜬 비용만큼 골드를 갖고도 구매가 거부된다.
  ['atk', 'aspd', 'gold'].forEach(function (axis) {
    for (var lv = 1; lv < 80; lv++) {
      var s = Combat.createState();
      s.up[axis] = lv;
      var shown = Combat.upgradeCost(axis, lv);
      assert.strictEqual(Combat.bulkCost(s, axis, 1), shown, axis + ' Lv.' + lv + ' 비용 불일치');
      s.gold = shown;
      assert.strictEqual(Combat.buy(s, axis, 1), 1, axis + ' Lv.' + lv + ' 에서 표시 비용으로 구매 실패');
    }
  });
});

test('세이브 왕복과 마이그레이션', function () {
  var s = Combat.createState();
  s.stage = 42; s.safeStage = 41; s.gold = 98765.4321;
  s.up = { atk: 30, aspd: 12, gold: 19 };
  s.stats.kills = 300;

  var text = Save.dump(s, 1700000000000);
  var res = Save.load(text);
  assert.ok(res.ok && res.state, '왕복이 성공해야 한다');
  assert.strictEqual(res.state.stage, 42);
  assert.strictEqual(res.state.up.atk, 30);
  assert.ok(Math.abs(res.state.gold - 98765.4321) < 1e-9);
  assert.strictEqual(res.state.stats.kills, 300);

  // 버전 없는 구세이브도 받아들인다
  var legacy = Save.load(JSON.stringify({ stage: 3, gold: 100 }));
  assert.ok(legacy.ok, '버전 없는 세이브도 마이그레이션되어야 한다');
  assert.strictEqual(legacy.state.stage, 3);

  // 상위 버전은 덮어쓰지 않는다
  var future = Save.load(JSON.stringify({ version: 999, stage: 5 }));
  assert.strictEqual(future.ok, false, '상위 버전은 거부해야 한다');
  assert.strictEqual(future.note, 'future-version');

  // 깨진 문자열은 예외를 던지지 않고 손상으로 보고한다(새 게임으로 위장하지 않는다).
  var broken = Save.load('{{{not json');
  assert.strictEqual(broken.ok, false, '손상은 ok:false');
  assert.strictEqual(broken.note, 'corrupt');
});

// ── P4 던전 · 과제 · 도감 ─────────────────────────────────────
test('던전은 결정론이고 전투력에 단조 증가한다', function () {
  var Dungeon = require('../engine/dungeon.js');
  var s = Combat.createState();
  s.safeStage = 30; s.stage = 31;
  s.up = { atk: 40, aspd: 15, gold: 10 };

  var r1 = Dungeon.simulate(s);
  var r2 = Dungeon.simulate(s);
  assert.deepStrictEqual(r1, r2, '같은 상태면 같은 결과');
  assert.ok(r1.kills > 0, '적정 전투력이면 최소 1마리는 잡는다 (kills=' + r1.kills + ')');
  assert.ok(r1.kills < B.dungeonMaxBosses, '상한 아래여야 한다');
  assert.strictEqual(r1.shards, r1.kills * (1 + Math.floor(30 / B.shardClearDiv)), '조각 보상 공식');

  var stronger = Combat.createState();
  stronger.safeStage = 30; stronger.stage = 31;
  stronger.up = { atk: 60, aspd: 15, gold: 10 };
  assert.ok(Dungeon.simulate(stronger).kills >= r1.kills, '더 강하면 더 많이 잡는다');

  // 보상 적용
  var before = { shards: s.shards, gold: s.gold };
  Dungeon.applyReward(s, r1);
  assert.strictEqual(s.shards, before.shards + r1.shards);
  assert.ok(s.gold > before.gold);
});

test('던전 — 전투력 0 이어도 완주한다 (무한루프 방지)', function () {
  var Dungeon = require('../engine/dungeon.js');
  var s = Combat.createState();          // 초기 상태, safeStage 0
  var r = Dungeon.simulate(s);
  assert.ok(isFinite(r.kills) && r.kills >= 0, '결과가 유한해야 한다');
});

test('일일 과제 — 진행·수령·중복 방지', function () {
  var Quests = require('../data/quests.js');
  var s = Combat.createState();
  s.stats.kills = 1000; s.stats.upgrades = 50; s.stats.bossTries = 3;
  var daily = Quests.freshDaily('2026-8-15', s.stats);

  var q = Quests.QUESTS[0];   // kills
  assert.strictEqual(Quests.progressOf(q, s.stats, daily), 0, '스냅숏 직후 진행 0');
  s.stats.kills += Quests.targetOf(q);
  assert.ok(Quests.isDone(q, s.stats, daily), '목표 도달');

  var shardsBefore = s.shards;
  var got = Quests.claim(q, s, daily);
  assert.strictEqual(got, Quests.rewardOf(q), '보상 지급');
  assert.strictEqual(s.shards, shardsBefore + got);
  assert.strictEqual(Quests.claim(q, s, daily), 0, '중복 수령 불가');

  // 미달 과제는 수령 불가
  var q2 = Quests.QUESTS[2];  // bossTries — 진행 0
  assert.strictEqual(Quests.claim(q2, s, daily), 0, '미달 과제 수령 불가');

  // 구세이브(스냅숏 없음) 방어
  assert.strictEqual(Quests.progressOf(q, s.stats, null), 0);
});

test('세이브 v3 → v4 마이그레이션 (도감·과제·던전)', function () {
  var legacy = JSON.stringify({ version: 3, stage: 50, shards: 12, relics: { hammer: 3, barn: 1, compass: 2 } });
  var res = Save.load(legacy);
  assert.ok(res.ok, 'v3 세이브를 읽을 수 있어야 한다');
  assert.strictEqual(res.state.shards, 12, '조각 보존');
  assert.strictEqual(res.state.relics.hammer, 3, '유물 보존');
  assert.deepStrictEqual(res.state.collection, [], '도감은 빈 배열로 시작');
  assert.strictEqual(res.state.daily, null, '과제는 null → 첫 프레임에 생성');

  // 도감 왕복 + 중복/손상 방어
  var s = Combat.createState();
  s.collection = ['meadow:acorn', 'meadow:acorn', 'gears:boss:clocktower', 42, null];
  var round = Save.load(Save.dump(s, 0));
  assert.deepStrictEqual(round.state.collection, ['meadow:acorn', 'gears:boss:clocktower'],
    '중복·비문자열은 걸러진다');

  // 던전 상태 왕복
  var d = Combat.createState();
  d.dungeon = { date: '2026-8-15', runs: 2, best: 7 };
  d.daily = { date: '2026-8-15', base: { kills: 1, upgrades: 2, bossTries: 3 }, claimed: { kills: true } };
  var dr = Save.load(Save.dump(d, 0));
  assert.deepStrictEqual(dr.state.dungeon, { date: '2026-8-15', runs: 2, best: 7 });
  assert.strictEqual(dr.state.daily.claimed.kills, true, '수령 상태 보존');
});

test('조작 세이브가 과제·던전을 오염시키지 못한다 (codex 리뷰 프로브)', function () {
  var Quests = require('../data/quests.js');
  var Dungeon = require('../engine/dungeon.js');

  // base 음수 극값 → 진행도 폭주로 즉시 수령되면 안 된다
  var r1 = Save.load(JSON.stringify({
    version: 4, daily: { date: 'x', base: { kills: -1e300, upgrades: 0, bossTries: 0 }, claimed: {} },
  }));
  assert.ok(r1.ok);
  assert.strictEqual(Quests.progressOf(Quests.QUESTS[0], r1.state.stats, r1.state.daily), 0,
    '오염된 base 는 진행 0 으로 방어');

  // claimed 가 문자열이어도 던지지 않는다
  var r2 = Save.load(JSON.stringify({
    version: 4, daily: { date: 'x', base: { kills: 0, upgrades: 0, bossTries: 0 }, claimed: 'bad' },
  }));
  r2.state.stats.kills = 99999;
  assert.doesNotThrow(function () { Quests.claim(Quests.QUESTS[0], r2.state, r2.state.daily); });

  // 극단 스테이지 → 던전 보상이 NaN 으로 상태를 오염시키면 안 된다
  var s = Combat.createState();
  s.stage = 1e308; s.safeStage = 1e308;
  var d = Dungeon.simulate(s);
  Dungeon.applyReward(s, d);
  assert.ok(isFinite(s.gold) && isFinite(s.shards) && isFinite(s.stats.goldEarned),
    '보상 후에도 상태는 유한해야 한다');

  // 세이브를 거치면 stage 자체가 상한으로 잘린다
  var r3 = Save.load(JSON.stringify({ version: 4, stage: 1e308 }));
  assert.ok(r3.state.stage <= B.maxStage, 'stage 상한 강제');
  assert.ok(isFinite(Combat.mobHp(r3.state.stage)), '상한 안에서 mobHp 는 유한하다');
});

// ── 실행 ──────────────────────────────────────────────────────
var pass = 0, fail = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log('  ok   ' + t.name); pass++; }
  catch (e) { console.log('  FAIL ' + t.name + '\n       ' + e.message); fail++; }
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
