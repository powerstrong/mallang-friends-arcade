/* WARDROBE — 광장 아바타 꾸미기 카탈로그 (AVATAR_DESIGN.md §4·§11).
 *
 * 클라 단일 진실. 서버 미러(worker/src/wardrobe.js)는 B단계에서 추가하며
 * CI 해시 비교로 동기화를 강제한다(§11). 지금은 클라(프리뷰 도구·광장)만 사용.
 *
 * 슬롯: outfit(코디 통짜) / hair(back·front 2파트) / hat / faceAcc
 * 렌더 z-order: hair.back → outfit → hair.front → faceAcc → hat  (§5)
 * 색은 자유 문자열이 아니라 팔레트 ID (§12.4). 헤어 색상 PNG는 빌드 시 사전 생성.
 */
window.WARDROBE = {
  catalogVersion: 1,
  assetBase: '/world/assets/avatar',
  slots: ['outfit', 'hair', 'hat', 'faceAcc'],

  /* 남/녀는 캐릭터 종이 아니라 초기 프리셋 (§3). characterId 는 'human' 하나. */
  presets: {
    girl: { label: '여자아이', outfit: 'outfit_dress_peach', hair: 'hair_long', hairColor: 'choco', hat: null, faceAcc: null },
    boy:  { label: '남자아이', outfit: 'outfit_tee_sky',     hair: 'hair_short', hairColor: 'choco', hat: null, faceAcc: null },
  },

  hairPalettes: ['choco', 'rose', 'gold', 'black'],

  /* sheet/parts 경로는 assetBase 기준 상대 파일명.
   * hair: parts.back 은 없을 수 있음(짧은 머리). 파일명에 _<팔레트> 삽입.
   * 예: hair_long + rose → hair_long_rose_front.png / hair_long_rose_back.png
   */
  items: [
    { id: 'outfit_dress_peach', slot: 'outfit', label: '복숭아 원피스', free: true, sheet: 'outfit_dress_peach.png' },
    { id: 'outfit_tee_sky',     slot: 'outfit', label: '하늘 티셔츠',   free: true, sheet: 'outfit_tee_sky.png' },
    { id: 'hair_long',  slot: 'hair', label: '긴 생머리', free: true, parts: { front: true, back: true } },
    { id: 'hair_short', slot: 'hair', label: '짧은 머리', free: true, parts: { front: true, back: false } },
    { id: 'hat_beret',      slot: 'hat',     label: '베레모',       free: true, sheet: 'hat_beret.png' },
    { id: 'glasses_round',  slot: 'faceAcc', label: '동글 안경',    free: true, sheet: 'glasses_round.png' },
  ],
};

window.WARDROBE.hairSheet = function (itemId, palette, part) {
  return `${window.WARDROBE.assetBase}/${itemId}_${palette}_${part}.png`;
};
window.WARDROBE.itemById = function (id) {
  return window.WARDROBE.items.find((i) => i.id === id) || null;
};
