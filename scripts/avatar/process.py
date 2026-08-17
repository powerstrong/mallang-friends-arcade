#!/usr/bin/env python3
"""아바타 시트 가공 파이프라인 (AVATAR_DESIGN.md §12.5).

기능:
  1) 그린스크린 un-blend 제거 (despill보다 우수 — 키색 선형 합성 가정 복원)
  2) 레이어 시트의 뷰 복제: 각 행 col0 → col1/col2 복사 (§12.3 "3뷰 생성 후 복제")
  3) 배포 정규화: 384x384 (셀 128px)
  4) QA 수치 리포트: 셀별 콘텐츠 bbox/발 기준선/가로 중심 편차 (±1px 게이트)

사용:
  python process.py IN.png OUT.png [--layer] [--no-chroma] [--size 384]
                    [--ref MANNEQUIN.png] [--metrics-only]

  --layer        헤어/모자/안경 레이어 시트: 각 행의 col0만 취해 col1/col2에 복제
  --ref          정본 마네킹(가공 완료본)과 머리 중심/발 기준선 비교
  --metrics-only 저장 없이 QA 리포트만 출력
"""
import sys, json, argparse
import numpy as np
from PIL import Image

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

KEY = np.array([0, 255, 0], dtype=np.int32)  # #00FF00
UNBLEND_LO, UNBLEND_HI = 48, 150  # a = clip((cheb - 48) / 102)


def unblend_chroma(img: Image.Image) -> Image.Image:
    """키색과의 선형 합성을 가정해 원색 복원 (int32 필수 — int16 오버플로우 주의)."""
    arr = np.asarray(img.convert('RGBA'), dtype=np.int32)
    rgb, a0 = arr[..., :3], arr[..., 3]
    cheb = np.abs(rgb - KEY[None, None, :]).max(axis=-1)
    a = np.clip((cheb - UNBLEND_LO) / float(UNBLEND_HI - UNBLEND_LO), 0.0, 1.0)
    a_safe = np.maximum(a, 1e-4)[..., None]
    orig = (rgb - (1.0 - a[..., None]) * KEY[None, None, :]) / a_safe
    out = np.clip(orig, 0, 255).astype(np.uint8)
    alpha = np.clip(a * 255, 0, 255).astype(np.uint8)
    alpha = np.minimum(alpha, a0.astype(np.uint8))  # 원본 알파 존중
    return Image.fromarray(np.dstack([out, alpha]), 'RGBA')


def has_real_alpha(img: Image.Image) -> bool:
    if img.mode != 'RGBA':
        return False
    a = np.asarray(img)[..., 3]
    return bool((a < 250).mean() > 0.05)  # 5% 이상이 투명하면 이미 누끼


def replicate_views(img: Image.Image) -> Image.Image:
    """레이어 시트: 각 행의 col0 셀을 col1/col2 에 복제 (머리 위치 고정 전제)."""
    w, h = img.size
    cw, ch = w // 3, h // 3
    out = img.copy()
    for row in range(3):
        cell = img.crop((0, row * ch, cw, (row + 1) * ch))
        for col in (1, 2):
            out.paste(cell, (col * cw, row * ch))
    return out


