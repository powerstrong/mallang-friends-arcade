# 서버 권위형 게임 클라이언트 템플릿

> **이 폴더는 "선착순 버튼"(`example-first-button`) 클라이언트 레퍼런스입니다.**  
> 새 서버 권위형 게임을 만들려면 이 폴더를 복사해서 시작하세요.

---

## 서버 권위형(Server-Authoritative)이란?

| 구분 | 릴레이(relay) | 서버 권위형(server-authoritative) |
|------|--------------|-----------------------------------|
| 게임 로직 위치 | 클라이언트(방장) | 서버 모듈 |
| 승패·점수 판정 | 클라이언트 | **서버** |
| 결과 위조 가능? | 가능 (클라 조작) | **불가** |
| 서버 코드 필요? | 없음 | **필요** (관리자 리뷰 필수) |
| 적합한 게임 | 캐주얼·파티 게임 | 공정성이 중요한 대결 게임 |

릴레이 방식은 클라이언트가 게임 결과를 직접 결정하기 때문에 조작이 가능합니다.  
서버 권위형은 **서버 모듈이 상태를 소유**하고 결과를 브로드캐스트하므로 클라이언트가 위조할 수 없습니다.

---

## 새 서버 권위형 게임 추가 절차

> **중요: worker/ 변경이 포함되므로 관리자 리뷰가 필수입니다.**  
> 관리자와 GitHub 이슈에서 먼저 상의하세요.

### 1단계 — 서버 모듈 작성

`worker/src/games/<game-id>.js` 파일을 작성합니다.  
인터페이스와 `ctx` API는 `worker/src/games/example_server_game.js` 를 참고하세요.

```js
// worker/src/games/my-game.js
export const myGame = {
  id: 'my-game',   // game-id: 소문자·숫자·하이픈만

  onJoin(ctx, ws, msg) { /* 참가자 합류 */ },
  onMessage(ctx, ws, payload) { /* 클라의 mod payload 수신 */ },
  onLeave(ctx, player) { /* 참가자 이탈 */ },
};
```

서버 모듈 상세 명세 → **[docs/SERVER_GAMES.md](../../../docs/SERVER_GAMES.md)**

### 2단계 — gameModules.js 등록

`worker/src/gameModules.js` 에 import 후 MODULES 배열에 추가합니다.

```js
import { myGame } from './games/my-game.js';
const MODULES = [ exampleServerGame, myGame ];  // 추가
```

**예약된 id(등록 금지)**: `jump-climber`, `sseuk-sseuk`

### 3단계 — 클라이언트 작성

이 템플릿 폴더를 복사합니다.

```bash
cp -r games/_template-server games/<game-id>
```

`game.js` 상단의 `GAME_ID` 를 새 game-id 로 바꾸고,  
`handleModEvent()` 에서 새 서버 이벤트를 처리하세요.  
`✏️ AI 수정 포인트` 주석을 검색하면 수정할 위치를 빠르게 찾을 수 있습니다.

### 4단계 — registry 에 DRAFT 등록

`games/registry.js` 에 항목을 추가합니다 (`status: 'DRAFT'` 유지).

### 5단계 — PR 열기

worker/ 변경이 포함되므로 반드시 관리자 리뷰를 거쳐야 합니다.  
PR 에 다음 정보를 포함하세요:
- 게임 설명 및 mod 프로토콜 요약
- 서버 모듈 로직 설명 (상태 관리, 이벤트 목록)
- 로컬 dev 서버(`wrangler dev`)에서 테스트한 결과

---

## game-id 규칙

```
^[a-z0-9]+(-[a-z0-9]+)*$
```

좋은 예: `speed-tap`, `color-match3`, `countdown-rush`  
나쁜 예: `SpeedTap`, `speed_tap`, `빠른탭`

---

## ?code= 두 탭 테스트법

로컬 dev 서버(`cd worker && npm run dev`)를 실행한 상태에서:

1. 탭 A: `http://localhost:8787/games/_template-server/index.html` → 방 코드 확인 (예: `ABC123`)
2. 탭 B: `http://localhost:8787/games/_template-server/index.html?code=ABC123` → 같은 방 합류
3. 탭 A에서 "라운드 시작(Arm)" 클릭 → 두 탭 모두 플레이 화면으로 전환
4. 두 탭 중 먼저 "탭!" 클릭한 탭의 이름이 **서버 판정으로** 승자로 표시되는지 확인

서버 권위형이므로 두 탭이 동시에 클릭해도 서버가 도착 순서를 결정합니다.

---

## registry 등록은 DRAFT로

신규 기여는 반드시 아래 값을 그대로 유지하세요. 관리자가 검토 후 변경합니다.

```js
status: 'DRAFT',
visibility: 'DIRECT_ONLY',
reviewState: 'NOT_SUBMITTED',
```
