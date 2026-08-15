/*
 * 말랑프렌즈 키우기 — 밸런스 그리드 서치
 *
 *   node games/mallang-idle/tools/tune.js
 *   node games/mallang-idle/tools/tune.js --top=10
 *
 * 24시간 시뮬이 0.2초에 도는 덕분에 파라미터 조합을 수백 개 돌려볼 수 있다.
 * 손으로 상수를 바꿔가며 감으로 맞추지 말고, 목표 지표를 점수화해서 찾는다.
 *
 * 주의: 이 스크립트는 BALANCE 객체를 런타임에 덮어쓴다. 결과로 나온 값을
 * engine/balance.js 에 직접 반영하는 것은 사람이 판단해서 한다.
 */
'use strict';

var Bal = require('../engine/balance.js');
var Sim = require('./sim.js');
var B = Bal.BALANCE;

/* ── 목표 구간 ────────────────────────────────────────────────
 * 방치형은 후반으로 갈수록 스테이지 체류가 길어지는 것이 정상이다.
 * 그래서 "전 구간 평균"이 아니라 구간별로 다른 기준을 둔다. */
var GOALS = [
  { key: 'm5',  seconds: 300,   checks: {
      firstUpgradeAt:   { max: 15 },
      firstBossAt:      { min: 40, max: 90 },
      firstBossClearAt: { max: 180 },
      avgStageDwell:    { min: 20, max: 60 },
      idleRatio:        { max: 0.30 },
  }},
  /* 최장 벽에 **하한**을 둔다. 상한만 보면 "벽이 아예 없는" 곡선이 만점을 받는데,
   * 그건 코어 루프(막힘 → 성장 → 돌파)가 사라졌다는 뜻이다. P2 편성을 넣자
   * 실제로 30분 구간의 벽이 0초가 되었고 상한만으로는 잡히지 않았다. */
  { key: 'm30', seconds: 1800,  checks: {
      avgStageDwell:    { min: 20, max: 90 },
      longestWall:      { min: 25, max: 300 },
      bossFailCount:    { min: 1 },
      idleRatio:        { max: 0.30 },
      avgClearRatio:    { min: 1.0, max: 1.7 },
  }},
  { key: 'h2',  seconds: 7200,  checks: {
      longestWall:      { min: 40, max: 600 },
      bossFailCount:    { min: 3 },
      idleRatio:        { max: 0.30 },
      avgClearRatio:    { min: 1.0, max: 1.7 },
  }},
  { key: 'h24', seconds: 86400, checks: {
      longestWall:      { max: 3600 },   // 성장축이 3개뿐인 v1 의 구조적 한계 — BALANCE.md 참고
      idleRatio:        { max: 0.30 },
      avgClearRatio:    { min: 1.0, max: 1.7 },
      finalStage:       { min: 150 },    // 하루 만에 진행이 죽지 않아야 한다
  }},
];

/* 이탈도를 상대 오차로 환산해 더한다. 0 이면 모든 목표 충족. */
function penalty(value, rule) {
  if (value == null || !isFinite(value)) return 5;
  var p = 0;
  if (rule.min != null && value < rule.min) p += (rule.min - value) / Math.max(Math.abs(rule.min), 1e-6);
  if (rule.max != null && value > rule.max) p += (value - rule.max) / Math.max(Math.abs(rule.max), 1e-6);
  return p;
}

function evaluate() {
  var total = 0;
  var detail = {};
  for (var i = 0; i < GOALS.length; i++) {
    var g = GOALS[i];
    var m = Sim.run({ seconds: g.seconds });
    var sub = 0;
    for (var k in g.checks) {
      if (!Object.prototype.hasOwnProperty.call(g.checks, k)) continue;
      sub += penalty(m[k], g.checks[k]);
    }
    detail[g.key] = { score: sub, m: m };
    total += sub;
  }
  return { score: total, detail: detail };
}

/* ── 그리드 ─────────────────────────────────────────────────── */
var GRID = {
  mobHpGrowth:      [1.150, 1.158, 1.165, 1.172, 1.180],
  goldGrowth:       [1.150, 1.158, 1.165, 1.172],
  bossHpMultiplier: [6, 8, 10, 12],
  costAtkGrowth:    [1.120, 1.135, 1.150],
};

function apply(combo) {
  B.mobHpGrowth = combo.mobHpGrowth;
  B.goldGrowth = combo.goldGrowth;
  B.bossHpMultiplier = combo.bossHpMultiplier;
  B.costGrowth.atk = combo.costAtkGrowth;
}

function main() {
  var topN = 5;
  process.argv.slice(2).forEach(function (a) {
    var m = a.match(/^--top=(\d+)$/);
    if (m) topN = parseInt(m[1], 10);
  });

  var results = [];
  var count = 0;
  var started = Date.now();

  GRID.mobHpGrowth.forEach(function (hp) {
    GRID.goldGrowth.forEach(function (gold) {
      if (gold >= hp) return;   // 골드가 적 HP 보다 빨리 자라면 벽이 아예 없다
      GRID.bossHpMultiplier.forEach(function (bm) {
        GRID.costAtkGrowth.forEach(function (ca) {
          var combo = { mobHpGrowth: hp, goldGrowth: gold, bossHpMultiplier: bm, costAtkGrowth: ca };
          apply(combo);
          var r = evaluate();
          results.push({ combo: combo, score: r.score, detail: r.detail });
          count++;
        });
      });
    });
  });

  results.sort(function (a, b) { return a.score - b.score; });

  console.log('조합 ' + count + '개 평가, ' + ((Date.now() - started) / 1000).toFixed(1) + 's\n');
  for (var i = 0; i < Math.min(topN, results.length); i++) {
    var r = results[i];
    var c = r.combo;
    console.log('#' + (i + 1) + '  점수 ' + r.score.toFixed(3));
    console.log('   mobHpGrowth=' + c.mobHpGrowth + '  goldGrowth=' + c.goldGrowth +
                '  bossHpMultiplier=' + c.bossHpMultiplier + '  costGrowth.atk=' + c.costAtkGrowth);
    ['m5', 'm30', 'h2', 'h24'].forEach(function (k) {
      var m = r.detail[k].m;
      console.log('   ' + k.padEnd(4) +
        ' stage=' + String(m.finalStage).padStart(4) +
        '  체류=' + Sim.fmtTime(m.avgStageDwell).padStart(7) +
        '  최장벽=' + Sim.fmtTime(m.longestWall).padStart(8) +
        '  유휴=' + (m.idleRatio * 100).toFixed(1).padStart(5) + '%' +
        '  여유비=' + (m.avgClearRatio == null ? '  —  ' : m.avgClearRatio.toFixed(2)));
    });
    console.log('');
  }
}

if (require.main === module) main();
module.exports = { evaluate: evaluate, GOALS: GOALS };
