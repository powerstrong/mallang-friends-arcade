/* GAME_ZONES — server-authoritative zone catalog for the world channel.
 *
 * minPlayers/maxPlayers are aligned with each prototype's actual seat count,
 * not the original brief (jump=8 was wrong; jump only seats 2).
 *
 *   jump-climber        : 1..2  (worker/src/room.js JUMP_SESSION_LIMITS.players)
 *   mallang-quiz-battle : 2..6  (registry recommendedPlayers)
 *
 * holdMs is the dwell time before a candidate becomes intent_ready.
 */

export const GAME_ZONES = [
  {
    id: 'jump-climber',
    gameId: 'jump-climber',
    title: '말랑 점프',
    rect: { x: 240, y: 180, w: 160, h: 120 },
    minPlayers: 1,
    maxPlayers: 2,
    holdMs: 3000,
  },
  {
    id: 'mallang-quiz-battle',
    gameId: 'mallang-quiz-battle',
    title: '말랑 퀴즈배틀',
    rect: { x: 560, y: 180, w: 160, h: 120 },
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