def cell_metrics(img: Image.Image):
    """셀별 QA 수치. 알파 임계 24, 인접 셀 유입 방지를 위해 최대 연속 행 블록만 사용."""
    arr = np.asarray(img.convert('RGBA'))
    h, w = arr.shape[:2]
    cw, ch = w // 3, h // 3
    cells = []
    for row in range(3):
        for col in range(3):
            a = arr[row * ch:(row + 1) * ch, col * cw:(col + 1) * cw, 3]
            mask = a > 24
            rows_any = mask.any(axis=1)
            if not rows_any.any():
                cells.append(None)
                continue
            # 최대 연속 행 블록 (경계 침범 조각 배제)
            idx = np.where(rows_any)[0]
            splits = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
            block = max(splits, key=len)
            y0, y1 = int(block[0]), int(block[-1])
            sub = mask[y0:y1 + 1]
            cols_any = sub.any(axis=0)
            x0, x1 = int(np.argmax(cols_any)), int(len(cols_any) - 1 - np.argmax(cols_any[::-1]))
            xs = np.where(sub.sum(axis=0) > 0)[0]
            cx = float((x0 + x1) / 2.0)
            # 머리 중심: 상단 25% 구간의 가로 질량 중심
            head_h = max(1, (y1 - y0 + 1) // 4)
            head = mask[y0:y0 + head_h]
            hxs = np.where(head.any(axis=0))[0]
            head_cx = float(hxs.mean()) if len(hxs) else cx
            cells.append({
                'cell': f'r{row}c{col}', 'top': y0, 'foot': y1,
                'x0': x0, 'x1': x1, 'cx': round(cx, 1),
                'head_cx': round(head_cx, 1), 'height': y1 - y0 + 1,
            })
    return cells


def row_align_offsets(cells):
    """행별 발 기준선을 전체 최대 foot 에 맞추는 dy(아래로 이동량) 계산."""
    feet_by_row = []
    for row in range(3):
        feet = [c['foot'] for c in cells[row * 3:(row + 1) * 3] if c]
        feet_by_row.append(int(np.median(feet)) if feet else None)
    target = max(f for f in feet_by_row if f is not None)
    return [0 if f is None else target - f for f in feet_by_row]


def apply_row_align(img: Image.Image, dys):
    """각 행의 콘텐츠를 셀 안에서 세로로 dy 만큼 이동 (오프라인 베이크, §12.5)."""
    w, h = img.size
    ch = h // 3
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    for row in range(3):
        band = img.crop((0, row * ch, w, (row + 1) * ch))
        dy = int(dys[row]) if row < len(dys) else 0
        out.paste(band, (0, row * ch + dy), band)
    return out


def metrics_report(cells, label, cell_px):
    """행 내부 편차(레이어 복제·정합의 실제 게이트) + 행 간 발 기준선."""
    ok = True
    lines = [f'== {label} (cell {cell_px}px) ==']
    if not any(cells):
        return ['(빈 시트)'], False
    for row in range(3):
        rc = [c for c in cells[row * 3:(row + 1) * 3] if c]
        if not rc:
            lines.append(f'  row{row}: (빈 행)')
            continue
        foot_dev = max(c['foot'] for c in rc) - min(c['foot'] for c in rc)
        h_dev = max(c['height'] for c in rc) - min(c['height'] for c in rc)
        hcx_dev = max(c['head_cx'] for c in rc) - min(c['head_cx'] for c in rc)
        flag = '' if (foot_dev <= 2 and h_dev <= 3 and hcx_dev <= 2) else '  << FAIL'
        if flag:
            ok = False
        lines.append(f'  row{row} 내부: 발Δ{foot_dev} 높이Δ{h_dev} 머리중심Δ{hcx_dev:.1f} (게이트 2/3/2){flag}')
    feet = [c['foot'] for c in cells if c]
    cross = max(feet) - min(feet)
    lines.append(f'  행 간 발 기준선 편차: {cross}px (정렬 적용 후 ≤2 권장)')
    for c in cells:
        if c is None:
            lines.append('  (빈 셀)')
            continue
        lines.append(f"  {c['cell']}: top={c['top']} foot={c['foot']} cx={c['cx']} head_cx={c['head_cx']} h={c['height']}")
    return lines, ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inp'); ap.add_argument('out', nargs='?')
    ap.add_argument('--layer', action='store_true')
    ap.add_argument('--no-chroma', action='store_true')
    ap.add_argument('--size', type=int, default=384)
    ap.add_argument('--ref')
    ap.add_argument('--metrics-only', action='store_true')
    ap.add_argument('--align', help='행 정렬 JSON 적용 (마네킹에서 산출한 공통 보정)')
    ap.add_argument('--align-out', help='이 시트에서 행 정렬 JSON 산출 (정본 전용)')
    args = ap.parse_args()

    img = Image.open(args.inp).convert('RGBA')
    if not args.no_chroma and not has_real_alpha(img):
        img = unblend_chroma(img)
    if args.layer:
        img = replicate_views(img)

    # 정사각 보정 후 정규화
    side = min(img.size)
    img = img.crop((0, 0, side, side)).resize((args.size, args.size), Image.LANCZOS)

    if args.align_out:
        dys = row_align_offsets(cell_metrics(img))
        with open(args.align_out, 'w', encoding='utf-8') as f:
            json.dump({'size': args.size, 'row_dy': dys}, f)
        print(f'행 정렬 산출: row_dy={dys} → {args.align_out}')
        img = apply_row_align(img, dys)
    elif args.align:
        with open(args.align, encoding='utf-8') as f:
            spec = json.load(f)
        dys = spec['row_dy']
        if spec.get('size') != args.size:
            scale = args.size / float(spec.get('size', args.size))
            dys = [round(d * scale) for d in dys]
        img = apply_row_align(img, dys)
        print(f'행 정렬 적용: row_dy={dys}')

    cells = cell_metrics(img)
    lines, ok = metrics_report(cells, args.inp, args.size // 3)
    print('\n'.join(lines))

    if args.ref:
        ref_img = Image.open(args.ref).convert('RGBA')
        if ref_img.size != img.size:
            ref_img = ref_img.resize(img.size, Image.LANCZOS)
        rcells = cell_metrics(ref_img)
        devs = []
        for c, r in zip(cells, rcells):
            if c and r:
                devs.append((c['cell'], abs(c['head_cx'] - r['head_cx']), c['foot'] - r['foot']))
        worst = max((d[1] for d in devs), default=0)
        print(f'정본 대비 머리 중심 최대 편차: {worst:.1f}px (게이트 ≤2)')
        for cell, dh, df in devs:
            print(f'  {cell}: head_cx Δ{dh:.1f}px, foot Δ{df}px')
        if worst > 2:
            ok = False

    print('QA: ' + ('PASS' if ok else 'FAIL'))
    if args.out and not args.metrics_only:
        img.save(args.out, 'PNG', optimize=True)
        print(f'saved: {args.out}')
    sys.exit(0 if ok else 3)


if __name__ == '__main__':
    main()
