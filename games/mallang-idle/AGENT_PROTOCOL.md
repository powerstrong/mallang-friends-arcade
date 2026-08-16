# 말랑프렌즈 키우기 — 자동 개발 작업 규약

`mallang-idle` · 며칠간 세션을 이어 달릴 에이전트가 **매 세션 시작 시 먼저 읽는 문서**

---

## 0. 세션 시작 절차

1. `NEXT_STEPS.md`를 읽는다 → 현재 단계와 다음 작업을 확인
2. [ROADMAP.md](ROADMAP.md)에서 **현재 단계의 게이트**를 확인
3. 지표 회귀 테스트를 먼저 돌린다 (지금 상태가 초록인지 확인하고 시작)

```bash
node games/mallang-idle/tests/balance.test.js
```

세션 종료 시 `NEXT_STEPS.md`를 갱신한다. 다음 세션은 이 파일만 보고 이어간다.

---

## 1. 작업 순서 — 뒤집지 않는다

```
1. 순수 전투 모델
2. 성장 공식
3. balance simulator
4. save / load / migrate
5. 최소 UI
6. 직접 플레이
7. 곡선 조정
8. 그 다음에야 연출
```

이걸 반대로 하면 **예쁜데 재미없는 키우기**가 나온다.
"UI가 있어야 확인할 수 있다"는 이유로 5번을 앞당기지 않는다 — 확인은 3번이 한다.

---

## 2. 금지 사항

| 금지 | 이유 |
|---|---|
| `BALANCE` 밖의 매직 넘버 | 밸런싱이 불가능해진다 |
| `Math.random()` | 시뮬레이터 결과가 재현되지 않는다. seeded RNG만 |
| 엔진이 DOM · 타이머 · `Date.now()`를 직접 읽기 | 시뮬과 게임이 갈라진다. 시간은 인자로 주입 |
| 전투 로직을 UI 계층에 중복 구현 | 지표가 거짓말을 한다 |
| 지표 회귀 테스트 삭제 · 허용 범위 임의 완화 | 밸런스가 조용히 무너지는 정확한 경로 |
| 게이트 미통과 상태로 다음 단계 진입 | 이 프로젝트의 유일한 브레이크를 푸는 행위 |
| 전투력을 데미지 공식에 재투입 | 밸런스가 설명 불가능해진다 |
| v1 BACKLOG 항목 선제 구현 | [CORE_LOOP.md](CORE_LOOP.md) 8절 참고 |

---

## 3. 밸런스를 건드릴 때

밸런스 변경은 **항상 측정과 함께** 커밋한다.

```
1. BALANCE 상수 수정
2. node tools/sim.js --minutes=5 / --minutes=30 / --hours=24
3. 지표 diff 확인
4. tests/balance.test.js 통과 확인
5. 커밋 메시지에 지표 변화 요약
```

감으로 상수를 더듬지 말 것 — `node tools/tune.js --top=5` 가 조합을 그리드 서치해
목표 지표 이탈도를 점수화한다(120조합 11.6초). 나온 값을 `engine/balance.js` 에
반영할지는 사람이 판단한다.

**커밋 메시지 예시**

```
Slow early gold curve to widen the first boss wall

goldGrowth 1.16 → 1.14
  첫 보스 돌파  1m52s → 2m21s
  최장 벽       1m40s → 3m05s
  유휴 비율     8% → 12%
```

지표가 실패하면 **상수를 고친다.** 허용 범위를 넓히는 것은 "범위 자체가 틀렸다"는
근거가 있을 때만이고, 그 근거를 커밋 메시지에 남긴다.
범위를 조용히 넓혀 테스트를 통과시키는 것은 이 프로젝트에서 가장 해로운 행동이다.

---

## 4. 게이트 판정

| 게이트 | 판정 주체 |
|---|---|
| P0 (24h 시뮬 완주, 지표 8종 출력) | **에이전트 자동 판정 가능** |
| P1 (5분 후 한 번 더 강화하고 싶은가) | **사람만 판정 가능** |
| P2 (편성이 정답 하나로 수렴하지 않는가) | 시뮬로 후보 압축 + 사람 확인 |
| P3~P5 | 사람 확인 |

**P1 게이트에 도달하면 작업을 멈추고 사람에게 확인을 요청한다.**
지표가 전부 초록이어도 자동으로 P2를 시작하지 않는다.

---

## 5. 커밋 규칙

- 한 변경 = 한 커밋. 밸런스 변경과 기능 추가를 한 커밋에 섞지 않는다
- `main`에서 직접 작업하고 커밋한다 (별도 브랜치를 만들지 않는다)
- 커밋 전 `node tests/balance.test.js` 통과 확인
- 에셋 생성은 `imagegen` 스킬에 위탁한다 (직접 그리지 않는다)

---

## 6. 파일 구조

