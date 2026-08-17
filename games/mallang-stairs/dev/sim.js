/* 말랑 계단 레이스 밸런스 시뮬 하니스 (Node 전용, 배포와 무관)
 *
 * 사용: node games/mallang-stairs/dev/sim.js
 *
 * 하는 일:
 *  1) 엔진 회귀 검증 — 시드 결정성, setScoreBoost(골든 타임)가 점수에만 곱해지고
 *     계단/게이지/즉사 룰에 불개입인지 assert.
 *  2) 탭 속도 프로파일별 30초 레이스 시뮬 — 층수·피버·사망·보호막 분포 표 출력.
 *     game.js 의 체크포인트(25층)·보호막(1000점=1칸, 10층 라인 부활)·부활 지연(620ms)을 모사한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = {};
for (const f of ['characters.js', 'stairs-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
}
const Engine = window.MallangStairsEngine;
const Chars = window.MallangCharacters;

// ---- game.js 상수 미러 (변경 시 함께 갱신) ----
const DUR_MS = 30000;
const CHECKPOINT_INTERVAL = 25;
const SHIELD_GAIN_PER_POINT = 1 / 1000;
const SHIELD_STEP_LINE = 10;
const FALL_RESTART_MS = 620;
const GOLDEN_TIME_MS = 10000;
const GOLDEN_SCORE_MUL = 1.5;
const TICK_MS = 16;

function mulberryish(seed) { // 시뮬 입력 지터용 (엔진 rng 와 무관)
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(opts) {
  const rng = mulberryish(opts.simSeed);
  const char = Chars.get(opts.charId);
  let engine = Engine.create({ seed: opts.seed, character: char });
  engine.start();

  let elapsed = 0;
  let bestStep = 0;
  let scoreOffset = 0;   // 이전 목숨 점수 합
  let checkpointStep = 0;
  let checkpointScore = 0;
  let shield = 0;
  let golden = false;
  let fevers = 0, gaugeDeaths = 0, missDeaths = 0, shieldFills = 0, shieldUses = 0;
  let wasFever = false;
  let roundMaxCombo = 0; // 목숨 넘어 라운드 전체 최대 콤보 (해금 조건용)
  let nextTapAt = opts.tapMs + (rng() - 0.5) * 2 * opts.jitMs;
  let restartHoldUntil = -1;

  function currentScore() { return scoreOffset + engine.getState().score; }

  function onDeath(reason) {
    if (reason === 'gauge') gaugeDeaths++; else missDeaths++;
    const s = engine.getState();
    if (shield >= 1) {
      const line = Math.floor(s.pos / SHIELD_STEP_LINE) * SHIELD_STEP_LINE;
      if (line > checkpointStep) checkpointStep = line;
      checkpointScore = scoreOffset + s.score;
      shield = 0;
      shieldUses++;
    }
    restartHoldUntil = elapsed + FALL_RESTART_MS;
  }

  function restartLife() {
    scoreOffset = checkpointScore;
    engine = Engine.create({ seed: opts.seed, character: char, startAtStep: checkpointStep });
    if (golden) engine.setScoreBoost(GOLDEN_SCORE_MUL);
    engine.start();
    wasFever = false;
    nextTapAt = elapsed + opts.tapMs + (rng() - 0.5) * 2 * opts.jitMs;
  }

  while (elapsed < DUR_MS) {
    elapsed += TICK_MS;
    if (!golden && DUR_MS - elapsed <= GOLDEN_TIME_MS) {
      golden = true;
      engine.setScoreBoost(GOLDEN_SCORE_MUL);
    }
    if (restartHoldUntil >= 0) {
      if (elapsed >= restartHoldUntil) { restartHoldUntil = -1; restartLife(); }
      continue;
    }
    engine.tick(TICK_MS);
    let s = engine.getState();
    if (s.dead) { onDeath(s.deadReason); continue; }
    if (s.feverActive && !wasFever) fevers++;
    wasFever = s.feverActive;

    if (elapsed >= nextTapAt) {
      nextTapAt = elapsed + opts.tapMs + (rng() - 0.5) * 2 * opts.jitMs;
      const wrong = rng() < opts.missRate;
      const dir = engine.dirAt(s.pos + 1) * (wrong ? -1 : 1);
      const ev = engine.input(dir);
      if (ev && ev.dead) { onDeath(ev.reason); continue; }
      if (ev && ev.gain) shield = Math.min(1, shield + ev.gain * SHIELD_GAIN_PER_POINT);
      if (shield >= 1 && ev && ev.gain) { /* armed */ }
      if (shield >= 1) shieldFills = Math.max(shieldFills, shieldUses + 1);
      s = engine.getState();
      if (s.maxCombo > roundMaxCombo) roundMaxCombo = s.maxCombo;
      const reached = Math.floor(s.pos / CHECKPOINT_INTERVAL) * CHECKPOINT_INTERVAL;
      if (reached > checkpointStep) { checkpointStep = reached; checkpointScore = currentScore(); }
      if (s.pos > bestStep) bestStep = s.pos;
    }
  }
  return { bestStep, score: currentScore(), fevers, gaugeDeaths, missDeaths, shieldFills, shieldUses, roundMaxCombo };
}

