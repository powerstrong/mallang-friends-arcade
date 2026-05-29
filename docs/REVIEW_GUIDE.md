# 관리자 리뷰 가이드

기여자가 PR을 열면 관리자가 수행하는 리뷰 절차를 정리합니다.

---

## 1단계 — PR 초기 검토

### 코드 범위 확인

- [ ] `games/<id>/` 폴더와 `games/registry.js` 항목 추가 외에 다른 파일을 건드리지 않았는가
- [ ] `worker/`, `world/`, `shared/`, `sw.js` 수정이 없는가
- [ ] 다른 게임 폴더(`games/<other-id>/`)를 수정하지 않았는가

### registry 항목 검증

- [ ] `status: 'DRAFT'`, `visibility: 'DIRECT_ONLY'`, `reviewState: 'NOT_SUBMITTED'`
- [ ] `id` 가 규칙에 맞는가: `^[a-z0-9]+(-[a-z0-9]+)*$`
- [ ] 기존 id와 중복이 없는가
- [ ] 필수 필드가 모두 있는가: `id, title, description, type, status, visibility, reviewState, author, path`
- [ ] `path` 가 실제 파일 위치와 일치하는가: `/games/<id>/index.html`
- [ ] GitHub Actions 자동 검증(`validate-games.js`)이 통과했는가

### 코드 품질

- [ ] 빌드 결과물이나 `node_modules` 가 포함되지 않았는가
- [ ] 외부 CDN 스크립트 사용이 없거나 적절한가
- [ ] `console.log`, `debugger`, `TODO`, `HACK` 주석이 남아있지 않은가

---

## 2단계 — 플레이 테스트

Pages 자동 프리뷰 URL에서 직접 게임을 실행합니다.

```
https://<branch>.<project>.pages.dev/games/<id>/index.html
```

### 데스크톱 체크리스트

- [ ] 게임이 정상적으로 시작된다
- [ ] 게임 로직이 기술적으로 오류 없이 작동한다
- [ ] 결과 화면이 표시된다
- [ ] 광장으로 복귀가 작동한다 (`window.GameBoot.exit()`)
- [ ] 브라우저 콘솔에 에러가 없다

### 모바일 체크리스트

- [ ] 세로 화면(portrait)에서 UI가 잘림 없이 표시된다
- [ ] 터치 조작(탭·스와이프)이 작동한다
- [ ] 버튼이 손가락으로 탭할 수 있는 크기다 (최소 44×44px 권장)
- [ ] 작은 화면(375px 이하)에서도 레이아웃이 무너지지 않는다

### 멀티플레이 게임 추가 체크

- [ ] 2인 이상 접속 시 실시간 동기화가 올바르게 작동한다
- [ ] 플레이어가 도중에 나가도 나머지가 크래시 없이 계속 진행된다
- [ ] 서버 권위형 로직이라면 로컬 dev 또는 스테이징에서 별도 검증

---

## 3단계 — 에셋 저작권 확인

- [ ] 이미지·사운드·폰트의 출처와 라이선스를 확인했는가
- [ ] 말랑프렌즈 캐릭터 에셋을 사용했다면 [ASSET_POLICY.md](../ASSET_POLICY.md) 를 준수했는가
- [ ] 저작권이 불분명한 에셋은 교체를 요청한다

---

## 4단계 — 승인 시 처리

PR이 기준을 통과하면 아래 순서로 처리합니다.

### 4-1. registry 상태 변경

`games/registry.js` 에서 해당 게임 항목을 수정합니다.

```js
// 변경 전 (기여자 제출 상태)
status: 'DRAFT',
visibility: 'DIRECT_ONLY',
reviewState: 'NOT_SUBMITTED',

// 변경 후 (승인 후)
status: 'PLAYABLE',
visibility: 'PUBLIC',
reviewState: 'APPROVED',
```

### 4-2. 광장 부스 추가

`worker/src/worldZones.js` 의 `GAME_ZONES` 배열에 부스를 추가합니다.

```js
{
  id: '<game-id>',
  gameId: '<game-id>',
  title: '게임 표시 이름',
  rect: { x: 0, y: 0, w: 165, h: 200 },  // 좌표는 기존 부스와 겹치지 않게 조정
  minPlayers: 1,
  maxPlayers: 2,  // registry.supportedPlayers 와 일치
  holdMs: 3000,
},
```

> 부스 좌표는 광장 캔버스 기준(540×960 portrait)입니다. 기존 부스와 겹치지 않도록 확인하세요.

### 4-3. PR 머지

수정 후 main 브랜치에 머지합니다. Cloudflare Pages가 자동으로 배포합니다.

---

## 반려 기준

아래 경우에는 변경 요청(Changes Requested)으로 돌려보냅니다.

- 코어 파일(worker·world·shared·sw.js) 수정
- 다른 게임 폴더 수정
- status가 DRAFT가 아닌 값으로 등록
- 외부 빌드 도구·패키지 포함
- 모바일에서 작동 불가
- 저작권 문제가 있는 에셋
- 게임이 실질적으로 동작하지 않는 상태(예: 빈 화면, 즉시 오류)
