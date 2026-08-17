# 아바타 꾸미기 — 다음 세션 할일 (0단계 완료 시점 핸드오프)

> 작성: 2026-08-17. 설계 근거는 전부 [AVATAR_DESIGN.md](./AVATAR_DESIGN.md) — 이 파일은 "무엇을 어떤 순서로"만 담는다.
> 상태: 설계 확정(codex 3라운드 Go) + **0단계(움직임 시제품) 통과, main 푸시됨(b7da42b)**.

## 0. 현재 상태 요약

- **에셋 15파일** `world/assets/avatar/` 반입 완료: `_mannequin.png`(비노출 정본), 코디 2(`outfit_dress_peach`, `outfit_tee_sky`), 긴머리 front/back × 4색, 숏컷 front × 4색, `hat_beret`, `glasses_round`. 전부 384²(셀 128px), 행정렬 베이크 완료.
- **파이프라인 확정**(§12.3 실측): 부유 레이어 생성 금지. 새 아이템 = ①정본 착용 편집 생성 → ②차분 추출 → ③(헤어만) 턱선 front/back 분리 → ④(헤어만) 팔레트 치환. 레시피는 아래 §4.
- **QA 도구**: `world/wardrobe-preview.html` (정적 서버로 열기: launch.json `static` = 8090 포트).
- **카탈로그**: `shared/wardrobe_catalog.js` (v0 — 서버 미러는 아직 없음).

## 1. 최우선 — 사람 검증 (사용자 게이트, 코드 작업 아님)

- [ ] `wardrobe-preview.html`에서 딸들과 **걸음 토글 판정**: 4박자(A→정지→B→정지) vs 2박자(현행) 어느 쪽이 자연스러운지 + 속도(90~200ms) 취향. → 결과를 A단계 `drawAvatar` 걸음 시퀀스에 반영.
- [ ] 코디·헤어·색 조합을 돌려보며 어색한 셀 확인(특히 옆모습 긴머리). 문제 셀은 §4 레시피로 해당 시트만 재생성.

## 2. A단계 — 전부 무료 옷장 (광장 통합, 다음 세션 본작업)

구현 순서 제안(각 항목이 커밋 단위):

1. **클라 합성 렌더** — `world/world.js`
   - `characterId==='human'`이면 `getSprite()`가 outfit 기반 **오프스크린 합성 시트**를 반환: z-order `hair_back → outfit → hair_front → faceAcc → hat`(§5). LRU 16~32, 합성 완료 전 기존/기본 시트 유지 후 원자 교체(§5-8·9).
   - **마네킹 비노출 강제**(§3): outfit 무효/누락 → 프리셋 기본값 적용, 그것도 실패 → 말랑 친구 폴백. `_mannequin.png` 단독 렌더 경로가 없어야 함.
   - 사람 시트는 표준 3×3이므로 `drawAvatar()` 자체는 거의 무변경(미러·FOOT_FRACTION 그대로). 걸음 시퀀스는 §1 판정 결과 반영.
2. **피커 확장** — `world/world.js` + `shared/wardrobe_catalog.js`
   - 동물 5카드 + **남자아이/여자아이 2카드**(WARDROBE.presets). 완전 첫 접속(저장 없음)이면 무선택 기본값 없음(§3 확정지시).
   - 사람 선택 시: 마지막 저장 착장 자동 적용 + **말랑 친구(게임 파트너) 서브 선택**(동물 5 중 1, 기본 랜덤).
   - localStorage: `world_outfit`(JSON), `world_game_buddy`. 기존 `world_character`와 호환 유지.
