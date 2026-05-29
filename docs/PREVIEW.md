# 프리뷰 & 로컬 개발

말랑프렌즈 아케이드는 3계층 프리뷰 환경을 지원합니다.  
어떤 방법을 쓸지는 게임 종류(클라이언트 전용 vs 서버 권위형)에 따라 달라집니다.

---

## 계층 1 — 로컬 풀스택 dev 서버

정적 파일 + API + Durable Objects 를 모두 로컬호스트에 띄웁니다.  
서버 로직(방 생성·WebSocket·광장)까지 포함한 완전한 환경입니다.

```bash
cd worker
npm install   # 최초 1회
npm run dev
```

- 정적 사이트: `http://localhost:8787/`
- 게임 직접 접근: `http://localhost:8787/games/<id>/index.html`
- wrangler 가 `worker/` 서버와 저장소 루트 정적 파일을 함께 서빙합니다.

**언제 필요한가**: 서버 API(`/api/rooms`, `/api/world/`)를 사용하는 게임,  
또는 광장 흐름(부스 → 게임 진입)을 처음부터 끝까지 테스트할 때.

---

## 계층 2 — Cloudflare Pages 자동 프리뷰

PR을 열거나 브랜치를 push 하면 Cloudflare Pages가 자동으로 고유 프리뷰 URL을 생성합니다.

```
https://<branch-name>.<project>.pages.dev/games/<id>/index.html
```

- main 머지 없이 게임을 외부에서 검증할 수 있습니다.
- 관리자가 이 URL로 플레이 테스트합니다.
- **클라이언트 전용 게임은 이 URL만으로 완전히 동작합니다.**
- **릴레이 멀티플레이 게임도 이 URL만으로 완전히 플레이·검증할 수 있습니다.**

### 릴레이 게임과 Pages 프리뷰

`shared/relay.js` 의 `MallangRelay` SDK를 사용하는 릴레이 게임은  
Pages 프리뷰 URL의 클라이언트가 **prod 릴레이 엔드포인트**(실제 서버)에 그대로 연결됩니다.

- 별도 staging 환경이 필요 없습니다.
- 브랜치/PR 프리뷰 URL을 친구에게 공유하면 실제 멀티플레이 테스트가 바로 가능합니다.
- 새 서버 코드를 배포할 필요가 없으므로 관리자 개입 없이 독립적으로 검증할 수 있습니다.

릴레이 게임 개발 방법은 [docs/RELAY.md](./RELAY.md) 를 참고하세요.

**주의 — fork PR**: 외부 기여자가 fork 에서 PR을 열면  
Cloudflare Pages 프리뷰가 생성되지 않거나 제한될 수 있습니다.  
이 경우 로컬 dev 서버에서 직접 확인하거나 관리자에게 스테이징 배포를 요청하세요.

---

## 계층 3 — 서버 권위형 신규 게임 스테이징

서버 로직(room.js·world.js 등)을 새로 추가하거나 수정하는 게임은  
Pages 프리뷰만으로는 백엔드를 검증할 수 없습니다.

이유:
- 백엔드(Durable Objects)는 `main` 브랜치 push 때만 worker 에 배포됩니다.
- Pages 프리뷰 URL의 클라이언트는 `shared/config.js` 에 하드코딩된 **prod API** 를 바라봅니다.
- prod API 에는 아직 새 서버 코드가 없으므로 기능이 동작하지 않습니다.

**대안**:
1. **로컬 dev 서버** (권장): `cd worker && npm run dev` 로 전체 스택을 로컬에서 실행
2. **관리자 스테이징**: 별도 staging 워커를 배포해 프리뷰가 그쪽을 바라보게 한다.

### 스테이징 워커 활성화 (관리자)

`worker/wrangler.toml` 에 `[env.staging]` 이 준비되어 있습니다. 한 번만 설정하면 됩니다.

```bash
cd worker
npx wrangler deploy --env staging   # game-lobby-staging 워커 배포
```

그다음 `shared/config.js` 의 `STAGING_API` 에 배포된 URL 을 넣습니다.

```js
const STAGING_API = 'https://game-lobby-staging.powerstrong.workers.dev';
```

- 이렇게 하면 프로덕션 호스트(`PROD_HOSTS`)가 아닌 **Pages 프리뷰 배포의 클라이언트가 자동으로 staging API** 를 바라봅니다. 프리뷰 브랜치에 새 서버 코드를 함께 staging 에 배포해두면, 머지 전에 서버 권위형 게임도 프리뷰에서 검증할 수 있습니다.
- `STAGING_API` 가 비어 있으면(기본값) 프리뷰도 prod API 를 사용하므로, 릴레이/클라이언트 게임 검증은 staging 없이도 그대로 동작합니다.
- 참고: 위 설정은 staging 이 prod 와 같은 D1 DB(`web-game-lab-scores`)를 재사용합니다. 리더보드 오염이 걱정되면 staging 전용 D1 을 만들어 `[env.staging.d1_databases]` 의 `database_id` 를 교체하세요.

> 대부분의 캐주얼 게임은 클라이언트 전용 또는 릴레이로 만들 수 있습니다.  
> 서버 로직 추가가 필요하면 이슈에서 관리자와 먼저 상의하세요.

---

## 요약

| 상황 | 추천 방법 |
|------|-----------|
| 클라이언트 전용 게임 개발 | Pages 프리뷰 URL |
| 릴레이 멀티플레이 게임 개발 | Pages 프리뷰 URL (prod 엔드포인트 그대로 연결) |
| 방 코드·광장 흐름 테스트 | 로컬 dev 서버 |
| 서버 권위형 신규 게임 (서버 로직 추가) | 로컬 dev 서버 + 관리자 스테이징 |
| 모바일 외부 공유 테스트 | Pages 프리뷰 URL |
| fork PR (외부 기여자) | 로컬 dev 서버 또는 관리자에게 요청 |
