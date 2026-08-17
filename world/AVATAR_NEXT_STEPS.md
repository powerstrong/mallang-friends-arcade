# 아바타 꾸미기 — 다음 세션 할일 (A단계 구현 완료 시점 핸드오프)

> 작성: 2026-08-17 (A단계 코드 완료로 갱신). 설계 근거는 전부 [AVATAR_DESIGN.md](./AVATAR_DESIGN.md).
> 상태: **A단계(전부 무료 옷장) 구현 완료** — 합성 렌더·피커·프로토콜·꾸미기 패널·거울 오브젝트, 워커 테스트 62 pass + wrangler dev 2클라 WS 스모크 통과.

## 0. A단계에서 들어간 것 (커밋 A1~A4)

- **클라 합성 렌더** `world/world.js`: `characterId:'human'` → 착장 기반 오프스크린 384² 시트(z-order §5), LRU 24, 갈아입기 중 이전 시트 유지 후 원자 교체, 레이어 1장 실패 시 합성 전체 불합격→emoji 폴백(마네킹 부분 노출 차단). 사람만 **4박자 걸음**(`HUMAN_WALK_PATTERN=[1,0,2,0]`, 130ms) — §1 사람검증 후 이 상수만 조정.
- **피커** : 남/녀 프리셋 2카드(합성 프리뷰 캔버스) + 동물 5카드, 말랑 친구 서브 선택(기본 랜덤). 완전 첫 접속은 무선택(확정지시). `world_outfit`(JSON: preset·rev·착장)·`world_game_buddy` localStorage.
- **프로토콜** `worker/src/world.js` + `worker/src/wardrobe.js`(카탈로그 서버 미러): join payload `{characterId:'human', gameBuddyId, outfit, catalogVersion}`, 서버 sanitize(무효→프리셋 치환), wire 엔 characterId/outfit만·buddy 비노출, `outfit_change`(단조 revision, 1s 스로틀, 권위 echo), 발사 경로 `_gameAvatarId`가 URL+world-launch 시드 양쪽에서 human→말랑 친구 치환. `isValidCharacterId` 는 동물 전용으로 유지(의도적 — 게임 폴백 경로 보호).
- **꾸미기 패널 + 진입점 2**: 헤더 👕 버튼(사람만 노출) + 전신거울 오브젝트 `MIRROR_BOOTH(600,690,110,120)` — 랜덤 스폰 영역(x80~460·y450~850)·모바일 크롭(x≈213~748)·LAB_BOOTH 회피 좌표. 패널: 걷기 미리보기(탭=회전)·탭 4·색 스와치·랜덤 코디·되돌리기·프리셋 기본·저장 시 일괄 반영+반짝임. 아이템 썸네일 = 그 아이템만 바꿔 입은 내 모습(시트 캐시 키 공유).
- **테스트**: `worker/tests/wardrobe-outfit.test.mjs`(7종) + 스크래치패드 2클라 WS 스모크(wrangler dev, `--assets` 없이 워커만 띄우면 reload 루프 없음).
- sw.js CACHE v40 + wardrobe_catalog.js PRECACHE 추가, 버전 뱃지 v40 재동기.

## 1. 최우선 — 사람 검증 (사용자 게이트)

- [ ] **실기기 광장 입장**: 여자아이/남자아이로 입장 → 걷기 4박자 감성 판정(뻣뻣하면 `HUMAN_WALK_PATTERN=[1,2]` 2박자 복귀 or `HUMAN_WALK_MS` 조정. 비교 도구는 `wardrobe-preview.html` 걸음 토글).
- [ ] **2클라 착장 실시간 반영**: 폰+PC 동시 입장 → 서로의 코디가 보이는지, 갈아입기 저장 시 상대 화면에 반짝임과 함께 바뀌는지.
- [ ] 꾸미기 패널 조작감(아이 손 기준): 탭·스와치·랜덤·저장 흐름, 거울 오브젝트 위치.
- [ ] 어색한 셀(특히 옆모습 긴머리) 확인 — 문제 시트는 §3 레시피로 재생성.
- [ ] 게임 발사 확인: 사람 아바타로 부스 매칭 → 게임이 평소처럼 시작되는지(캐릭터는 각 게임의 자체 선택/배정 — 말랑 친구 사전 선택 UI 는 실측 후 제거됨, 설계서 §2).

## 2. B단계 — 가족 선물 (다음 본작업, 설계서 §8~10)

