# jump-climber 2P 밸런스: Tier 1 작업 계획

> 목표: snowball / runaway-leader 완화. 부스트 자원 고갈 + 격차 시각화.
> 절대 X: 1등 페널티, 노골적 러버밴드, 숫자 격차 HUD.
>
> Codex + Gemini 합의: "1등 끌어내리지 말고, 각자 먹게 + 친구 위치 귀엽게"

## 1-a. 부스트 픽업 per-player (A1+A2 절충)

서버(room.js)와 클라(game.js) 같이 변경 — protocol 일치 필요.

### 서버 (worker/src/room.js)
- [ ] boost 스키마에 `pickedBySlots: number[]` 추가 (Set 직렬화 불가하니 array)
- [ ] `worker/src/room.js:2045-2048` 부근 picked 처리:
  - 기존: `boosts = boosts.filter(b => !picked.has(b.id))` (전역 삭제)
  - 신규: 각 boost 의 `pickedBySlots` 에 sender slot 추가. 모든 활성 slot 이 다 먹었으면 (또는 N 일 동안 활성 player 가 다 먹었으면) 삭제. 1~2P 환경에선 "2명 다 먹으면 삭제" 단순화.
  - 단일 플레이어 (1P) 시엔 한 번 먹으면 즉시 삭제 (기존 동작 유지)
- [ ] world snapshot serialize 시 `pickedBySlots` 도 포함

### 클라 (prototypes/jump-climber/game.js)
- [ ] `pickedBoostIds: Set<string>` → `pickedBoostIds: Set<string>` 그대로. 의미가 "내 slot 이 먹은 것" 으로 변경 (서버가 인정한 것만 남기는 기존 로직 유지)
- [ ] `game.js:1122-1127` 렌더 필터: 내 slot 이 picked 인 boost 는 숨김. 다른 slot 만 picked 한 boost 는 "친구가 먹은 거" 시각으로 약하게 표시 (옅은 회색 또는 fade 0.4)
- [ ] `game.js:2230` (먹는 순간) — 동일하게 자기 set 에 add + `pickedBoostIds` 로 piggyback (서버는 sender slot 으로 인식)

### 시각 처리
- [ ] `style.css` 에 `.boost.is-friend-picked` 클래스: opacity 0.4, 채도 낮춤, label "✓" 또는 작은 발자취 아이콘

### 검증
- [ ] 1P 모드: 기존과 동일 동작 (한 번 먹으면 사라짐)
- [ ] 2P 모드: 한 명이 먹으면 그 사람한테만 사라짐, 다른 사람 화면엔 옅게 남음
- [ ] 두 명 다 먹으면 서버에서 완전 삭제

### Codex 리뷰 항목
- world snapshot 사이즈 영향 (boost 당 array 추가)
- 1P/2P 분기 처리
- pickedBoostIds 의 의미 변경이 다른 곳에 영향 없는지

## 1-b. 친구 진행 인디케이터 (클라 only)

### 화면 좌측 가장자리에 작은 친구 캐릭터 아이콘
- 위치: bestHeight 에 비례한 세로 위치 (자기 vs 친구)
- 크기: 작게 (24~32px)
- 자기 위치는 화살표 ▶ 또는 본인 아이콘
- 친구 위치는 캐릭터 portrait
- 차이가 클수록 화면 가장자리 표시, 가까우면 화면 안에 들어옴

### 구현
- [ ] HTML: `<div id="rivalGauge" class="rival-gauge"></div>` arena 안에 추가
- [ ] CSS: 세로 게이지, 위/아래 끝에 max/0
- [ ] JS: render loop 에서 자기/친구 bestHeight 읽어 위치 갱신
- [ ] 1P 모드에선 숨김 (다른 플레이어 없으니 무의미)
- [ ] 친구가 사망(alive=false) 시 회색 처리 또는 fade out

### Codex 리뷰 항목
- render loop 성능 영향
- 1P 모드 분기

## 진행 상태

### 1-a (부스트 per-player)
- [ ] 서버 스키마 + 핸들러 변경
- [ ] 클라 렌더 + 픽업 변경
- [ ] CSS 보강
- [ ] Codex 리뷰

### 1-b (친구 인디케이터)
- [ ] HTML + CSS 추가
- [ ] JS render 로직
- [ ] 1P 분기
- [ ] Codex 리뷰

### 마무리
- [ ] sw.js bump
- [ ] commit + push
