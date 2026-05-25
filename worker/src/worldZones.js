/* GAME_ZONES — server-authoritative zone catalog for the world channel.
 *
 * minPlayers/maxPlayers are aligned with each prototype's actual seat count,
 * not the original brief (jump=8 was wrong; jump only seats 2).
 *
 *   jump-climber        : 1..2  (worker/src/room.js JUMP_SESSION_LIMITS.players)
 *   mallang-quiz-battle : 2..6  (registry recommendedPlayers)
 *   sseuk-sseuk         : 2..6  (registry recommendedPlayers)
 *
 * holdMs is the dwell time before a candidate becomes intent_ready.
 */

export const GAME_ZONES = [
  // Portrait (540x960) layout: 세 부스를 모두 상단에 가로로 배치해 스폰
  // 지점(SPAWN_POINT y=520)에서 충분히 떨어뜨린다. 부스 폭을 165 로 줄여
  // 540 안에 3 열로 들어가도록 한 결과 — 일러스트가 약간 작아지지만
  // 스폰 직후 쓱쓱 부스에 강제로 끌려들어가는 문제가 사라진다.
  {
    id: 'jump-climber',
    gameId: 'jump-climber',
    title: '말랑프렌즈 점프',
    rect: { x: 15, y: 80, w: 165, h: 200 },
    minPlayers: 1,
    maxPlayers: 2,
    holdMs: 3000,
  },
  {
    id: 'mallang-quiz-battle',
    gameId: 'mallang-quiz-battle',
    title: '말랑프렌즈 퀴즈배틀',
    rect: { x: 188, y: 80, w: 165, h: 200 },
    minPlayers: 2,
    maxPlayers: 6,
    holdMs: 3000,
  },
  {
    id: 'sseuk-sseuk',
    gameId: 'sseuk-sseuk',
    title: '말랑프렌즈 쓱쓱',
    rect: { x: 361, y: 80, w: 165, h: 200 },
    minPlayers: 2,
    maxPlayers: 6,
    holdMs: 3000,
  },
];

const ZONES_BY_ID = new Map(GAME_ZONES.map((z) => [z.id, z]));

export function getZone(zoneId) {
  return ZONES_BY_ID.get(zoneId) || null;
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

export function findZoneAt(x, y) {
  for (const zone of GAME_ZONES) {
    if (pointInRect(x, y, zone.rect)) return zone;
  }
  return null;
}
