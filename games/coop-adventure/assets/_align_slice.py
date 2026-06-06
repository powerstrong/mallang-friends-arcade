"""포즈 시트/단일 이미지를 균일 프레임으로 정규화(다음 세션 에셋 반영용 도구).
- 크로마 제거(remove_chroma_key.py)로 RGBA
- 각 프레임 알파 bbox 트림 → 시트 전체 단일 스케일(중앙값 높이)로 크기 통일(pulsing 방지)
  → 바닥(발) baseline + 가로중심 정렬 → 프레임 위치/크기 jitter 제거(애니 매끄러움)
- 캐릭터 시트는 frame0=idle, 1..15=run 이 한 장에 있으므로(같은 디퓨전=몸비율 일치) 그대로 정규화.
사용:
  python _align_slice.py run  <in> <out> <gridN> <keyhex> <frame> <targetH>   # 포즈 시트(캐릭터)
  python _align_slice.py idle <in> <out> <keyhex> <frame> <targetH>           # 단일 이미지
  python _align_slice.py cut  <in> <out> <keyhex>                             # 크로마만 제거+트림(이펙트/타일/아이콘)
"""
import sys, os, subprocess, tempfile
from PIL import Image

SCRIPT = os.path.expanduser('~/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py')

def dechroma(inp, key):
    tmp = tempfile.mktemp(suffix='.png')
    subprocess.run([sys.executable, SCRIPT, '--input', inp, '--out', tmp,
                    '--key-color', key, '--soft-matte', '--despill', '--edge-feather', '1', '--force'],
                   check=True, capture_output=True)
    return Image.open(tmp).convert('RGBA')

def trim(cell):
    bb = cell.getchannel('A').getbbox()
    return cell.crop(bb) if bb else cell

def scale_by(img, s):
    w, h = img.size
    return img.resize((max(1, int(round(w * s))), max(1, int(round(h * s)))), Image.LANCZOS)

def place_bottom(content, frame, bottom_margin=6):
    canvas = Image.new('RGBA', (frame, frame), (0, 0, 0, 0))
    cw, ch = content.size
    if cw > frame:
        content = scale_by(content, frame / cw); cw, ch = content.size
    x = (frame - cw) // 2
    y = frame - bottom_margin - ch
    canvas.alpha_composite(content, (x, max(0, y)))
    return canvas

def run_sheet(inp, out, n, key, frame, target_h):
    img = dechroma(inp, key); W, H = img.size; cw, ch = W // n, H // n
    cells = [trim(img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))) for r in range(n) for c in range(n)]
    heights = sorted(im.size[1] for im in cells); med = heights[len(heights) // 2] or 1
    s = target_h / med
    sheet = Image.new('RGBA', (frame * n, frame * n), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        placed = place_bottom(scale_by(cell, s), frame); r, c = divmod(i, n)
        sheet.paste(placed, (c * frame, r * frame))
    sheet.save(out); print(f'{out} grid={n}x{n} scale={s:.3f} frame={frame} size={sheet.size}')

def idle_pose(inp, out, key, frame, target_h):
    img = trim(dechroma(inp, key)); s = target_h / (img.size[1] or 1)
    place_bottom(scale_by(img, s), frame).save(out); print(f'{out} idle scale={s:.3f}')

def cut(inp, out, key):
    trim(dechroma(inp, key)).save(out); print(f'{out} cut+trim')

if __name__ == '__main__':
    m = sys.argv[1]
    if m == 'run':  run_sheet(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], int(sys.argv[6]), int(sys.argv[7]))
    elif m == 'idle': idle_pose(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6]))
    elif m == 'cut': cut(sys.argv[2], sys.argv[3], sys.argv[4])
