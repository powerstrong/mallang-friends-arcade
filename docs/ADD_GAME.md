# 새 게임 추가 매뉴얼

> 사람이든 AI 도구(Claude Code·Codex·Cursor)든 이 문서를 그대로 따라오면 됩니다.

---

## 1단계 — 이슈 먼저 열기

시작 전에 GitHub 이슈를 하나 열고 만들고 싶은 게임 아이디어를 적어주세요.  
관리자가 game-id 중복 여부를 확인하고 코멘트로 알려드립니다.

---

## 2단계 — game-id 결정

game-id는 폴더명이자 registry 키입니다.

**규칙**: 소문자 영문·숫자·하이픈만 (`^[a-z0-9]+(-[a-z0-9]+)*$`)

```
좋은 예: color-run, balloon3, tap-race
나쁜 예: ColorRun, color_run, 컬러런
```

---

## 3단계 — 게임 종류 선택 & 템플릿 복사

만들려는 게임의 종류에 따라 시작 템플릿이 다릅니다.

### (a) 클라이언트 전용 게임

서버 없이 혼자 또는 같은 화면에서 즐기는 게임(싱글·로컬 동시 플레이).

```bash
# 예시: game-id = color-run
cp -r games/_template games/color-run
```

Windows라면 탐색기에서 `games/_template` 폴더를 통째로 복사해서  
`games/color-run` 으로 이름을 바꾸면 됩니다.

---

### (b) 실시간 멀티플레이 게임 (릴레이)

온라인으로 여러 명이 실시간으로 함께 즐기는 게임.  
서버 코드는 작성하지 않고, `shared/relay.js` 의 `MallangRelay` SDK만 사용합니다.

```bash
# 예시: game-id = tap-sync
cp -r games/_template-realtime games/tap-sync
```

Windows라면 탐색기에서 `games/_template-realtime` 폴더를 통째로 복사해서  
`games/tap-sync` 로 이름을 바꾸면 됩니다.

릴레이 방식의 상세 동작·API·제약은 **[docs/RELAY.md](./RELAY.md)** 를 참고하세요.

---

### (c) 서버 권위형 게임 (server-authoritative)

> **worker/ 코드 변경이 포함됩니다. 관리자 리뷰가 필수입니다.**  
> 시작 전에 GitHub 이슈에서 관리자와 먼저 상의하세요.

점수 조작·결과 위조를 방지해야 하는 게임에 사용합니다.  
게임 로직이 서버 모듈에 있어 클라이언트는 결과를 위조할 수 없습니다.

```bash
# 예시: game-id = speed-tap
cp -r games/_template-server games/speed-tap
```

Windows라면 탐색기에서 `games/_template-server` 폴더를 통째로 복사해서  
`games/speed-tap` 으로 이름을 바꾸면 됩니다.

추가로 **서버 모듈**도 작성해야 합니다:

1. `worker/src/games/<id>.js` — 서버 게임 모듈 작성
2. `worker/src/gameModules.js` — 모듈 등록

서버 권위형 모듈 인터페이스·ctx API·mod 프로토콜 상세 →  
**[docs/SERVER_GAMES.md](./SERVER_GAMES.md)**

---

**어떤 걸 고를까?**

| 상황 | 선택 |
|------|------|
| 혼자 하거나 같은 화면에서 플레이 | (a) `_template` |
| 방 코드로 온라인 친구와 실시간 플레이 | (b) `_template-realtime` |
| 점수 조작 방지·서버 검증이 필수 | (c) `_template-server` (관리자 리뷰 필수) |

---

## 4단계 — 게임 개발

`games/<id>/` 폴더 **안에서만** 작업하세요.

```
games/color-run/
├── index.html      ← 진입점 (필수)
├── game.js         ← 게임 로직
├── style.css       ← 스타일
└── assets/         ← 이미지·사운드 등
```

**반드시 지킬 것**

- `worker/`, `world/`, `shared/`, 다른 게임 폴더 수정 금지
- 빌드 도구·`npm install` 금지. 순수 HTML/CSS/JS 만 사용
- 외부 CDN 패키지 사용 전 관리자와 먼저 상의
- `shared/bootstrap.js` 와 `games/registry.js` 는 `<script src>` 로 불러와 사용 (수정 금지)

