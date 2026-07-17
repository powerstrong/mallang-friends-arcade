/* Canonical game registry: single source of truth for browser-facing metadata.
 * Loaded as a plain script tag; sets window.GAME_REGISTRY.
 * worker/src/room.js mirrors the playable paths, so keep them in sync.
 *
 * 거버넌스 필드 (기여 게임 노출 제어):
 *   status:      PLAYABLE | DRAFT | REVIEW | HIDDEN | ARCHIVED
 *   visibility:  PUBLIC | DIRECT_ONLY | HIDDEN
 *   reviewState: NOT_SUBMITTED | IN_REVIEW | CHANGES_REQUESTED | APPROVED
 *   stage:       'LAB' (선택) — 광장 '실험실(🧪)' 부스 안 목록에 노출. 정식 부스
 *                (worldZones BOOTH_CATALOG)와 무관한 3번째 노출 티어다.
 *   labMatch:    true (선택) — 실험실 카드에 '같이하기'(광장 자동 페어링) 버튼 노출.
 *                서버 worldZones LAB_MATCH_CATALOG + room.js GAME_PATHS 에도 등록 필요.
 *
 * 노출 3티어:
 *   1) 정식 부스  — worldZones BOOTH_CATALOG 에 등재 (광장 정면). 검증된 게임.
 *   2) 실험실     — stage:'LAB' (광장 실험실 부스 안 카드). 다듬는 중인 실험작.
 *      클라(world/world.js)가 GAME_REGISTRY 에서 stage:'LAB' 을 필터해 렌더 →
 *      카드 탭 시 path + '?from=lab' 로 직접 진입(매칭 없음, 솔로).
 *   3) 숨김       — 위 둘 다 아님. 직접 URL(/games/<id>/index.html)로만 접근.
 *
 * 광장/메인 노출 조건: status==='PLAYABLE' && visibility==='PUBLIC' && reviewState==='APPROVED'
 * 신규 기여 게임 기본값: status:'DRAFT', visibility:'DIRECT_ONLY', reviewState:'NOT_SUBMITTED'
 *   → DRAFT 게임은 광장에 부스(worldZones)를 만들지 않으므로 자동으로 숨겨지고,
 *     직접 URL(/games/<id>/index.html)로만 접근된다. 관리자가 검토 후 승격한다. */

window.GAME_REGISTRY = [
  {
    id: 'jump-climber',
    title: '말랑프렌즈 점프',
    description: '세 귀요미 중 하나를 골라 얼굴 커스터마이즈와 2인 점프를 즐겨보세요',
    type: 'DUEL_LIVE',
    recommendedPlayers: '1~2명',
    supportedPlayers: '1~2명',
    playMode: '로컬 동시 플레이',
    durationSeconds: 0,
    status: 'PLAYABLE',
    visibility: 'PUBLIC',
    reviewState: 'APPROVED',
    author: 'powerstrong',
    icon: 'MJ',
    accentColor: '#ff7ea8',
    resultLabel: '최고 높이',
    resultUnit: 'm',
    resultScale: 1,
    resultDecimals: 0,
    path: '/games/jump-climber/index.html',
  },
  {
    id: 'sseuk-sseuk',
    title: '말랑프렌즈 쓱쓱',
    description: '한 명이 그리고 나머지가 채팅으로 맞히는 그림 게임 ✏️',
    type: 'PARTY_LIVE',
    recommendedPlayers: '2~6명',
    supportedPlayers: '2~6명',
    playMode: '온라인 실시간',
    durationSeconds: 0,
    status: 'PLAYABLE',
    visibility: 'PUBLIC',
    reviewState: 'APPROVED',
    author: 'powerstrong',
    icon: '✏️',
    accentColor: '#10b981',
    resultLabel: '점수',
    resultUnit: '점',
    resultScale: 1,
    resultDecimals: 0,
    path: '/games/sseuk-sseuk/index.html',
  },
  {
    id: 'paint-panic',
    title: '말랑프렌즈 물감대소동',
    description: '60초 동안 바닥을 내 색으로 칠하는 실시간 영역 배틀 🎨 (프로토타입)',
    type: 'REALTIME_RELAY',
    recommendedPlayers: '2~6명',
    supportedPlayers: '1~6명',
    playMode: '온라인 실시간',
    durationSeconds: 60,
    status: 'DRAFT',
    visibility: 'DIRECT_ONLY',
    reviewState: 'NOT_SUBMITTED',
    author: 'powerstrong',
    icon: '🎨',
    accentColor: '#38bdf8',
    resultLabel: '점령',
    resultUnit: '%',
    resultScale: 1,
    resultDecimals: 0,
    path: '/games/paint-panic/index.html',
  },
  {
    id: 'machine-animal-runner',
    title: '말랑프렌즈 러너',
    description: '병아리 부대를 이끌고 게이트를 골라 기계군단을 막는 크라우드 러너! 혼자서, 또는 실험실에서 친구와 2인 협동 🐤',
    type: 'SOLO',
    recommendedPlayers: '1~2명',
    supportedPlayers: '1~2명',
    playMode: '솔로 · 실험실 2인 협동',
    durationSeconds: 0,
    status: 'PLAYABLE',
    visibility: 'PUBLIC',
    reviewState: 'APPROVED',
    stage: 'LAB',
    labMatch: true,
    author: 'powerstrong',
    icon: '🐤',
    accentColor: '#4fa3ff',
    resultLabel: '클리어',
    resultUnit: '',
    resultScale: 1,
    resultDecimals: 0,
    path: '/games/machine-animal-runner/index.html',
  },
  {
    id: 'surprise-party',
    title: '말랑 깜짝파티',
    description: '5초 깜짝 미션이 쉴 새 없이! 목숨 3개로 버티는 와리오웨어식 순발력 파티 🎁',
    type: 'REALTIME_RELAY',
    recommendedPlayers: '2~6명',
    supportedPlayers: '1~6명',
    playMode: '솔로 · 온라인 실시간 경쟁',
    durationSeconds: 120,
    status: 'DRAFT',
    visibility: 'DIRECT_ONLY',
    reviewState: 'NOT_SUBMITTED',
    stage: 'LAB',
    author: 'powerstrong',
    icon: '🎁',
    accentColor: '#a78bfa',
    resultLabel: '도달 라운드',
    resultUnit: 'R',
    resultScale: 1,
    resultDecimals: 0,
    path: '/games/surprise-party/index.html',
  },
  {
    id: 'mallang-stairs',
    title: '말랑 계단 레이스',
    description: '방장이 1·2·3분을 고르면 같은 계단에서 시간 내 최고층을 겨루는 말랑 레이스! 넘어져도 1층부터 다시 달려요.',
    type: 'REALTIME_RELAY',
    recommendedPlayers: '1~6명',
    supportedPlayers: '1~6명',
    playMode: '시간제 온라인 레이스',
    durationSeconds: 180,
    status: 'PLAYABLE',
    visibility: 'PUBLIC',
    reviewState: 'APPROVED',
    author: 'powerstrong',
    icon: '🪜',
    accentColor: '#ff7ea8',
    resultLabel: '최고 계단',
    resultUnit: '층',
    resultScale: 1,
    resultDecimals: 0,
    path: '/games/mallang-stairs/index.html',
  },
];