3. **프로토콜** — `world/world.js` + `worker/src/world.js` (+ 서버 미러 신설 `worker/src/wardrobe.js`)
   - join payload `{characterId:'human', gameBuddyId, outfit, catalogVersion}` (§11). 서버: outfit을 카탈로그로 검증(무효 → 프리셋 기본으로 치환), attachment에 둘 다 저장, **광장 브로드캐스트엔 characterId/outfit만, 게임 발사 변환엔 gameBuddyId만**.
   - `characters.js`의 `isValidCharacterId`에 'human' 허용 추가하되 게임 변환(`toGameCharacterId`)에는 human이 절대 들어가지 않게 — 발사 경로 전수 확인(`_launchProposal`, lab_queue, relay 합류).
   - `outfit_change` 메시지(저장 시에만, 단조 `revision`, 서버 검증 후 브로드캐스트, 수신 피어 재합성). `joinParams`도 저장 직후 갱신(§11).
   - 서버 미러는 characters.js처럼 assert 동기화 함수 포함(§11 CI 해시 비교는 B단계로 미뤄도 됨).
4. **꾸미기 패널 + 진입점 2개** — `world/index.html` + `world/world.js`
   - 헤더 `👕 꾸미기` 버튼 + 광장 **전신거울 오브젝트**(LAB_BOOTH 패턴 클라 전용 rect, 부스 배치와 겹침 주의 — platform-architecture-facts의 boothRect 좌표 참조).
   - 패널(§7): 큰 걷기 미리보기(탭=방향 회전) / 슬롯 탭 4개 / 색 스와치 / **오늘의 랜덤 코디** / 되돌리기 / 저장 시 일괄 반영+반짝임. A단계는 전 아이템 무료(잠금 UI 없음). 편집 중 WS 유지, 닫기·오류 시 기존 착장 보존(§7).
5. **검증**: 2클라에서 서로의 착장·갈아입기 실시간 반영 확인(사람 검증은 사용자에게 — Node 하니스로 WS 스모크만, [[platform-wrangler-dev-reload-loop]] 참고: wrangler dev 시각검증 불가).

### A단계에서 하지 않는 것
프로필/D1/쿠폰/선물함/부모 메뉴(전부 B단계, §8~10), 상하의 분리·등소품·피부/얼굴 variant(v2, §4), 계절 아이템.

## 3. B단계 이후 (요약 — 상세는 설계서)

D1 프로필·옷장·선물함(마이그레이션 0005 안 = §10), 부모 PIN 메뉴+쿠폰/종이 코드(§9), 특별 코디 추가(무료율 70% 규칙 §8), 코디 저장 3칸, 주간 무료 옷(영구 추가형). → C단계: 패션 스튜디오(반응 좋을 때만).

## 4. 새 아이템 추가 레시피 (확정 파이프라인)

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

# ③ shared/wardrobe_catalog.js 에 아이템 등록 → ④ wardrobe-preview.html 육안+수치 검수 통과 후 커밋
```

## 5. 함정 목록 (이번 세션 실측)

- **부유 레이어 생성 금지** — 반드시 착용 편집. 프롬프트에 "Image 1을 편집, 의복/해당 아이템만 변경, 불변 조건 나열" 형식 유지.
- **align.json(row_dy=[0,4,10])은 마네킹 세대 고유값** — 마네킹을 재생성하면 전 시트 재가공 필요. 마네킹은 바꾸지 말 것.
- 차분 추출 시 **아이템 색이 마네킹 표면색(살구 피부·흰 탱크톱·회색 반바지·근백색 하이라이트)과 비슷하면 구멍** — 프롬프트에서 흰색/살구색 단독 아이템 지양, 하이라이트는 "거의 흰색" 대신 연회색 지시가 안전.
- 크로마키는 그린 #00FF00 + "방송용 그린스크린" 앵커 문구가 성공 패턴. 초록 계열 아이템은 마젠타 키로 전환 필요(§12.5, 아직 미구현).
- `*.log`는 gitignore — 커밋 안 됨(프롬프트 .md와 raw PNG만 커밋).
- 광장 통합 시 `_mannequin.png`이 실수로 그려지는 폴백 경로를 만들지 말 것(확정지시).