D1 프로필·옷장·선물함(마이그레이션 0005 안=§10), 부모 PIN 메뉴(서버 측 잠금·ADMIN_KEY 비노출), 쿠폰+종이 코드(원자성·멱등성), 특별 코디 추가(무료율 70% 규칙), 코디 저장 3칸, 주간 무료 옷(영구 추가형). 카탈로그 클라/서버 CI 해시 비교도 이때.

## 3. 새 아이템 추가 레시피 (확정 파이프라인)

```bash
# ① 프롬프트: scripts/avatar/p*v2_*.md 중 유형 맞는 것 복사 — "착용 편집" 형식 유지
#    (코디=p1 형식 / 헤어=p3v2 / 모자·소품=p5v2 / 안경류=p6v2). __BODY__ 치환은 아래 명령이 수행.
cd scripts/avatar
BODY="C:/src/incubating/web-game-lab/scripts/avatar/raw/mannequin_v1_raw.png"
sed "s|__BODY__|$BODY|" pNEW_item.md | codex exec -s workspace-write --skip-git-repo-check - > pNEW_item.log

# ② 가공 (repo 루트에서) — build_assets.sh 에 항목 추가하거나 단건:
#    코디:  process.py RAW OUT.png --align scripts/avatar/align.json --ref world/assets/avatar/_mannequin.png
#    헤어:  process.py RAW STEM --extract-worn raw/mannequin_v1_raw.png --split-hair --align align.json
#           → hair_palette.py 로 4색 → OUT/<id>_<pal>_<part>.png 리네임 (build_assets.sh 참조)
#    모자/안경: process.py RAW OUT.png --extract-worn ... --align ... (분리 없음)

# ③ 카탈로그 등록: shared/wardrobe_catalog.js + worker/src/wardrobe.js **양쪽**(미러!)
# ④ wardrobe-preview.html 육안+수치 검수 통과 후 커밋. hairPalettes 추가 시 swatch 색도.
```

## 4. 함정 목록 (실측 누적)

- **부유 레이어 생성 금지** — 반드시 착용 편집. 프롬프트에 "Image 1을 편집, 해당 아이템만 변경, 불변 조건 나열" 형식 유지.
- **상·하의(분리옷) 프롬프트 2대 규칙(2026-08-17 실측)**: ① 교체 지시를 "모든 9셀에서 X를 Y로 교체한다. 어느 셀에도 X가 보이면 실패다"로 강조 — 치마 1차 생성이 지시를 통째로 무시하고 마네킹을 그대로 반환한 전례(차분 0px). ② 아이템 실루엣은 마네킹의 흰 탱크톱/회색 반바지를 **완전히 덮는** 크기만 허용 — 빈틈=속옷 노출. 추출 결과는 `alpha px 수`로 즉시 검증(0이면 생성 실패).
- 분리옷 추출 단계의 `QA: FAIL` 은 전신용 지표를 부분 레이어에 적용한 노이즈 — **착용 시트의 --metrics-only PASS + 합성 육안**이 실제 게이트(모자·안경과 동일 관례).
- **align.json(row_dy=[0,4,10])은 마네킹 세대 고유값** — 마네킹 재생성 시 전 시트 재가공. 마네킹은 바꾸지 말 것.
- 차분 추출 시 아이템 색이 마네킹 표면색(살구·흰 탱크톱·회색 반바지·근백색 하이라이트)과 비슷하면 구멍 — 흰/살구 단독 아이템 지양, 하이라이트는 연회색 지시.
- 크로마키 그린 #00FF00 + "방송용 그린스크린" 앵커 문구. 초록 계열 아이템은 마젠타 키 전환 필요(§12.5, 미구현).
- `*.log` 는 gitignore — 프롬프트 .md 와 raw PNG 만 커밋.
- `_mannequin.png` 단독 렌더 경로 금지(확정지시) — 클라는 sanitize+합성 실패 시 emoji 폴백으로 처리 중. 새 렌더 경로를 추가할 때 이 원칙 유지.
- **world.js 는 IIFE 본문에서 buildPicker() 가 즉시 실행** — 피커가 만지는 `let` 상태는 선언을 그 위에 둘 것(TDZ. joinParams·buddyRowEl 전례).
- 카탈로그는 **클라/서버 2벌**(shared/wardrobe_catalog.js ↔ worker/src/wardrobe.js) — 한쪽만 고치면 서버가 새 아이템을 프리셋 기본으로 치환해버린다(증상: 저장했는데 남에게 기본 코디로 보임).
- wrangler dev 는 `--assets` 없이 워커만 띄우면 reload 루프 없이 WS 검증 가능(스모크 스크립트는 저장소 밖에 둘 것).
