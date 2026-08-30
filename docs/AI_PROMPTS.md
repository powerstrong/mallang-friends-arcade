# AI 도구용 프롬프트

Claude Code·Codex·Cursor 등 AI 코딩 도구에 복붙해서 사용할 수 있는 프롬프트 모음입니다.

---

## 프롬프트 1 — 새 게임 만들기

```
저장소 루트: [저장소 경로]
game-id: [예: color-run]

말랑프렌즈 아케이드에 새 게임을 추가해 줘.
아래 제약을 반드시 지켜야 해.

[제약 — 절대 어기지 마]
- 작업 범위: games/<id>/ 폴더 안에서만. 다른 폴더는 읽기만 허용.
- 절대 수정 금지: worker/, world/, shared/, sw.js, 다른 게임 폴더(games/<other-id>/)
- games/registry.js 는 내 항목 1개만 추가. status:'DRAFT', visibility:'DIRECT_ONLY', reviewState:'NOT_SUBMITTED' 값 그대로 유지.
- 빌드 도구 금지: npm install, package.json, 번들러, 트랜스파일러 전부 금지.
- 외부 패키지 금지: CDN 스크립트 포함 금지. 순수 HTML/CSS/JavaScript 만 사용.
- 모바일 동작 필수: 세로 화면(portrait)에서 UI가 잘림 없이 표시되고, 터치 조작이 작동해야 함.
- 디버그 코드 금지: console.log, debugger, TODO, HACK 주석은 최종 코드에 남기지 마.

[시작점]
1. games/_template/ 폴더 내용을 읽어서 구조를 파악해.
2. games/<id>/ 폴더를 생성하고 index.html, game.js, style.css 를 작성해.
3. shared/bootstrap.js 의 window.GameBoot API를 사용해 결과를 제출하고 광장으로 복귀해.
4. games/registry.js 맨 끝에 DRAFT 항목을 추가해.

[게임 설명]
[여기에 만들고 싶은 게임 설명을 적어줘]
```

---

## 프롬프트 2 — 실시간 멀티플레이(릴레이) 게임 만들기

```
저장소 루트: [저장소 경로]
game-id: [예: tap-sync]

말랑프렌즈 아케이드에 실시간 멀티플레이 게임을 추가해 줘.
아래 제약을 반드시 지켜야 해.

[제약 — 절대 어기지 마]
- 작업 범위: games/<id>/ 폴더 안에서만. 다른 폴더는 읽기만 허용.
- 절대 수정 금지: worker/, world/, shared/, sw.js, 다른 게임 폴더(games/<other-id>/)
- games/registry.js 는 내 항목 1개만 추가. status:'DRAFT', visibility:'DIRECT_ONLY', reviewState:'NOT_SUBMITTED' 값 그대로 유지.
- 빌드 도구 금지: npm install, package.json, 번들러, 트랜스파일러 전부 금지.
- 외부 패키지 금지: CDN 스크립트 포함 금지. 순수 HTML/CSS/JavaScript 만 사용.
- 모바일 동작 필수: 세로 화면(portrait)에서 UI가 잘림 없이 표시되고, 터치 조작이 작동해야 함.
- 디버그 코드 금지: console.log, debugger, TODO, HACK 주석은 최종 코드에 남기지 마.
- 서버 권위 없음: 승패·점수 판정을 서버에 맡기지 마. 클라이언트(방장)가 처리해야 함.

[릴레이 SDK 사용 규칙]
- shared/relay.js 의 window.MallangRelay 를 반드시 사용해.
- index.html 에서 로드 순서: /shared/config.js → /shared/bootstrap.js → /shared/relay.js
- relay.send(payload) 의 payload 는 직렬화 시 8,192 바이트 이하.
- 고빈도 전송(위치 동기화 등)은 throttle 을 적용해 초당 40 메시지 이하로 유지해.
- relay.ready Promise 를 await 한 뒤에 relay.code, relay.playerId 를 사용해.
- 방 코드 공유: relay.code 를 ?code=XXXX URL 형태로 UI에 표시해.

[시작점]
1. games/_template-realtime/ 폴더 내용을 읽어서 구조를 파악해.
2. shared/relay.js 를 읽어서 MallangRelay API 를 확인해.
3. docs/RELAY.md 를 읽어서 프로토콜·제약을 확인해.
4. games/<id>/ 폴더를 생성하고 index.html, game.js, style.css 를 작성해.
5. games/registry.js 맨 끝에 DRAFT 항목을 추가해.

[게임 설명]
[여기에 만들고 싶은 게임 설명을 적어줘]
```

---

## 프롬프트 3 — 서버 권위형 게임 만들기

