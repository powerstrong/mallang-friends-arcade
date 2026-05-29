# 릴레이(중계) 멀티플레이 레퍼런스

말랑프렌즈 아케이드의 **릴레이 멀티플레이**는 서버가 게임 로직 없이 메시지를 중계만 하는 구조입니다.  
기여자는 서버 코드를 한 줄도 작성하지 않고, `shared/relay.js` 의 `MallangRelay` SDK 만으로 실시간 멀티플레이 게임을 만들 수 있습니다.

---

## 릴레이란?

```
플레이어 A ──→ 서버 ──→ 플레이어 B
              (중계만)
플레이어 B ──→ 서버 ──→ 플레이어 A
```

- 서버는 같은 방(roomCode) + 같은 gameId 참가자끼리 메시지를 **그대로 전달**합니다.
- 승패 판정·점수·충돌 처리 등 **게임 로직은 전적으로 클라이언트**에 있습니다.
- 서버 권위가 없으므로 치팅 방지는 되지 않습니다. 이 한계를 이해한 뒤 사용하세요.

---

## 언제 쓰나

| 상황 | 릴레이 적합 여부 |
|------|----------------|
| 협동 퍼즐·협동 드로잉 | 적합 |
| 턴제 보드게임·퀴즈 | 적합 (호스트 클라이언트가 권위) |
| 캐주얼 레이싱·타이밍 게임 | 적합 (순위 조작 위험 감수 가능) |
| 점수 조작 방지가 필수인 리더보드 게임 | 부적합 — 관리자와 상의 |
| 서버가 정합성을 보장해야 하는 게임 | 부적합 — 관리자와 상의 |

---

## 메시지 프로토콜

### 클라이언트 → 서버

| type | 필드 | 설명 |
|------|------|------|
| `join` | `name`, `playerId?` | 로비 입장 (SDK가 자동 처리) |
| `join_game` | `gameId`, `mode:'relay'`, `playerId`, `name`, `characterId?` | 릴레이 게임 세션 합류 (SDK가 자동 처리) |
| `relay` | `payload`, `echo?` | 같은 게임 세션의 다른 참가자에게 전송. `echo:true` 면 자신도 수신 |

### 서버 → 클라이언트

| type | 필드 | 설명 |
|------|------|------|
| `welcome` | `playerId`, ... | 로비 합류 완료. 서버가 부여한 플레이어 ID |
| `relay_joined` | `playerId`, `players:[{id,name,characterId}]` | 릴레이 게임 세션 합류 완료 |
| `relay_presence` | `players:[{id,name,characterId}]` | 참가자 합류/이탈 시 전체에게 브로드캐스트 |
| `relay` | `from`, `payload`, `ts` | 다른 참가자가 보낸 메시지. `from` 은 발신자 playerId |
| `error` | `message` | 오류 |

> SDK를 사용하면 `join`·`join_game` 은 자동으로 처리됩니다. 게임 코드에서 직접 보낼 필요가 없습니다.

---

## 서버 제약(캡)

| 항목 | 한도 |
|------|------|
| payload 직렬화 크기 | **8,192 바이트** 이하 |
| 연결당 전송 속도 | **초당 40 메시지** (초과분은 조용히 드롭) |
| 서버 권위 | 없음 (치팅 방지 안 됨) |

payload가 8 KB를 넘으면 서버가 해당 메시지를 무시합니다. 위치·상태 등 간단한 데이터만 담으세요.

---

## 방 코드 모델

- URL에 `?code=XXXX` 가 있으면 **기존 방에 합류**합니다.
- `?code` 가 없으면 SDK가 **새 방을 생성**하고 `relay.code` 로 코드를 제공합니다.
- 방 코드를 `?code=XXXX` URL 형태로 친구에게 공유하면 함께 플레이할 수 있습니다.

```js
// 방장: 새 방 생성
await relay.ready;
const shareUrl = location.origin + location.pathname + '?code=' + relay.code;
// → 이 URL을 친구에게 전달

// 참가자: URL에 ?code=XXXX 포함해서 접속하면 자동으로 같은 방으로 합류
```

---

## MallangRelay SDK API

`shared/relay.js` 를 `<script src>` 로 로드하면 `window.MallangRelay` 가 노출됩니다.

### 초기화

