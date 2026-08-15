/*
 * 말랑프렌즈 키우기 — 헤드리스 밸런스 시뮬레이터
 *
 * UI 를 3시간 플레이하며 곡선을 보는 것은 자동 개발에서 불가능하다.
 * 이 시뮬레이터가 유일한 피드백 채널이다(../BALANCE.md 3절).
 *
 *   node games/mallang-idle/tools/sim.js --minutes=30
 *   node games/mallang-idle/tools/sim.js --hours=24 --json
 *
 * 게임 화면과 같은 engine/combat.js 를 쓴다. 전투 로직을 여기에 다시 구현하면
 * 지표가 거짓말을 하게 되므로 절대 복제하지 않는다.
 */
'use strict';

var Combat = require('../engine/combat.js');
var Bal = require('../engine/balance.js');
var Chars = require('../data/characters.js');
var B = Bal.BALANCE;
var AXES = Bal.AXES;
var POLICY = Bal.SIM_POLICY;

/* ── 편성 정책 ───────────────────────────────────────────────
 * 슬롯이 열리거나 새 친구가 해금되면 다시 짠다. 후보 조합을 전부 만들어
 * "지금 상황에서의 골드/초"로 점수를 매기되, 보스에 막혀 있으면 돌파력(보스 DPS)을
 * 기준으로 고른다 — 실제 플레이어가 하는 판단과 같다. */
function combinations(arr, k) {
  var out = [];
  (function pick(start, cur) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (var i = start; i < arr.length; i++) { cur.push(arr[i]); pick(i + 1, cur); cur.pop(); }
  })(0, []);
  return out;
}

function bestParty(state, stuck) {
  var slots = Chars.slotsFor(state.stage);
  var unlocked = Chars.unlockedAt(state.stage);
  if (unlocked.length <= slots) return unlocked.slice();

  var probe = { up: state.up, stage: state.stage, party: [] };
  var best = null;
  combinations(unlocked, slots).forEach(function (combo) {
    probe.party = combo;
    var score = stuck ? Combat.bossDps(probe) : Combat.goldPerSec(probe, state.stage);
    if (!best || score > best.score) best = { score: score, combo: combo };
  });
  return best ? best.combo : unlocked.slice(0, slots);
}

/* ── 플레이어 대역 정책 ──────────────────────────────────────────
 * 모든 축의 가치를 "골드/초 증가량 ÷ 비용"이라는 하나의 척도로 환산한다.
 * DPS 축(atk/aspd)은 보스 돌파에도 기여하므로 dpsBonusWeight 만큼 가중한다.
 * 이 정책을 바꾸면 지표가 바뀐다 → 변경 시 커밋 메시지에 남길 것. */
function bestAxis(state, dpsOnly) {
  var stage = state.stage;
  var base = Combat.goldPerSec(state, stage);
  var best = null;

  for (var i = 0; i < AXES.length; i++) {
    var axis = AXES[i].id;
    if (dpsOnly && axis === 'gold') continue;

    var cost = Combat.upgradeCost(axis, state.up[axis]);
    if (state.gold < cost) continue;

    /* 얕은 probe — clone 없이 up 만 바꿔 골드/초를 다시 계산한다.
     * party 를 반드시 함께 넘겨야 한다. 빠뜨리면 보너스가 빠진 probe 와 보너스가 실린
     * base 를 비교하게 되어 모든 강화의 이득이 음수가 되고, 시뮬이 한 번도 강화하지 않는다. */
    var probeUp = { atk: state.up.atk, aspd: state.up.aspd, gold: state.up.gold };
    probeUp[axis] += 1;
    var gain = Combat.goldPerSec({ up: probeUp, party: state.party, stage: stage }, stage) - base;
    if (!(gain > 0)) continue;

    var weight = (axis === 'gold') ? 1 : POLICY.dpsBonusWeight;
    var value = (gain * weight) / cost;
    if (!best || value > best.value) best = { axis: axis, value: value };
  }
  return best;
}

/* 다음 강화를 살 수 있게 되기까지 걸릴 시간(초). 유휴 지표의 기준이다.
 * 이미 살 수 있으면 0. 골드 수입이 없으면 Infinity.
 *
 * 두 가지를 실제 플레이에 맞춘다.
 *  - dpsOnly(벽에 막힌 상태)일 때는 GOLD 축을 사지 않으므로 후보에서 뺀다.
 *    그러지 않으면 "곧 살 수 있다"고 착각해 유휴를 과소평가한다.
 *  - 보스에 실패하는 동안 흘려보내는 제한시간은 수입이 0 이다. 벽에 막힌 상태에서는
 *    그만큼 실효 수입을 깎아 실제 대기 시간에 가깝게 만든다. */
