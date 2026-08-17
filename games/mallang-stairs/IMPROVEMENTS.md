# 말랑 계단 레이스 — 개선 백로그 (2026-08-17)

이 문서는 Claude Code **원격(claude.ai/code) 세션이 단독으로 집어 실행할 수 있도록** 과제를 정리한 백로그다.
각 과제는 이 문서만 읽고 착수할 수 있게 배경·수정 위치·완료 기준을 담았다. 이미지 생성이 필요한 부분은
로컬(codex imagegen)에서 **이미 생성해 assets/ 에 넣어 두었으므로**, 원격 과제는 전부 코드 작업이다.

> **진행 현황 (2026-08-17, 같은 날 로컬 세션에서 R1~R11 구현 완료)**
> - 구현됨: R1(테마 압축) · R2(보호막 시각화) · R3(골든 타임) · R4(메달+기록 델타) · R5(솔로 PB 고스트)
>   · R6(안내 한글화) · R7(튜토리얼 힌트) · R8(시뮬 하니스 `dev/sim.js` — 결론: 수치 변경 불필요)
>   · R9(마이크로 최적화) · R10(솔로 visibility 일시정지) · R11(주간 TOP3)
> - 검증: Node 시뮬(엔진 결정성·setScoreBoost 점수전용 1.496x·프로파일 표) + 헤드리스 DOM 스모크
>   (시작→카운트다운→힌트 1회성→오답 즉사→시간종료 결과→재도전→정답 홉, CSS 배선 전부 확인).
> - **사람 검증 남음**: 실기기 시각 확인(버블 위치·골든 발판 체감·힌트 위치·배경 전환 멀미),
>   30초 실주행 감각, 멀티 2클라(메달·고스트 비표시·순위), 백그라운드 전환 복귀.
> - 남은 과제: R12(시작 동기화, 선택) · R13(시크릿 해금, 사용자 결정 필요).
> - R8 시뮬 근거: 평균(탭400ms) 61.9층·피버 1.27회·보호막 충전 1.0회 — 목표(판당 피버~1회) 이미 충족.
>   초보(600ms)는 피버 0회·게이지사망 1.5회로 빡빡하지만 무한의계단류 본연의 긴장이므로 유지.

---

## 0. 현재 상태 요약

- **모드**: 30초 단일 시간제 레이스(솔로/멀티 동일). 무한 모드 없음. 죽으면 체크포인트(25층 단위)에서 부활, 시간 종료 시 최고층(bestStep)으로 순위.
- **구조**: 순수 HTML/CSS/JS, window 전역(ES 모듈 아님).
  - [stairs-engine.js](stairs-engine.js) — DOM/네트워크 무의존 결정적 코어(계단·판정·게이지·피버·부스터·점수). 싱글/멀티 공통.
  - [game.js](game.js) — 렌더/입력/루프/UI/결과/보호막/체크포인트. [multiplayer.js](multiplayer.js) — MallangRelay 래핑(transport만, 판정 불개입).
  - [characters.js](characters.js) — 5캐릭터(공개 3: 토끼·햄스터·병아리 / 시크릿 2: 라떼·민트). [audio.js](audio.js) — WebAudio 프로시저럴 SFX.
- **점수 보호막**: 약 1000점마다 1칸 충전, 사망 시 소모하면 10층 단위 라인에서 부활(game.js `SHIELD_*`, `onDeath`).
- **주간 리더보드**: `POST /api/leaderboard` 제출 완료(층 우선, 저장값 = 층×100000+점수 복합 인코딩). 조회는 `GET /api/leaderboard?game=mallang-stairs`.
- **절대불변 룰(깨지 말 것)**: 오입력 즉사·게이지0 즉사. 피버/부스터/능력은 점수·게이지만 바꾸고 즉사 룰이나 실수 방어를 주지 않는다. 시간제 레이스에서 죽음은 라운드 종료가 아니라 체크포인트 부활이다.

### 원격 세션 공통 주의사항

