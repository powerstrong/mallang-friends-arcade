/*
 * 말랑프렌즈 키우기 — 캐릭터 정의 (P2 편성)
 *
 * 설계 의도: 캐릭터가 스킨이 되면 안 된다. 편성이 "정답 하나로 수렴"하지 않으려면
 * 각자가 서로 다른 축을 밀어야 한다(../ROADMAP.md P2 게이트).
 * 그래서 다섯 친구를 코어 루프의 세 긴장에 맞춰 배치했다.
 *
 *   DPS 계열   : 모찌(공격력) · 피치(공격속도)
 *   경제 계열   : 푸딩(골드) · 민트(전진 속도 = 파밍 회전율)
 *   돌파 계열   : 라떼(보스 데미지)
 *   유물 계열   : 별사탕(별조각 수입 — 나침반/망치/곳간 레벨을 앞당긴다)
 *
 * 지금 보스가 안 깨지면 라떼, 장기 성장을 원하면 푸딩/민트, 유물을 몰아치려면
 * 별사탕 — 어느 쪽도 항상 옳지 않다. 해금은 스테이지 도달로만 이루어진다(가챠 없음).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleCharacters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 스프라이트 메타(표현 전용): walk/run = 6프레임 워크사이클(walkN·runN),
   * atkSheet = 기본공격 6프레임, atkSp = 스킬 세트피스 8프레임 (7.1절 규격).
   * atk(단일 포즈)는 시트 부재 시 폴백으로 남긴다. 스킬 '수치'는 불변. */
  var CHARACTERS = [
    {
      id: 'rabbit', name: '모찌 토끼', unlockStage: 1,
      walk: 'assets/hero-rabbit-walk.png', frameW: 172, walkN: 6,
      run: 'assets/hero-rabbit-run.png', runW: 152, runN: 6,
      portrait: 'assets/portrait-rabbit.png',
      atk: 'assets/atk-rabbit.png', atkW: 265,
      atkSheet: 'assets/atk-rabbit-sheet.png', atkSheetW: 244, atkSheetN: 6,
      atkSp: 'assets/atk-rabbit-sp.png', atkSpW: 170, atkSpN: 8,
      skill: { key: 'atkMul', value: 0.20 },
      skillText: '공격력 +20%',
      desc: '한 방이 묵직한 기본기형',
    },
    {
      id: 'chick', name: '피치 병아리', unlockStage: 5,
      walk: 'assets/hero-chick-walk.png', frameW: 188, walkN: 6,
      run: 'assets/hero-chick-run.png', runW: 242, runN: 6,
      portrait: 'assets/portrait-chick.png',
      atk: 'assets/atk-chick.png', atkW: 301,
      atkSheet: 'assets/atk-chick-sheet.png', atkSheetW: 312, atkSheetN: 6,
      atkSp: 'assets/atk-chick-sp.png', atkSpW: 270, atkSpN: 8,
      skill: { key: 'aspdMul', value: 0.18 },
      skillText: '공격 속도 +18%',
      desc: '빠르게 쪼아대는 속공형',
    },
    /* 해금 간격 재배치(codex 재미 리뷰 #2): 1/5/15/30/50 은 30분(스테이지 ~53)에
     * 전부 소진되어 첫 세션이 일주일치 해금을 다 써 버렸다. 22/55/90/120 으로
     * 늘려 "다음 복귀에 무엇이 열리는가"가 첫 주 내내 남아 있게 한다.
     * 컷신 화자-해금 정합(챕터 경계 31/71/131/211)은 무결성 테스트가 지킨다. */
    {
      id: 'hamster', name: '푸딩 햄스터', unlockStage: 22,
      walk: 'assets/hero-hamster-walk.png', frameW: 194, walkN: 6,
      run: 'assets/hero-hamster-run.png', runW: 290, runN: 6,
      portrait: 'assets/portrait-hamster.png',
      atk: 'assets/atk-hamster.png', atkW: 283,
      atkSheet: 'assets/atk-hamster-sheet.png', atkSheetW: 236, atkSheetN: 6,
      atkSp: 'assets/atk-hamster-sp.png', atkSpW: 216, atkSpN: 8,
      skill: { key: 'goldMul', value: 0.25 },
      skillText: '골드 획득 +25%',
      desc: '볼주머니 가득 모으는 살림꾼',
    },
    {
      id: 'latte', name: '라떼 퍼피', unlockStage: 55,
      walk: 'assets/hero-latte-walk.png', frameW: 202, walkN: 6,
      run: 'assets/hero-latte-run.png', runW: 224, runN: 6,
      portrait: 'assets/portrait-latte.png',
      atk: 'assets/atk-latte.png', atkW: 253,
      atkSheet: 'assets/atk-latte-sheet.png', atkSheetW: 204, atkSheetN: 6,
      atkSp: 'assets/atk-latte-sp.png', atkSpW: 200, atkSpN: 8,
      skill: { key: 'bossMul', value: 0.35 },
      skillText: '보스에게 주는 피해 +35%',
      desc: '큰 상대일수록 신나는 돌파형',
    },
    {
      id: 'mintcat', name: '민트 키튼', unlockStage: 90,
      walk: 'assets/hero-mintcat-walk.png', frameW: 208, walkN: 6,
      run: 'assets/hero-mintcat-run.png', runW: 286, runN: 6,
      portrait: 'assets/portrait-mintcat.png',
      atk: 'assets/atk-mintcat.png', atkW: 258,
      atkSheet: 'assets/atk-mintcat-sheet.png', atkSheetW: 334, atkSheetN: 6,
      atkSp: 'assets/atk-mintcat-sp.png', atkSpW: 254, atkSpN: 8,
      skill: { key: 'advanceMul', value: 0.40 },
      skillText: '이동 시간 -40%',
      desc: '사뿐사뿐 빨리 도는 발바닥',
    },
    /* 기계 전선(71~130) 한복판에서 구출되는 여섯 번째 친구.
     * 별조각 축은 "벽에서 라떼(즉시 돌파력)냐 별사탕(유물 성장)이냐"라는
     * 새 갈림길을 만든다 — 코어 루프의 긴장 2번을 깊게 하는 축. */
    {
      id: 'otter', name: '별사탕 수달', unlockStage: 120,
      walk: 'assets/hero-otter-walk.png', frameW: 182, walkN: 6,
      run: 'assets/hero-otter-run.png', runW: 276, runN: 6,
      portrait: 'assets/portrait-otter.png',
      atk: 'assets/atk-otter.png', atkW: 236,
      atkSheet: 'assets/atk-otter-sheet.png', atkSheetW: 278, atkSheetN: 6,
      atkSp: 'assets/atk-otter-sp.png', atkSpW: 254, atkSpN: 8,
      skill: { key: 'shardMul', value: 0.35 },
      skillText: '별조각 획득 +35%',
      desc: '반짝이는 건 놓치지 않는 수집가',
    },
  ];

  /* 파티 슬롯도 진행에 따라 열린다. 처음부터 셋을 주면 편성이 선택이 아니라 나열이 된다. */
  var SLOT_UNLOCKS = [1, 10, 40];   // 슬롯 1·2·3 이 열리는 스테이지

  function byId(id) {
    for (var i = 0; i < CHARACTERS.length; i++) if (CHARACTERS[i].id === id) return CHARACTERS[i];
    return null;
  }

  function slotsFor(stage) {
    var n = 0;
    for (var i = 0; i < SLOT_UNLOCKS.length; i++) if (stage >= SLOT_UNLOCKS[i]) n++;
    return Math.max(1, n);
  }

  function unlockedAt(stage) {
    var out = [];
    for (var i = 0; i < CHARACTERS.length; i++) {
      if (stage >= CHARACTERS[i].unlockStage) out.push(CHARACTERS[i].id);
    }
    return out;
  }

  return {
    CHARACTERS: CHARACTERS,
    SLOT_UNLOCKS: SLOT_UNLOCKS,
    byId: byId,
    slotsFor: slotsFor,
    unlockedAt: unlockedAt,
  };
});
