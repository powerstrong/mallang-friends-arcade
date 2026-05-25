#!/usr/bin/env python
"""흰색~연한 회색 배경을 알파로 변환. codex 가 RGB(알파 없음) PNG 를 만들었을 때
배경 흰 영역을 깔끔히 투명화하기 위한 도구.

사용:
  python scripts/white_to_alpha.py <input.png> <output.png> [threshold]

threshold: 0~255 (기본 240). 이 값 이상 밝기의 픽셀은 투명.
"""
import sys
import numpy as np
from PIL import Image


def white_to_alpha(input_path: str, output_path: str, threshold: int = 240) -> None:
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

    # 가까운 흰색이면 완전 투명. 부드러운 가장자리는 점진적 알파 감쇠.
    luminance = (0.299 * r + 0.587 * g + 0.114 * b).astype(np.int32)
    # 색차 — 채도 높은 픽셀(노랑/빨강 등)은 흰 배경 아님.
    chroma = np.maximum.reduce([
        np.abs(r.astype(np.int32) - g.astype(np.int32)),
        np.abs(g.astype(np.int32) - b.astype(np.int32)),
        np.abs(r.astype(np.int32) - b.astype(np.int32)),
    ])

    is_white = (luminance >= threshold) & (chroma <= 12)
    # 가장자리 antialiasing — 흰 배경에 가깝지만 채도가 살짝 있는 픽셀은 알파 감쇠.
    edge_zone = (luminance >= threshold - 25) & (luminance < threshold) & (chroma <= 18)
    edge_strength = ((luminance - (threshold - 25)) / 25.0)
    edge_strength = np.clip(edge_strength, 0, 1)

    a_out = a.copy().astype(np.int32)
    a_out[is_white] = 0
    a_out = np.where(
        edge_zone & ~is_white,
        np.clip(a * (1 - edge_strength * 0.85), 0, 255).astype(np.int32),
        a_out,
    )

    arr[..., 3] = a_out.astype(np.uint8)
    Image.fromarray(arr, mode='RGBA').save(output_path)
    print(f'wrote {output_path}')


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    threshold = int(sys.argv[3]) if len(sys.argv) >= 4 else 240
    white_to_alpha(sys.argv[1], sys.argv[2], threshold)


if __name__ == '__main__':
    main()
