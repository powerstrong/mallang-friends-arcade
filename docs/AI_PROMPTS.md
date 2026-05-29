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

## 프롬프트 2 — 기존 게임 버그 수정

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

## 프롬프트 3 — PR 전 자체 점검

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
