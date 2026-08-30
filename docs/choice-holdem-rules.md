# 초이스 홀덤(Choice Hold'em) 규칙 · 엔진 명세

2인용 포커. 구현체는 `worker/src/games/choice_holdem_engine.js`(순수 함수),
테스트는 `worker/tests/choice-holdem-engine.test.mjs`.

---

## 1. 핵심

최종 패는 **공용 3장 + 개인 2장 = 정확히 5장**이다. 텍사스 홀덤처럼 7장 중 5장을 고르지 않는다.

개인 2장 중 두 번째 장이 이 게임의 전부다.

1. Choice 카드 2장이 나온다. **선플레이어만 두 장을 모두 본다.**
2. 선플레이어가 **한 장만 앞면으로 공개**한다.
3. 후플레이어가 **[공개된 카드] vs [숫자를 모르는 카드]** 중 하나를 고른다.
4. 후플레이어가 고르지 않은 나머지 한 장이 선플레이어에게 귀속된다.

선플레이어는 좋은 카드를 일부러 공개할 수도, 나쁜 카드를 공개해 상대를 뒷면으로 유도할 수도 있다.
이 정보 비대칭이 게임의 중심이므로 UI 에서도 "공개 카드 vs 미지의 카드" 선택을 가장 크게 보여준다.

---

## 2. 덱과 칩

| 항목 | 값 |
|------|-----|
| 덱 | 숫자 1~5, 각 4장 = **20장** |
| 문양(suit) | **없음** — 플러시·스트레이트 플러시 계열 족보도 없음 |
| 시작 칩 | 1인 **20칩** (게임 내 총량 40칩) |
| 게임 종료 | 한쪽 칩이 0이 되면 상대 승리 |
| 한 라운드 사용 카드 | 공용 3 + 개인 1×2 + Choice 2 = **7장** |

기본 베팅(앤티)은 양쪽이 매 라운드 똑같이 낸다. 라운드가 진행될수록 오른다.

```
baseBet = 1 + Math.floor((round - 1) / 10)
// 1~10R → 1칩, 11~20R → 2칩, 21~30R → 3칩 …
```

칩이 기본 베팅보다 적으면 남은 칩만 내고(올인), 불균등한 초과분은 반환한다.

---

## 3. 라운드 진행

```
ROUND_START → BASE_BET → DEAL(공용 3 + 개인 1) → BETTING_1
  → CHOICE_REVEAL → CHOICE_SELECT → BETTING_2 → SHOWDOWN → SETTLEMENT → NEXT_ROUND
```

- 선플레이어는 **라운드마다 교대**한다(홀수 라운드 = 첫 참가자).
- **1차·2차 베팅 모두 선플레이어가 먼저 액션한다.**
- 어느 베팅 단계에서든 폴드하면 쇼다운 없이 즉시 라운드가 끝나고 상대가 팟을 가져간다.
  폴드한 쪽의 개인 카드는 공개하지 않는다.
- 한쪽이 올인이라 더 베팅할 수 없으면 해당 베팅 단계는 건너뛴다(Choice 단계는 그대로 진행).

### 베팅

| 액션 | 규칙 |
|------|------|
| CHECK | 콜할 금액이 0일 때만 |
| BET | 1칩 이상, 보유 칩 이내. 상한 없음 |
| CALL | 콜할 금액이 있을 때만. 칩이 모자라면 남은 칩 전부(올인 콜) |
| RAISE | **한 베팅 단계에서 1회만.** `amount` 는 그 단계의 총 베팅액(raise-to) — 예: 상대 BET 3 → RAISE 7 |
| FOLD | 언제나 가능 |
| ALL_IN | 상황에 따라 BET / CALL / RAISE 로 해석. 레이즈가 이미 쓰였고 콜 이상이면 거부 |

콜되지 않은 초과 베팅은 항상 베팅한 쪽에 반환된다.

---

## 4. 족보

높은 순서. 숫자가 1~5뿐이라 "5장이 모두 다른 숫자"는 1·2·3·4·5 스트레이트뿐이고,
따라서 하이카드 족보는 존재할 수 없다(아래 6종이 전부).

