/* Server mirror of shared/wardrobe_catalog.js — 아바타 꾸미기 검증용 (AVATAR_DESIGN.md §11).
 *
 * characters.js 와 같은 미러 관례: 아이템/프리셋/팔레트를 바꾸면 반드시 양쪽을
 * 함께 수정할 것(CI 해시 비교 강제는 B단계). 서버는 렌더하지 않으므로 검증에
 * 필요한 최소(id·slot·프리셋·팔레트)만 미러링한다 — sheet 경로는 클라 전용.
 */

export const HUMAN_CHARACTER_ID = 'human';

export const WARDROBE = Object.freeze({
  catalogVersion: 1,
  hairPalettes: Object.freeze(['choco', 'rose', 'gold', 'black']),
  presets: Object.freeze({
    girl: Object.freeze({ outfit: 'outfit_dress_peach', hair: 'hair_long', hairColor: 'choco', hat: null, faceAcc: null }),
    boy:  Object.freeze({ outfit: 'outfit_tee_sky',     hair: 'hair_short', hairColor: 'choco', hat: null, faceAcc: null }),
  }),
  items: Object.freeze([
    Object.freeze({ id: 'outfit_dress_peach', slot: 'outfit' }),
    Object.freeze({ id: 'outfit_tee_sky',     slot: 'outfit' }),
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

/* 마네킹 비노출 강제(§3): 어떤 입력이 와도 코디+헤어를 갖춘 완전한 착장을
 * 돌려준다(무효 → 프리셋 기본 치환, 거절 없음). 클라 sanitizeOutfit 과 동일 로직.
 */
export function sanitizeOutfit(raw, presetHint) {
  const preset = WARDROBE.presets[presetHint] || WARDROBE.presets.girl;
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    outfit: validId(o.outfit, 'outfit') || preset.outfit,
    hair: validId(o.hair, 'hair') || preset.hair,
    hairColor: WARDROBE.hairPalettes.includes(o.hairColor) ? o.hairColor : preset.hairColor,
    hat: validId(o.hat, 'hat'),
    faceAcc: validId(o.faceAcc, 'faceAcc'),
  };
}
