# 말랑프렌즈 키우기 — 현재 상태와 다음 작업

`mallang-idle` · 최종 갱신 2026-08-15

> 새 세션은 이 문서 → [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) 순으로 읽고 이어간다.

---

## 지금 어디까지 왔나

**P0 (하네스) 완료 · P1 (코어 루프) 1차 구현 완료 — 사람 게이트 판정 대기**

| 항목 | 상태 |
|---|---|
| 순수 결정론 엔진 `engine/combat.js` | 완료 — 이벤트 기반 step, dt 크기 무관 |
| BALANCE 단일 상수 `engine/balance.js` | 완료 |
| seeded RNG `engine/rng.js` | 완료 (현재 전투는 무작위 요소 없음, 향후 드랍용) |
| 세이브 `engine/save.js` | 완료 — version 1 + migrateSave + 상위버전 거부 |
| 챕터 데이터 `data/chapters.js` | 완료 — 들판/삐걱이는 언덕/기계군단 3챕터 |
| 헤드리스 시뮬 `tools/sim.js` | 완료 — 24h 시뮬 0.2초 |
| 그리드 서치 `tools/tune.js` | 완료 — 120조합 11.6초 |
| 지표 회귀 테스트 `tests/balance.test.js` | **15개 전부 통과** |
| 게임 화면 `index.html/game.js/style.css` | 완료 — 횡스크롤 자동 전진, 강화 3축 x1/x10/MAX |
| `?dev=1` 치트 패널 | 완료 — 골드/스테이지/오프라인/배속 x20/세이브 |
| 에셋 | 완료 — 챕터1 5종 신규 생성, 기계군단 5종 러너에서 재사용, 주인공 워크사이클 |
| 실험실 노출 | 완료 — `games/registry.js` 에 `stage:'LAB'` 등록 |

### 검증한 것

```bash
node games/mallang-idle/tests/balance.test.js    # 15 passed
node games/mallang-idle/tools/sim.js --minutes=5
node games/mallang-idle/tools/tune.js --top=5
node scripts/validate-games.js                   # registry 검증 통과
```

브라우저(로컬 정적 서버 8090, `?dev=1`)에서 확인한 것 — 콘솔 에러 없음, 적 이미지 로드,
강화 즉시 DPS 반영(10 → 11.2), 60초 진행에 8스테이지 돌파 + 보스 실패 2회(벽이 실제로 생김).

---

## 바로 다음에 할 일

### 1. P1 게이트 판정 (사람만 가능) ★ 최우선
> **5분 플레이하고 나서 한 번 더 강화하고 싶어지는가.**

실험실(🧪) → 말랑프렌즈 키우기 카드로 진입해서 직접 5분 플레이한다.
이 판정 전에는 P2(편성)를 시작하지 않는다.

판정이 "재미없다"면 고칠 후보는 이 순서다.
1. `BALANCE.bossHpMultiplier` / `bossTimeLimit` — 보스가 관문으로 느껴지는가
2. `advanceSeconds` / `mobsPerStage` — 한 스테이지의 호흡
3. 강화 체감 — `atkGrowth` 대비 `costGrowth.atk`

### 2. 남은 구현 (P1 마감용)

- [ ] **보스 자동 재도전 토글** — UI에서 일단 제거했다. 엔진에 "보스 앞 대기" 상태가
      없어서 체크박스가 아무 동작도 안 했기 때문. 넣으려면 `combat.js` 에 대기 페이즈를
      추가하고 시뮬 정책은 항상 자동으로 두면 된다.
- [ ] **골드 획득 연출** — 몹 처치 시 +골드 플로팅 텍스트. 지금은 숫자만 조용히 오른다.
- [ ] **첫 진입 안내** — 강화 버튼을 처음 누르게 만드는 유도 한 줄.
- [ ] **챕터 전용 배경** — `gears`/`machine` 챕터가 아직 들판 배경을 재사용한다
      (`data/chapters.js` 의 TODO(P5)).

### 3. 밸런스 후속

- [ ] 24시간 지점의 벽(현재 최장 45분)은 **P3 영구 성장축이 푸는 문제**로 정리했다.
      근거는 `tests/balance.test.js` 의 24시간 테스트 주석에 남아 있다.
      **P3 착수 시 그 기준을 3600 → 1200 으로 되돌리고** 새 성장축이 실제로 벽을
      무너뜨리는지 검증할 것.
- [ ] 여유비(`avgClearRatio`)가 30분~2시간 구간에서 1.5 근처다. 보스가 조금 더
      아슬아슬해도 좋다면 `bossHpMultiplier` 를 올려 재측정.

---

## 이 게임에서 조심할 것

- **엔진에 전투 로직을 두 벌 만들지 말 것.** `game.js` 는 렌더와 입력만 한다.
  시뮬레이터가 같은 `engine/combat.js` 를 쓰기 때문에 여기서 갈라지면 지표가 거짓말을 한다.
- **`Math.random()` 금지.** 무작위가 필요하면 `engine/rng.js` 를 주입한다.
- **지표 회귀 테스트의 허용 범위를 조용히 넓히지 말 것.** 먼저 BALANCE 상수를 고친다.
  범위를 바꿔야 한다면 근거를 테스트 주석과 커밋 메시지에 남긴다(이미 두 건의 선례가 있다).
- **`window.__mallangIdle`** (`?dev=1` 전용) — 헤드리스/백그라운드 탭에서는
  `requestAnimationFrame` 이 멈춰 게임이 진행되지 않는다. 이 훅의 `advance(초)` 로
  시간을 직접 밀어서 렌더 결과까지 검증할 수 있다.

---

## 관련 문서

- [CORE_LOOP.md](CORE_LOOP.md) — 게임 정의와 루프
- [BALANCE.md](BALANCE.md) — 공식·상수·지표
- [ROADMAP.md](ROADMAP.md) — 단계와 게이트
- [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) — 자동 개발 작업 규약
