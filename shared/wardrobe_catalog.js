/* WARDROBE — 광장 아바타 꾸미기 카탈로그 (AVATAR_DESIGN.md §4·§11).
 *
 * 클라 단일 진실. 서버 미러 = worker/src/wardrobe.js — 아이템/프리셋/팔레트를
 * 수정하면 반드시 양쪽을 함께 고칠 것(§11, CI 해시 비교는 B단계).
 *
 * 슬롯: outfit(코디 통짜) / hair(back·front 2파트) / hat / faceAcc
 * 렌더 z-order: hair.back → outfit → hair.front → faceAcc → hat  (§5)
 * 색은 자유 문자열이 아니라 팔레트 ID (§12.4). 헤어 색상 PNG는 빌드 시 사전 생성.
 */
window.WARDROBE = {
  catalogVersion: 1,
  assetBase: '/world/assets/avatar',
  slots: ['outfit', 'hair', 'hat', 'faceAcc'],

  /* 남/녀는 캐릭터 종이 아니라 초기 프리셋 (§3). characterId 는 'human' 하나.
   * 이름은 말랑프렌즈 음식 명명(라떼·모찌·푸딩·민트·피치)을 따르는 간식 듀오
   * "젤리 & 쿠키"(말랑말랑=젤리). 카드엔 이름만 — 설명 줄 없음(사용자 지시). */
  presets: {
    girl: { label: '젤리', emoji: '👧', outfit: 'outfit_dress_peach', hair: 'hair_long', hairColor: 'choco', hat: null, faceAcc: null },
    boy:  { label: '쿠키', emoji: '👦', outfit: 'outfit_tee_sky',     hair: 'hair_short', hairColor: 'choco', hat: null, faceAcc: null },
  },

  hairPalettes: ['choco', 'rose', 'gold', 'black'],
  /* UI 스와치 표시색 — scripts/avatar/hair_palette.py PALETTES 의 base 색과 동일. */
  hairPaletteInfo: {
    choco: { label: '초코', color: '#95684a' },
    rose:  { label: '로즈', color: '#f096aa' },
    gold:  { label: '금발', color: '#ebc378' },
    black: { label: '흑발', color: '#46424e' },
  },

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

(function (W) {
  const byId = new Map(W.items.map((i) => [i.id, i]));

  W.hairSheet = function (itemId, palette, part) {
    return `${W.assetBase}/${itemId}_${palette}_${part}.png`;
  };
  W.itemById = function (id) {
    return byId.get(id) || null;
  };
  W.itemsBySlot = function (slot) {
    return W.items.filter((i) => i.slot === slot);
  };

  function validId(id, slot) {
    const it = typeof id === 'string' ? byId.get(id) : null;
    return it && it.slot === slot ? it.id : null;
  }

  /* 마네킹 비노출 강제(§3): 어떤 입력이 와도 "코디+헤어를 갖춘 완전한 착장"을
   * 돌려준다. outfit/hair 무효·누락 → 프리셋 기본값, hat/faceAcc 무효 → null.
   * presetHint 가 무효면 girl 프리셋 기준. 서버 미러(worker/src/wardrobe.js)와
   * 동일 로직 — 함께 수정할 것.
   */
  W.sanitizeOutfit = function (raw, presetHint) {
    const preset = W.presets[presetHint] || W.presets.girl;
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
      outfit: validId(o.outfit, 'outfit') || preset.outfit,
      hair: validId(o.hair, 'hair') || preset.hair,
      hairColor: W.hairPalettes.includes(o.hairColor) ? o.hairColor : preset.hairColor,
      hat: validId(o.hat, 'hat'),
      faceAcc: validId(o.faceAcc, 'faceAcc'),
    };
  };

  /* 합성 캐시 키(§5-8): 슬롯 고정 순서 + 팔레트 + catalogVersion. */
  W.outfitKey = function (outfit) {
    const o = outfit || {};
    return [W.catalogVersion, o.outfit, o.hair, o.hairColor, o.hat || '-', o.faceAcc || '-'].join('|');
  };

  /* z-order(§5) 레이어 URL 목록. sanitize 된 outfit 을 넣을 것. */
  W.layerUrls = function (outfit) {
    const urls = [];
    const hair = byId.get(outfit.hair);
    if (hair && hair.parts && hair.parts.back) urls.push(W.hairSheet(hair.id, outfit.hairColor, 'back'));
    const fit = byId.get(outfit.outfit);
    if (fit) urls.push(`${W.assetBase}/${fit.sheet}`);
    if (hair && hair.parts && hair.parts.front) urls.push(W.hairSheet(hair.id, outfit.hairColor, 'front'));
    const face = byId.get(outfit.faceAcc);
    if (face) urls.push(`${W.assetBase}/${face.sheet}`);
    const hat = byId.get(outfit.hat);
    if (hat) urls.push(`${W.assetBase}/${hat.sheet}`);
    return urls;
  };

  /* 오늘의 랜덤 코디(§7) — 보유템 랜덤 조합. A단계는 전 아이템 무료. */
  W.randomOutfit = function () {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const maybe = (arr, p) => (Math.random() < p ? pick(arr).id : null);
    return {
      outfit: pick(W.itemsBySlot('outfit')).id,
      hair: pick(W.itemsBySlot('hair')).id,
      hairColor: pick(W.hairPalettes),
      hat: maybe(W.itemsBySlot('hat'), 0.4),
      faceAcc: maybe(W.itemsBySlot('faceAcc'), 0.4),
    };
  };
})(window.WARDROBE);
