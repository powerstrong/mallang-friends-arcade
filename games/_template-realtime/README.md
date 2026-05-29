# 릴레이 실시간 멀티플레이 템플릿

> **게임**: 실시간 탭 대결 — 15초 동안 버튼을 최대한 많이 탭하고, 서로의 점수를 실시간으로 확인하며 겨룹니다.

---

## 릴레이(중계) 모델이란?

```
참가자 A ──┐                ┌── 참가자 A
참가자 B ──┤  서버(중계만)  ├── 참가자 B
참가자 C ──┘                └── 참가자 C
          메시지를 그대로 중계
```

- **서버에 권위(authority)가 없습니다.** 서버는 같은 방·같은 gameId 의 참가자 간에 메시지를 그대로 전달할 뿐입니다.
- **게임 로직·점수·승패 판정은 전적으로 클라이언트**에 있습니다.
- 기여자는 **서버 코드를 한 줄도 작성하지 않고** `shared/relay.js` 만으로 실시간 멀티플레이를 만들 수 있습니다.

### 주의: 치팅에 약합니다

클라이언트가 메시지를 조작해도 서버가 검증하지 않습니다.  
**캐주얼·협동 게임**에 적합하고, 점수 조작이 치명적인 경쟁 게임에는 부적합합니다.  
서버 권위가 필요하다면 관리자(powerstrong)와 상의하세요.

---

## 이 폴더로 새 게임 만들기

### 1. 폴더 복사

```
games/_template-realtime/   →   games/<game-id>/
```

### game-id 규칙

- 소문자 영숫자와 하이픈만 사용: `^[a-z0-9]+(-[a-z0-9]+)*$`
- 예: `tap-battle`, `color-rush`, `word-relay`
- `_`(언더스코어) 시작은 템플릿 예약 → 레지스트리 등록 불가

### 2. 파일 수정

| 파일 | 주요 수정 포인트 |
|------|-----------------|
| `index.html` | `<title>`, 게임 제목·설명 텍스트 |
| `style.css` | 색상(accent color), 버튼·배경 스타일 |
| `game.js` | `GAME_ID`, `ROUND_SECONDS`, 탭 로직 전체 |

`game.js` 안의 `✏️ 여기를 바꾸세요` 주석을 검색하면 수정 포인트를 빠르게 찾을 수 있습니다.

### 3. registry.js 등록

`games/registry.js` 배열에 항목을 추가합니다.  
**신규 기여 게임의 기본값**: `status:'DRAFT'`, `visibility:'DIRECT_ONLY'`, `reviewState:'NOT_SUBMITTED'`  
→ 광장(월드)에는 노출되지 않고 직접 URL로만 접근됩니다. 관리자 검토 후 승격됩니다.

```js
// games/registry.js 예시 — 실제 파일의 기존 항목 형식에 맞추세요
{
  id: 'tap-battle',                        // ✏️ 폴더명과 일치
  title: '탭 대결',                         // ✏️ 표시 이름
  description: '15초 탭 속도 대결!',         // ✏️ 한 줄 설명
  type: 'REALTIME_RELAY',                  // 릴레이 멀티플레이 게임
  recommendedPlayers: '2~6명',
  supportedPlayers: '2~6명',
  playMode: '온라인 실시간',
  durationSeconds: 15,
  status: 'DRAFT',                         // 신규 기여 기본값
  visibility: 'DIRECT_ONLY',              // 신규 기여 기본값
  reviewState: 'NOT_SUBMITTED',           // 신규 기여 기본값
  author: 'your-github-handle',           // ✏️ 본인 핸들
  icon: '👆',                              // ✏️ 이모지 아이콘
  accentColor: '#e53170',                 // ✏️ 강조 색상
  resultLabel: '탭 수',
  resultUnit: '탭',
  resultScale: 1,
  resultDecimals: 0,
  path: '/games/tap-battle/index.html',   // ✏️ 실제 경로
},
```

---

## 테스트 방법

### 브라우저 2개 탭으로 테스트 (가장 빠름)

1. 개발 서버 실행 (프로젝트 루트에서)
2. 첫 번째 탭에서 게임을 열면 방 코드가 화면에 표시됩니다:
   ```
   http://localhost:PORT/games/<game-id>/index.html
   ```
3. 두 번째 탭에서 같은 URL에 `?code=XXXX` 를 붙여 접속합니다:
   ```
   http://localhost:PORT/games/<game-id>/index.html?code=XXXX
   ```
4. 두 탭 모두 로비에 참가자가 나타나는지 확인합니다.
5. 각 탭에서 "시작!" → 탭 버튼을 누르면 서로의 점수가 실시간으로 갱신됩니다.

### 2개 기기로 테스트 (모바일 포함)

같은 로컬 네트워크에서 PC IP로 접근하거나, 배포 환경 URL을 사용합니다.

---

## 파일 수정 범위

### 수정 가능

```
games/<game-id>/          ← 여러분의 게임 폴더 (자유롭게 수정)
  index.html
  style.css
  game.js
  assets/                 ← 이미지·사운드 등 에셋 추가 가능
games/registry.js         ← 본인 게임 항목만 추가
```

### 수정 금지

```
worker/                   ← 서버 코드 (관리자 전용)
world/                    ← 아케이드 광장 코드 (관리자 전용)
shared/                   ← 공용 SDK (config.js, bootstrap.js, relay.js 등)
sw.js                     ← 서비스 워커
games/registry.js 의 타인 항목  ← 다른 게임 항목 수정 금지
다른 게임 폴더             ← 다른 기여자의 게임에 손대지 마세요
```

---

## relay.js API 빠른 참고

```js
// 릴레이 생성 (bootstrap.js 로드 후 사용)
const relay = MallangRelay.create({ gameId: 'my-game', name: '플레이어' });

relay.ready.then(() => {
  console.log('방 코드:', relay.code);   // 친구에게 ?code=XXXX 로 공유
  console.log('내 id:', relay.playerId);
});

relay.on('players', list => { /* 참가자 입퇴장 시 호출 */ });
relay.on('message', ({ from, payload, ts }) => { /* 다른 참가자 메시지 수신 */ });
relay.on('error', err => { /* 연결 오류 처리 */ });

relay.send({ type: 'score', value: 42 });  // 방 전체에 전송
relay.send({ type: 'ping' }, { echo: true }); // echo:true면 자신도 받음
relay.leave();  // 방 나가기
```

**제약사항**
- payload 직렬화: **8,192바이트 이하**
- 전송 속도: **연결당 초당 40메시지** (초과분은 드롭됨)
