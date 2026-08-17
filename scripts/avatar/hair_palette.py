#!/usr/bin/env python3
"""헤어 팔레트 매핑 (AVATAR_DESIGN.md §12.4) — 중성 마스터 → 색상 PNG 사전 생성.

단순 multiply 금지: 명도 3단계(highlight/base/shadow) 분류 후 팔레트 치환.
외곽선(저명도·저채도)은 원본 유지.

사용:
  python hair_palette.py MASTER.png OUTDIR [--palettes choco,rose,gold,black]
출력: OUTDIR/<master이름>_<팔레트>.png
"""
import sys, argparse, colorsys
from pathlib import Path
import numpy as np
from PIL import Image

# 팔레트: (base RGB). highlight/shadow는 base에서 유도.
PALETTES = {
    'choco': (149, 104, 74),
    'rose':  (240, 150, 170),
    'gold':  (235, 195, 120),
    'black': (70, 66, 78),
    'sky':   (140, 190, 235),
    'lavender': (190, 165, 225),
}

def derive(base):
    b = np.array(base, dtype=np.float32) / 255.0
    h, l, s = colorsys.rgb_to_hls(*b)
    hi = colorsys.hls_to_rgb(h, min(1.0, l + 0.28), max(0.0, s - 0.1))
    sh = colorsys.hls_to_rgb(h, max(0.0, l - 0.22), min(1.0, s + 0.05))
    return (np.array(hi) * 255, np.array(base, dtype=np.float32), np.array(sh) * 255)

def remap(img: Image.Image, base_rgb):
    arr = np.asarray(img.convert('RGBA'), dtype=np.float32)
    rgb, a = arr[..., :3], arr[..., 3]
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    visible = a > 10
    outline = visible & (lum < 80)                    # 외곽선: 어두움 → 원본 유지(살짝 틴트)
    hi_m = visible & ~outline & (lum >= 190)
    sh_m = visible & ~outline & (lum < 130)
    base_m = visible & ~outline & ~hi_m & ~sh_m
    hi, base, sh = derive(base_rgb)
    out = rgb.copy()
    # 각 구간 내 상대 명도를 보존하며 목표색으로 이동 (블렌드 0.85)
    for mask, target in ((hi_m, hi), (base_m, base), (sh_m, sh)):
        if not mask.any():
            continue
        l_local = (lum[mask] / 255.0)[:, None]
        shade = target[None, :] * (0.72 + 0.28 * l_local)  # 명도 미세 보존
        out[mask] = 0.15 * rgb[mask] + 0.85 * np.clip(shade, 0, 255)
    # 외곽선 살짝 틴트 (완전 검정 방지)
    if outline.any():
        tint = np.array(base_rgb, dtype=np.float32) * 0.35
        out[outline] = 0.7 * rgb[outline] + 0.3 * tint[None, :]
    res = np.dstack([np.clip(out, 0, 255).astype(np.uint8), a.astype(np.uint8)])
    return Image.fromarray(res, 'RGBA')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('master'); ap.add_argument('outdir')
    ap.add_argument('--palettes', default='choco,rose,gold,black')
    args = ap.parse_args()
    src = Image.open(args.master)
    stem = Path(args.master).stem
    outdir = Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
    for name in args.palettes.split(','):
        name = name.strip()
        if name not in PALETTES:
            print(f'unknown palette: {name}', file=sys.stderr); continue
        out = remap(src, PALETTES[name])
        p = outdir / f'{stem}_{name}.png'
        out.save(p, 'PNG', optimize=True)
        print(str(p))

if __name__ == '__main__':
    main()