1. **검증은 Node 하니스로.** 이 레포는 브라우저 시각검증이 불안정하고(wrangler dev reload 루프), 원격 환경엔 브라우저가 없다.
   엔진류는 `global.window = {}; eval(fs.readFileSync('games/mallang-stairs/stairs-engine.js','utf8'))` 방식으로 로드해 시뮬레이션으로 검증한다.
   DOM 코드는 로직 분리를 최대화하고, 사람 확인이 필요한 부분은 커밋 메시지·PR 설명에 "사람 검증 필요" 항목으로 명시한다.
2. **main 직접 작업.** 별도 브랜치를 만들지 말고 main에서 커밋한다(프로젝트 방침). 커밋 prefix는 기존 스타일: `feat(mallang-stairs): …`, `balance(mallang-stairs): …`.
3. **멀티 프로토콜 주의.** snapshot/start 메시지 포맷([multiplayer.js](multiplayer.js))을 바꾸면 구버전 클라와 섞일 수 있다 — 필드 추가는 OK, 의미 변경·삭제는 금지.
4. **줄번호는 근사치.** 함수명 기준으로 찾을 것.

---

## 1. 준비된 신규 에셋 (생성 완료, 배선 대기)

2026-08-17 로컬 codex imagegen으로 생성·후처리해 `assets/` 에 커밋해 둔 파일. 아직 코드에서 사용하지 않는다.

| 파일 | 내용 | 소비 과제 |
|---|---|---|
| `assets/fx-shield-bubble.png` | 캐릭터를 감싸는 민트색 보호막 버블(중앙 투명 오라) | R2 |
| `assets/fx-shield-pop.png` | 보호막 소모 순간 버블 팝 이펙트 | R2 |
| `assets/stair-gold.png` | 골든 타임용 황금 구름 발판 타일 | R3 |
| `assets/ui-medal-gold.png` `ui-medal-silver.png` `ui-medal-bronze.png` | 결과 화면 1·2·3위 메달 | R4 |

---

## 2. 원격 과제 (우선순위순)

### R1. 테마 진행을 30초 레이스에 맞게 압축 — 난이도 하

- **왜**: `THEME_STEPS`가 0/60/140/220/300층 기준인데, 이는 무한 모드 시절 튜닝이다. 30초 레이스에서 평균 어린이(탭 간격 ~400ms)는 60~80층에서 끝나므로 노을·새벽·우주 배경과 캔디·쿠키 발판을 사실상 아무도 못 본다. 5테마 아트 투자가 묻혀 있다.
- **무엇을**: [game.js](game.js) `THEME_STEPS`의 `min`을 `0 / 35 / 70 / 110 / 150`으로 압축(발판 매핑은 유지: 구름·구름·캔디·캔디·쿠키).
- **완료 기준**: 탭 간격 400ms 시뮬 기준 한 판에 테마 2~3개가 노출된다. 배경 크로스페이드(1.2s)가 잦아져 어지럽지 않은지 간격을 눈으로 한 번 확인(사람 검증 항목으로 표기).

### R2. 보호막 시각화 배선 (에셋 준비됨) — 난이도 중

- **왜**: 보호막은 이 게임의 핵심 차별 메커닉인데 현재 게이지 펄스 + 텍스트 플로트("보호막 완성!")뿐이라 아이들이 상태를 인지하기 어렵다.
- **무엇을**:
  1. [index.html](index.html) `#player` 안에 `comboFlame`처럼 `<img id="shieldBubble" class="shield-bubble" src="./assets/fx-shield-bubble.png" alt="" draggable="false" />` 추가.
  2. [game.js](game.js) — `updateHud`(또는 shield 증감 지점)에서 `shield >= 1`이면 `shieldBubble.classList.add('is-on')`, 소모·라운드 시작 시 제거. `FX_ASSETS`에 `shieldPop: 'fx-shield-pop.png'` 추가, `buildFxPools()`에 `buildFxPool('shieldPop', 1)`, `playFx` 타임아웃 분기(~450ms). `onDeath`의 보호막 소모 분기에서 `playFx('shieldPop', homeX(), homeY() - 40)` (기존 텍스트 플로트는 유지).
  3. [style.css](style.css) — `.shield-bubble { position:absolute; inset:-12px; opacity:0; transition:opacity .2s; pointer-events:none; }` `.shield-bubble.is-on { opacity:.5; animation: 완만한 펄스 }` + `.fx-pop--shieldPop { --fx-size: 140px; }` 및 팝 키프레임(기존 `fallPuff` 패턴 복제).