function waitForNextUpgrade(state, dpsOnly) {
  var cheapest = Infinity;
  for (var i = 0; i < AXES.length; i++) {
    var axis = AXES[i].id;
    if (dpsOnly && axis === 'gold') continue;
    var c = Combat.upgradeCost(axis, state.up[axis]);
    if (c < cheapest) cheapest = c;
  }
  var need = cheapest - state.gold;
  if (need <= 0) return 0;

  var gps = Combat.goldPerSec(state, state.stage);
  if (!(gps > 0)) return Infinity;
  if (dpsOnly) {
    // 한 사이클 = 일반몹 mobsPerStage 마리 + 보스 제한시간(수입 없음)
    var farmSec = B.mobsPerStage * (B.advanceSeconds + Combat.mobHp(state.stage) / Combat.dps(state));
    gps *= farmSec / (farmSec + B.bossTimeLimit);
  }
  return need / gps;
}

function decide(state, dpsOnly) {
  var bought = 0;
  for (var n = 0; n < POLICY.maxBulkPerDecision; n++) {
    var pick = bestAxis(state, dpsOnly);
    if (!pick) break;
    if (!Combat.buy(state, pick.axis, 1)) break;
    bought++;
  }
  return bought;
}

/* ── 시뮬레이션 ─────────────────────────────────────────────── */
function run(opts) {
  opts = opts || {};
  var duration = opts.seconds || 300;
  var dt = POLICY.decisionInterval;

  var s = Combat.createState();

  var m = {
    duration: duration,
    firstUpgradeAt: null,
    firstBossAt: null,
    firstBossClearAt: null,
    idleSeconds: 0,
    stageDwell: [],        // 스테이지별 체류 시간
    longestWall: 0,        // 보스 첫 실패 → 돌파까지 가장 오래 걸린 시간
    longestWallStage: null,
    clearRatios: [],       // 돌파 시점의 (dps * bossTimeLimit) / bossHp
    goldPerMinSamples: [],
  };

  m.partyChanges = 0;
  var lastPartyKey = '';
  var stageEnteredAt = 0;
  var firstFailAt = null;      // 현재 스테이지에서 처음 보스에 실패한 시각
  var stuck = false;           // 이번 스테이지에서 보스를 한 번이라도 놓쳤는가
  var lastGoldEarned = 0;
  var nextGoldSampleAt = 60;

  while (s.t < duration) {
    var dpsOnly = POLICY.bossStuckDpsOnly && stuck;

    /* 유휴 = 다음 강화까지 대기가 임계를 넘는 시간.
     * "지금 살 게 없다"로 재면 구매 직후는 항상 참이라 100%가 나온다 — 방치형에서
     * 골드가 모이는 짧은 대기는 정상이고, 문제는 하염없이 기다리는 구간이다. */
    if (waitForNextUpgrade(s, dpsOnly) > POLICY.idleThresholdSec) m.idleSeconds += dt;

    // 마지막 구간이 duration 을 넘지 않도록 자른다 — 요청한 시간만 정확히 시뮬한다.
    var stepDt = Math.min(dt, duration - s.t);
    Combat.step(s, stepDt);

    // 이번 구간에 일어난 이벤트 처리
    for (var i = 0; i < s.events.length; i++) {
      var ev = s.events[i];
      if (ev.type === 'boss_start' && m.firstBossAt == null) m.firstBossAt = s.t;
      if (ev.type === 'boss_fail') {
        if (firstFailAt == null) firstFailAt = s.t;
        stuck = true;
      }
      if (ev.type === 'boss_clear') {
        if (m.firstBossClearAt == null) m.firstBossClearAt = s.t;
        m.stageDwell.push(s.t - stageEnteredAt);
        if (firstFailAt != null) {
          var wall = s.t - firstFailAt;
          if (wall > m.longestWall) { m.longestWall = wall; m.longestWallStage = ev.stage; }
        }
        m.clearRatios.push((Combat.dps(s) * B.bossTimeLimit) / Combat.bossHp(ev.stage));
        stageEnteredAt = s.t;
        firstFailAt = null;
        stuck = false;
      }
    }
    s.events.length = 0;

    // 해금·슬롯 상황이 바뀌었으면 편성을 다시 짠다.
    var key = s.stage + '|' + (dpsOnly ? 'b' : 'f');
    if (key !== lastPartyKey) {
      lastPartyKey = key;
      var want = bestParty(s, dpsOnly);
      if (want.join(',') !== s.party.join(',')) {
        s.party = want;
        m.partyChanges++;
      }
    }

    var bought = decide(s, dpsOnly);
    if (bought > 0 && m.firstUpgradeAt == null) m.firstUpgradeAt = s.t;

    if (s.t >= nextGoldSampleAt) {
      m.goldPerMinSamples.push(s.stats.goldEarned - lastGoldEarned);
      lastGoldEarned = s.stats.goldEarned;
      nextGoldSampleAt += 60;
    }
  }

  /* 아직 돌파하지 못한 벽도 최장 벽에 반영한다.
   * 돌파 시점에만 확정하면, 시뮬 종료 시점에 열려 있는 가장 긴 벽이 통째로 빠져
   * 게이트를 잘못 통과시킨다(실제로 3,726초짜리 벽이 3,466초로 보고된 사례가 있었다). */
  if (firstFailAt != null) {
    var openWall = s.t - firstFailAt;
    if (openWall > m.longestWall) { m.longestWall = openWall; m.longestWallStage = s.stage; }
    m.unresolvedWall = openWall;
  } else {
    m.unresolvedWall = 0;
  }

  m.idleRatio = m.idleSeconds / duration;
  m.avgStageDwell = avg(m.stageDwell);
  m.bossFailCount = s.stats.bossFails;
  m.avgClearRatio = avg(m.clearRatios);
  m.finalStage = s.stage;
  m.finalSafeStage = s.safeStage;
  m.state = s;
  return m;
}