| 족보 | 비교 순서 |
|------|-----------|
| 포카드 | 4장 숫자 → 나머지 1장 |
| 풀하우스 | 트리플 숫자 → 페어 숫자 |
| 스트레이트 | 1·2·3·4·5 하나뿐 — 서로 항상 동점 |
| 트리플 | 트리플 숫자 → 키커 2장(높은 순) |
| 투페어 | 높은 페어 → 낮은 페어 → 나머지 |
| 원페어 | 페어 숫자 → 나머지 3장(높은 순) |

**완전 동점**이면 팟을 나누지 않고 전액을 다음 라운드로 **이월**한다(`carryPot`).
예: 7R 팟 10 동점 → 8R 은 이월 10 + 앤티 2 = 12에서 시작.

---

## 5. 히든 정보 (서버 권위)

클라이언트로 나가는 상태는 **반드시 `viewFor(state, viewerId)` 를 거친다.**
UI 에서만 가리는 방식은 개발자 도구로 뚫리므로 금지.

| 카드 | 선플레이어 | 후플레이어 |
|------|-----------|-----------|
| Choice 2장 (공개 전) | 둘 다 숫자 보임 | **둘 다 `rank: null`** |
| Choice 공개 후 | 둘 다 보임 | 공개 카드만 숫자, 뒷면은 `rank: null` |
| 상대 개인 카드 | 쇼다운 전까지 `rank: null` | 쇼다운 전까지 `rank: null` |
| 앞면 공개된 Choice 카드 | 누구 손에 들어가든 모두에게 공개 | 〃 |
| 남은 덱 | 뷰에 포함되지 않음 | 〃 |

폴드로 끝난 라운드는 쇼다운이 아니므로 어느 카드도 공개하지 않는다.

서버가 검증하는 항목: 차례 여부 · 보유 칩 초과 · 레이즈 1회 제한 ·
REVEAL 은 선플레이어만 · SELECT 는 후플레이어만 · 카드 id 가 실제 Choice 카드인지.

---

## 6. 엔진 API

```js
import { createGame, applyAction, viewFor, legalActions, ACTION, PHASE }
  from '../src/games/choice_holdem_engine.js';

let state = createGame({ players: [{ id: 'a', name: '앨리스' }, { id: 'b', name: '밥' }], seed });

const { state: next, events, error } = applyAction(state, { type: ACTION.BET, playerId: 'a', amount: 3 });
if (error) reject(error.code);          // 상태는 그대로 — 거부
else { state = next; send(viewFor(state, 'a'), viewFor(state, 'b')); }
```

- `applyAction` 은 입력 state 를 변형하지 않고 새 state 를 돌려준다.
- 난수는 `state.rngState`(mulberry32)로만 진행 — 같은 seed·같은 액션열이면 결과가 항상 같다(리플레이·재현 가능).
- 엔진이 멈추는 phase 는 입력이 필요한 지점뿐이다:
  `WAITING · BETTING_1 · CHOICE_REVEAL · CHOICE_SELECT · BETTING_2 · SETTLEMENT · GAME_OVER`.
  나머지 단계(ROUND_START·BASE_BET·DEAL·SHOWDOWN)는 `events` 로만 남는다.
- `legalActions(state, playerId)` 가 UI·AI·서버 검증이 공유하는 단일 기준이다.
- 테스트는 `stackedDecks: [[공용3, 선개인1, 후개인1, Choice2], …]` 로 라운드별 덱 앞부분을 고정한다.

---

## 7. 미확정 규칙

**매 라운드 20장을 완전히 다시 섞는가?** — 방송 규칙 미확인.
초기 구현은 `deckResetMode: 'EVERY_ROUND'`(매 라운드 새 덱)로 가정하며,
`createGame({ config: { deckResetMode } })` 로 설정을 분리해 두었다.
현재 엔진은 EVERY_ROUND 동작 하나만 구현되어 있으므로, 규칙이 확인되면 이 설정을 분기점으로 다른 모드를 추가한다.
