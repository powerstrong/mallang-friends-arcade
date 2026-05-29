# 기여 가이드

말랑프렌즈 아케이드에 새 게임을 추가하거나 버그를 고치고 싶은 분을 환영합니다.  
초보·취미 개발자나 Claude Code·Codex·Cursor 같은 AI 툴을 쓰는 분도 쉽게 따라올 수 있게 작성했습니다.

---

## 기여 흐름

```
이슈 먼저 열기
    ↓
game-id 정하기  (예: color-run)
    ↓
games/_template/ 복사 → games/<id>/
    ↓
/games/<id>/ 안에서만 개발
    ↓
games/registry.js 에 DRAFT 항목 추가
    ↓
PR 열기
    ↓
Cloudflare Pages 자동 프리뷰로 직접 확인
    ↓
관리자 플레이 테스트 + 승인
    ↓
PLAYABLE 승격 + main 머지
```

자세한 단계별 안내는 **[docs/ADD_GAME.md](./docs/ADD_GAME.md)** 를 참고하세요.

---

## game-id 규칙

- 소문자 영문·숫자·하이픈만 허용
- 패턴: `^[a-z0-9]+(-[a-z0-9]+)*$`
- 예시: `color-run`, `balloon3`, `tap-race`
- PR 전에 기존 id와 겹치지 않는지 `games/registry.js` 에서 확인하세요.

---

## 수정 가능 / 금지 파일

### 기여자가 작업하는 곳 (여기만 건드리세요)

| 경로 | 설명 |
|------|------|
| `games/<id>/` | 내 게임 전체 — index.html, 스타일, 스크립트, 에셋 |
| `games/registry.js` | 내 게임 항목 1개 추가 (DRAFT/DIRECT_ONLY/NOT_SUBMITTED) |

### 코어 — 절대 수정 금지

| 경로 | 이유 |
|------|------|
| `worker/` | 서버 로직 (Cloudflare Workers + Durable Objects) |
| `world/` | 광장(로비) 클라이언트 |
| `shared/` | 공통 라이브러리 (bootstrap.js 등) |
| `sw.js` | 서비스 워커 |
| `games/_template/` | 공용 템플릿 — 복사해서 사용, 원본 수정 금지 |
| 다른 게임의 `games/<other-id>/` | 해당 게임 기여자 영역 |

> 코어 파일이 왜 분리되어 있는지는 [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md) 를 참고하세요.

---

## 에셋 라이선스 주의

- 말랑프렌즈 캐릭터·로고 에셋은 MIT가 아닌 별도 정책이 적용됩니다.
- 에셋 사용 전 반드시 [ASSET_POLICY.md](./ASSET_POLICY.md) 를 확인하세요.
- 새 에셋을 직접 제작하거나 CC0·퍼블릭도메인 소스를 사용하는 것을 권장합니다.

---

## 모바일 테스트 체크리스트

PR 전에 스마트폰(또는 브라우저 DevTools 모바일 에뮬레이터)으로 확인하세요.

- [ ] 세로 화면(portrait) 에서 UI가 잘림 없이 표시된다
- [ ] 터치 조작(탭·스와이프)이 마우스 클릭과 동일하게 작동한다
- [ ] 게임 시작·종료·결과 화면이 모바일에서 정상 동작한다
- [ ] 작은 화면(375px 이하)에서 버튼이 손가락으로 탭할 수 있는 크기다

---

## 코드 스타일

- 빌드 도구·외부 패키지 금지. 순수 HTML/CSS/JS 만 사용하세요.
- `npm install` 없이 브라우저에서 바로 열리는 파일이어야 합니다.
- `console.log` 등 디버그 코드는 PR 전에 제거하세요.

---

## AI 도구로 기여할 때

Claude Code·Codex·Cursor 등으로 게임을 만드는 분을 위한 프롬프트 예시가  
**[docs/AI_PROMPTS.md](./docs/AI_PROMPTS.md)** 에 있습니다. 복붙해서 바로 쓸 수 있습니다.

---

## 자동 검증

PR이 열리면 GitHub Actions 가 `scripts/validate-games.js` 를 실행해  
`games/registry.js` 항목의 필수 필드·형식·id 중복 여부를 자동으로 검사합니다.  
빨간 체크가 뜨면 에러 메시지를 읽고 registry 항목을 수정하세요.

---

질문이 있으면 이슈를 열어주세요. 환영합니다!