```
저장소 루트: [저장소 경로]
game-id: [예: speed-tap]

말랑프렌즈 아케이드에 서버 권위형(server-authoritative) 게임을 추가해 줘.
이 방식은 게임 로직이 서버에 있어 클라이언트가 결과를 위조할 수 없어.
worker/ 변경이 포함되므로 PR 후 관리자 리뷰가 반드시 필요해.

[제약 — 절대 어기지 마]
- 서버 모듈 작성 범위: worker/src/games/<id>.js 신규 파일 하나만.
- gameModules.js 등록: worker/src/gameModules.js 에 import + MODULES 배열 추가만.
- 코어 변경 금지: worker/src/index.js, worker/src/room.js, worker/src/world.js 등 기존 핵심 파일 수정 금지.
- 클라이언트 작업 범위: games/<id>/ 폴더 안에서만. shared/, world/ 수정 금지.
- 게임 id 중복 금지: jump-climber / sseuk-sseuk 는 예약 id — 절대 사용 금지.
- 빌드 도구 금지: npm install, package.json, 번들러, 트랜스파일러 전부 금지.
- 외부 패키지 금지: CDN 스크립트 포함 금지. 순수 HTML/CSS/JavaScript 만 사용.
- 모바일 동작 필수: 세로 화면(portrait)에서 UI가 잘림 없이 표시되고, 터치 조작이 작동해야 함.
- 디버그 코드 금지: console.log, debugger, TODO, HACK 주석은 최종 코드에 남기지 마.

[mod 프로토콜 규칙]
- 클라 → 서버: { type: 'mod', payload: { action: '...', ...params } }
- 서버 → 클라: ctx.broadcast / ctx.sendTo 로 { type: 'mod', event: '...', ...fields }
- payload 는 직렬화 시 8,192 바이트 이하.
- 초당 40 메시지 이하로 전송.
- 클라이언트가 직접 승자·점수를 결정하지 말 것 — 반드시 서버 이벤트를 기다릴 것.

[시작점]
1. worker/src/games/example_server_game.js 를 읽어서 모듈 인터페이스와 ctx API 를 파악해.
2. worker/src/gameModules.js 를 읽어서 등록 방법을 파악해.
3. docs/SERVER_GAMES.md 를 읽어서 ctx API·제약 전체를 파악해.
4. games/_template-server/ 폴더 내용을 읽어서 클라이언트 구조를 파악해.
5. worker/src/games/<id>.js 서버 모듈을 작성해.
6. worker/src/gameModules.js 에 import 와 배열 추가를 해.
7. games/<id>/ 폴더를 생성하고 index.html, game.js, style.css 를 작성해.
   game.js 의 GAME_ID 를 새 id 로 바꾸고, handleModEvent() 에서 새 이벤트를 처리해.
8. games/registry.js 맨 끝에 DRAFT 항목을 추가해.

[게임 설명]
[여기에 만들고 싶은 게임 설명을 적어줘. 서버가 판정해야 하는 규칙을 명확히 설명해줘]
```

---

## 프롬프트 4 — 기존 게임 버그 수정

```
저장소 루트: [저장소 경로]
수정할 게임: games/[game-id]/

아래 버그를 고쳐 줘.

[버그 설명]
[여기에 버그 상황을 구체적으로 적어줘. 재현 방법, 기대 동작, 실제 동작 포함]

[제약]
- 수정 범위: games/[game-id]/ 폴더 안에서만.
- worker/, world/, shared/, games/registry.js, 다른 게임 폴더는 수정 금지.
- 빌드 도구·외부 패키지 추가 금지.
- console.log 등 디버그 코드를 새로 추가하지 마. 수정 후 제거해.
- 모바일(세로 화면, 터치 조작)도 함께 검증해.

[절차]
1. games/[game-id]/ 파일들을 읽어서 버그 원인을 파악해.
2. 최소한의 변경으로 버그를 수정해. 불필요한 리팩터링은 하지 마.
3. 수정한 파일 목록과 변경 내용을 알려줘.
```

---

## 프롬프트 5 — PR 전 자체 점검

```
저장소 루트: [저장소 경로]
내 게임 폴더: games/[game-id]/

PR을 열기 전에 아래 항목을 점검하고 문제가 있으면 고쳐 줘.

[점검 목록]
1. games/[game-id]/index.html 이 존재하는지 확인
2. games/registry.js 에서 내 항목(id: '[game-id]')을 찾아:
   - status 가 'DRAFT' 인지
   - visibility 가 'DIRECT_ONLY' 인지
   - reviewState 가 'NOT_SUBMITTED' 인지
   - path 가 '/games/[game-id]/index.html' 인지
   - 필수 필드(id, title, description, type, status, visibility, reviewState, author, path)가 모두 있는지
3. game-id 형식 확인: 소문자·숫자·하이픈만 (^[a-z0-9]+(-[a-z0-9]+)*$)
4. worker/, world/, shared/ 수정 여부 확인 (수정했다면 되돌려)
5. console.log, debugger, TODO, HACK 이 게임 파일에 남아있는지 확인하고 제거
6. 외부 CDN 스크립트 태그가 있는지 확인 (있다면 보고)
7. HTML에서 모바일 뷰포트 메타 태그 확인:
   <meta name="viewport" content="width=device-width, initial-scale=1.0">

문제 항목마다: 무엇이 문제인지, 어떻게 고쳤는지 알려줘.
모두 통과하면 "PR 준비 완료" 라고 알려줘.
```

---

## 팁

- 프롬프트에서 `[저장소 경로]` 는 실제 경로로 바꿔서 사용하세요.
- AI가 `shared/bootstrap.js` 나 `worker/` 를 수정하려 하면 즉시 중단시키세요.
- 생성된 코드에 `console.log` 가 많이 보이면 "디버그 코드를 모두 제거해줘" 라고 추가 요청하세요.
- 모바일 동작이 의심될 때는 "브라우저 DevTools에서 iPhone SE(375px) 기준으로 확인하는 방법을 알려줘" 라고 물어보세요.
