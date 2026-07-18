/* stairs-engine.js — 말랑 계단 레이스 순수 코어 룰 (window 전역, ES모듈 아님)
 *
 * 이 모듈은 DOM·네트워크에 전혀 의존하지 않는 결정적(deterministic) 상태기계다.
 * 싱글과 멀티가 "완전히 동일한" engine 을 쓰며, 멀티는 같은 seed 로 같은 계단을 본다.
 *
 * 절대 불변 핵심 룰:
 *   - 잘못된 방향 입력 → 즉시 사망
 *   - 시간 게이지 0 → 즉시 사망
 *   - 부활 없음
 *   - 피버/부스터/캐릭터 능력은 점수·게이지를 바꾸되 즉사 룰이나 실수 방어를 주지 않음
 *
 * API:
 *   var e = MallangStairsEngine.create({ seed, character });
 *   e.start();
 *   e.tick(dtMs);            // 매 프레임 시간 진행(게이지 감소·타이머)
 *   e.input(dir);            // dir = -1(왼쪽) | +1(오른쪽). 즉시 판정.
 *   e.dirAt(index);          // 해당 계단의 방향(-1|1). 결정적.
 *   e.getState();            // 렌더/스냅샷용 상태 스냅샷
 */
(function () {
  'use strict';

  var BASE_STEP_SCORE = 10;

  var GAUGE = {
    max: 100,
    initial: 70,
    resumeInitial: 85,
    drainPerSecond: 16,
    recoverNormal: 6,
    recoverGood: 7.5,
    recoverPerfect: 9.5,
    crisisThreshold: 12, // 이 아래로 떨어지면 토끼 위기회복 발동 가능
  };

  // 빠른 입력 등급. maxMs 는 직전 입력 이후 경과시간(엔진 내부 시계 기준).
  var SPEED_GRADE = {
    perfect: { maxMs: 250, scoreMul: 2.0, gaugeRecoverMul: 1.25, feverGain: 4, recover: GAUGE.recoverPerfect },
    good:    { maxMs: 450, scoreMul: 1.4, gaugeRecoverMul: 1.1,  feverGain: 2, recover: GAUGE.recoverGood },
    normal:  { maxMs: Infinity, scoreMul: 1.0, gaugeRecoverMul: 1.0, feverGain: 1, recover: GAUGE.recoverNormal },
  };

  var FEVER = {
    gaugeMax: 100,
    durationMs: 5000,
    scoreMul: 1.5,        // 피버 중 기본 점수 배율
    gaugeRecoverBonus: 1.15, // 피버 중 게이지 회복 소폭 증가
  };

  var BOOSTER = {
    spawnEveryStepsMin: 8,
    spawnEveryStepsMax: 13,
    durationMs: { speed: 8000, stable: 8000, combo: 10000, fever: 0 },
    types: ['speed', 'stable', 'combo', 'fever'],
  };

  var BOOSTER_EFFECTS = {
    speed: {
      drainMul: 0.9,
      judgeElapsedMul: 0.85,
      perfectScoreMul: 1.35,
    },
    stable: { gaugeRecoverMul: 1.5 },
    combo: { comboExcessMul: 1.5 },
    fever: { fillAmount: 55, extendMs: 1500 },
  };

  // ---- 결정적 의사난수 (mulberry32) ----
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 문자열(방 코드 등) → 32bit 시드
  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    str = String(str == null ? 'solo' : str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getComboMultiplier(combo) {
    if (combo >= 100) return 2.0;
    if (combo >= 70) return 1.7;
    if (combo >= 40) return 1.45;
    if (combo >= 20) return 1.25;
    if (combo >= 10) return 1.1;
    return 1.0;
  }

  function create(opts) {
    opts = opts || {};
    var character = opts.character || { id: 'mochi-rabbit', ability: {} };
    var ability = character.ability || {};
    var seedInt = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : hashSeed(opts.seed);
    var startStep = Math.max(0, Math.floor(opts.startAtStep || 0));

    // 계단 방향 시퀀스는 seed 로부터 0번부터 순방향으로만 생성/캐시한다.
    // 같은 seed 면 모든 클라이언트가 동일한 배열을 얻는다.
    var stairRng = makeRng(seedInt ^ 0x9e3779b9);
    var dirs = [0]; // index 0 = 시작 발판(방향 무의미)
    var runDir = stairRng() < 0.5 ? -1 : 1;
    var runRemaining = 0;
    var consecutiveSwitches = 0; // 연속 길이1 런(급전환) 카운트

    function chooseRunLen(forIndex) {
      var r = stairRng();
      // 가끔 5연속
      if (r < 0.05) return 5;
      if (forIndex < 20) {
        // 초반: 급전환 없음, 2~4 위주
        return 2 + Math.floor(stairRng() * 3); // 2,3,4
      }
      if (forIndex < 50) {
        // 중반: 1 허용하되 연속 급전환 3회 이상 금지
        if (consecutiveSwitches >= 2) return 2 + Math.floor(stairRng() * 2); // 강제 2~3
        var pick = stairRng();
        if (pick < 0.30) return 1;
        if (pick < 0.65) return 2;
        if (pick < 0.88) return 3;
        return 4;
      }
      // 후반: 급전환 빈발 허용
      var p = stairRng();
      if (p < 0.45) return 1;
      if (p < 0.78) return 2;
      if (p < 0.93) return 3;
      return 4;
    }

    function genUpTo(n) {
      while (dirs.length <= n) {
        var i = dirs.length;
        if (runRemaining <= 0) {
          runDir = -runDir; // 런이 끝나면 방향 전환
          var len = chooseRunLen(i);
          consecutiveSwitches = (len === 1) ? (consecutiveSwitches + 1) : 0;
          runRemaining = len;
        }
        dirs.push(runDir);
        runRemaining--;
      }
    }

    function dirAt(index) {
      if (index < 0) return 0;
      genUpTo(index);
      return dirs[index];
    }

    // 부스터 스폰 지점은 seed 로 결정적으로 미리 계산
    var boosterRng = makeRng(seedInt ^ 0x85ebca6b);
    var nextBoosterStep = BOOSTER.spawnEveryStepsMin +
      Math.floor(boosterRng() * (BOOSTER.spawnEveryStepsMax - BOOSTER.spawnEveryStepsMin + 1));
    var boosterAtStep = {}; // step -> type
    function ensureBoosterPlan(upToStep) {
      while (nextBoosterStep <= upToStep) {
        var t = BOOSTER.types[Math.floor(boosterRng() * BOOSTER.types.length)];
        boosterAtStep[nextBoosterStep] = t;
        nextBoosterStep += BOOSTER.spawnEveryStepsMin +
          Math.floor(boosterRng() * (BOOSTER.spawnEveryStepsMax - BOOSTER.spawnEveryStepsMin + 1));
      }
    }

    var st = {
      started: false,
      dead: false,
      deadReason: null,    // 'wrong' | 'gauge'
      pos: startStep,      // 현재 서 있는 계단 index
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfectCount: 0,
      gauge: startStep > 0 ? GAUGE.resumeInitial : GAUGE.initial,
      feverGauge: 0,
      feverActive: false,
      feverRemainingMs: 0,
      clock: 0,            // 엔진 내부 시계(ms) — 입력 타이밍 기준
      lastInputClock: 0,
      crisisLeft: (ability.crisisRecover && ability.crisisRecover.once) || 0,
      superStepLeft: 0,    // 라떼: 남은 슈퍼스텝 수
      boosters: { speed: 0, stable: 0, combo: 0 }, // 남은 ms
      lastEvent: null,     // {type, grade, step, booster, ...} 1회성 이벤트(렌더용)
      facing: 1,           // 캐릭터가 바라보는 방향(렌더 보조)
      runStartStep: startStep,
    };

    function judgeWindow(grade) {
      var bonus = ability.judgeWindowBonusMs || 0;
      return SPEED_GRADE[grade].maxMs + bonus;
    }

    function gradeFor(elapsedMs) {
      if (elapsedMs <= judgeWindow('perfect')) return 'perfect';
      if (elapsedMs <= judgeWindow('good')) return 'good';
      return 'normal';
    }

    function effectiveElapsedMs(elapsedMs) {
      if (st.boosters.speed <= 0) return elapsedMs;
      return elapsedMs * BOOSTER_EFFECTS.speed.judgeElapsedMul;
    }

    function gaugePressureFactor() {
      var ramp = Math.max(0, st.pos - 20) / 180;
      return 1 + Math.min(ramp, 1) * 0.30; // 20층 이후 200층까지 최대 +30%
    }

    function effectiveDrainPerSec() {
      var charMul = ability.drainMul || 1;
      var boosterMul = st.boosters.speed > 0 ? BOOSTER_EFFECTS.speed.drainMul : 1;
      return GAUGE.drainPerSecond * gaugePressureFactor() * charMul * boosterMul;
    }

    function die(reason) {
      if (st.dead) return;
      st.dead = true;
      st.deadReason = reason;
      st.feverActive = false;
      st.lastEvent = { type: 'death', reason: reason, step: st.pos };
    }

    function applyBoosterPickup(type) {
      if (type === 'fever') {
        if (st.feverActive) {
          st.feverRemainingMs += BOOSTER_EFFECTS.fever.extendMs; // 피버 중이면 시간 연장
        } else {
          st.feverGauge = Math.min(FEVER.gaugeMax, st.feverGauge + BOOSTER_EFFECTS.fever.fillAmount);
        }
      } else {
        st.boosters[type] = BOOSTER.durationMs[type];
      }
    }

    function triggerFever() {
      st.feverActive = true;
      st.feverRemainingMs = FEVER.durationMs;
      st.feverGauge = 0;
    }

    return {
      seedInt: seedInt,
      dirAt: dirAt,
      boosterAt: function (step) { ensureBoosterPlan(step); return boosterAtStep[step] || null; },

      start: function () {
        st.started = true;
        st.dead = false;
        st.deadReason = null;
        st.pos = st.runStartStep;
        st.score = 0;
        st.combo = 0;
        st.maxCombo = 0;
        st.perfectCount = 0;
        st.gauge = st.runStartStep > 0 ? GAUGE.resumeInitial : GAUGE.initial;
        st.feverGauge = 0;
        st.feverActive = false;
        st.feverRemainingMs = 0;
        st.superStepLeft = 0;
        st.boosters.speed = 0;
        st.boosters.stable = 0;
        st.boosters.combo = 0;
        st.lastEvent = null;
        st.clock = 0;
        st.lastInputClock = 0;
        st.crisisLeft = (ability.crisisRecover && ability.crisisRecover.once) || 0;
        st.facing = 1;
        genUpTo(st.pos + 40);
        ensureBoosterPlan(st.pos + 40);
        Object.keys(boosterAtStep).forEach(function (step) {
          if (+step <= st.pos) delete boosterAtStep[step];
        });
      },

      tick: function (dtMs) {
        if (!st.started || st.dead) return;
        st.clock += dtMs;

        // 시간 게이지 감소
        st.gauge -= effectiveDrainPerSec() * (dtMs / 1000);

        // 토끼: 위기 시 게임당 1회 자동 회복 (잘못된 입력 사망은 못 막음)
        if (st.gauge <= GAUGE.crisisThreshold && st.crisisLeft > 0) {
          st.gauge = Math.min(GAUGE.max, st.gauge + GAUGE.max * (ability.crisisRecover.ratio || 0.25));
          st.crisisLeft--;
          st.lastEvent = { type: 'crisis', step: st.pos };
        }

        if (st.gauge <= 0) {
          st.gauge = 0;
          die('gauge');
          return;
        }

        // 부스터 타이머
        ['speed', 'stable', 'combo'].forEach(function (k) {
          if (st.boosters[k] > 0) st.boosters[k] = Math.max(0, st.boosters[k] - dtMs);
        });

        // 피버 타이머
        if (st.feverActive) {
          st.feverRemainingMs -= dtMs;
          if (st.feverRemainingMs <= 0) {
            st.feverActive = false;
            st.feverRemainingMs = 0;
          }
        }
      },

      input: function (dir) {
        if (!st.started || st.dead) return null;
        var required = dirAt(st.pos + 1);
        if (dir !== required) {
          st.facing = dir;
          die('wrong');
          st.lastEvent = { type: 'death', reason: 'wrong', step: st.pos };
          return { dead: true, reason: 'wrong' };
        }

        // 올바른 입력 → 한 계단 상승
        var elapsed = st.clock - st.lastInputClock;
        st.lastInputClock = st.clock;
        var effectiveElapsed = effectiveElapsedMs(elapsed);
        var grade = gradeFor(effectiveElapsed);
        var sg = SPEED_GRADE[grade];

        st.pos++;
        st.facing = dir;
        st.combo++;
        if (st.combo > st.maxCombo) st.maxCombo = st.combo;
        if (grade === 'perfect') st.perfectCount++;

        // --- 점수 계산 ---
        // speedMul: Perfect 시 햄스터 보너스 추가
        var speedMul = sg.scoreMul;
        if (grade === 'perfect' && ability.perfectScoreBonus) speedMul += ability.perfectScoreBonus;

        var comboMul = getComboMultiplier(st.combo);
        if (st.boosters.combo > 0) {
          // 콤보 부스터: 콤보 배율의 초과분을 50% 증폭 (낮은 콤보면 효과 작음)
          comboMul = 1 + (comboMul - 1) * BOOSTER_EFFECTS.combo.comboExcessMul;
        }

        var charMul = ability.baseScoreMul || 1;

        // 라떼 슈퍼스텝: 30콤보 도달 시 다음 3스텝 2배
        if (ability.superStep && st.combo > 0 &&
            st.combo % ability.superStep.everyCombo === 0) {
          st.superStepLeft = ability.superStep.steps;
        }
        var buildMul = 1;
        if (st.superStepLeft > 0) {
          buildMul *= (ability.superStep ? ability.superStep.mul : 2.0);
          st.superStepLeft--;
        }
        if (st.boosters.speed > 0 && grade === 'perfect') buildMul *= BOOSTER_EFFECTS.speed.perfectScoreMul;

        var feverMul = 1;
        if (st.feverActive) {
          feverMul = FEVER.scoreMul + (ability.feverScoreBonus || 0);
        }

        var gain = BASE_STEP_SCORE * speedMul * comboMul * charMul * feverMul * buildMul;
        st.score += Math.round(gain);

        // --- 게이지 회복 ---
        var recover = sg.recover * sg.gaugeRecoverMul;
        if (st.boosters.stable > 0) recover *= BOOSTER_EFFECTS.stable.gaugeRecoverMul;
        if (st.feverActive) recover *= FEVER.gaugeRecoverBonus;
        st.gauge = Math.min(GAUGE.max, st.gauge + recover);

        // --- 피버 게이지 충전 ---
        if (!st.feverActive) {
          var fgain = sg.feverGain * (ability.feverGainMul || 1);
          st.feverGauge += fgain;
          if (st.feverGauge >= FEVER.gaugeMax) triggerFever();
        }

        // --- 부스터 획득(자동) ---
        var booster = null;
        ensureBoosterPlan(st.pos);
        if (boosterAtStep[st.pos]) {
          booster = boosterAtStep[st.pos];
          applyBoosterPickup(booster);
          delete boosterAtStep[st.pos];
        }

        // 다음 계단 미리 생성
        genUpTo(st.pos + 20);
        ensureBoosterPlan(st.pos + 20);

        st.lastEvent = {
          type: 'step', grade: grade, step: st.pos, gain: Math.round(gain),
          combo: st.combo, booster: booster,
          fever: st.feverActive, superStep: st.superStepLeft > 0,
          effectiveElapsedMs: effectiveElapsed,
        };
        return st.lastEvent;
      },

      // 이벤트 1회 소비(렌더가 읽고 비움)
      consumeEvent: function () {
        var ev = st.lastEvent;
        st.lastEvent = null;
        return ev;
      },

      getState: function () {
        return {
          started: st.started,
          dead: st.dead,
          deadReason: st.deadReason,
          runStartStep: st.runStartStep,
          pos: st.pos,
          score: st.score,
          combo: st.combo,
          maxCombo: st.maxCombo,
          perfectCount: st.perfectCount,
          gauge: st.gauge,
          gaugeRatio: st.gauge / GAUGE.max,
          feverGauge: st.feverGauge,
          feverRatio: st.feverGauge / FEVER.gaugeMax,
          feverActive: st.feverActive,
          feverRemainingMs: st.feverRemainingMs,
          drainPerSecond: effectiveDrainPerSec(),
          gaugePressureFactor: gaugePressureFactor(),
          facing: st.facing,
          nextDir: dirAt(st.pos + 1),
          boosters: { speed: st.boosters.speed, stable: st.boosters.stable, combo: st.boosters.combo },
          boosterEffects: BOOSTER_EFFECTS,
          superStepLeft: st.superStepLeft,
        };
      },
    };
  }

  window.MallangStairsEngine = {
    create: create,
    GAUGE: GAUGE,
    SPEED_GRADE: SPEED_GRADE,
    FEVER: FEVER,
    BOOSTER_EFFECTS: BOOSTER_EFFECTS,
    getComboMultiplier: getComboMultiplier,
    hashSeed: hashSeed,
  };
})();