- **완료 기준**: 게이지 가득 → 캐릭터 주변 버블 표시. 보호막 부활 → 팝 이펙트 + 버블 소멸. 보호막 없을 때는 아무 것도 안 보임. 죽음-부활 사이클(`restartLife`) 후 상태 잔존 없음.

### R3. 골든 타임 — 마지막 10초 드라마 (에셋 준비됨) — 난이도 중

- **왜**: 고정 30초 레이스가 밋밋하게 끝난다. 막판 점수 배율 구간을 만들면 종료 직전 역전 드라마가 생긴다(HUD의 10초 danger 연출과도 맞물림).
- **무엇을**:
  1. [stairs-engine.js](stairs-engine.js) — `create()` 클로저에 `externalScoreMul = 1` 추가, `setScoreBoost(mul)` API 노출, `input()`의 `gain` 계산에 곱하기. **즉사 룰·게이지에는 손대지 않는다.**
  2. [game.js](game.js) — `frame()`에서 `remainingMs() <= 10000`이 처음 되는 순간: `engine.setScoreBoost(1.5)`, `stairLayer.classList.add('is-golden')`, `spawnFloat('골든 타임! 점수 1.5배', 'overtake', 150, 1200)`, `playSound('fever','start')` 급 강조음(적절히 선택). **주의**: 골든 타임 중 죽어서 `createLifeEngine`으로 엔진이 재생성되면 boost를 재적용할 것. 라운드 시작 시 클래스·boost 초기화.
  3. [style.css](style.css) — `.stair-layer.is-golden .stair:not(.is-next) { background-image: url('./assets/stair-gold.png'); }` (is-next 골드 글로우는 유지). hudTime에 골드 펄스 강조는 선택.
- **완료 기준**: 시뮬(엔진 단위)로 boost 적용 시 gain 1.5배 확인. 잔여 10초 진입 시 발판이 황금으로 바뀌고 안내 플로트 1회. 부활 후에도 배율 유지. 솔로·멀티 동일 동작(점수는 각자 로컬 계산이라 동기화 이슈 없음).

### R4. 결과 화면 메달 + 개인 성장 표시 (에셋 준비됨) — 난이도 하

- **왜**: 멀티 결과 순위가 텍스트뿐이고(트로피는 1위만), 솔로 결과엔 "지난 나"와의 비교가 없다.
- **무엇을**:
  1. [game.js](game.js) `renderResultRank` — 1·2·3위 행 앞에 `ui-medal-gold/silver/bronze.png` 아이콘(`.result-rank__medal`, ~20px) 표시.
  2. `showResult` — `savePersonalBest` 호출 **전에** 이전 PB를 스냅샷해 두고, 결과 카드에 델타 한 줄 추가: 신기록이면 "지난 최고보다 +N층!", 아니면 "최고 기록까지 -N층" (첫 판이면 생략).
- **완료 기준**: 멀티 top3 행에 메달, 솔로/멀티 공통 델타 문구. `escapeHtml` 유지(이름은 사용자 입력).

### R5. 솔로 PB 고스트 — 혼자서도 라이벌 (코드만으로 가능) — 난이도 중상

