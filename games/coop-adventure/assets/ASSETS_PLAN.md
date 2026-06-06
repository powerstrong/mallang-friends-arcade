# 에셋 일괄 생성 → 반영 계획 (다음 세션용)

## ✅ 현재 상태 (2026-06-06 갱신)
- **생성·처리 완료**: 19종 전부 생성→크로마 제거/정렬/리사이즈까지 끝. 게임용 `*.png` 준비됨.
- **캐릭터 5종**: 모두 **측면 + 비율 일치(단일 시트 frame0=idle, 1~15=run)**. cat·puppy·rabbit은 깔끔한 프로필, chick·hamster는 둥근 형태라 2차 재생성으로 측면 확보(완벽 프로필은 아니나 측면 방향성 OK).
- **게임 배선됨**: `chick-run`(나)·`cat-run`(친구)만 play.js에 단일시트 방식으로 반영·검증 완료(idle=f0, run=1~15@20fps, 공중 f6/f12, origin 발바닥).
- **아직 미반영(다음 세션, 아래 §3대로)**: puppy/rabbit/hamster(캐릭터 선택용), 배경 3, 발판 타일 3, 이펙트 4, UI/배너 4.
- scratch(`_gen/` 프롬프트·로그, `_proc.sh` 등)는 `.gitignore`로 커밋 제외. 도구 `_align_slice.py`와 이 문서는 유지.
- **남은 화질 이슈**: chick/hamster 완벽 프로필 원하면 재재생성 여지. 배경/썸네일 PNG가 큼(원하면 JPG 변환).

---


> 2026-06-06, codex `imagegen` 병렬 생성. 이 문서는 **생성된 raw 이미지를 게임에 반영하는 절차**를 담는다.
> 생성 자체는 백그라운드(`_gen/_run.sh`, task)로 수행됨. 처리·배선은 이 문서대로 진행.

## 0. 핵심 원칙 / 비율 버그 수정
- **이전 문제**: idle과 run을 **따로 생성** → 디퓨전이 몸 통통함을 다르게 그려 비율 불일치(서기=슬림, 달리기=통통). 측정: idle 벨리폭115/높이179 vs run 167/190.
- **수정**: 캐릭터는 **한 시트에 idle(frame0)+달리기(frame1~15)를 함께 생성** → 같은 디퓨전 패스라 몸 비율 자동 일치. 텍스처 교체도 불필요(한 시트 안 프레임만 사용).

## 1. 생성물 위치 찾기
각 프롬프트는 `_gen/<name>.txt`, 로그는 `_gen/<name>.log`.
```
sid=$(grep -m1 "session id:" _gen/<name>.log | awk '{print $3}')
img=~/.codex/generated_images/$sid/$(ls ~/.codex/generated_images/$sid | head -1)
```
`_gen/_run.sh` 출력(task bxxil6fo8)에 `DONE <name> exit=0` 으로 완료 확인. 실패(exit≠0)면 해당 `_gen/<name>.txt`만 재실행.

## 2. 처리 도구
`_align_slice.py` (크로마 제거+트림+발 baseline 정렬). 모드:
- `run  <in> <out> 4 <chroma> 256 190` — 캐릭터 포즈 시트(4x4=16, frame 256)
- `idle <in> <out> <chroma> 256 190` — 단일 포즈
- `cut  <in> <out> <chroma>` — 크로마만 제거+트림(이펙트/타일/아이콘)
배경/썸네일(크로마 없음)은 처리 없이 PIL로 리사이즈만.

## 3. 에셋별 처리 + 게임 반영

### 캐릭터 (5종) — 포즈 시트
| name | chroma | 처리 | 산출 |
|---|---|---|---|
| char-chick | #ff00ff | `run … 4 "#ff00ff" 256 190` | `chick-run.png`(1024², 16f) ※ 기존 교체 |
| char-cat | #ff00ff | 동일 | `cat-run.png` ※ 기존 교체 |
| char-puppy | #00ff00 | 동일 | `puppy-run.png` |
| char-rabbit | #00ff00 | 동일 | `rabbit-run.png` |
| char-hamster | #00ff00 | 동일 | `hamster-run.png` |
- **chick-idle.png/cat-idle.png 는 폐기**(이제 시트 frame0=idle 사용).
- **play.js 배선 변경**:
  - preload: `chick-run`/`cat-run` spritesheet(frameW/H 256) 만 로드. `chick-idle`/`cat-idle` 로드 제거.
  - anims: 달리기는 `generateFrameNumbers(key,{start:1,end:15})` (frame0=idle 제외). frameRate 20.
  - 상태머신: idle = `setFrame(0)` (텍스처 교체 X), run = `play(key,true)`, air = `setFrame(JUMP/FALL)`(run 프레임 중 택1, 예: 5/12). → 텍스처 단일이라 scale base 일정, origin(0.5,1) 유지.
  - 캐릭터 선택 확장 시: player=선택 캐릭터 `-run` 시트, ghost=상대 캐릭터 시트. registry로 캐릭터 id 전달.

