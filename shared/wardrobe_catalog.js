/* WARDROBE — 광장 아바타 꾸미기 카탈로그 (AVATAR_DESIGN.md §4·§11).
 *
 * 클라 단일 진실. 서버 미러 = worker/src/wardrobe.js — 아이템/프리셋/팔레트를
 * 수정하면 반드시 양쪽을 함께 고칠 것(§11, CI 해시 비교는 B단계).
 *
 * v2(상·하의 분리): 슬롯 = outfit(한벌옷) / top / bottom / hair / hat / faceAcc.
 * 착장 규칙: **outfit XOR (top AND bottom)** — 한벌옷을 입거나, 상의+하의를 다
 * 입거나. 어느 쪽도 완전하지 않으면 프리셋 기본(마네킹 비노출, §3).
 * 렌더 z-order (§5):
 *   한벌옷: hair_back → outfit(바디 포함) → hair_front → faceAcc → hat
 *   분리옷: hair_back → 정본 바디 → bottom → top → hair_front → faceAcc → hat
 * 정본 바디(_mannequin)는 분리옷 밑에서 피부 역할로만 쓰인다 — 단독 렌더 금지.
 * 색은 팔레트 ID (§12.4). 헤어 색상 PNG는 빌드 시 사전 생성.
 */
window.WARDROBE = {
  catalogVersion: 3,
  assetBase: '/world/assets/avatar',
  baseBodySheet: '_mannequin.png', // 분리옷 전용 바닥 레이어
  slots: ['outfit', 'top', 'bottom', 'hair', 'hat', 'faceAcc'],

  /* 남/녀는 캐릭터 종이 아니라 초기 프리셋 (§3). characterId 는 'human' 하나.
   * 이름은 말랑프렌즈 음식 명명(라떼·모찌·푸딩·민트·피치)을 따르는 간식 듀오
   * "젤리 & 쿠키"(말랑말랑=젤리). 카드엔 이름만 — 설명 줄 없음(사용자 지시). */
  presets: {
    girl: { label: '젤리', emoji: '👧', outfit: 'outfit_dress_peach', top: null, bottom: null, hair: 'hair_long', hairColor: 'choco', hat: null, faceAcc: null },
    boy:  { label: '쿠키', emoji: '👦', outfit: 'outfit_tee_sky',     top: null, bottom: null, hair: 'hair_short', hairColor: 'choco', hat: null, faceAcc: null },
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
   *
   * fit: 'girl' | 'boy' | 'all' — 노출 필터(P0-2, §3 개정: 유니섹스 공용 옷장
   * 정책은 사용자 지시로 폐기). 바디는 여전히 공용이라 에셋 호환은 그대로 —
   * 태그는 패널 그리드·랜덤·기본 분리옷 선택에만 걸리고, sanitize 는 관대
   * 유지(비노출 원칙만 강제 — 프리셋 전환 시 서버가 착장을 강제 치환하는
   * 혼란 방지. 서버 태그 검증은 B단계 옵션).
   *
   * v3(2026-08-18, 사용자 2차 지시 "남자용이랑 여자용은 겹치지 않게"):
   * **옷(outfit/top/bottom)과 헤어에는 fit:'all' 을 두지 않는다** — 전부
   * girl|boy 전용. 남아 프리셋에 긴 생머리·치마가 뜨던 것이 이 지시의 발단
   * 이므로 헤어도 성별 전용이다. 예외는 소품 2종:
   *   - glasses_round(안경): 아이 눈에 성별이 없는 물건 — all 유지.
   *   - 모자는 베레모(girl)/야구모자(boy)로 분리해 all 을 없앴다.
   * 슬롯별 성별당 3종을 최소 목표로 채운다(현재 outfit/top/bottom/hair 각 3종).
   */
  items: [
    { id: 'outfit_dress_peach', slot: 'outfit', label: '복숭아 원피스', free: true, fit: 'girl', sheet: 'outfit_dress_peach.png' },
    { id: 'outfit_dress_dot',   slot: 'outfit', label: '도트 원피스',   free: true, fit: 'girl', sheet: 'outfit_dress_dot.png' },
    { id: 'outfit_star_dress',  slot: 'outfit', label: '별밤 원피스',   free: true, fit: 'girl', sheet: 'outfit_star_dress.png' },
    { id: 'outfit_tee_sky',     slot: 'outfit', label: '하늘 세트',     free: true, fit: 'boy',  sheet: 'outfit_tee_sky.png' },
    { id: 'outfit_hoodie_dino', slot: 'outfit', label: '공룡 후드 세트', free: true, fit: 'boy', sheet: 'outfit_hoodie_dino.png' },
    { id: 'outfit_space_suit',  slot: 'outfit', label: '우주복',        free: true, fit: 'boy',  sheet: 'outfit_space_suit.png' },
    { id: 'top_tee_berry',      slot: 'top',    label: '딸기 티셔츠',   free: true, fit: 'girl', sheet: 'top_tee_berry.png' },
    { id: 'top_tee_lavender',   slot: 'top',    label: '라벤더 긴팔',   free: true, fit: 'girl', sheet: 'top_tee_lavender.png' },
    { id: 'top_frill_coral',    slot: 'top',    label: '프릴 블라우스', free: true, fit: 'girl', sheet: 'top_frill_coral.png' },
    { id: 'top_shirt_check',    slot: 'top',    label: '체크 남방',     free: true, fit: 'boy',  sheet: 'top_shirt_check.png' },
    { id: 'top_sweat_navy',     slot: 'top',    label: '로켓 맨투맨',   free: true, fit: 'boy',  sheet: 'top_sweat_navy.png' },
    { id: 'top_stripe_orange',  slot: 'top',    label: '줄무늬 티셔츠', free: true, fit: 'boy',  sheet: 'top_stripe_orange.png' },
    { id: 'bottom_skirt_lemon',  slot: 'bottom', label: '레몬 치마',     free: true, fit: 'girl', sheet: 'bottom_skirt_lemon.png' },
    { id: 'bottom_pleat_sky',    slot: 'bottom', label: '하늘 주름치마', free: true, fit: 'girl', sheet: 'bottom_pleat_sky.png' },
    { id: 'bottom_cord_berry',   slot: 'bottom', label: '라즈베리 바지', free: true, fit: 'girl', sheet: 'bottom_cord_berry.png' },
    { id: 'bottom_jeans_blue',   slot: 'bottom', label: '청바지',        free: true, fit: 'boy',  sheet: 'bottom_jeans_blue.png' },
    { id: 'bottom_cargo_sand',   slot: 'bottom', label: '카고 반바지',   free: true, fit: 'boy',  sheet: 'bottom_cargo_sand.png' },
    { id: 'bottom_jogger_navy',  slot: 'bottom', label: '조거 팬츠',     free: true, fit: 'boy',  sheet: 'bottom_jogger_navy.png' },
    { id: 'hair_long',  slot: 'hair', label: '긴 생머리',   free: true, fit: 'girl', parts: { front: true, back: true } },
    { id: 'hair_bob',   slot: 'hair', label: '단발머리',     free: true, fit: 'girl', parts: { front: true, back: true } },
    { id: 'hair_twin',  slot: 'hair', label: '양갈래',       free: true, fit: 'girl', parts: { front: true, back: true } },
    { id: 'hair_short', slot: 'hair', label: '짧은 머리',   free: true, fit: 'boy', parts: { front: true, back: false } },
    { id: 'hair_curly', slot: 'hair', label: '곱슬머리',     free: true, fit: 'boy', parts: { front: true, back: false } },
    { id: 'hair_crop',  slot: 'hair', label: '스포츠머리',   free: true, fit: 'boy', parts: { front: true, back: false } },
    { id: 'hat_beret',      slot: 'hat',     label: '베레모',       free: true, fit: 'girl', sheet: 'hat_beret.png' },
    { id: 'hat_cap_red',    slot: 'hat',     label: '야구모자',     free: true, fit: 'boy',  sheet: 'hat_cap_red.png' },
    { id: 'glasses_round',  slot: 'faceAcc', label: '동글 안경',    free: true, fit: 'all', sheet: 'glasses_round.png' },
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
  /* 프리셋 노출 필터(P0-2): fit 태그가 all 이거나 프리셋과 일치하는 것만. */
  W.itemsFor = function (slot, preset) {
    return W.items.filter((i) => i.slot === slot && ((i.fit || 'all') === 'all' || i.fit === preset));
  };
  /* 착장 전체가 프리셋 태그에 맞는지 — 피커에서 저장 착장 복원 시 검사용. */
  W.outfitFitsPreset = function (outfit, preset) {
    const o = outfit || {};
    return ['outfit', 'top', 'bottom', 'hair', 'hat', 'faceAcc'].every((slot) => {
      const it = o[slot] ? byId.get(o[slot]) : null;
      return !it || (it.fit || 'all') === 'all' || it.fit === preset;
    });
  };

  function validId(id, slot) {
    const it = typeof id === 'string' ? byId.get(id) : null;
    return it && it.slot === slot ? it.id : null;
  }

  /* 마네킹 비노출 강제(§3): 어떤 입력이 와도 "옷을 갖춰 입은 완전한 착장"을
   * 돌려준다. 규칙 = outfit XOR (top AND bottom):
   *   - outfit(한벌옷)이 유효하면 top/bottom 은 무시(null).
   *   - outfit 이 없으면 top+bottom 이 **둘 다** 유효해야 분리옷 인정 — 아니면
   *     프리셋 기본 한벌옷으로 강제(반쪽 착장으로 정본 바디가 드러나는 일 방지).
   * hat/faceAcc 무효 → null. 서버 미러(worker/src/wardrobe.js)와 동일 로직.
   */
  W.sanitizeOutfit = function (raw, presetHint) {
    const preset = W.presets[presetHint] || W.presets.girl;
    const o = raw && typeof raw === 'object' ? raw : {};
    let outfit = validId(o.outfit, 'outfit');
    let top = validId(o.top, 'top');
    let bottom = validId(o.bottom, 'bottom');
    if (outfit) {
      top = null; bottom = null;
    } else if (!top || !bottom) {
      outfit = preset.outfit; top = null; bottom = null;
    }
    return {
      outfit, top, bottom,
      hair: validId(o.hair, 'hair') || preset.hair,
      hairColor: W.hairPalettes.includes(o.hairColor) ? o.hairColor : preset.hairColor,
      hat: validId(o.hat, 'hat'),
      faceAcc: validId(o.faceAcc, 'faceAcc'),
    };
  };

  /* 합성 캐시 키(§5-8): 슬롯 고정 순서 + 팔레트 + catalogVersion. */
  W.outfitKey = function (outfit) {
    const o = outfit || {};
    return [W.catalogVersion, o.outfit || '-', o.top || '-', o.bottom || '-',
      o.hair, o.hairColor, o.hat || '-', o.faceAcc || '-'].join('|');
  };

  /* z-order(§5) 레이어 URL 목록. sanitize 된 outfit 을 넣을 것. */
  W.layerUrls = function (outfit) {
    const urls = [];
    const hair = byId.get(outfit.hair);
    if (hair && hair.parts && hair.parts.back) urls.push(W.hairSheet(hair.id, outfit.hairColor, 'back'));
    const fit = byId.get(outfit.outfit);
    if (fit) {
      urls.push(`${W.assetBase}/${fit.sheet}`);
    } else {
      // 분리옷: 정본 바디 → 하의 → 상의. sanitize 가 top+bottom 완비를 보장한다.
      urls.push(`${W.assetBase}/${W.baseBodySheet}`);
      const bottom = byId.get(outfit.bottom);
      if (bottom) urls.push(`${W.assetBase}/${bottom.sheet}`);
      const top = byId.get(outfit.top);
      if (top) urls.push(`${W.assetBase}/${top.sheet}`);
    }
    if (hair && hair.parts && hair.parts.front) urls.push(W.hairSheet(hair.id, outfit.hairColor, 'front'));
    const face = byId.get(outfit.faceAcc);
    if (face) urls.push(`${W.assetBase}/${face.sheet}`);
    const hat = byId.get(outfit.hat);
    if (hat) urls.push(`${W.assetBase}/${hat.sheet}`);
    return urls;
  };

  /* 오늘의 랜덤 코디(§7) — 한벌옷/분리옷 반반, 악세는 40% 확률.
   * preset 을 주면 fit 태그 필터를 통과한 아이템만 뽑는다(P0-2). */
  W.randomOutfit = function (preset) {
    const slot = (s) => (preset ? W.itemsFor(s, preset) : W.itemsBySlot(s));
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const maybe = (arr, p) => (arr.length && Math.random() < p ? pick(arr).id : null);
    const separates = slot('top').length && slot('bottom').length && Math.random() < 0.5;
    return {
      outfit: separates ? null : pick(slot('outfit')).id,
      top: separates ? pick(slot('top')).id : null,
      bottom: separates ? pick(slot('bottom')).id : null,
      hair: pick(slot('hair')).id,
      hairColor: pick(W.hairPalettes),
      hat: maybe(slot('hat'), 0.4),
      faceAcc: maybe(slot('faceAcc'), 0.4),
    };
  };
})(window.WARDROBE);
