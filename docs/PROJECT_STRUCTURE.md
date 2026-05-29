# 프로젝트 구조

말랑프렌즈 아케이드의 전체 폴더 구조와 각 디렉터리의 역할을 설명합니다.

---

## 전체 구조

```
web-game-lab/
├── games/                    ← 게임 모음 (기여자 작업 영역)
│   ├── registry.js           ← 게임 등록 파일 (항목 추가만 허용)
│   ├── _template/            ← 새 게임 시작 템플릿 (복사해서 사용)
│   ├── jump-climber/         ← 말랑프렌즈 점프
│   ├── mallang-quiz-battle/  ← 말랑프렌즈 퀴즈배틀
│   └── sseuk-sseuk/          ← 말랑프렌즈 쓱쓱
│
├── worker/                   ← 서버 코어 [수정 금지]
│   ├── src/
│   │   ├── index.js          ← API 라우터 (Workers fetch 핸들러)
│   │   ├── room.js           ← GameRoom Durable Object (방 관리·WebSocket)
│   │   ├── world.js          ← WorldChannel Durable Object (광장·실시간)
│   │   ├── worldZones.js     ← 광장 부스 위치·인원 정의
│   │   └── leaderboard.js    ← D1 리더보드 로직
│   ├── wrangler.toml         ← Cloudflare 배포 설정
│   └── package.json
│
├── world/                    ← 광장 클라이언트 코어 [수정 금지]
│   ├── world.html            ← 광장 진입점
│   ├── world.js              ← 광장 메인 로직
│   └── ...
│
├── shared/                   ← 공통 라이브러리 [수정 금지]
│   ├── bootstrap.js          ← GameBoot API (게임→광장 인터페이스)
│   └── config.js             ← 서버 URL 등 환경 설정
│
├── sw.js                     ← 서비스 워커 [수정 금지]
├── games/registry.js         ← 게임 등록 파일 (항목 추가만)
├── scripts/
│   └── validate-games.js     ← PR 자동 검증 스크립트
├── docs/                     ← 문서 모음
│   ├── ADD_GAME.md
│   ├── AI_PROMPTS.md
│   ├── PREVIEW.md
│   ├── PROJECT_STRUCTURE.md
│   ├── REVIEW_GUIDE.md
│   ├── media/                ← 문서용 스크린샷
│   └── games/               ← 게임별 소개 페이지
├── README.md
├── CONTRIBUTING.md
├── LICENSE
└── ASSET_POLICY.md
```

---

## 코어 vs 기여자 영역

### 코어 (일반 기여자 수정 금지)

| 경로 | 설명 |
|------|------|
| `worker/` | Cloudflare Workers + Durable Objects 서버 로직. 방 관리·WebSocket·리더보드·광장 채널을 모두 담당합니다. 잘못 수정하면 전체 서비스가 영향을 받습니다. |
| `world/` | 광장(로비) 클라이언트. 아바타 이동·부스 감지·게임 진입 흐름이 구현되어 있습니다. |
| `shared/` | 모든 게임이 공통으로 사용하는 `GameBoot` API와 서버 URL 설정. |
| `sw.js` | 서비스 워커. 오프라인 캐싱과 업데이트 처리를 담당합니다. |

### 기여자 작업 영역

| 경로 | 설명 |
|------|------|
| `games/<id>/` | 내 게임 전체 소유 영역. index.html·스크립트·스타일·에셋을 여기에 둡니다. |
| `games/registry.js` | 내 게임 항목 1개를 배열 끝에 추가합니다. 다른 항목은 수정하지 마세요. |

---

## 게임 등록 파일 (games/registry.js)

브라우저가 `<script>` 태그로 로드하는 단순 JS 파일입니다.  
`window.GAME_REGISTRY` 배열에 게임 메타데이터 객체를 담습니다.

**노출 조건**: `status === 'PLAYABLE' && visibility === 'PUBLIC' && reviewState === 'APPROVED'`

**신규 기여 기본값**: `status: 'DRAFT'`, `visibility: 'DIRECT_ONLY'`, `reviewState: 'NOT_SUBMITTED'`

DRAFT 게임은 광장 부스가 없어 자동으로 숨겨지며, 직접 URL(`/games/<id>/index.html`)로만 접근할 수 있습니다.

---

## 광장 부스 (worker/src/worldZones.js)

광장에 보이는 게임 부스의 위치·크기·인원을 정의합니다.  
PLAYABLE로 승격된 게임은 관리자가 이 파일에 부스 항목을 추가합니다.  
기여자가 직접 수정하지 않습니다.

---

## 공통 API (shared/bootstrap.js)

게임 코드에서 사용하는 `window.GameBoot` 를 제공합니다.

```js
window.GameBoot.code          // 방 코드 (멀티플레이)
window.GameBoot.name          // 플레이어 닉네임
window.GameBoot.isMultiplayer // 멀티플레이 여부
window.GameBoot.submitResult(result)  // 결과 제출
window.GameBoot.exit()               // 광장으로 복귀
```

게임 index.html 에서 `shared/bootstrap.js` 를 로드한 뒤 사용하세요.

---

## 서버 API 경로 (worker/src/index.js)

| 경로 | 설명 |
|------|------|
| `POST /api/rooms` | 새 방 생성 |
| `GET /api/rooms/:code` | WebSocket 업그레이드 → GameRoom DO |
| `GET /api/world/:loungeId` | WebSocket 업그레이드 → WorldChannel DO |
| `GET /api/leaderboard?game=:game` | 주간 리더보드 조회 |

클라이언트 전용 게임은 이 API를 직접 호출하지 않아도 됩니다.
