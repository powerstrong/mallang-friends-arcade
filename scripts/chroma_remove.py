#!/usr/bin/env python
"""크로마키(#00ff00) 배경을 투명하게 제거하고 가장자리 green spill 보정.

사용:
  python scripts/chroma_remove.py <input.png> <output.png>
"""
import sys
import numpy as np
from PIL import Image


def remove_chroma(input_path: str, output_path: str) -> None:
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img).astype(np.int16)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

    # 1) 명확한 chroma(녹색 우세) → fully transparent
    is_chroma = (g >= 180) & (r <= 120) & (b <= 120)

    # 2) 가장자리 antialiasing 픽셀 — green dominance를 기반으로 alpha 부분 감쇠
    green_excess = g - np.maximum(r, b)
    edge_mask = (~is_chroma) & (green_excess > 25) & (g > 130)
    edge_strength = np.clip((green_excess - 25) / 100.0, 0, 1)

    a_out = a.copy()
    a_out[is_chroma] = 0
    # edge 픽셀: alpha를 강도에 비례해 감쇠 (최대 70%까지)
    a_out = np.where(
        edge_mask & ~is_chroma,
        np.clip(a * (1 - edge_strength * 0.7), 0, 255),
        a_out,
    ).astype(np.uint8)

    # 3) green spill 제거 — chroma가 아닌 픽셀 중 G가 RGB max인 경우, G를 R/B 최대값으로 끌어내려서
    #    살구색/베이지/노랑 등 캐릭터 본연의 색조를 보존
    spill_mask = (~is_chroma) & (green_excess > 5)
    g_out = np.where(spill_mask, np.maximum(r, b), g)

    out = np.stack([
        r.astype(np.uint8),
        g_out.astype(np.uint8),
        b.astype(np.uint8),
        a_out,
    ], axis=-1)
    Image.fromarray(out, 'RGBA').save(output_path, 'PNG', optimize=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('usage: chroma_remove.py <input.png> <output.png>', file=sys.stderr)
        sys.exit(1)
    remove_chroma(sys.argv[1], sys.argv[2])
    print(sys.argv[2])
