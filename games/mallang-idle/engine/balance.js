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
    mobHpGrowth: 1.172,     // 스테이지당 지수 — goldGrowth 보다 높아야 벽이 생긴다
    bossHpMultiplier: 12,
    bossTimeLimit: 25,      // 초
    mobsPerStage: 10,
    advanceSeconds: 0.6,    // 몹 사이 전진 시간 — 진행의 리듬

    // ── 보상 ──────────────────────────────────────────────────
    goldBase: 6,
    goldGrowth: 1.158,      // 스테이지당 지수

    // ── 강화 비용 ─────────────────────────────────────────────
    costBase:   { atk: 20,    aspd: 60,   gold: 45 },
    costGrowth: { atk: 1.135, aspd: 1.22, gold: 1.18 },

    // ── 오프라인 ──────────────────────────────────────────────
    offlineEfficiency: 0.25,
    offlineMaxHours: 8,
    offlineMinSeconds: 60,    // 이보다 짧게 비운 건 보상 팝업을 띄우지 않는다(골드는 준다)

    // ── 표시 전용 ─────────────────────────────────────────────
    // 전투력 = DPS·골드배수의 가중합. 표시용이며 데미지 공식에 재투입되지 않는다.
    powerDpsWeight: 10,
    powerGoldWeight: 50,

    // 세이브 검증 상한 — 손상/조작된 값이 Infinity 로 번지는 것을 막는다.
    maxUpgradeLevel: 100000,
  };

  // 강화 축 목록 — UI·시뮬레이터·테스트가 공유한다.
  var AXES = [
    { id: 'atk',  name: '공격력',    desc: '한 방의 세기',     icon: 'assets/icon-atk.png' },
    { id: 'aspd', name: '공격 속도', desc: '초당 공격 횟수',   icon: 'assets/icon-aspd.png' },
    { id: 'gold', name: '골드 획득', desc: '몹이 주는 골드',   icon: 'assets/icon-gold.png' },
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

  return { BALANCE: BALANCE, AXES: AXES, SIM_POLICY: SIM_POLICY };
});
