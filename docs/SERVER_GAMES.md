# 서버 권위형 게임 모듈 레퍼런스

> 서버 권위형 게임은 게임 로직이 서버 모듈에 있어 클라이언트가 결과를 위조할 수 없습니다.  
> **worker/ 변경이 포함되므로 관리자 리뷰가 필수입니다.**

---

## 릴레이 vs 서버 권위형 선택 가이드

| 상황 | 추천 방식 |
|------|-----------|
| 캐주얼·파티 게임, 공정성보다 재미 우선 | 릴레이 (`games/_template-realtime`) |
| 점수·승패 조작 방지가 필요한 대결 게임 | **서버 권위형** (`games/_template-server`) |
| 서버 영속 데이터(리더보드·기록) 필요 | 서버 권위형 + `ctx.storage` |
| worker/ 코드를 건드리고 싶지 않음 | 릴레이 |
| 관리자 리뷰 없이 PR 합치고 싶음 | 릴레이 |

릴레이 방식 상세 → [docs/RELAY.md](./RELAY.md)

---

## 아키텍처 개요

```
클라이언트                          서버(GameRoom DO)
─────────────────                  ──────────────────────────────────
WS 연결
→ {type:'join', name, playerId?}
                                   ← {type:'welcome', playerId}
→ {type:'join_game', gameId, ...}
                                   gameId가 SERVER_GAME_MODULES에 있으면
                                   모듈.onJoin(ctx, ws, msg) 호출
→ {type:'mod', payload:{...}}
                                   모듈.onMessage(ctx, ws, payload) 호출
                                   ← ctx.broadcast({type:'mod', event, ...})
```

핵심 GameRoom의 거대 switch를 건드리지 않고, 모듈이 join/message/leave 이벤트를 독립적으로 처리합니다.

---

## 모듈 인터페이스

`worker/src/games/<id>.js` 에 아래 형태로 export 합니다.

```js
export const myGame = {
  // game-id — gameModules.js 등록 키, 클라의 join_game.gameId 와 일치해야 함
  id: 'my-game',

  // 참가자 합류 — ws.deserializeAttachment() 로 {id, name} 읽기 가능
  onJoin(ctx, ws, msg) {
    const me = ws.deserializeAttachment();
    ctx.sendTo(ws, { type: 'mod', event: 'joined', you: me.id });
    ctx.broadcast({ type: 'mod', event: 'roster', roster: ctx.roster() });
  },

  // 클라가 {type:'mod', payload} 를 보낼 때마다 호출 — payload 가 이 함수에 전달됨
  onMessage(ctx, ws, payload) {
    const me = ws.deserializeAttachment();
    if (payload.action === 'some-action') {
      // 상태 변경은 반드시 여기서(서버에서). 클라에서 직접 바꾸지 말 것.
      ctx.state.someField = true;
      ctx.broadcast({ type: 'mod', event: 'some-event', data: ctx.state.someField });
    }
  },

  // 참가자 이탈
  onLeave(ctx, player) {
    ctx.broadcast({ type: 'mod', event: 'roster', roster: ctx.roster() });
  },
};
```

---

## ctx API

GameRoom이 모듈 함수 호출 시 주입하는 컨텍스트 객체입니다.

| 프로퍼티/메서드 | 타입 | 설명 |
|----------------|------|------|
| `ctx.gameId` | `string` | 이 모듈의 game-id |
| `ctx.state` | `object` | 이 게임의 in-memory 상태. 모듈이 자유롭게 읽고 씀. DO 재시작 시 초기화됨. |
| `ctx.storage` | DO Storage | 영속 저장이 필요할 때. `await ctx.storage.put(key, val)` / `get(key)` |
| `ctx.sessions()` | `[{ws, player}]` | 이 게임에 join_game 한 세션 목록 |
| `ctx.roster()` | `[{id, name}]` | 현재 참가자 id·name 배열 |
| `ctx.broadcast(msg)` | `void` | 같은 게임 모든 세션에 JSON 전송 |
| `ctx.sendTo(ws, msg)` | `void` | 특정 세션(ws)에만 JSON 전송 |

`ctx.state` 는 객체 참조이므로 직접 필드를 추가/변경하면 됩니다.  
초기화가 필요하면 `onJoin` 에서 `ctx.state.myField === undefined` 를 체크하세요.

---

## mod 메시지 프로토콜

### 클라이언트 → 서버

```js
// 모든 게임 액션은 이 형식으로 전송
ws.send(JSON.stringify({ type: 'mod', payload: { action: 'some-action', ...params } }));
```

`payload` 는 `onMessage(ctx, ws, payload)` 의 세 번째 인자로 전달됩니다.

### 서버 → 클라이언트

```js
// 관례: { type: 'mod', event: '<이벤트명>', ...추가필드 }
ctx.broadcast({ type: 'mod', event: 'result', winnerId: '...' });
ctx.sendTo(ws, { type: 'mod', event: 'joined', you: me.id });
```

`event` 필드 이름은 모듈이 자유롭게 정의합니다.

---

## 서버 캡 (제한)

| 항목 | 제한 |
|------|------|
| payload 크기 | **8,192 바이트** 이하 |
| 연결당 전송 속도 | **초당 40 메시지** 이하 |

고빈도 이벤트(위치 동기화 등)는 throttle을 적용하세요.

---

## 새 서버 게임 추가 절차

1. `worker/src/games/<id>.js` 작성 — 위 모듈 인터페이스 참고
2. `worker/src/gameModules.js` 에 import 후 `MODULES` 배열에 추가
3. `games/_template-server/` 복사 → `games/<id>/` — 클라이언트 작성
4. `games/registry.js` 에 `status:'DRAFT'` 항목 추가
5. **PR 오픈 — worker/ 변경 포함이므로 관리자 리뷰 필수**

상세 절차 → [docs/ADD_GAME.md](./ADD_GAME.md)

---

## 예약 game-id (등록 금지)

아래 id는 코어 GameRoom switch에서 직접 처리하므로 모듈로 등록하면 오류가 발생합니다.

- `jump-climber`
- `mallang-quiz-battle`
- `sseuk-sseuk`

---

## 레퍼런스 구현

`worker/src/games/example_server_game.js` — "선착순 버튼" (`example-first-button`)

- 모듈 인터페이스 전체 예시
- `ctx` 사용법 (state, broadcast, sendTo, roster)
- arm/claim 프로토콜로 서버 권위 판정 데모
- 파일 상단 주석에 인터페이스 전체 명세 포함

클라이언트 레퍼런스 → `games/_template-server/`
