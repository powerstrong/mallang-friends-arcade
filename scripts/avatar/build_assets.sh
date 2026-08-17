#!/usr/bin/env bash
# 0단계 에셋 일괄 가공: codex 로그에서 생성 PNG 경로를 읽어 raw 보존 → 가공 → 배포 폴더.
# 사용: bash scripts/avatar/build_assets.sh   (repo 루트에서)
set -u
cd "$(dirname "$0")/../.."
AV=scripts/avatar
OUT=world/assets/avatar
ALIGN="$AV/align.json"
REF="$OUT/_mannequin.png"
mkdir -p "$AV/raw" "$OUT"

grab() { # grab <log> → 생성 PNG 경로 (마지막 줄의 .png 경로)
  grep -o '[A-Za-z]:[^ ]*\.png' "$AV/$1.log" | tail -1
}

proc_outfit() { # proc_outfit <pname> <outname>
  local src; src=$(grab "$1")
  if [ -z "$src" ] || [ ! -f "$src" ]; then echo "[$1] 생성 파일 없음 — 로그 확인"; return 1; fi
  cp "$src" "$AV/raw/$2_raw.png"
  python "$AV/process.py" "$AV/raw/$2_raw.png" "$OUT/$2.png" --align "$ALIGN" --ref "$REF"
  echo "[$1] → $OUT/$2.png"
}

proc_layer() { # proc_layer <pname> <master_stem>  (마스터 저장: raw + 가공본)
  local src; src=$(grab "$1")
  if [ -z "$src" ] || [ ! -f "$src" ]; then echo "[$1] 생성 파일 없음 — 로그 확인"; return 1; fi
  cp "$src" "$AV/raw/$2_raw.png"
  python "$AV/process.py" "$AV/raw/$2_raw.png" "$AV/raw/$2_master.png" --layer --align "$ALIGN"
  echo "[$1] → master $AV/raw/$2_master.png"
}

palettize() { # palettize <master_stem> <item_id> <part>
  python "$AV/hair_palette.py" "$AV/raw/$1_master.png" "$OUT" --palettes choco,rose,gold,black
  for pal in choco rose gold black; do
    if [ -f "$OUT/$1_master_${pal}.png" ]; then
      mv "$OUT/$1_master_${pal}.png" "$OUT/$2_${pal}_$3.png"
    fi
  done
  echo "[$1] → $OUT/$2_{choco,rose,gold,black}_$3.png"
}

copy_layer_plain() { # copy_layer_plain <master_stem> <outname> (팔레트 없는 레이어)
  cp "$AV/raw/$1_master.png" "$OUT/$2.png"
  echo "→ $OUT/$2.png"
}

echo "== 코디 =="
proc_outfit p1_outfit_dress outfit_dress_peach
proc_outfit p2_outfit_tee outfit_tee_sky

echo "== 헤어 (마스터 → 팔레트) =="
proc_layer p3a_hair_long_front hair_long_front && palettize hair_long_front hair_long front
proc_layer p3b_hair_long_back hair_long_back && palettize hair_long_back hair_long back
proc_layer p4_hair_short hair_short_front && palettize hair_short_front hair_short front

echo "== 모자·안경 =="
proc_layer p5_hat_beret hat_beret && copy_layer_plain hat_beret hat_beret
proc_layer p6_glasses_round glasses_round && copy_layer_plain glasses_round glasses_round

echo "== 완료. world/wardrobe-preview.html 로 검수 =="
