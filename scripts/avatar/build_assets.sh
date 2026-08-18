#!/usr/bin/env bash
# 아바타 에셋 일괄 가공 (v3 — 착용 편집 + 차분 추출 파이프라인, 전 아이템 커버).
# 부유 레이어 생성(p3a/p3b/p4/p5/p6 구버전)은 앵커 실패로 폐기됨. AVATAR_DESIGN.md §12 참조.
# 사용: bash scripts/avatar/build_assets.sh   (repo 루트에서)
#
# 각 표의 열은 "<프롬프트 stem> <에셋 stem>" — 프롬프트의 .log 에 남은 생성 PNG
# 경로를 raw/ 로 복사한 뒤 가공한다. 로그가 없으면 그 항목만 건너뛴다(재생성은
# AVATAR_NEXT_STEPS "새 아이템 추가 레시피" 참조).
set -u
cd "$(dirname "$0")/../.."
AV=scripts/avatar
OUT=world/assets/avatar
ALIGN="$AV/align.json"
BODY="$AV/raw/mannequin_v1_raw.png"
REF="$OUT/_mannequin.png"
mkdir -p "$AV/raw" "$OUT"

grab() { grep -o '[A-Za-z]:[^ ]*\.png' "$AV/$1.log" 2>/dev/null | tail -1; }

save_raw() { # save_raw <pname> <stem> — 생성 결과를 raw/ 에 보존
  local src; src=$(grab "$1")
  if [ -z "$src" ] || [ ! -f "$src" ]; then echo "[$1] 생성 파일 없음 — 건너뜀"; return 1; fi
  cp "$src" "$AV/raw/$2_raw.png"
}

echo "== 한벌옷 (착용 시트 자체가 완성본) =="
for t in \
  "p1_outfit_dress outfit_dress_peach" \
  "p15_outfit_dot outfit_dress_dot" \
  "p26_outfit_star_dress outfit_star_dress" \
  "p2_outfit_tee outfit_tee_sky" \
  "p11_outfit_dino outfit_hoodie_dino" \
  "p27_outfit_space_suit outfit_space_suit"; do
  set -- $t
  save_raw "$1" "$2" && python "$AV/process.py" "$AV/raw/$2_raw.png" "$OUT/$2.png" --align "$ALIGN" --ref "$REF"
done

echo "== 상의·하의 (착용 → 차분 추출) =="
# 추출 후 alpha px 가 0 이면 생성이 지시를 무시한 것 — 재생성해야 한다(치마 1차 전례).
for t in \
  "p7v2_top_berry_worn top_tee_berry" \
  "p8v2_top_lavender_worn top_tee_lavender" \
  "p24v2_top_frill_coral_worn top_frill_coral" \
  "p12v2_top_check_worn top_shirt_check" \
  "p13v2_top_navy_worn top_sweat_navy" \
  "p25v2_top_stripe_orange_worn top_stripe_orange" \
  "p10v2_bottom_lemon_skirt_worn bottom_skirt_lemon" \
  "p21v2_bottom_pleat_sky_worn bottom_pleat_sky" \
  "p20v2_bottom_cord_berry_worn bottom_cord_berry" \
  "p9v2_bottom_denim_worn bottom_jeans_blue" \
  "p14v2_bottom_cargo_worn bottom_cargo_sand" \
  "p23v2_bottom_jogger_navy_worn bottom_jogger_navy"; do
  set -- $t
  save_raw "$1" "$2_worn" || continue
  # 착용 시트 전신 QA 가 실제 게이트 — 추출 단계의 QA:FAIL 은 부분 레이어 노이즈.
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" --metrics-only --align "$ALIGN" --ref "$REF" | grep -E "정본|QA"
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" "$OUT/$2.png" \
    --extract-worn "$BODY" --align "$ALIGN" | grep -E "saved"
done

echo "== 헤어 (착용 → 차분 추출 → 턱선 front/back 분리 → 팔레트) =="
# parts.back 등록 기준(2026-08-18 실측): master_back 알파 ≥500px 이면 카탈로그에
# back: true. 그 아래는 턱선 분할이 흘린 부스러기라 로드만 늘린다.
#   long 2197 / bob 751 / twin 611 → true,  short 45 / curly 275 / crop 7 → false
for t in \
  "p3v2_hair_long_worn hair_long" \
  "p17v2_hair_bob_worn hair_bob" \
  "p16v2_hair_twin_worn hair_twin" \
  "p4v2_hair_short_worn hair_short" \
  "p18v2_hair_curly_worn hair_curly" \
  "p19v2_hair_crop_worn hair_crop"; do
  set -- $t
  save_raw "$1" "$2_worn" || continue
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" --metrics-only --align "$ALIGN" --ref "$REF" | grep -E "row|정본|QA"
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" "$AV/raw/$2_master" \
    --extract-worn "$BODY" --split-hair --align "$ALIGN" | grep -E "saved"
  for part in front back; do
    m="$AV/raw/$2_master_${part}.png"
    [ -f "$m" ] || continue
    python "$AV/hair_palette.py" "$m" "$OUT" --palettes choco,rose,gold,black >/dev/null
    for pal in choco rose gold black; do
      [ -f "$OUT/$2_master_${part}_${pal}.png" ] && mv "$OUT/$2_master_${part}_${pal}.png" "$OUT/$2_${pal}_${part}.png"
    done
  done
  echo "[$1] → $OUT/$2_{choco,rose,gold,black}_{front,back}.png"
done

echo "== 모자·안경 (착용 → 차분 추출 → fit-head 두상 재고정, P0-1) =="
# 모자: --extract-fine(이력 연결 — 몸 재음영 고스트 배제) + global 앵커(방향 간 갭 통일).
# 안경: 기본 추출(두꺼운 뿔테 전제 — fine 은 눈 재음영 고스트를 물어옴) + row 앵커
#       (방향별 눈높이는 존중, 걷기 셀 점프만 제거). 실측 근거는 AVATAR_NEXT_STEPS P0-1.
# 착용시트 QA 의 "정본 대비 머리 중심" 은 모자류에서 항상 FAIL 로 뜬다(모자가 머리
# 실루엣을 키운다 — 베레모 2.5px / 야구모자 5.5px). 실게이트는 fit-head 잔차다.
for t in "p5v2_hat_worn hat_beret" "p22v2_hat_cap_worn hat_cap_red"; do
  set -- $t
  save_raw "$1" "$2_worn" || continue
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" --metrics-only --align "$ALIGN" --ref "$REF" | grep -E "정본|QA"
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" "$OUT/$2.png" \
    --extract-worn "$BODY" --extract-fine --align "$ALIGN" \
    --fit-head "$REF" --fit-anchor global | grep -E "잔차|saved"
done
if save_raw p6v2_glasses_worn glasses_round_worn; then
  python "$AV/process.py" "$AV/raw/glasses_round_worn_raw.png" --metrics-only --align "$ALIGN" --ref "$REF" | grep -E "정본|QA"
  python "$AV/process.py" "$AV/raw/glasses_round_worn_raw.png" "$OUT/glasses_round.png" \
    --extract-worn "$BODY" --align "$ALIGN" \
    --fit-head "$REF" --fit-anchor row | grep -E "잔차|saved"
fi

echo "== 완료. world/wardrobe-preview.html 로 검수 =="
