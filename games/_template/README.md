# 말랑프렌즈 아케이드 — 게임 기여 템플릿

이 폴더를 복사하면 새 미니게임을 곧바로 만들 수 있습니다.  
빌드 도구·패키지·CDN 없이 순수 HTML/CSS/JavaScript만 사용합니다.

---

## 1. 새 게임 만들기

```
games/_template/   ←  이 폴더를 통째로 복사하세요
games/<game-id>/   ←  복사한 폴더 이름을 game-id로 바꾸세요
```

**game-id 규칙:** 영어 소문자·숫자·하이픈만 사용, 정규식 `^[a-z0-9]+(-[a-z0-9]+)*$`

```
좋은 예: my-tap-game, color-match, puzzle-23
나쁜 예: MyGame, my_game, -game, game-
```

---

## 2. 파일 수정 순서

| 파일 | 할 일 |
|------|--------|
| `index.html` | `<title>` 과 화면 안의 제목·설명 텍스트를 게임에 맞게 교체 |
| `style.css`  | `✏️` 주석이 있는 색상·크기 변수를 원하는 값으로 변경 |
| `game.js`    | 맨 위 `CONFIG` 객체의 숫자를 조정해 난이도 조절, `✏️` 주석 지점에서 게임 로직 확장 |

### 핵심 API (bootstrap.js)

```js
// 아케이드 광장으로 돌아가기
window.GameBoot.exit();

// 게임 결과를 아케이드에 기록
window.GameBoot.submitResult({ score: 42 });

// 로비에서 전달된 플레이어 정보 (솔로 플레이 시 null일 수 있음)
window.GameBoot.name      // 플레이어 표시 이름
window.GameBoot.playerId  // 플레이어 고유 ID
```

---

## 3. games/registry.js 에 항목 추가

`games/registry.js` 의 `window.GAME_REGISTRY` 배열 끝에 아래 형식으로 추가하세요.  
**신규 기여 게임은 반드시 아래 기본값을 그대로 사용해야 합니다.**

```js
{
  id: '<game-id>',                         // 폴더 이름과 동일하게
  title: '게임 표시 이름',
  description: '한 줄 설명',
  type: 'SOLO',                            // SOLO | DUEL_LIVE | PARTY_LIVE
  recommendedPlayers: '1명',
  supportedPlayers: '1명',
  playMode: '솔로 플레이',
  durationSeconds: 30,                     // 0 이면 무제한
  status: 'DRAFT',                         // ← 반드시 DRAFT
  visibility: 'DIRECT_ONLY',              // ← 반드시 DIRECT_ONLY
  reviewState: 'NOT_SUBMITTED',           // ← 반드시 NOT_SUBMITTED
  author: '<본인 GitHub 아이디>',
  icon: '🎮',                              // 이모지 또는 2자리 문자
  accentColor: '#ff6b6b',                  // 카드 강조색 (#rrggbb)
  resultLabel: '점수',
  resultUnit: '점',
  resultScale: 1,
  resultDecimals: 0,
  path: '/games/<game-id>/index.html',    // ← 경로 정확히 일치시킬 것
},
```

---

## 4. 개발 중 테스트 방법

DRAFT 게임은 광장(메인 화면)에 나타나지 않습니다.  
**직접 URL**로만 접근해 테스트하세요:

```
http://localhost:<포트>/games/<game-id>/index.html
```

배포된 환경이라면:

```
https://<도메인>/games/<game-id>/index.html
```

---

## 5. 광장 노출 승격 절차

1. 개발 완료 후 Pull Request 를 열어 주세요.
2. 관리자가 게임을 검토합니다.
3. 승인 시 관리자가 registry 항목을 아래로 변경합니다:
   - `status: 'PLAYABLE'`
   - `visibility: 'PUBLIC'`
   - `reviewState: 'APPROVED'`
4. 승격 이후 광장 부스에 게임이 노출됩니다.

---

## 6. 수정 가능 영역 vs 수정 금지 영역

### 수정해도 되는 곳
- `games/<game-id>/` — 내 게임 폴더 전체
- `games/registry.js` — 내 게임의 항목 1개 추가

### 절대 수정 금지
| 경로 | 이유 |
|------|------|
| `worker/` | 서버·WebSocket 코드, 코어 인프라 |
| `world/` | 광장(로비) 클라이언트 코어 |
| `shared/` | bootstrap.js 등 공용 계약 |
| `sw.js` | 서비스 워커 |
| `games/<다른 게임 폴더>/` | 다른 기여자의 코드 |
| `games/_template/` | 이 템플릿 자체 |

---

## 7. 모바일 테스트 체크리스트

- [ ] 세로 화면(portrait)에서 버튼·텍스트가 잘리지 않는다
- [ ] 터치 탭이 클릭과 동일하게 동작한다
- [ ] `font-size` 가 작은 화면(360px 너비)에서도 읽기 편하다
- [ ] 화면 밖으로 가로 스크롤이 생기지 않는다
- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1.0">` 가 `index.html` 에 있다
- [ ] 빠르게 여러 번 탭해도 게임이 오작동하지 않는다