- **왜**: 솔로 레이스엔 긴장 상대가 없다. 개인 최고 기록 런을 유령으로 재생하면 "지난 나"와의 레이스가 된다. 멀티 쉐도우 렌더 경로를 재활용하므로 신규 아트 불필요.
- **무엇을**:
  1. **기록**: 솔로 라운드 중 `frame()`에서 ~500ms 간격으로 `{ t: 경과ms, s: bestStep }` 샘플(30초=최대 60개). 라운드 종료 시 신기록이면 `localStorage['mallang-stairs:pbghost']`에 곡선 저장.
  2. **재생**: 솔로 `beginRound` 시 곡선이 있으면 고스트 노드 1개 생성(`.remote-player` CSS 재활용, opacity ~0.35, 라벨 "👻 지난 최고"). 매 프레임 경과시간으로 곡선을 선형 보간해 `interpStepX/Y`로 배치 — x는 현재 시드의 계단을 따르므로 실제 발판 위에 얹혀 보인다(높이 비교가 목적이라 이걸로 충분).
  3. 멀티에서는 고스트 미표시. 고스트 캐릭터는 PB 당시 캐릭터 id도 곡선에 함께 저장해 사용.
- **완료 기준**: PB가 있는 솔로 판에서 고스트가 함께 올라감. 새 PB 달성 시 곡선 갱신. localStorage 파싱 실패 시 조용히 무시(기존 `loadPersonalBest` 패턴).

### R6. 스크린리더 안내 한글화 — 난이도 최하

- **왜**: UI는 전부 한국어인데 `announce()`(aria-live) 문자열만 영어다: `'Shield ready'`, `'Safe step reached: N'`, `'You took the lead!'`, `'You overtook a friend!'`, `'Shield saved you at step N'`.
- **무엇을**: [game.js](game.js)의 해당 5곳을 한국어로 교체("보호막 완성", "안전 계단 도달: N층", "선두로 나섰어요", "친구를 추월했어요", "보호막 발동 — N층에서 부활"). `soundBtn`의 SOUND ON/OFF → "소리 켬/끔" 교체는 선택(스타일 확인).
- **완료 기준**: grep으로 영어 announce 문자열 0건.

### R7. 첫 판 튜토리얼 힌트 — 난이도 하

- **왜**: 룰은 단순하지만("반짝이는 다음 계단 방향을 누른다") 첫 이용 어린이는 오입력 즉사를 겪고서야 배운다.
- **무엇을**: `localStorage['mallang-stairs:seen-hint']` 없으면 첫 카운트다운 동안 스테이지 위에 1회성 오버레이: "반짝이는 계단 쪽 화면을 눌러요! ← →" + 시작과 함께 사라짐·플래그 저장. [game.js](game.js) `runCountdown` 주변 + [style.css](style.css) 소형 클래스.
- **완료 기준**: 최초 1회만 노출, 이후 재노출 없음. 카운트다운 조작 방해 없음.

### R8. 밸런스 시뮬 하니스 + 피버 빈도 튜닝 — 난이도 중

- **왜**: 30초 레이스 기준 재튜닝이 감으로 이뤄져 왔다(30초 단축, 보호막 충전량 등). 평균 어린이가 피버를 한 판에 0~1회밖에 못 보는 것으로 추정되나 근거 데이터가 없다.
- **무엇을**:
  1. `games/mallang-stairs/dev/sim.js` (Node 스크립트, 새 폴더) — window shim으로 엔진 로드, 탭 간격 프로파일(200/300/400/600ms ± 지터, 오입력률 0~3%)별로 30초 × N회 시뮬. 출력: 평균 최고층, 피버 횟수, 게이지 사망률, 평균 점수, 보호막 충전 도달률.
  2. 결과를 근거로 [stairs-engine.js](stairs-engine.js) `SPEED_GRADE.*.feverGain` 또는 `FEVER.gaugeMax`를 조정해 "탭 400ms 프로파일이 판당 피버 ~1회"가 되게. `gaugePressureFactor`(20층부터 램프)도 30초 도달 범위(~150층)에 맞는지 함께 점검.
  3. 시뮬 표를 커밋 메시지에 첨부.
- **완료 기준**: sim.js 재실행 가능(멱등), 튜닝 전후 표 비교, 절대불변 룰 무변.

### R9. 마이크로 최적화 묶음 — 난이도 하