function avg(a) {
  if (!a.length) return null;
  var t = 0;
  for (var i = 0; i < a.length; i++) t += a[i];
  return t / a.length;
}

/* ── 출력 ───────────────────────────────────────────────────── */
function fmtTime(sec) {
  if (sec == null) return '—';
  if (sec < 60) return sec.toFixed(1) + 's';
  var mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
  return mm + 'm ' + String(ss).padStart(2, '0') + 's';
}

function fmtNum(n) {
  if (n == null || !isFinite(n)) return '—';
  var units = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad'];
  var u = 0;
  while (Math.abs(n) >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (u === 0 ? Math.round(n) : n.toFixed(2)) + units[u];
}

function report(m) {
  var s = m.state;
  var lines = [];
  lines.push('=== simulate ' + fmtTime(m.duration) + ' ===');
  lines.push('Stage           1 → ' + m.finalStage + '  (클리어 ' + m.finalSafeStage + ')');
  lines.push('강화 레벨       ATK ' + s.up.atk + ' · ASPD ' + s.up.aspd + ' · GOLD ' + s.up.gold);
  lines.push('강화 횟수       ' + s.stats.upgrades);
  lines.push('보스            시도 ' + s.stats.bossTries + ' / 성공 ' + s.stats.bossWins + ' / 실패 ' + s.stats.bossFails);
  lines.push('');
  lines.push('첫 강화까지     ' + fmtTime(m.firstUpgradeAt));
  lines.push('첫 보스 도달    ' + fmtTime(m.firstBossAt));
  lines.push('첫 보스 돌파    ' + fmtTime(m.firstBossClearAt));
  lines.push('스테이지 평균   ' + fmtTime(m.avgStageDwell));
  lines.push('최장 벽         ' + fmtTime(m.longestWall) + (m.longestWallStage ? '  @ Stage ' + m.longestWallStage : ''));
  lines.push('유휴 비율       ' + (m.idleRatio * 100).toFixed(1) + '%');
  lines.push('돌파 여유비     ' + (m.avgClearRatio == null ? '—' : m.avgClearRatio.toFixed(2)) + '   (1.0 = 제한시간 딱 맞춤)');
  lines.push('총 골드         ' + fmtNum(s.stats.goldEarned));
  lines.push('최종 DPS        ' + fmtNum(Combat.dps(s)));
  lines.push('전투력          ' + fmtNum(Combat.power(s)));
  return lines.join('\n');
}

/* ── CLI ────────────────────────────────────────────────────── */
function parseArgs(argv) {
  var o = { seconds: 300, json: false };
  argv.forEach(function (a) {
    var mm;
    if ((mm = a.match(/^--minutes=([\d.]+)$/))) o.seconds = parseFloat(mm[1]) * 60;
    else if ((mm = a.match(/^--hours=([\d.]+)$/))) o.seconds = parseFloat(mm[1]) * 3600;
    else if ((mm = a.match(/^--seconds=([\d.]+)$/))) o.seconds = parseFloat(mm[1]);
    else if (a === '--json') o.json = true;
  });
  return o;
}

if (require.main === module) {
  var opts = parseArgs(process.argv.slice(2));
  var m = run(opts);
  if (opts.json) {
    var out = Object.assign({}, m);
    delete out.state;
    delete out.stageDwell;
    delete out.clearRatios;
    delete out.goldPerMinSamples;
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(report(m));
  }
}

module.exports = { run: run, report: report, fmtTime: fmtTime, fmtNum: fmtNum };
