/*
 * 말랑프렌즈 키우기 — 순수 결정론 전투·성장 모델
 *
 * 핵심 원칙 (../AGENT_PROTOCOL.md 2절):
 *   - 순수 함수. DOM·타이머·Date.now() 를 직접 읽지 않는다. 시간은 인자로 주입된다.
 *   - 게임 화면과 헤드리스 시뮬레이터가 "이 파일 하나"를 공유한다. 전투 로직이
 *     두 벌 존재하면 지표가 거짓말을 한다.
 *   - Math.random() 금지. 무작위가 필요하면 rng.js 를 주입받는다.
 *
 * 시간 진행은 틱 누적이 아니라 "다음 이벤트까지의 시간"을 계산해 그만큼만 나아가는
 * 이벤트 기반이다. 덕분에 dt 를 60초로 줘도 결과가 dt=0.016 과 동일하다 —
 * 24시간 시뮬이 정확하면서도 빠르게 돈다.
 *
 * 상태는 JSON 직렬화 가능한 평범한 객체다.
 */
(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./balance.js') : root.MallangIdleBalance,
    typeof require === 'function' ? require('../data/characters.js') : root.MallangIdleCharacters
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleCombat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Bal, Chars) {
  'use strict';

  var B = Bal.BALANCE;
  var AXES = Bal.AXES;

  var PHASE_ADVANCE = 'advance';  // 다음 적을 향해 전진 중
  var PHASE_FIGHT   = 'fight';    // 일반몹과 교전 중
  var PHASE_BOSS    = 'boss';     // 보스 관문

  // ── 파티 보너스 ──────────────────────────────────────────────
  /* 편성된 캐릭터의 패시브를 합산한다. 곱이 아니라 합으로 쌓아 세 명을 넣어도
   * 배수가 폭주하지 않게 한다(같은 축을 겹쳐도 선형). */
  var NO_BONUS = { atkMul: 0, aspdMul: 0, goldMul: 0, bossMul: 0, advanceMul: 0, shardMul: 0 };

  function partyBonus(s) {
    var out = { atkMul: 0, aspdMul: 0, goldMul: 0, bossMul: 0, advanceMul: 0, shardMul: 0 };
    var party = s && s.party;
    if (!party || !party.length || !Chars) return out;
    for (var i = 0; i < party.length; i++) {
      var c = Chars.byId(party[i]);
      if (!c || !c.skill) continue;
      if (out[c.skill.key] === undefined) continue;
      out[c.skill.key] += c.skill.value;
    }
    return out;
  }

  // ── 파생 수치 ────────────────────────────────────────────────
  function atk(lv)     { return B.baseAtk * Math.pow(B.atkGrowth, lv - 1); }
  function aspd(lv)    { return Math.min(B.aspdCap, B.baseAspd * (1 + B.aspdPerLv * (lv - 1))); }
  function goldMul(lv) { return 1 + B.goldMulPerLv * (lv - 1); }

  // ── 유물 보너스 (P3 영구 성장축) ─────────────────────────────
  function relicLv(s, id) {
    return (s && s.relics && isFinite(s.relics[id])) ? s.relics[id] : 0;
  }
  /* 레벨당 곱연산 — 레벨 하나가 항상 같은 비율의 벽을 깎는다(balance.js 주석 참고). */
  function relicMul(s, id) {
    var def = B.relics[id];
    return def ? Math.pow(1 + def.perLv, relicLv(s, id)) : 1;
  }
  function relicCost(s, id) {
    var def = B.relics[id];
    return def ? Math.ceil(def.costBase * Math.pow(def.costGrowth, relicLv(s, id))) : Infinity;
  }
  function buyRelic(s, id) {
    var def = B.relics[id];
    if (!def) return false;
    if (relicLv(s, id) >= B.maxRelicLevel) return false;
    var cost = relicCost(s, id);
    if (!(s.shards >= cost)) return false;
    s.shards -= cost;
    s.relics[id] = relicLv(s, id) + 1;
    s.events.push({ type: 'relic', id: id, lv: s.relics[id], cost: cost });
    return true;
  }

  /* 편성·유물 보너스가 반영된 실전 수치. aspd 상한은 보너스 적용 후에 건다 —
   * 그러지 않으면 상한에 닿은 뒤 병아리를 넣어도 아무 일도 일어나지 않는다. */
  function effAtk(s)  { return atk(s.up.atk) * (1 + partyBonus(s).atkMul) * relicMul(s, 'hammer'); }
  function effAspd(s) { return Math.min(B.aspdCap, aspd(s.up.aspd) * (1 + partyBonus(s).aspdMul)); }
  function dps(s)     { return effAtk(s) * effAspd(s); }

  /* 보스에게만 붙는 추가 피해. 일반몹 처치 속도는 그대로 두고 관문 돌파력만 올린다. */
  function bossDps(s) { return dps(s) * (1 + partyBonus(s).bossMul) * relicMul(s, 'compass'); }

  function advanceSeconds(s) {
    var mul = 1 - partyBonus(s).advanceMul;
    if (!(mul > 0.1)) mul = 0.1;
    return B.advanceSeconds * mul;
  }

  function mobHp(stage)  { return B.mobBaseHp * Math.pow(B.mobHpGrowth, stage - 1); }
  function bossHp(stage) {
    /* 도입 첫 벽 — firstWallStage 보스만 의도적으로 굵다(balance.js 주석 참고).
     * 던전은 baseStage ≥ 9(해금 10)라 이 배수를 상속하지 않는다. */
    var mul = stage === B.firstWallStage ? B.firstWallHpMul : 1;
    return mobHp(stage) * B.bossHpMultiplier * mul;
  }
  function mobGold(s, stage) {
    return B.goldBase * Math.pow(B.goldGrowth, stage - 1) * goldMul(s.up.gold)
         * (1 + partyBonus(s).goldMul) * relicMul(s, 'barn');
  }

  function upgradeCost(axis, lv) {
    return B.costBase[axis] * Math.pow(B.costGrowth[axis], lv - 1);
  }

  /* 전투력 — 표시 전용 파생 지표.
   * 이 값이 데미지 공식에 다시 곱해지는 구조는 금지한다(../CORE_LOOP.md 6절). */
  function power(s) {
    var pb = partyBonus(s);
    return Math.floor(
      dps(s) * B.powerDpsWeight +
      goldMul(s.up.gold) * (1 + pb.goldMul) * relicMul(s, 'barn') * B.powerGoldWeight +
      (pb.bossMul + pb.advanceMul + pb.shardMul + (relicMul(s, 'compass') - 1)) * B.powerGoldWeight
    );
  }

  /* 편성이 유효한지 정리한다 — 해금되지 않은 캐릭터, 중복, 슬롯 초과를 걷어낸다.
   * 세이브를 손으로 고쳤거나 슬롯이 아직 안 열린 상태에서도 안전해야 한다. */
  function sanitizeParty(s) {
    if (!Chars) return [];
    var slots = Chars.slotsFor(s.stage);
    var unlocked = Chars.unlockedAt(s.stage);
    var seen = {};
    var out = [];
    var src = Array.isArray(s.party) ? s.party : [];
    for (var i = 0; i < src.length && out.length < slots; i++) {
      var id = src[i];
      if (seen[id]) continue;
      if (unlocked.indexOf(id) === -1) continue;
      seen[id] = 1;
      out.push(id);
    }
    /* 빈 슬롯은 해금된 친구로 채운다. 슬롯이 열렸는데 비워두면 유저가 편성 화면에
     * 들어가기 전까지 손해만 보는데, 방치형에서 그런 마찰은 그냥 손실이다.
     * 채워진 뒤에는 언제든 탭으로 바꿀 수 있다. */
    for (var j = 0; j < unlocked.length && out.length < slots; j++) {
      if (!seen[unlocked[j]]) { seen[unlocked[j]] = 1; out.push(unlocked[j]); }
    }
    s.party = out;
    return out;
  }

  /* 현재 편성으로 특정 스테이지를 파밍할 때의 골드/초.
   * 시뮬레이터 정책 판단과 오프라인 보상이 함께 쓴다. */
  function goldPerSec(s, stage) {
    var d = dps(s);
    if (d <= 0) return 0;
    var cycle = advanceSeconds(s) + mobHp(stage) / d;
    return mobGold(s, stage) / cycle;
  }

  // ── 상태 ────────────────────────────────────────────────────
  function createState() {
    return {
      t: 0,                 // 누적 플레이 시간(초)
      stage: 1,
      safeStage: 0,         // 보스를 돌파한 최고 스테이지 (오프라인 보상 기준)
      mobIndex: 0,          // 현재 스테이지에서 처치한 일반몹 수
      phase: PHASE_ADVANCE,
      phaseT: 0,            // 전진 경과
      enemyHp: 0,
      enemyMaxHp: 0,
      bossT: 0,             // 보스 제한시간 경과
      gold: 0,
      up: { atk: 1, aspd: 1, gold: 1 },
      party: Chars ? [Chars.CHARACTERS[0].id] : [],   // 편성된 캐릭터 (슬롯 순서)
      shards: 0,                                       // 별조각 — 보스가 주는 유물 재화
      relics: { hammer: 0, barn: 0, compass: 0 },
      collection: [],                                  // 도감 — 만난 몬스터/보스 id
      storySeen: [],                                   // 스토리 — 본 장면 id
      daily: null,                                     // 일일 과제 { date, base, claimed } — game.js 가 관리
      dungeon: null,                                   // 던전 { date, runs, best } — game.js 가 관리
      stats: {
        kills: 0, bossTries: 0, bossWins: 0, bossFails: 0,
        upgrades: 0, goldEarned: 0,
      },
      // 이번 step 에서 일어난 일 — UI 연출과 시뮬 지표가 읽고 비운다.
      events: [],
    };
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }

  // ── 이벤트 기반 진행 ─────────────────────────────────────────
  /* 다음 이벤트까지의 시간과 **그 이벤트가 무엇인지**를 함께 돌려준다.
   * 종류를 여기서 확정하는 것이 핵심이다. 예전에는 시간만 반환하고 도착 후 HP 잔량으로
   * 승패를 다시 판정했는데, 보스를 제한시간에 딱 맞춰 잡는 구간에서 부동소수 오차가
   * 승패를 뒤집었다(같은 상황에서 dt=0.5 는 승리, dt=0.25 는 실패). */
  function nextEvent(s) {
    var d = dps(s);
    if (s.phase === PHASE_ADVANCE) return { t: advanceSeconds(s) - s.phaseT, kind: 'spawn' };
    if (s.phase === PHASE_FIGHT)   return { t: s.enemyHp / d, kind: 'kill' };
    if (s.phase === PHASE_BOSS) {
      var tKill = s.enemyHp / bossDps(s);
      var tOut = B.bossTimeLimit - s.bossT;
      // 동시에 도달하면 플레이어에게 유리하게 — 제한시간 안에 잡은 것으로 본다.
      return tKill <= tOut ? { t: tKill, kind: 'boss_kill' } : { t: tOut, kind: 'boss_timeout' };
    }
    return { t: Infinity, kind: 'none' };
  }

  function elapse(s, dt) {
    s.t += dt;
    if (s.phase === PHASE_ADVANCE) {
      s.phaseT += dt;
    } else if (s.phase === PHASE_BOSS) {
      s.enemyHp -= bossDps(s) * dt;
      s.bossT += dt;
    } else {
      s.enemyHp -= dps(s) * dt;
    }
  }

  function spawnNext(s) {
    s.phaseT = 0;
    if (s.mobIndex >= B.mobsPerStage) {
      s.phase = PHASE_BOSS;
      s.enemyMaxHp = bossHp(s.stage);
      s.enemyHp = s.enemyMaxHp;
      s.bossT = 0;
      s.stats.bossTries++;
      s.events.push({ type: 'boss_start', stage: s.stage });
    } else {
      s.phase = PHASE_FIGHT;
      s.enemyMaxHp = mobHp(s.stage);
      s.enemyHp = s.enemyMaxHp;
      s.events.push({ type: 'mob_spawn', stage: s.stage, index: s.mobIndex });
    }
  }

  /* 이벤트 종류는 nextEvent 가 이미 확정했다. 여기서 HP 잔량으로 다시 판정하지 않는다. */
  function resolveEvent(s, kind) {
    if (kind === 'spawn') { spawnNext(s); return; }

    if (kind === 'kill') {
      s.enemyHp = 0;
      var g = mobGold(s, s.stage);
      s.gold += g;
      s.stats.goldEarned += g;
      s.stats.kills++;
      s.mobIndex++;
      s.phase = PHASE_ADVANCE;
      s.phaseT = 0;
      s.events.push({ type: 'mob_kill', gold: g });
      return;
    }

    if (kind === 'boss_kill') {
      s.enemyHp = 0;
      s.safeStage = s.stage;
      /* 별사탕(shardMul) 편성 시 조각 수입이 늘어난다 — floor 로 정수 유지 */
      var clearShards = Math.floor((1 + Math.floor(s.stage / B.shardClearDiv)) * (1 + partyBonus(s).shardMul));
      s.shards += clearShards;
      s.stage++;
      s.mobIndex = 0;
      s.stats.bossWins++;
      s.phase = PHASE_ADVANCE;
      s.phaseT = 0;
      s.events.push({ type: 'boss_clear', stage: s.safeStage, shards: clearShards });
      return;
    }

    if (kind === 'boss_timeout') {
      /* 실패해도 스테이지는 내려가지 않고, 별조각 1개를 준다.
       * 벽에 막힌 시간이 그대로 유물 성장이 되므로, 벽에서 할 수 있는 일이
       * "골드 파밍" 하나에서 "골드 파밍 + 조각 모으기" 둘로 늘어난다(P3 게이트). */
      var failShards = Math.floor((1 + Math.floor(s.stage / B.shardFailDiv)) * (1 + partyBonus(s).shardMul));
      s.shards += failShards;
      s.mobIndex = 0;
      s.stats.bossFails++;
      s.phase = PHASE_ADVANCE;
      s.phaseT = 0;
      s.events.push({ type: 'boss_fail', stage: s.stage, shards: failShards });
    }
  }

  /* dt 초만큼 진행한다. 이벤트 경계에서 정확히 끊어 처리하므로 dt 크기와 무관하게
   * 결과가 같다. **주어진 dt 는 언제나 전부 소비한다** — 예전에는 이벤트 수 상한에
   * 걸리면 남은 시간을 조용히 버려서 step(s, 1e9) 이 56만 초만 진행했다.
   * 상한은 "0초 이벤트가 연속되는" 비정상 상태에만 건다. */
  function step(s, dt) {
    if (!(dt > 0)) return s;
    var remain = dt;
    var zeroGuard = 0;
    while (remain > 0) {
      var ev = nextEvent(s);
      if (!isFinite(ev.t)) { elapse(s, remain); return s; }
      var te = ev.t > 0 ? ev.t : 0;
      if (te > remain) { elapse(s, remain); return s; }
      elapse(s, te);
      resolveEvent(s, ev.kind);
      remain -= te;
      if (te === 0) { if (++zeroGuard > 1000) return s; } else { zeroGuard = 0; }
    }
    return s;
  }

  // ── 강화 ────────────────────────────────────────────────────
  /* 골드로 살 수 있는 최대 개수. 등비수열 합의 역함수로 근사한 뒤 정수 보정한다.
   * 보정 루프에는 상한을 둔다 — costGrowth 가 1 로 설정되면 bulkCost 가 선형이 되어
   * 근사식이 무너지고 루프가 끝나지 않는다. */
  var AFFORD_CAP = 100000;
  function affordable(s, axis, cap) {
    var g = B.costGrowth[axis];
    var c0 = upgradeCost(axis, s.up[axis]);
    if (!(s.gold >= c0)) return 0;
    var n;
    if (g > 1) {
      n = Math.floor(Math.log(1 + (s.gold * (g - 1)) / c0) / Math.log(g));
    } else {
      n = Math.floor(s.gold / c0);            // 비용이 일정한 경우
    }
    if (!isFinite(n) || n < 0) n = 0;
    n = Math.min(n, AFFORD_CAP);
    // 부동소수 오차 보정
    var guard = 0;
    while (n > 0 && bulkCost(s, axis, n) > s.gold && guard++ < 64) n--;
    guard = 0;
    while (n < AFFORD_CAP && bulkCost(s, axis, n + 1) <= s.gold && guard++ < 64) n++;
    if (cap != null) n = Math.min(n, cap);
    return n;
  }

  /* count 개를 한 번에 살 때의 총비용.
   * count===1 은 반드시 upgradeCost 와 **정확히 같은 값**이어야 한다. 등비합 공식으로
   * 계산하면 1 ULP 차이가 나서, 화면에 표시된 1레벨 비용만큼 골드를 갖고도 구매가
   * 거부되는 일이 생겼다(ATK Lv.21). */
  function bulkCost(s, axis, count) {
    if (count <= 0) return 0;
    var c0 = upgradeCost(axis, s.up[axis]);
    if (count === 1) return c0;
    var g = B.costGrowth[axis];
    if (g === 1) return c0 * count;
    return c0 * (Math.pow(g, count) - 1) / (g - 1);
  }

  /* 강화 구매. count 는 정수 또는 'max'. 실제로 구매한 개수를 돌려준다. */
  function buy(s, axis, count) {
    var n = (count === 'max') ? affordable(s, axis, null) : Math.floor(count);
    if (!(n > 0)) return 0;
    var cost = bulkCost(s, axis, n);
    if (cost > s.gold) {
      n = affordable(s, axis, n);
      if (!(n > 0)) return 0;
      cost = bulkCost(s, axis, n);
    }
    s.gold -= cost;
    s.up[axis] += n;
    s.stats.upgrades += n;
    s.events.push({ type: 'upgrade', axis: axis, count: n, cost: cost });
    return n;
  }

  /* 지금 살 수 있는 강화가 하나라도 있는가 — "유휴 시간" 지표의 정의. */
  function canBuyAnything(s) {
    for (var i = 0; i < AXES.length; i++) {
      if (s.gold >= upgradeCost(AXES[i].id, s.up[AXES[i].id])) return true;
    }
    return false;
  }

  // ── 오프라인 보상 ────────────────────────────────────────────
  /* elapsedSec 은 호출자가 (now - lastSaveAt) 으로 계산해 넘긴다. 엔진은 시계를
   * 읽지 않는다. 음수(시계 역행)는 0, 상한은 offlineMaxHours 로 자른다. */
  function offlineReward(s, elapsedSec) {
    var e = elapsedSec;
    if (!(e > 0)) e = 0;
    var cap = B.offlineMaxHours * 3600;
    var clamped = Math.min(e, cap);
    // 안정적으로 파밍 가능한 구간 = 보스를 돌파한 최고 스테이지.
    // 아직 첫 보스를 못 넘었으면 1스테이지 기준.
    var farmStage = s.safeStage > 0 ? s.safeStage : 1;
    var gold = goldPerSec(s, farmStage) * clamped * B.offlineEfficiency;
    // 손상되거나 조작된 세이브(극대 레벨)에서 Infinity/NaN 이 골드로 새어 들어가면
    // 이후 모든 계산이 오염된다. 마지막 관문에서 막는다.
    if (!isFinite(gold) || gold < 0) gold = 0;
    return {
      gold: gold,
      seconds: clamped,
      cappedBy: e > cap ? 'max' : (elapsedSec < 0 ? 'clock' : null),
      farmStage: farmStage,
    };
  }

  return {
    PHASE_ADVANCE: PHASE_ADVANCE, PHASE_FIGHT: PHASE_FIGHT, PHASE_BOSS: PHASE_BOSS,
    createState: createState, clone: clone, step: step,
    atk: atk, aspd: aspd, goldMul: goldMul, dps: dps, power: power,
    effAtk: effAtk, effAspd: effAspd, bossDps: bossDps, advanceSeconds: advanceSeconds,
    partyBonus: partyBonus, sanitizeParty: sanitizeParty, NO_BONUS: NO_BONUS,
    relicLv: relicLv, relicMul: relicMul, relicCost: relicCost, buyRelic: buyRelic,
    mobHp: mobHp, bossHp: bossHp, mobGold: mobGold, goldPerSec: goldPerSec,
    upgradeCost: upgradeCost, bulkCost: bulkCost, affordable: affordable,
    buy: buy, canBuyAnything: canBuyAnything,
    offlineReward: offlineReward,
  };
});
