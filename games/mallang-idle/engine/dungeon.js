/*
 * 말랑프렌즈 키우기 — 별빛 시련 (보스 러시 던전)
 *
 * 방치형 문법을 따른다: 결과는 현재 전투력으로 **결정론적으로 계산**되고,
 * 화면은 그 결과를 연출로 보여줄 뿐이다. 조작이 없으므로 엔진은 순수 함수 하나면 된다.
 *
 * 규칙: 보스가 연속으로 나온다. i번째 보스 HP = 기준 보스 HP × dungeonHpGrowth^i,
 * 각 보스 제한시간 dungeonBossTime 초. 시간 안에 못 잡는 순간 종료.
 * 보상: 격파당 별조각(스테이지 비례) + 골드(파밍 수십 초치).
 *
 * HP·생존 축이 없는 v1 에서는 던전도 DPS 체크의 변형이다. 생존형 던전(HP 축)은
 * P4 후속 후보로 남긴다 — ../NEXT_STEPS.md 참고.
 */
(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./balance.js') : root.MallangIdleBalance,
    typeof require === 'function' ? require('./combat.js') : root.MallangIdleCombat
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleDungeon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Bal, Combat) {
  'use strict';

  var B = Bal.BALANCE;

  /* 현재 상태의 전투력으로 시련을 끝까지 돌린 결과.
   * 같은 상태면 언제나 같은 결과 — 시뮬레이터·테스트·화면이 모두 이 함수를 쓴다. */
  function simulate(state) {
    var baseStage = state.safeStage > 0 ? state.safeStage : 1;
    var dps = Combat.bossDps(state);
    var shardPerKill = 1 + Math.floor(baseStage / B.shardClearDiv);
    var goldPerKill = Combat.goldPerSec(state, baseStage) * B.dungeonGoldSeconds;
    // 손상 세이브(극단 스테이지)에서 지수 계산이 Infinity/NaN 으로 번지면
    // 보상을 통해 상태 전체가 오염된다. 여기서 끊는다.
    if (!isFinite(goldPerKill) || goldPerKill < 0) goldPerKill = 0;
    if (!isFinite(dps) || dps <= 0) {
      return { kills: 0, shards: 0, gold: 0, baseStage: baseStage, log: [] };
    }

    var kills = 0;
    var log = [];
    while (kills < B.dungeonMaxBosses) {
      var hp = Combat.bossHp(baseStage) * B.dungeonStartMul * Math.pow(B.dungeonHpGrowth, kills);
      var need = hp / dps;
      if (need > B.dungeonBossTime) {
        log.push({ hp: hp, time: null });          // 잡지 못한 마지막 보스
        break;
      }
      kills++;
      log.push({ hp: hp, time: need });
    }
    return {
      kills: kills,
      shards: kills * shardPerKill,
      gold: kills * goldPerKill,
      baseStage: baseStage,
      log: log,
    };
  }

  /* 보상 지급 — simulate 결과를 실제 상태에 반영한다.
   * 마지막 관문에서 한 번 더 유한성을 확인한다(오프라인 보상과 같은 원칙). */
  function applyReward(state, result) {
    var shards = isFinite(result.shards) && result.shards > 0 ? result.shards : 0;
    var gold = isFinite(result.gold) && result.gold > 0 ? result.gold : 0;
    state.shards += shards;
    state.gold += gold;
    state.stats.goldEarned += gold;
  }

  return { simulate: simulate, applyReward: applyReward };
});