// ---- 1) 엔진 회귀 검증 ----
function assertEqual(a, b, msg) {
  if (a !== b) { console.error('ASSERT FAIL:', msg, '|', a, '!==', b); process.exitCode = 1; }
}
function assertClose(x, lo, hi, msg) {
  if (!(x >= lo && x <= hi)) { console.error('ASSERT FAIL:', msg, '|', x, 'not in', [lo, hi]); process.exitCode = 1; }
}

(function verifyEngine() {
  const chick = Chars.get('peach-chick');
  // 결정성: 같은 시드 → 같은 계단 방향
  const e1 = Engine.create({ seed: 'ROOM1:run1', character: chick });
  const e2 = Engine.create({ seed: 'ROOM1:run1', character: chick });
  for (let i = 1; i <= 500; i++) assertEqual(e1.dirAt(i), e2.dirAt(i), 'dirAt(' + i + ') 결정성');

  // setScoreBoost: 동일 입력 스크립트에서 점수만 ~1.5배, 게이지·계단·사망 불변
  function runScript(boost) {
    const e = Engine.create({ seed: 'boost-check', character: chick });
    if (boost) e.setScoreBoost(GOLDEN_SCORE_MUL);
    e.start();
    for (let i = 0; i < 60; i++) {
      e.tick(300);
      const ev = e.input(e.dirAt(e.getState().pos + 1));
      if (!ev || ev.dead) throw new Error('unexpected death in boost-check');
    }
    return e.getState();
  }
  const base = runScript(false);
  const boosted = runScript(true);
  assertEqual(base.pos, boosted.pos, 'boost 가 층수 불개입');
  assertEqual(Math.round(base.gauge * 1000), Math.round(boosted.gauge * 1000), 'boost 가 게이지 불개입');
  assertClose(boosted.score / base.score, 1.45, 1.55, 'boost 점수 배율 ~1.5x');
  console.log('[verify] 엔진 결정성 · setScoreBoost 점수 전용(층/게이지 불변) OK — ratio',
    (boosted.score / base.score).toFixed(3));
})();

// ---- 2) 프로파일 시뮬 ----
const PROFILES = [
  { name: '고수(탭 220ms)', tapMs: 220, jitMs: 50, missRate: 0.004 },
  { name: '상급(탭 300ms)', tapMs: 300, jitMs: 70, missRate: 0.008 },
  { name: '평균(탭 400ms)', tapMs: 400, jitMs: 90, missRate: 0.012 },
  { name: '초보(탭 600ms)', tapMs: 600, jitMs: 130, missRate: 0.02 },
];
const RUNS = 40;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log('\n캐릭터: 말랑 병아리(기본) · 30초 레이스 · ' + RUNS + '시드 평균');
console.log('프로파일           | 층(평균/최소/최대) | 피버 | 게이지사망 | 오입력사망 | 보호막(충전/사용) | 점수');
for (const p of PROFILES) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) {
    rs.push(simulate({
      seed: 'sim:' + i, simSeed: 7777 + i * 131, charId: 'peach-chick',
      tapMs: p.tapMs, jitMs: p.jitMs, missRate: p.missRate,
    }));
  }
  const floors = rs.map(r => r.bestStep);
  console.log(
    p.name.padEnd(14) +
    ' | ' + avg(floors).toFixed(1) + ' / ' + Math.min(...floors) + ' / ' + Math.max(...floors) +
    ' | ' + avg(rs.map(r => r.fevers)).toFixed(2) +
    ' | ' + avg(rs.map(r => r.gaugeDeaths)).toFixed(2) +
    ' | ' + avg(rs.map(r => r.missDeaths)).toFixed(2) +
    ' | ' + avg(rs.map(r => r.shieldFills)).toFixed(2) + ' / ' + avg(rs.map(r => r.shieldUses)).toFixed(2) +
    ' | ' + Math.round(avg(rs.map(r => r.score)))
  );
}
console.log('\n테마 노출(THEME_STEPS 35/70/110/150 기준): 위 층수 평균과 대조해 판 내 테마 수를 가늠한다.');

// ---- 3) 시크릿 해금 조건 후보 분포 (R13) ----
console.log('\n해금 조건 후보 — 라운드당 달성 확률(%):');
console.log('프로파일           | 콤보≥30 | 콤보≥35 | 콤보≥40 | 콤보≥50 | 피버≥2 | 피버≥3');
for (const p of PROFILES) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) {
    rs.push(simulate({
      seed: 'unlock:' + i, simSeed: 4242 + i * 977, charId: 'peach-chick',
      tapMs: p.tapMs, jitMs: p.jitMs, missRate: p.missRate,
    }));
  }
  const pct = (f) => Math.round(100 * rs.filter(f).length / rs.length);
  console.log(
    p.name.padEnd(14) +
    ' | ' + pct(r => r.roundMaxCombo >= 30) + ' | ' + pct(r => r.roundMaxCombo >= 35) +
    ' | ' + pct(r => r.roundMaxCombo >= 40) + ' | ' + pct(r => r.roundMaxCombo >= 50) +
    ' | ' + pct(r => r.fevers >= 2) + ' | ' + pct(r => r.fevers >= 3)
  );
}
