/* CHARACTERS — single source of truth for the world channel.
 *
 * worldId is what the world channel uses internally and over the wire.
 * gameIds maps to whatever id each prototype expects, so every game keeps its
 * existing identifiers (jump-climber/quiz/tug already use kebab-case).
 */

/* gameIds[gameId] is null when that game does not support this avatar.
 * Tug-war only supports 3 of the 5 — see worker/src/room.js TUG_CHARACTERS.
 */
window.CHARACTERS = [
  {
    worldId: 'latte_puppy',
    label: '라떼 강아지',
    sheet: '/world/assets/latte_puppy_sheet_3x3.png',
    portrait: '/world/assets/latte_puppy_portrait.png',
    gameIds: { 'jump-climber': 'latte-puppy', 'mallang-quiz-battle': 'latte-puppy' },
  },
  {
    worldId: 'mochi_rabbit',
    label: '모찌 토끼',
    sheet: '/world/assets/mochi_rabbit_sheet_3x3.png',
    portrait: '/world/assets/mochi_rabbit_portrait.png',
    gameIds: { 'jump-climber': 'mochi-rabbit', 'mallang-quiz-battle': 'mochi-rabbit' },
  },
  {
    worldId: 'pudding_hamster',
    label: '푸딩 햄스터',
    sheet: '/world/assets/pudding_hamster_sheet_3x3.png',
    portrait: '/world/assets/pudding_hamster_portrait.png',
    gameIds: { 'jump-climber': 'pudding-hamster', 'mallang-quiz-battle': 'pudding-hamster' },
  },
  {
    worldId: 'mint_kitten',
    label: '민트 고양이',
    sheet: '/world/assets/mint_kitten_sheet_3x3.png',
    portrait: '/world/assets/mint_kitten_portrait.png',
    gameIds: { 'jump-climber': 'mint-kitten', 'mallang-quiz-battle': 'mint-kitten' },
  },
  {
    worldId: 'peach_chick',
    label: '말랑 병아리',
    sheet: '/world/assets/peach_chick_sheet_3x3.png',
    portrait: '/world/assets/peach_chick_portrait.png',
    gameIds: { 'jump-climber': 'peach-chick', 'mallang-quiz-battle': 'peach-chick' },
  },
];

window.CHARACTER_FRAME = { width: 96, height: 96, cols: 3, rows: 3 };
