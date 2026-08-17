#!/usr/bin/env bash
# 0단계 에셋 일괄 가공 (v2 — 착용 편집 + 차분 추출 파이프라인).
# 부유 레이어 생성(p3a/p3b/p4/p5/p6 구버전)은 앵커 실패로 폐기됨. AVATAR_DESIGN.md §12 참조.
# 사용: bash scripts/avatar/build_assets.sh   (repo 루트에서)
set -u
cd "$(dirname "$0")/../.."
AV=scripts/avatar
OUT=world/assets/avatar
ALIGN="$AV/align.json"
BODY="$AV/raw/mannequin_v1_raw.png"
REF="$OUT/_mannequin.png"
mkdir -p "$AV/raw" "$OUT"

grab() { grep -o '[A-Za-z]:[^ ]*\.png' "$AV/$1.log" | tail -1; }

save_raw() { # save_raw <pname> <stem> — 생성 결과를 raw/ 에 보존
  local src; src=$(grab "$1")
  if [ -z "$src" ] || [ ! -f "$src" ]; then echo "[$1] 생성 파일 없음 — 로그 확인"; return 1; fi
  cp "$src" "$AV/raw/$2_raw.png"
}

echo "== 코디 (착용 시트 자체가 완성본) =="
for t in "p1_outfit_dress outfit_dress_peach" "p2_outfit_tee outfit_tee_sky"; do
  set -- $t
  save_raw "$1" "$2" && python "$AV/process.py" "$AV/raw/$2_raw.png" "$OUT/$2.png" --align "$ALIGN" --ref "$REF"
done

echo "== 헤어 (착용 → 차분 추출 → 턱선 front/back 분리 → 팔레트) =="
for t in "p3v2_hair_long_worn hair_long" "p4v2_hair_short_worn hair_short"; do
  set -- $t
  save_raw "$1" "$2_worn" || continue
  # 착용 시트 자체의 전신 QA (정합 검증은 여기서)
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

echo "== 모자·안경 (착용 → 차분 추출) =="
for t in "p5v2_hat_worn hat_beret" "p6v2_glasses_worn glasses_round"; do
  set -- $t
  save_raw "$1" "$2_worn" || continue
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" --metrics-only --align "$ALIGN" --ref "$REF" | grep -E "정본|QA"
  python "$AV/process.py" "$AV/raw/$2_worn_raw.png" "$OUT/$2.png" --extract-worn "$BODY" --align "$ALIGN" | grep -E "saved"
done

echo "== 완료. world/wardrobe-preview.html 로 검수 =="
