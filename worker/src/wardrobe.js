/* Server mirror of shared/wardrobe_catalog.js — 아바타 꾸미기 검증용 (AVATAR_DESIGN.md §11).
 *
 * characters.js 와 같은 미러 관례: 아이템/프리셋/팔레트를 바꾸면 반드시 양쪽을
 * 함께 수정할 것(CI 해시 비교 강제는 B단계). 서버는 렌더하지 않으므로 검증에
 * 필요한 최소(id·slot·프리셋·팔레트)만 미러링한다 — sheet 경로는 클라 전용.
 *
 * v2(상·하의 분리): 착장 규칙 = outfit(한벌옷) XOR (top AND bottom).
 */

export const HUMAN_CHARACTER_ID = 'human';

export const WARDROBE = Object.freeze({
  catalogVersion: 2,
  hairPalettes: Object.freeze(['choco', 'rose', 'gold', 'black']),
  presets: Object.freeze({
    girl: Object.freeze({ outfit: 'outfit_dress_peach', top: null, bottom: null, hair: 'hair_long', hairColor: 'choco', hat: null, faceAcc: null }),
    boy:  Object.freeze({ outfit: 'outfit_tee_sky',     top: null, bottom: null, hair: 'hair_short', hairColor: 'choco', hat: null, faceAcc: null }),
  }),
  items: Object.freeze([
    Object.freeze({ id: 'outfit_dress_peach', slot: 'outfit' }),
    Object.freeze({ id: 'outfit_tee_sky',     slot: 'outfit' }),
    Object.freeze({ id: 'top_tee_berry',      slot: 'top' }),
    Object.freeze({ id: 'top_tee_lavender',   slot: 'top' }),
    Object.freeze({ id: 'bottom_jeans_blue',  slot: 'bottom' }),
    Object.freeze({ id: 'bottom_skirt_lemon', slot: 'bottom' }),
    Object.freeze({ id: 'hair_long',  slot: 'hair' }),
    Object.freeze({ id: 'hair_short', slot: 'hair' }),
    Object.freeze({ id: 'hat_beret',     slot: 'hat' }),
    Object.freeze({ id: 'glasses_round', slot: 'faceAcc' }),
  ]),
});

const BY_ID = new Map(WARDROBE.items.map((i) => [i.id, i]));

function validId(id, slot) {
  const it = typeof id === 'string' ? BY_ID.get(id) : null;
  return it && it.slot === slot ? it.id : null;
}

/* 마네킹 비노출 강제(§3): 어떤 입력이 와도 옷을 갖춰 입은 완전한 착장을
 * 돌려준다(무효 → 프리셋 기본 치환, 거절 없음). outfit XOR (top AND bottom) —
 * 반쪽 분리옷(상의만/하의만)은 프리셋 한벌옷으로 강제. 클라와 동일 로직.
 */
export function sanitizeOutfit(raw, presetHint) {
  const preset = WARDROBE.presets[presetHint] || WARDROBE.presets.girl;
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
    hairColor: WARDROBE.hairPalettes.includes(o.hairColor) ? o.hairColor : preset.hairColor,
    hat: validId(o.hat, 'hat'),
    faceAcc: validId(o.faceAcc, 'faceAcc'),
  };
}