- **왜**: 저사양 폰 대비 소소한 DOM 낭비 제거.
- **무엇을**: [game.js](game.js)
  1. `layoutStairs()` — 부스터 배지 `innerHTML`을 매 탭마다 무조건 재설정하지 말고 노드에 마지막 타입을 캐시해 변경 시에만 갱신.
  2. `selectChar()` 시점에 해당 캐릭터 포즈 `preloadPoses` 호출(현재는 라운드 시작 때만이라 첫 홉에서 이미지 팝 가능).
- **완료 기준**: 동작 동일, 탭당 DOM 쓰기 감소(코드 리뷰로 확인).

### R10. 백그라운드 전환 처리(솔로 일시정지) — 난이도 하

- **왜**: 탭이 숨겨지면 rAF는 멈추지만 `roundEndAt`은 벽시계라, 솔로 중 잠깐 알림을 보고 오면 판이 그냥 끝나 있다.
- **무엇을**: [game.js](game.js) — `visibilitychange`에서 솔로(playing && !isMulti)일 때 숨김 시각을 기록하고, 복귀 시 `roundEndAt`을 숨김 시간만큼 뒤로 민다(엔진 게이지는 tick 기반이라 자동으로 멈춰 있음). **멀티는 벽시계가 공유 규칙이므로 손대지 않는다.**
- **완료 기준**: 솔로에서 숨김→복귀 시 남은 시간 보존. 멀티 동작 무변.

### R11. 셋업 화면 주간 TOP3 미리보기 — 난이도 하

- **왜**: 주간 리더보드 제출은 붙었지만 게임 안에서 보이지 않아 동기부여로 작동하지 않는다.
- **무엇을**: [game.js](game.js) `init()`에서 `GET {WORKER_URL}/api/leaderboard?game=mallang-stairs` fetch → 응답 `entries`의 저장 점수는 `층×100000+점수` 복합값이므로 `층 = Math.floor(score/100000)`로 디코드([worker/src/index.js](../../worker/src/index.js) `STAIRS_TIE_BASE` 참조). 셋업 화면 `pbNote` 아래에 "🏆 이번 주: 1위 이름 N층 · 2위 … · 3위 …" 한 줄(또는 3행 소형 리스트). 실패 시 조용히 생략, 이름은 `escapeHtml`.
- **완료 기준**: 네트워크 실패에도 화면 깨짐 없음. 방 입장 흐름(대기 패널)과 겹치지 않는 배치.

### R12. (선택·저우선) 멀티 시작 동기화 정밀화

start 브로드캐스트 수신 시점 차이만큼(대개 <200ms) 클라 간 시작이 어긋난다. 서버 시각 기반 `startAt`을 주려면 [worker/src/room.js](../../worker/src/room.js) relay에 서버 타임스탬프 부가가 필요해 워커 수정을 동반한다. 캐주얼 기준 체감이 작으므로 보류 — 착수 전 사용자 확인.

### R13. (사용자 결정 필요) 시크릿 캐릭터 해금 조건

현재 라떼·민트는 🎲랜덤 추첨으로만 등장한다. "조건 달성 시 해금(예: 100층 1회)" 같은 규칙은 게임 디자인 결정이므로 **사용자에게 먼저 물어보고** 진행할 것.

---

## 3. 원격으로 할 수 없는 것 (로컬·사람 필요)

| 항목 | 이유 |
|---|---|
| 멀티 2클라 라이브 사람 검증 | 표준 게이트. **아직 미완**(엔진·싱글은 Node+브라우저 검증 완료, 실멀티는 사람 필요) |
| 추가 이미지 에셋 생성·재생성 | codex imagegen은 로컬 CLI 전용(이번에 R2~R4용은 생성해 둠) |
| 실기기 터치 반응·오디오 체감, 배경 크로스페이드 멀미 체크(R1) | 실기기 필요 |

---

## 4. 이력

- 2026-08-17: 최초 작성. 신규 에셋 6파일 생성·커밋(1절), 원격 과제 R1~R13 정리.
- 2026-08-17(같은 날): 로컬 세션에서 R1~R11 구현·검증 완료(상단 진행 현황 참조). 남은 것: R12·R13 + 사람 검증.
