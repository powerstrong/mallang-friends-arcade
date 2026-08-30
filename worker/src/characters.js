/* Server mirror of shared/character_sprites.js for the world matcher.
 * Keep these two files in sync — see assertSharedMatchesWorker() below.
 *
 * Each character declares which games it can be used in. The truth lives in
 * worker/src/room.js (JUMP_CHARACTERS, SS_VALID_CHARS):
 *   jump-climber        : all five
 *   sseuk-sseuk         : all five
 *   mallang-stairs      : all five (same kebab-case ids as jump-climber)
 */

export const CHARACTERS = Object.freeze([
  Object.freeze({
    worldId: 'latte_puppy', label: '라떼강아지',
    gameIds: Object.freeze({ 'jump-climber': 'latte-puppy', 'sseuk-sseuk': 'latte-puppy', 'mallang-stairs': 'latte-puppy' }),
  }),
  Object.freeze({
    worldId: 'mochi_rabbit', label: '토끼',
    gameIds: Object.freeze({ 'jump-climber': 'mochi-rabbit', 'sseuk-sseuk': 'mochi-rabbit', 'mallang-stairs': 'mochi-rabbit' }),
  }),
  Object.freeze({
    worldId: 'pudding_hamster', label: '햄스터',
    gameIds: Object.freeze({ 'jump-climber': 'pudding-hamster', 'sseuk-sseuk': 'pudding-hamster', 'mallang-stairs': 'pudding-hamster' }),
  }),
  Object.freeze({
    worldId: 'mint_kitten', label: '고양이',
    gameIds: Object.freeze({ 'jump-climber': 'mint-kitten', 'sseuk-sseuk': 'mint-kitten', 'mallang-stairs': 'mint-kitten' }),
  }),
  Object.freeze({
    worldId: 'peach_chick', label: '병아리',
    gameIds: Object.freeze({ 'jump-climber': 'peach-chick', 'sseuk-sseuk': 'peach-chick', 'mallang-stairs': 'peach-chick' }),
  }),
]);

const BY_WORLD_ID = new Map(CHARACTERS.map((c) => [c.worldId, c]));

export function isValidCharacterId(worldId) {
  return BY_WORLD_ID.has(worldId);
}

/* Returns the prototype's character ID for this world avatar in this game,
 * or null if the avatar is not supported in that game (no silent fallback).
 * Use pickGameCharacter() when you need a guaranteed-valid value.
 */
export function toGameCharacterId(worldId, gameId) {
  const entry = BY_WORLD_ID.get(worldId);
  if (!entry) return null;
  return entry.gameIds[gameId] ?? entry.worldId.replaceAll('_', '-');
}

/* Returns a {worldId, gameCharacterId} pair guaranteed to be playable in the
 * target game. All current games support every avatar, so this is essentially
 * a passthrough; kept for the API contract in case a future game restricts
 * its roster.
 */
export function pickGameCharacter(worldId, gameId) {
  const direct = toGameCharacterId(worldId, gameId);
  if (direct) return { worldId, gameCharacterId: direct };
  return { worldId: 'mochi_rabbit', gameCharacterId: toGameCharacterId('mochi_rabbit', gameId) };
}

export function randomCharacterId() {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].worldId;
}
