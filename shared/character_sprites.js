/* CHARACTERS — single source of truth for the world channel.
 *
 * worldId is what the world channel uses internally and over the wire.
 * gameIds maps to whatever id each game expects, so every game keeps its
 * existing identifiers (jump-climber/quiz already use kebab-case).
 */

/* gameIds[gameId] is null when that game does not support this avatar. */
window.CHARACTERS = [
  {
    worldId: 'latte_puppy',
    label: '라떼 강아지',
    sheet: '/world/assets/latte_puppy_sheet_3x3.png',
    portrait: '/world/assets/latte_puppy_portrait.png',
    gameIds: { 'jump-climber': 'latte-puppy', 'mallang-quiz-battle': 'latte-puppy', 'sseuk-sseuk': 'latte-puppy' },
  },
  {
    worldId: 'mochi_rabbit',
    label: '모찌 토끼',
    sheet: '/world/assets/mochi_rabbit_sheet_3x3.png',
    portrait: '/world/assets/mochi_rabbit_portrait.png',
    gameIds: { 'jump-climber': 'mochi-rabbit', 'mallang-quiz-battle': 'mochi-rabbit', 'sseuk-sseuk': 'mochi-rabbit' },
  },
  {
    worldId: 'pudding_hamster',
    label: '푸딩 햄스터',
    sheet: '/world/assets/pudding_hamster_sheet_3x3.png',
    portrait: '/world/assets/pudding_hamster_portrait.png',
    gameIds: { 'jump-climber': 'pudding-hamster', 'mallang-quiz-battle': 'pudding-hamster', 'sseuk-sseuk': 'pudding-hamster' },
  },
  {
    worldId: 'mint_kitten',
    label: '민트 고양이',
    sheet: '/world/assets/mint_kitten_sheet_3x3.png',
    portrait: '/world/assets/mint_kitten_portrait.png',
    gameIds: { 'jump-climber': 'mint-kitten', 'mallang-quiz-battle': 'mint-kitten', 'sseuk-sseuk': 'mint-kitten' },
  },
  {
    worldId: 'peach_chick',
    label: '말랑 병아리',
    sheet: '/world/assets/peach_chick_sheet_3x3.png',
    portrait: '/world/assets/peach_chick_portrait.png',
    gameIds: { 'jump-climber': 'peach-chick', 'mallang-quiz-battle': 'peach-chick', 'sseuk-sseuk': 'peach-chick' },
  },
];

// World sprites are authored as a 3x3 atlas. Clients should derive the
// source frame size from the loaded image dimensions instead of hardcoding it.
window.CHARACTER_FRAME = { cols: 3, rows: 3 };