공통 유틸은 `shared/bootstrap.js` 의 `window.GameBoot` 를 통해 사용할 수 있습니다.

```js
// 세션 파라미터 읽기
const { code, name, isMultiplayer } = window.GameBoot;

// 결과 제출
window.GameBoot.submitResult({ score: 42 });

// 광장으로 복귀
window.GameBoot.exit();
```

---

## 5단계 — registry에 DRAFT로 등록

`games/registry.js` 를 열어 배열 맨 끝에 항목을 추가합니다.

```js
{
  id: 'color-run',
  title: '컬러런',
  description: '색을 맞추며 달리는 게임',
  type: 'SOLO',                    // SOLO | DUEL_LIVE | PARTY_LIVE
  recommendedPlayers: '1명',
  supportedPlayers: '1명',
  playMode: '싱글',
  durationSeconds: 60,
  status: 'DRAFT',                 // 신규 기여는 반드시 DRAFT
  visibility: 'DIRECT_ONLY',       // 신규 기여는 반드시 DIRECT_ONLY
  reviewState: 'NOT_SUBMITTED',    // 신규 기여는 반드시 NOT_SUBMITTED
  author: '내-github-닉네임',
  icon: '🎨',
  accentColor: '#ff5500',
  resultLabel: '점수',
  resultUnit: '점',
  resultScale: 1,
  resultDecimals: 0,
  path: '/games/color-run/index.html',
},
```

> status·visibility·reviewState 는 위 값 그대로 두세요. 관리자가 검토 후 변경합니다.

---

## 6단계 — 직접 테스트 URL

DRAFT 게임은 광장에 노출되지 않습니다. 직접 URL로 접근하세요.

**로컬 dev 서버** (풀스택, 서버 API 포함):
```bash
cd worker
npm run dev
# → http://localhost:8787/games/color-run/index.html
```

**Cloudflare Pages 프리뷰** (PR 열면 자동 생성):
```
https://<branch>.<project>.pages.dev/games/color-run/index.html
```

클라이언트 전용 게임은 Pages 프리뷰만으로 완전히 테스트할 수 있습니다.  
서버 API가 필요한 게임은 로컬 dev 서버 또는 관리자 스테이징이 필요합니다.  
자세한 내용은 [docs/PREVIEW.md](./PREVIEW.md) 를 참고하세요.

---

## 7단계 — PR 전 체크리스트

PR을 열기 전에 직접 확인하세요.

- [ ] `games/<id>/index.html` 이 존재하고 브라우저에서 열린다
- [ ] `games/registry.js` 에 내 항목이 추가됐고, status=DRAFT·visibility=DIRECT_ONLY·reviewState=NOT_SUBMITTED
- [ ] `worker/`, `world/`, `shared/`, 다른 게임 폴더를 수정하지 않았다
- [ ] 외부 패키지·빌드 결과물이 포함되지 않았다
- [ ] 모바일(세로 화면) 에서 UI가 정상 표시된다
- [ ] 터치 조작이 작동한다
- [ ] `console.log` 등 디버그 코드를 제거했다
- [ ] 에셋의 저작권이 문제없다 ([ASSET_POLICY.md](../ASSET_POLICY.md) 확인)
- [ ] game-id가 기존 항목과 겹치지 않는다

---

## 흔한 실수

| 실수 | 해결 |
|------|------|
| `status: 'PLAYABLE'` 로 등록 | `DRAFT` 로 바꾸세요. 관리자가 승격합니다 |
| `worker/` 또는 `shared/` 파일 수정 | 되돌리고 `games/<id>/` 안에서 해결하세요 |
| `npm install` 또는 `package.json` 추가 | 외부 패키지 금지. 순수 JS로 구현하세요 |
| game-id에 대문자·언더스코어 사용 | 소문자·숫자·하이픈만 허용 |
| `path` 경로가 실제 파일 위치와 다름 | `/games/<id>/index.html` 형식으로 맞추세요 |
| 데스크톱만 테스트 | 모바일(세로)에서도 반드시 확인하세요 |

---

승인 후 관리자가 registry를 `PLAYABLE/PUBLIC/APPROVED` 로 변경하고  
광장에 부스를 추가합니다. [docs/REVIEW_GUIDE.md](./REVIEW_GUIDE.md) 참고.