```js
const relay = MallangRelay.create({
  gameId: 'my-game',       // 필수. games/registry.js 의 id 와 일치시킬 것
  name: '토끼',             // 선택. 없으면 GameBoot.name 사용
  characterId: 'rabbit',   // 선택
  code: 'XXXX',            // 선택. 없으면 URL ?code= 또는 새 방 자동 생성
});
```

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `relay.ready` | `Promise` | 릴레이 합류가 완료되면 resolve. `await relay.ready` 로 대기 |
| `relay.playerId` | `string` | 서버가 부여한 내 플레이어 ID |
| `relay.code` | `string` | 방 코드. `await relay.ready` 이후 확정 |
| `relay.players()` | `function` | 현재 참가자 목록 배열 반환. 변경 시에도 최신 상태 |

### 이벤트

```js
relay.on('ready',   handle => { /* 합류 완료. relay.playerId, relay.code 사용 가능 */ });
relay.on('players', list   => { /* 참가자 목록 변경 시. list = [{id, name, characterId}] */ });
relay.on('message', ({ from, payload, ts }) => { /* 다른 참가자 메시지 수신 */ });
relay.on('open',    ()     => { /* WebSocket 연결 */ });
relay.on('close',   ()     => { /* WebSocket 종료 */ });
relay.on('error',   err    => { /* 오류 */ });
```

### 메서드

```js
relay.send(payload, { echo: false });
// payload: 직렬화 가능한 객체. 8 KB 이하 유지.
// echo: true 이면 자신도 수신 (기본 false).
// 반환: 전송 성공 여부 (boolean)

relay.leave();
// WebSocket을 닫고 방에서 나감
```

---

## 최소 코드 예시

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>내 릴레이 게임</title>
</head>
<body>
  <div id="status">연결 중...</div>
  <div id="players"></div>
  <button id="sendBtn">위치 공유</button>

  <script src="/shared/config.js"></script>
  <script src="/shared/bootstrap.js"></script>
  <script src="/shared/relay.js"></script>
  <script>
    const relay = MallangRelay.create({ gameId: 'my-game' });

    relay.on('players', list => {
      document.getElementById('players').textContent =
        '참가자: ' + list.map(p => p.name).join(', ');
    });

    relay.on('message', ({ from, payload }) => {
      console.log(from + '의 위치:', payload.x, payload.y);
    });

    relay.ready.then(() => {
      document.getElementById('status').textContent =
        '방 코드: ' + relay.code + ' | 내 ID: ' + relay.playerId;
    });

    document.getElementById('sendBtn').addEventListener('click', () => {
      relay.send({ x: Math.random() * 100, y: Math.random() * 100 });
    });
  </script>
</body>
</html>
```

---

## 템플릿 복사 안내

실시간 멀티플레이 게임은 `games/_template-realtime/` 을 출발점으로 사용하세요.

```bash
# 예시: game-id = tap-sync
cp -r games/_template-realtime games/tap-sync
```

Windows라면 탐색기에서 `games/_template-realtime` 폴더를 통째로 복사해서  
`games/tap-sync` 로 이름을 바꾸면 됩니다.

이후 개발 절차는 [docs/ADD_GAME.md](./ADD_GAME.md) 를 참고하세요.

---

## 한계 및 주의사항

- **치팅 방지 없음**: 서버는 메시지를 그대로 중계할 뿐, 내용을 검증하지 않습니다. 악의적인 사용자가 payload를 조작할 수 있습니다.
- **신뢰 모델**: 점수 집계·승패 판정은 클라이언트 중 한 명(보통 방장)이 맡고, 나머지는 그 결과를 신뢰하는 구조입니다.
- **연결 안정성**: WebSocket이 끊기면 재연결되지 않습니다. 게임 로직에서 `close` 이벤트를 처리하세요.
- **속도 제한**: 초당 40 메시지를 초과하면 메시지가 드롭됩니다. 위치 동기화 등 고빈도 전송은 throttle을 적용하세요.
- **프리뷰 환경**: 릴레이 게임은 prod 릴레이 엔드포인트를 사용하므로 Cloudflare Pages 브랜치/PR 프리뷰만으로 완전히 플레이·검증할 수 있습니다. 자세한 내용은 [docs/PREVIEW.md](./PREVIEW.md) 참고.