### 배경 (3종) — 전체 이미지(크로마 없음)
| name | 산출 | 반영 |
|---|---|---|
| bg-grass | `bg-grass.png` (가로, ~1536x864로 리사이즈) | PlayScene 스테이지 1 배경 |
| bg-cloud | `bg-cloud.png` | 스테이지 2 |
| bg-cave | `bg-cave.png` | 스테이지 3 |
- 반영: PlayScene create에서 `this.add.image(0,0,bgKey).setOrigin(0).setScrollFactor(SF).setDepth(-10)`.
  - 카메라 스크롤보다 느리게(패럴럭스): `setScrollFactor(0.3)` 정도. 월드폭(3600)보다 넓게 타일/스트레치 또는 `tileSprite`로.
  - 스테이지별 bgKey는 `stages.js`에 필드 추가(`bg:'bg-grass'`)하고 init data로 전달.

### 발판 타일 (3종) — 크로마, 타일
| name | chroma | 산출 | 반영 |
|---|---|---|---|
| tile-grass | #ff00ff | `cut` → `tile-grass.png` | 스테이지1 발판 텍스처 |
| tile-cloud | #00ff00 | `tile-cloud.png` | 스테이지2 |
| tile-stone | #00ff00 | `tile-stone.png` | 스테이지3 |
- 반영: 현재 `_solid()`는 색 사각형. → `tileSprite`로 발판 폭만큼 타일링하거나 9-slice. 물리 바디(staticGroup)는 그대로 두고 비주얼만 타일로 교체.

### 이펙트 (4종) — 크로마, 투명
| name | chroma | 산출 | 반영(현재 코드) |
|---|---|---|---|
| fx-dust | #00ff00 | `cut`→`fx-dust.png` | 점프/착지 시 발밑에 스폰(현재 스쿼시만 있음 → 먼지 추가) |
| fx-sparkle | #ff00ff | `fx-sparkle.png` | 별 획득 `+1` 옆 반짝임 |
| fx-poof | #00ff00 | `fx-poof.png` | `_poof()`의 💨 텍스트를 이 이미지로 교체 |
| fx-heart | #00ff00 | `fx-heart.png` | 합류/이모트 '굿' 시 하트 팝 |
- 반영: `this.add.image(x,y,key)` + 짧은 tween(scale/alpha) 후 destroy. 기존 `_poof`/별 연출 자리에 끼움.

### UI / 배너 (4종)
| name | chroma | 산출 | 반영 |
|---|---|---|---|
| ui-title | #00ff00 | `cut`→`ui-title.png` | 타이틀/부트 화면 배너(텍스트는 Phaser로 위에 올림) |
| ui-star | #00ff00 | `ui-star.png` | MapScene 별 평가(현재 ★ 텍스트 → 이미지) |
| ui-lock | #00ff00 | `ui-lock.png` | MapScene 잠금 노드(현재 🔒 텍스트 → 이미지) |
| ui-thumb | 없음 | `ui-thumb.png`(16:9 리사이즈) | 아케이드 로비 썸네일/registry 등록 이미지 |

## 4. 처리 일괄 실행 예시(다음 세션)
```
A=games/coop-adventure/assets
resolve(){ sid=$(grep -m1 "session id:" $A/_gen/$1.log|awk '{print $3}'); echo ~/.codex/generated_images/$sid/$(ls ~/.codex/generated_images/$sid|head -1); }
python $A/_align_slice.py run "$(resolve char-chick)" $A/chick-run.png 4 "#ff00ff" 256 190
# … 캐릭터 5종 run, idle 없음
python $A/_align_slice.py cut "$(resolve fx-dust)" $A/fx-dust.png "#00ff00"
# … 이펙트/타일/아이콘 cut, 배경/썸네일 리사이즈
```
처리 후 각 이미지 **반드시 Read로 육안 확인**(크로마 잔흉·민트/녹색 잠식·비율). 민트(고양이)·초록 발판/타일은 마젠타 크로마 사용했는지 재확인.

## 5. 반영 순서 권장
1. 캐릭터 5종 처리 → play.js 시트 단일화(idle=frame0) 반영 + 비율 검증(계측: idle/run 발 baseline·크기 일치).
2. 배경 3종 → PlayScene 패럴럭스 + stages.js bg 필드.
3. 타일 3종 → 발판 비주얼.
4. 이펙트 4종 → 기존 연출 자리에 끼움.
5. UI 4종 → MapScene/타이틀/썸네일.
각 단계 codex 리뷰 후 커밋(과하지 않게 단계별 1커밋).

## 6. 정리
- `_gen/` 폴더와 `_align_slice.py`, 이 문서는 작업 도구/기록. 최종 커밋 시 `_gen/`(프롬프트/로그)은 빼도 됨(또는 tools로 이동). 게임이 쓰는 건 처리된 `*.png`만.
