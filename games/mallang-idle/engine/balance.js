/*
 * 말랑프렌즈 키우기 — 밸런스 상수 단일 원천
 *
 * 이 파일 밖에 계수를 두지 않는다. 게임 코드에 `* 1.17`, `* 6` 같은 매직 넘버가
 * 흩어지는 순간 밸런싱이 불가능해진다. 자세한 의도는 ../BALANCE.md 참고.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleBalance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BALANCE = {
    // ── 플레이어 ──────────────────────────────────────────────
    baseAtk: 10,
    atkGrowth: 1.12,        // 지수 (레벨당)

    baseAspd: 1.0,          // 공격/초
    aspdPerLv: 0.04,        // 선형 증가분
    aspdCap: 5.0,           // 상한 — DPS 이중 지수 폭주 방지

    goldMulPerLv: 0.08,     // 선형: goldMul = 1 + 0.08*(lv-1)

    // ── 적 ────────────────────────────────────────────────────
    mobBaseHp: 30,
    mobHpGrowth: 1.18,     // 스테이지당 지수 — goldGrowth 보다 높아야 벽이 생긴다
    bossHpMultiplier: 12,
    bossTimeLimit: 25,      // 초
    mobsPerStage: 10,
    advanceSeconds: 0.6,    // 몹 사이 전진 시간 — 진행의 리듬

    // ── 보상 ──────────────────────────────────────────────────
    goldBase: 6,
    goldGrowth: 1.158,       // 스테이지당 지수

    // ── 강화 비용 ─────────────────────────────────────────────
    costBase:   { atk: 20,   aspd: 60,   gold: 45 },
    costGrowth: { atk: 1.15, aspd: 1.22, gold: 1.18 },

    // ── 오프라인 ──────────────────────────────────────────────
    offlineEfficiency: 0.25,
    offlineMaxHours: 8,
    offlineMinSeconds: 60,    // 이보다 짧게 비운 건 보상 팝업을 띄우지 않는다(골드는 준다)

    // ── 유물 (P3 영구 성장축) ─────────────────────────────────
    // 별조각: 보스가 주는 두 번째 재화. 실패해도 조각을 준다 — 벽에 막힌 시간이
    // 그대로 성장이 되어, 벽에서 시도할 수단이 골드 강화 하나에서 둘로 늘어난다.
    //
    // 유물 배수는 레벨당 **곱연산**(pow)이다. 선형(+15%p/Lv)으로 두면 상대 이득이
    // 레벨이 오를수록 줄어들어(14→15레벨 = ×1.048) 지수로 자라는 보스 HP 를 영구히
    // 못 따라간다. 곱연산이어야 레벨 하나가 항상 같은 비율의 벽을 깎는다.
    shardClearDiv: 10,        // 돌파 보상 = 1 + floor(stage / shardClearDiv)
    shardFailDiv: 15,         // 실패 보상 = 1 + floor(stage / shardFailDiv) — 후반 벽에서도 수입 유지

    relics: {
      hammer:  { costBase: 8, costGrowth: 1.45, perLv: 0.08 },  // 공격 ×1.08/Lv
      barn:    { costBase: 8, costGrowth: 1.45, perLv: 0.08 },  // 골드 ×1.08/Lv
      compass: { costBase: 6, costGrowth: 1.35, perLv: 0.12 },  // 보스 피해 ×1.12/Lv
    },
    maxRelicLevel: 10000,

    // ── 별빛 시련 (보스 러시 던전, P4) ────────────────────────
    dungeonRunsPerDay: 3,
    dungeonBossTime: 15,      // 보스당 제한시간(초)
    dungeonStartMul: 0.35,    // 첫 보스 = 본편 보스의 35% — 방금 그 층을 깬 유저가
                              // 몇 연승은 하고 벽을 만나야 첫 경험이 성립한다
    dungeonHpGrowth: 1.35,    // 연전마다 HP 배율
    dungeonGoldSeconds: 30,   // 격파당 골드 = 파밍 30초치
    dungeonMaxBosses: 200,    // 폭주 방지 상한

    // ── 일일 과제 (P4) ────────────────────────────────────────
    questRewards: { kills: 5, upgrades: 5, bossTries: 8 },   // 별조각
    questTargets: { kills: 200, upgrades: 20, bossTries: 10 },

    // ── 표시 전용 ─────────────────────────────────────────────
    // 전투력 = DPS·골드배수의 가중합. 표시용이며 데미지 공식에 재투입되지 않는다.
    powerDpsWeight: 10,
    powerGoldWeight: 50,

    // 세이브 검증 상한 — 손상/조작된 값이 Infinity 로 번지는 것을 막는다.
    maxUpgradeLevel: 100000,
    // mobHp = 30 × 1.18^stage 는 stage ≈ 4280 에서 double 을 넘는다(Infinity).
    // 정상 플레이는 수백 층 규모이므로 4000 이면 실사용에 여유가 크다.
    maxStage: 4000,
  };

  // 강화 축 목록 — UI·시뮬레이터·테스트가 공유한다.
  var AXES = [
    { id: 'atk',  name: '공격력',    desc: '한 방의 세기',     icon: 'assets/icon-atk.png' },
    { id: 'aspd', name: '공격 속도', desc: '초당 공격 횟수',   icon: 'assets/icon-aspd.png' },
    { id: 'gold', name: '골드 획득', desc: '몹이 주는 골드',   icon: 'assets/icon-gold.png' },
  ];

  // 유물 축 — UI·시뮬레이터·테스트가 공유. bonus 키는 combat.partyBonus 와 같은 체계.
  var RELIC_AXES = [
    { id: 'hammer',  name: '별의 망치',   icon: 'assets/icon-relic-hammer.png',  bonusText: '공격력',    effect: 'atk' },
    { id: 'barn',    name: '별의 곳간',   icon: 'assets/icon-relic-barn.png',    bonusText: '골드 획득', effect: 'gold' },
    { id: 'compass', name: '별의 나침반', icon: 'assets/icon-relic-compass.png', bonusText: '보스 피해', effect: 'boss' },
  ];

  // 시뮬레이터가 대역하는 "합리적인 플레이어"의 정책.
  // 정책을 바꾸면 지표가 바뀐다 → 변경 시 커밋 메시지에 기록할 것.
  var SIM_POLICY = {
    dpsBonusWeight: 1.25,     // DPS 축은 보스 돌파에도 기여하므로 가중
    decisionInterval: 0.5,    // 초 — 구매 판단 주기
    bossStuckDpsOnly: true,   // 보스에 한 번 실패하면 DPS 축 우선
    maxBulkPerDecision: 50,   // 한 번의 판단에서 살 최대 개수

    /* "유휴"의 정의 — 방치형에서 골드가 모이는 짧은 대기는 정상이다.
     * 문제가 되는 것은 다음 강화까지 하염없이 기다리는 구간이므로,
     * 대기 예상 시간이 이 임계를 넘는 시간만 유휴로 집계한다. */
    idleThresholdSec: 30,
  };

  return { BALANCE: BALANCE, AXES: AXES, RELIC_AXES: RELIC_AXES, SIM_POLICY: SIM_POLICY };
});
