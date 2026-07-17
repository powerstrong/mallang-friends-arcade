/* characters.js — 말랑 계단 레이스 캐릭터 정의 (window 전역, ES모듈 아님)
 *
 * 에셋은 게임 독립성을 위해 games/mallang-stairs/assets/ 로 복사된 사본을 쓴다
 * (jump-climber 폴더에 의존하지 않음).
 *
 * 충돌/렌더는 PNG 실측 bbox(캐릭터마다 136~253px로 제각각)가 아니라
 * 아래 BOX 고정 게임박스를 기준으로 한다.
 */
(function () {
  'use strict';

  // 모든 캐릭터 공통 고정 게임박스 (렌더 기준 크기 / 충돌 판정 크기).
  // 원본 PNG는 256x256 캔버스에 캐릭터가 가변 면적으로 들어있으므로
  // 박스는 캐릭터별 bbox와 무관하게 통일한다.
  var BOX = {
    renderSize: 76,   // 기본 렌더 한 변(px). 계단 칸 위에 앉는 크기
    hitW: 48,         // 충돌 판정 폭
    hitH: 56,         // 충돌 판정 높이
    anchor: 'bottom-center',
  };

  var ASSET_DIR = 'assets/';
  function poses(id) {
    return {
      main:  ASSET_DIR + id + '-main.png',
      left:  ASSET_DIR + id + '-left.png',
      right: ASSET_DIR + id + '-right.png',
      fall:  ASSET_DIR + id + '-fall.png',
      win:   ASSET_DIR + id + '-win.png',
    };
  }

  // ability 필드 의미:
  //   perfectScoreBonus  : Perfect 판정 점수 추가 배율(+0.15 = +15%)
  //   drainMul           : 시간게이지 감소 배율(1.05 = +5%)
  //   judgeWindowBonusMs : Perfect/Good 판정 시간 여유(+ms)
  //   baseScoreMul       : 기본 점수 배율
  //   crisisRecover      : 위기 시 게이지 자동회복 (ratio=비율, once=게임당 횟수)
  //   superStep          : N콤보마다 K스텝 동안 점수 배율
  //   feverGainMul       : 피버게이지 획득 배율
  //   feverScoreBonus    : 피버 중 점수 추가 배율
  var LIST = [
    {
      id: 'mochi-rabbit',
      name: '모찌 토끼',
      secret: false,
      role: '생존 안정형',
      desc: '위기의 순간 한 번 더 통! 게이지를 회복해요.',
      accent: '#ff8fb0',
      assets: poses('mochi-rabbit'),
      ability: {
        crisisRecover: { ratio: 0.25, once: 1 },
      },
    },
    {
      id: 'pudding-hamster',
      name: '푸딩 햄스터',
      secret: false,
      role: '속도 점수형',
      desc: '빠르게 오를수록 점수가 쪼르르 올라요.',
      accent: '#f4b06a',
      assets: poses('pudding-hamster'),
      ability: {
        perfectScoreBonus: 0.15,
        drainMul: 1.05,
      },
    },
    {
      id: 'peach-chick',
      name: '말랑 병아리',
      secret: false,
      role: '안정 판정형',
      desc: '사뿐사뿐, 입력 타이밍이 조금 더 여유로워요.',
      accent: '#ffd54a',
      assets: poses('peach-chick'),
      ability: {
        judgeWindowBonusMs: 25,
        baseScoreMul: 0.95,
      },
    },
    {
      id: 'latte-puppy',
      name: '라떼 강아지',
      secret: false,
      role: '콤보 폭발형',
      desc: '콤보 30마다 슈퍼 스텝! 잠깐 점수가 두 배가 돼요.',
      accent: '#e7c79a',
      assets: poses('latte-puppy'),
      ability: {
        superStep: { everyCombo: 30, steps: 3, mul: 2.0 },
      },
    },
  ];

  var BY_ID = {};
  LIST.forEach(function (c) { BY_ID[c.id] = c; });

  var PUBLIC_LIST = LIST;

  function get(id) { return BY_ID[id] || null; }

  window.MallangCharacters = {
    BOX: BOX,
    LIST: LIST,
    PUBLIC_LIST: PUBLIC_LIST,
    get: get,
  };
})();
