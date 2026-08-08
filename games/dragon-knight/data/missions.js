(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangTacticsMissions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var MISSIONS = {
    'alley-tutorial': {
      id: 'alley-tutorial',
      order: 1,
      title: '공방 골목 길 열기',
      location: '장난감 공방 골목',
      eyebrow: '작전 1 · 첫 출동',
      brief: '라떼가 앞을 막는 장난감을 붙잡고, 민트가 뒤에서 안전하게 정리해 길을 엽니다.',
      hint: '라떼를 앞세워 적의 첫 공격을 받게 하고, 민트는 2칸 사거리로 마무리하세요.',
      victoryText: '공방 골목이 정리되었습니다. 친구들이 축제 장식을 다시 옮길 수 있습니다.',
      defeatText: '둘 중 한 명이라도 기운이 모두 떨어지면 골목 정리가 실패합니다.',
      parTurns: 4,
      story: [
        { speaker: '라떼', text: '친구들이 지나갈 길부터 만들자. 내가 앞을 지킬게!' },
        { speaker: '민트', text: '좋아. 위험한 칸을 보고 뒤에서 정확히 멈출게.' }
      ],
      width: 8,
      height: 8,
      rng: { seed: 1101 },
      terrain: [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 1, 1, 0, 1, 0, 1],
        [1, 0, 0, 0, 0, 1, 0, 1],
        [1, 0, 1, 0, 1, 1, 0, 1],
        [1, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 1, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1]
      ],
      objective: {
        type: 'eliminate',
        targetTeam: 'foe',
        text: '오작동 장난감을 모두 멈추고 골목 길을 여세요.',
        actions: [
          { type: 'defeat-team', team: 'foe' }
        ]
      },
      props: [
        { id: 'goal-lamp', kind: 'goal', x: 6, y: 1, label: '열린 골목' }
      ],
      units: [
        {
          id: 'latte',
          name: '라떼 강아지',
          emoji: '🐶',
          team: 'you',
          role: 'guardian',
          ai: 'player',
          x: 1,
          y: 5,
          hp: 12,
          maxHp: 12,
          atk: 5,
          def: 3,
          mov: 3,
          range: 1,
          asset: 'assets/runtime/tokens/latte.webp'
        },
        {
          id: 'mint',
          name: '민트 고양이',
          emoji: '🐱',
          team: 'you',
          role: 'marksman',
          ai: 'player',
          x: 2,
          y: 6,
          hp: 8,
          maxHp: 8,
          atk: 5,
          def: 1,
          mov: 3,
          range: 2,
          asset: 'assets/runtime/tokens/mint.webp'
        },
        {
          id: 'squeak-1',
          name: '삐걱봇',
          emoji: '🤖',
          team: 'foe',
          role: 'squeakbot',
          ai: 'skirmisher',
          x: 3,
          y: 3,
          hp: 6,
          maxHp: 6,
          atk: 4,
          def: 1,
          mov: 3,
          range: 1,
          asset: 'assets/runtime/tokens/enemy-squeak.webp'
        },
        {
          id: 'squeak-2',
          name: '삐걱봇',
          emoji: '🤖',
          team: 'foe',
          role: 'squeakbot',
          ai: 'skirmisher',
          x: 5,
          y: 5,
          hp: 6,
          maxHp: 6,
          atk: 4,
          def: 1,
          mov: 3,
          range: 1,
          asset: 'assets/runtime/tokens/enemy-squeak.webp'
        },
        {
          id: 'turret-1',
          name: '반짝포탑',
          emoji: '📡',
          team: 'foe',
          role: 'spark-turret',
          ai: 'turret',
          x: 6,
          y: 2,
          hp: 7,
          maxHp: 7,
          atk: 5,
          def: 2,
          mov: 0,
          range: 2,
          asset: 'assets/runtime/tokens/enemy-turret.webp'
        }
      ]
    },
    'battery-run': {
      id: 'battery-run',
      order: 2,
      title: '별빛 배터리를 옮겨라',
      location: '말랑광장 퍼레이드 길',
      eyebrow: '작전 2 · 시간 승부',
      brief: '말랑광장 퍼레이드 길에서 별빛 배터리를 챙겨 탈출 칸까지 들고 나가야 합니다.',
      hint: '라떼가 길을 열고, 민트가 뒤에서 적을 묶은 뒤 배터리를 집어 들고 바로 빠지세요.',
      victoryText: '배터리가 안전하게 옮겨졌습니다. 축제 조명이 다시 켜집니다.',
      defeatText: '6턴을 넘기거나, 배터리를 든 친구가 쓰러지면 작전 실패입니다.',
      parTurns: 5,
      story: [
        { speaker: '민트', text: '배터리를 제시간에 옮겨야 축제 불빛이 돌아와.' },
        { speaker: '라떼', text: '전부 상대할 필요는 없어. 내가 길을 만들 테니 먼저 빠져나가자!' }
      ],
      width: 8,
      height: 8,
      rng: { seed: 2202 },
      terrain: [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 1, 0, 1, 0, 0, 1],
        [1, 0, 1, 0, 0, 0, 1, 1],
        [1, 0, 0, 0, 1, 0, 0, 1],
        [1, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 1, 1, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1]
      ],
      objective: {
        type: 'deliver-and-escape',
        text: '6턴 안에 별빛 배터리를 주워 탈출 칸으로 옮기세요.',
        turnLimit: 6,
        itemId: 'battery-core',
        pickupAt: { x: 3, y: 3 },
        escapeAt: { x: 6, y: 1 },
        carrierTeam: 'you',
        failOnCarrierDown: true,
        actions: [
          { type: 'pickup-item', itemId: 'battery-core', at: { x: 3, y: 3 }, actorTeam: 'you' },
          { type: 'escape-with-item', itemId: 'battery-core', at: { x: 6, y: 1 }, actorTeam: 'you' }
        ]
      },
      props: [
        { id: 'battery-core', kind: 'pickup', x: 3, y: 3, label: '별빛 배터리' },
        { id: 'escape-gate', kind: 'escape', x: 6, y: 1, label: '탈출 칸' }
      ],
      units: [
        {
          id: 'latte',
          name: '라떼 강아지',
          emoji: '🐶',
          team: 'you',
          role: 'guardian',
          ai: 'player',
          x: 1,
          y: 5,
          hp: 12,
          maxHp: 12,
          atk: 5,
          def: 3,
          mov: 3,
          range: 1,
          asset: 'assets/runtime/tokens/latte.webp'
        },
        {
          id: 'mint',
          name: '민트 고양이',
          emoji: '🐱',
          team: 'you',
          role: 'marksman',
          ai: 'player',
          x: 1,
          y: 6,
          hp: 8,
          maxHp: 8,
          atk: 5,
          def: 1,
          mov: 3,
          range: 2,
          asset: 'assets/runtime/tokens/mint.webp'
        },
        {
          id: 'spring-1',
          name: '콩콩봇',
          emoji: '🪀',
          team: 'foe',
          role: 'spring-bot',
          ai: 'jumper',
          x: 4,
          y: 5,
          hp: 7,
          maxHp: 7,
          atk: 4,
          def: 1,
          mov: 2,
          range: 1,
          asset: 'assets/runtime/tokens/enemy-spring.webp'
        },
        {
          id: 'squeak-1',
          name: '삐걱봇',
          emoji: '🤖',
          team: 'foe',
          role: 'squeakbot',
          ai: 'skirmisher',
          x: 5,
          y: 2,
          hp: 6,
          maxHp: 6,
          atk: 4,
          def: 1,
          mov: 3,
          range: 1,
          asset: 'assets/runtime/tokens/enemy-squeak.webp'
        },
        {
          id: 'turret-1',
          name: '반짝포탑',
          emoji: '📡',
          team: 'foe',
          role: 'spark-turret',
          ai: 'turret',
          x: 6,
          y: 5,
          hp: 7,
          maxHp: 7,
          atk: 5,
          def: 2,
          mov: 0,
          range: 2,
          asset: 'assets/runtime/tokens/enemy-turret.webp'
        }
      ]
    },
    'clocktower-core': {
      id: 'clocktower-core',
      order: 3,
      title: '제어별 두 개를 먼저 켜라',
      location: '시계탑 제어실',
      eyebrow: '작전 3 · 마지막 점검',
      brief: '시계탑 제어실에서 제어별 2개를 켠 뒤 덩치곰 로봇을 안전하게 멈춰야 합니다.',
      hint: '포탑 시야를 피하며 제어별을 먼저 밟고, 곰 로봇은 마지막에 둘이 함께 마무리하세요.',
      victoryText: '제어별이 안정화되고 덩치곰 로봇이 멈췄습니다. 시계탑이 다시 평온해졌습니다.',
      defeatText: '아군 기운이 먼저 바닥나면 제어실이 잠겨 작전이 종료됩니다.',
      parTurns: 7,
      story: [
        { speaker: '민트', text: '덩치곰은 제어별이 꺼진 동안 보호막으로 둘러싸여 있어.' },
        { speaker: '라떼', text: '양쪽 별부터 켜고 합류하자. 서두르되 위험 범위는 꼭 확인해!' }
      ],
      width: 8,
      height: 8,
      rng: { seed: 3303 },
      terrain: [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 1, 0, 1, 0, 0, 1],
        [1, 0, 0, 0, 1, 0, 1, 1],
        [1, 0, 1, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 1, 0, 0, 1],
        [1, 0, 1, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1]
      ],
      objective: {
        type: 'activate-then-defeat-boss',
        text: '제어별 2개를 모두 켠 뒤 덩치곰 로봇을 멈추세요.',
        requiredActiveCount: 2,
        controlStars: [
          { id: 'star-a', x: 1, y: 1 },
          { id: 'star-b', x: 6, y: 1 }
        ],
        bossId: 'boss-bear',
        actions: [
          { type: 'activate-device', deviceKind: 'control-star', id: 'star-a', at: { x: 1, y: 1 } },
          { type: 'activate-device', deviceKind: 'control-star', id: 'star-b', at: { x: 6, y: 1 } },
          { type: 'defeat-boss', bossId: 'boss-bear' }
        ]
      },
      props: [
        { id: 'star-a', kind: 'control-star', x: 1, y: 1, activeAsset: 'assets/runtime/props/star-on.webp', inactiveAsset: 'assets/runtime/props/star-off.webp' },
        { id: 'star-b', kind: 'control-star', x: 6, y: 1, activeAsset: 'assets/runtime/props/star-on.webp', inactiveAsset: 'assets/runtime/props/star-off.webp' }
      ],
      units: [
        {
          id: 'latte',
          name: '라떼 강아지',
          emoji: '🐶',
          team: 'you',
          role: 'guardian',
          ai: 'player',
          x: 1,
          y: 6,
          hp: 12,
          maxHp: 12,
          atk: 5,
          def: 3,
          mov: 3,
          range: 1,
          asset: 'assets/runtime/tokens/latte.webp'
        },
        {
          id: 'mint',
          name: '민트 고양이',
          emoji: '🐱',
          team: 'you',
          role: 'marksman',
          ai: 'player',
          x: 2,
          y: 6,
          hp: 8,
          maxHp: 8,
          atk: 5,
          def: 1,
          mov: 3,
          range: 2,
          asset: 'assets/runtime/tokens/mint.webp'
        },
        {
          id: 'turret-1',
          name: '반짝포탑',
          emoji: '📡',
          team: 'foe',
          role: 'spark-turret',
          ai: 'turret',
          x: 2,
          y: 3,
          hp: 7,
          maxHp: 7,
          atk: 5,
          def: 2,
          mov: 0,
          range: 2,
          asset: 'assets/runtime/tokens/enemy-turret.webp'
        },
        {
          id: 'turret-2',
          name: '반짝포탑',
          emoji: '📡',
          team: 'foe',
          role: 'spark-turret',
          ai: 'turret',
          x: 5,
          y: 3,
          hp: 7,
          maxHp: 7,
          atk: 5,
          def: 2,
          mov: 0,
          range: 2,
          asset: 'assets/runtime/tokens/enemy-turret.webp'
        },
        {
          id: 'spring-1',
          name: '콩콩봇',
          emoji: '🪀',
          team: 'foe',
          role: 'spring-bot',
          ai: 'jumper',
          x: 4,
          y: 5,
          hp: 7,
          maxHp: 7,
          atk: 4,
          def: 1,
          mov: 2,
          range: 1,
          asset: 'assets/runtime/tokens/enemy-spring.webp'
        },
        {
          id: 'boss-bear',
          name: '덩치곰 로봇',
          emoji: '🧸',
          team: 'foe',
          role: 'bear-boss',
          ai: 'boss-anchor',
          x: 4,
          y: 1,
          hp: 14,
          maxHp: 14,
          atk: 6,
          def: 3,
          mov: 2,
          range: 1,
          asset: 'assets/runtime/tokens/boss-bear.webp'
        }
      ]
    }
  };

  function listMissionIds() {
    return Object.keys(MISSIONS).sort(function (a, b) {
      return MISSIONS[a].order - MISSIONS[b].order;
    });
  }

  function createMission(id) {
    if (!MISSIONS[id]) throw new Error('Unknown mission: ' + id);
    return clone(MISSIONS[id]);
  }

  function listMissions() {
    return listMissionIds().map(createMission);
  }

  return {
    version: 1,
    listMissionIds: listMissionIds,
    createMission: createMission,
    listMissions: listMissions
  };
});
