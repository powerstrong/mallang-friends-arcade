# NEXT STEPS — 별빛 구조 퍼즐 (클라우드 이어작업용)

> 최종 갱신: 2026-08-09 · 콜드 스타트: `HANDOFF.md` → `REDESIGN.md` → 이 파일
> 브랜치 정책: `main`에서 직접 작업·커밋·푸시. 폴링/대기 루프 금지.

## 지금까지 (v1, 커밋됨)
- 장르 전면 재설계: 2인 결정론 SRPG → **결정론 전술 퍼즐**(밀기/당기기로 장난감을 벽·수리별·서로에 부딪혀 수리).
- 순수 엔진 `engine/puzzle.js`, 콘텐츠 `data/puzzles.js`(포탑 5퍼즐), UI `engine/ui.js`(예약→미리보기→출동→undo/restart), 결정론 예고(포탑 광선).
- `tests/puzzles.test.js`가 BFS 솔버로 각 퍼즐 검증: 풀이가능·무피해경로·par=최적·**능력필수(비자명성)**·무겹침. `tests/ui-static.test.js`도 통과.
- 브라우저 375×812 E2E 확인: 탭 조작·미리보기·출동·★★★·undo. 콘솔 에러 0.

## 검증 방법(재현)
```bash
cd games/mallang-starlight && for f in tests/*.test.js; do node "$f"; done
# 로컬 시각검증: 리포 루트에서 python -m http.server 후 /games/mallang-starlight/index.html
```
`window.__mallangStarlight` 디버그 훅: `getState/getSave/getReserved/startPuzzle/reserve/go/undo/restart/clearSave`.

## 다음 작업 (우선순위 순)

### 1. 삐걱봇(돌진) 퍼즐 안전 도입  — 콘텐츠 다양성
엔진에 dash(돌진) 이미 구현됨. 단 **자동해결 함정 주의**: 돌진이 시작부터 벽/모서리로 향하면 무행동 자동클리어. 멀티토이는 포탑끼리 광선이 서로를 수리하는 자동해결도 발생.
- 해결: `data/puzzles.js`에 후보 추가 → **반드시 솔버 게이트 통과**(아래 2의 강화 솔버로). 삐걱봇은 중앙 배치·돌진 경로가 열린 바닥이 되게, 친구는 라인 밖으로 뺄 수 있게.
- 테스트의 `noAbility.minBeats===null`(비자명성)과 `minZero!==null`(무피해)를 반드시 유지.

### 2. 더 빠른 솔버 → par3+ 콘텐츠 가능
현재 테스트 BFS는 5×5·beatLimit3까지가 실용 한계(par3 repair5 검증에 ~76s). 
- IDDFS + 더 강한 pruning(대칭 제거, 지배상태 컷, `to`가 결과 동일한 이동 병합)로 6×6/par3~4 검증을 수십초 내로.
- 이게 되면 난이도 커브를 1,1,2,1,2 → 1,2,2,3,3 등으로 재구성.

### 3. 데일리 퍼즐 + 공유 (웹 강점 극대화)
- 날짜 시드로 검증된 템플릿 조합 → "오늘의 퍼즐". 상태에 `rng.seed` 자리 있음(현재 미사용).
- URL 해시에 `seed + 행동기록` → 같은 판/리플레이 공유. `file://`은 짧은 도전 코드 복사.
- 스포일러 없는 결과 공유 문자열: `오늘 별빛작전 2비트 / 피해 0 ⭐⭐⭐`.

### 4. 연쇄 수리 보너스 + 연출
- 한 비트에 2대 이상 수리 시 보너스 점수 + 강한 시청각(현재 `beep('repair')`만). 별 3 조건에 "2연쇄"도 인정 검토.
- 출동 해결을 **단계 애니메이션**(친구 이동 → 능력 → 각 장난감 예고 순차)으로. 현재는 CSS transition으로 스냅. 이벤트(`res.events`)를 순차 재생하면 됨.

### 5. 3번째 동사(햄스터) — 루프 검증 후에만
`REDESIGN §2` 후속. 직선 밀기(최대 2칸) 역할 추가로 조합 깊이 확장. 로스터/캠페인 확장은 데일리+수제 20판이 재플레이 검증한 뒤.

### 6. 정리
- 미사용 런타임 에셋 확인/제거: 구 SRPG용 `enemy-squeak.webp`, `enemy-spring.webp`, `boss-bear.webp`, `props/*`, `hub-bg`/`result-sticker`는 사용 중. `assets/runtime`에서 orphan 스캔 후 미사용분 정리(구 `ui-static` orphan 테스트 로직 참고).
- `ART.md`는 구 SRPG 기준 → 퍼즐 기준으로 갱신(포탑/수리별/화살표 예고 표현).

## 주의점(엔진 불변식)
- 상태는 JSON 직렬화 가능(함수/DOM/Set 금지). `engine/puzzle.js`에 `Math.random`/`document.` 금지.
- 장난감 예고(intent)는 비트 시작에 고정, 실행은 현재 위치 기준(밀면 원점만 이동 → 재배선). 이 규칙이 재미의 핵심이므로 유지.
- `previewBeat`는 `applyBeat`와 동일 결과여야 함(미리보기=실제). 결정론 유지.