```
games/mallang-idle/
  CORE_LOOP.md          게임 정의와 루프
  BALANCE.md            공식·상수·지표
  ROADMAP.md            단계와 게이트
  AGENT_PROTOCOL.md     이 문서
  NEXT_STEPS.md         현재 상태 · 다음 작업 (매 세션 갱신)

  engine/
    balance.js          모든 계수의 단일 원천
    combat.js           순수 결정론 전투/성장 모델
    save.js             version + migrateSave (마이그레이션 테스트는 balance.test.js 에)
    dungeon.js          별빛 시련 — 결정론 보스 러시
    rng.js              seeded RNG
  data/
    chapters.js         스테이지 구간 → 테마/적/배경 (7챕터)
    characters.js       말랑프렌즈 6명 — 해금·슬롯·파티 보너스
    quests.js           일일 과제
    story.js            컷신·합류·보스 도발 (무결성 테스트가 화자-해금 정합 강제)
  render/               표현 계층 — 엔진을 읽기만 한다 (COMBAT_STAGE_OVERHAUL.md)
    queue.js            연출 이벤트 버퍼 — 엔진의 순간 확정과 화면 페이스를 분리
    stage.js            전투 무대 씬 렌더러 (시차·액터·카메라·캔버스 파티클)
  tools/
    sim.js              헤드리스 시뮬레이터 (+ --sessions=15/120 오프라인 세션 모델)
    tune.js             파라미터 그리드 서치
  tests/
    balance.test.js     지표 회귀 + 엔진 불변조건 + 세이브 마이그레이션 + 스토리 무결성
    ui-contract.test.js  [hidden] 가드·시작 게이트·에셋 존재·FX 상한·Math.random 계층·큐 배선
    queue.test.js        연출 버퍼: 사건 유실 0 + 배속/버스트 따라잡기 (실제 엔진으로 구동)
    browser-harness.js   무의존 헤드리스 CDP 하니스 (screenshot·추가 기동 인자 지원)
    first-visit.browser.test.js  실브라우저: 신규 방문 플로우 (computed style·실좌표)
    multi-tab.browser.test.js    실브라우저: 멀티탭 정지→이어하기
    stage.browser.test.js        실브라우저: 무대-엔진 동기·유실 0·감속 모드
  index.html  game.js  style.css  audio.js  assets/
```

**모듈 패턴** — 이 저장소는 무빌드 정적 사이트다. `games/mallang-starlight/engine/puzzle.js`의
UMD 패턴을 따라 브라우저와 Node에서 같은 파일을 쓴다.

```js
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MallangIdle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () { ... });
```

---

## 7. 검증

- 정적 테스트: `node games/mallang-idle/tests/balance.test.js` · `ui-contract.test.js` ·
  `queue.test.js`
- 실브라우저 테스트: `node games/mallang-idle/tests/first-visit.browser.test.js` ·
  `multi-tab.browser.test.js` · `stage.browser.test.js`
  (헤드리스 Chrome/Edge + CDP, 브라우저 없으면 SKIP). 리눅스·컨테이너에서는 배포판 경로를
  자동 탐색하고 root 일 때 `--no-sandbox` 를 붙인다 — `CHROME_PATH` 로 직접 지정도 가능
- 시각 스모크: browser-harness 의 `pg.screenshot()` — 스테이지 점프 + storySeen
  선채움으로 신규 챕터를 촬영해 눈으로 확인 (8차 scratchpad visual_smoke.js 원형)
- 로컬 정적 서버: `.claude/launch.json`의 `static` 설정 (포트 8090)
- 시각 검증의 최종 판정은 사람이 한다. 스크린샷으로 "재미있다"를 판정하지 않는다

**브라우저에서 게임이 안 굴러가는 것처럼 보일 때** — 헤드리스나 백그라운드 탭에서는
`requestAnimationFrame` 이 정지하므로 게임 시간이 흐르지 않는다. 코드 버그가 아니다.
`?dev=1` 로 열고 `window.__mallangIdle` 훅을 쓰면 창을 띄우지 않고 검증할 수 있다.

**숨은 창에서는 CSS transition/animation 이 얼어붙는다** — 컴포지팅이 없으면
전이가 시작값에서 멈춘 채 computed style 을 돌려준다. 위치·전이 검증은
`el.style.transition='none'` 으로 끄고 목표값을 직접 읽어라. (교전 대형 캘리브레이션에서
"CSS 가 적용 안 된다"는 오진으로 30분을 태울 뻔했다.)

**표시/숨김 검증은 반드시 computed style 로** — `el.hidden` 속성값과
프로그램적 `el.click()` 만으로 검증하면 "hidden 인데 화면에 보이는" 결함을 놓친다.
`hidden` 속성은 UA 의 `display:none` 으로만 숨기므로, 클래스가 `display:flex` 를 주면
그게 이긴다. 실제로 인트로 오버레이가 시작하기를 눌러도 안 사라지는 사고가 배포에서
발견됐다(자동화는 전부 통과했는데). 가드는 style.css 최상단
`[hidden] { display:none !important; }` — 지우지 말 것. 오버레이·모달 검증은
`getComputedStyle().display` 와 `document.elementFromPoint()` 기반 좌표 클릭으로 한다.

```js
var H = window.__mallangIdle;
H.advance(60);        // 60초를 밀고 렌더까지 갱신
H.state.stage;        // 결과 확인
```

---

## 8. 이 프로젝트의 한 문장

> 가장 큰 리스크는 구현 난이도가 아니라 **성장 곡선이 재미없어지는 것**이다.
> 새로운 시스템을 추가하기 전에 현재 루프의 숫자와 플레이 리듬을 먼저 검증하라.
> 장비·펫·스킬·환생·서버·광장 연동은 코어 루프가 재미있다는 **증거가 생긴 뒤** 추가한다.
