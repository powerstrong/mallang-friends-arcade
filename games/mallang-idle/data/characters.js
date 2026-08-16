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
 *
 * 지금 보스가 안 깨지면 라떼, 장기 성장을 원하면 푸딩/민트 — 어느 쪽도 항상 옳지 않다.
 * 해금은 스테이지 도달로만 이루어진다(가챠 없음).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdleCharacters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CHARACTERS = [
    {
      id: 'rabbit', name: '모찌 토끼', unlockStage: 1,
      walk: 'assets/hero-rabbit-walk.png', frameW: 151,
      portrait: 'assets/portrait-rabbit.png',
      atk: 'assets/atk-rabbit.png', atkW: 265,
      skill: { key: 'atkMul', value: 0.20 },
      skillText: '공격력 +20%',
      desc: '한 방이 묵직한 기본기형',
    },
    {
      id: 'chick', name: '피치 병아리', unlockStage: 5,
      walk: 'assets/hero-chick-walk.png', frameW: 188,
      portrait: 'assets/portrait-chick.png',
      atk: 'assets/atk-chick.png', atkW: 301,
      skill: { key: 'aspdMul', value: 0.18 },
      skillText: '공격 속도 +18%',
      desc: '빠르게 쪼아대는 속공형',
    },
    {
      id: 'hamster', name: '푸딩 햄스터', unlockStage: 15,
      walk: 'assets/hero-hamster-walk.png', frameW: 191,
      portrait: 'assets/portrait-hamster.png',
      atk: 'assets/atk-hamster.png', atkW: 283,
      skill: { key: 'goldMul', value: 0.25 },
      skillText: '골드 획득 +25%',
      desc: '볼주머니 가득 모으는 살림꾼',
    },
    {
      id: 'latte', name: '라떼 퍼피', unlockStage: 30,
      walk: 'assets/hero-latte-walk.png', frameW: 139,
      portrait: 'assets/portrait-latte.png',
      atk: 'assets/atk-latte.png', atkW: 253,
      skill: { key: 'bossMul', value: 0.35 },
      skillText: '보스에게 주는 피해 +35%',
      desc: '큰 상대일수록 신나는 돌파형',
    },
    {
      id: 'mintcat', name: '민트 키튼', unlockStage: 50,
      walk: 'assets/hero-mintcat-walk.png', frameW: 202,
      portrait: 'assets/portrait-mintcat.png',
      atk: 'assets/atk-mintcat.png', atkW: 258,
      skill: { key: 'advanceMul', value: 0.40 },
      skillText: '이동 시간 -40%',
      desc: '사뿐사뿐 빨리 도는 발바닥',
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
