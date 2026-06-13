/* MAR_CHARACTERS — 캐릭터 5종 정의 (M3)
 *
 * 능력 수치는 DESIGN.md 리뷰 수정안(codex·gemini P0 반영) 그대로:
 *  - 병아리: ×N 포함 시 첫 게이트에 상한 도달(codex P0) → +N 게이트만 +20%
 *  - 토끼: 40/20은 보스전 과함 → 25/15, 체감 위해 시각 오라 필수(gemini)
 *  - 민트: ×1.3은 상한 구조서 순수 30% 우위(codex P0) → ×1.2 + 사수상한 10(질 정체성)
 *  - 라떼: 조향 페널티는 "렉 걸린 느낌"(gemini) → 페널티 없음, 받는 피해 −25%
 *  - 햄스터: 3초 무적은 과함(codex) → 1.5초. 보스 드레인·게이트 페널티는 보호막 제외
 * 부대는 단일 종(대장과 같은 종). 수치는 텔레메트리로 재튜닝 전제.
 *
 * 해금: 병아리 기본 / 토끼=스테이지1 클리어 / 민트=2 / 라떼=3 / 햄스터=전 스테이지 클리어 */
(function (global) {
  global.MAR_CHARACTERS = [
    {
      id: 'chick', name: '피치 병아리', emoji: '🐤',
      abilityName: '군집', abilityDesc: '+N 게이트 효과 +20%',
      weapon: 'straight', // 기본 직진탄 — 미사일은 기본적으로 앞으로 나간다(사용자 피드백)
      ability: { addGateMul: 1.2 }
    },
    {
      id: 'rabbit', name: '토끼', emoji: '🐰',
      abilityName: '날쌤', abilityDesc: '조향 +25% · 보스탄 회피 ↑',
      weapon: 'rapid',    // 빠른 연사 직진탄(얇고 잦음)
      ability: { steerMul: 1.25, shotHitboxMul: 0.85, aura: true }
    },
    {
      id: 'mintcat', name: '민트 고양이', emoji: '🐱',
      abilityName: '치명', abilityDesc: '데미지 ×1.2 · 사수 10명',
      weapon: 'homing',   // 유도탄(수렴) — 질 정체성과 어울림
      ability: { dmgMul: 1.2, shooterCap: 10 }
    },
    {
      id: 'latte', name: '라떼', emoji: '🐶',
      abilityName: '든든', abilityDesc: '받는 피해 −25%',
      weapon: 'mortar',   // 광역 대포 — 곡사 포탄 + 착탄 링
      ability: { damageTakenMul: 0.75 }
    },
    {
      id: 'hamster', name: '햄스터', emoji: '🐹',
      abilityName: '보호막', abilityDesc: '스테이지당 1회 피해 무효 + 1.5초 무적',
      weapon: 'spread',   // 부채꼴 직진탄
      ability: { autoShield: true, shieldInvulnSec: 1.5 }
    }
  ];

  /* 진도 기반 해금 캐릭터 id 목록 */
  global.MARUnlockedChars = function () {
    var cleared = (window.MARProgress ? MARProgress.clearedStages() : {});
    var ids = ['chick'];
    if (cleared[1]) ids.push('rabbit');
    if (cleared[2]) ids.push('mintcat');
    if (cleared[3]) ids.push('latte');
    if (cleared[1] && cleared[2] && cleared[3]) ids.push('hamster');
    return ids;
  };
})(window);
