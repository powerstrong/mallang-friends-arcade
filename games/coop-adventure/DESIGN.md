# 말랑프렌즈 협동대모험 — 기획 & 개발 문서 (v0.4)

> 게임 ID: `coop-adventure` · 장르: 2D 횡스크롤 협동 플랫포머 · 타깃: 초등학생 / 모바일
> 상태: **DRAFT (프로토타입 개발 중)** · 최종 업데이트: 2026-06-06
>
> ⚠️ 이 문서는 **개발 진행 추적기**를 겸합니다. 작업이 중단되면 아래
> [개발 진행 상태](#개발-진행-상태) 섹션의 "현재 단계 / 다음 작업"부터 이어서 진행합니다.

---

## 0. 한 줄 컨셉
> **두 친구가 서로의 길을 열어주며 함께 골인하는, 귀여운 2인 협동 플랫포머.**
> 혼자서도 즐길 수 있지만, 둘이 하면 더 멀리 간다. (1인 플레이 + 2인 협동 모두 지원)

---

## 1. 확정된 핵심 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 플랫폼 | 기존 텐텐오락실/말랑프렌즈 아케이드 내 부스 게임 | 광장·registry·GameBoot·DO·Cloudflare 인프라 재사용 |
| 엔진 | **Phaser 3, 무빌드 vendor** (`/shared/vendor/phaser-<ver>.min.js`) | 마리오류=레벨제작+충돌이 핵심 → Tilemap+Arcade Physics. 무빌드로 플랫폼 일관성 유지. Godot 기각(WASM 무거움·부스모델 충돌) |
| 장르/방향 | **가로 횡스크롤** | jump-climber(세로 등반/엔들리스)와 차별화. "마리오처럼"의 본질 |
| 인원 | **1인 + 2인 협동** (같은 콘텐츠, 협동 기믹은 1인/2인 버전 분기) | 멀티가 아케이드 핵심 요소. 솔로도 가능해야 함 |
| 화면 | **각자 시점 카메라** + 가끔 "합류 구간" | 각자 화면=내 캐릭터(예측, 부드러움). 네트워크 지연에 가장 강함 |
| 구조 | **골인형 스테이지 클리어** (월드맵 + 별 1~3 + 다음 스테이지 해금) | 초딩 리텐션 엔진. 죽음=실패-재도전 루프(목표 아님) |
| 난이도 | **명시적 메뉴 없음** = 스테이지 진행 + 협동/솔로 + 은근한 DDA | 초딩은 자기 실력 평가 어려움. 선택 마찰 제거 |
| 세션 길이 | 스테이지당 **1~2분**, 일반적 한 판 45~90초 | 짧은 "한 판 더" 루프 |
| 보너스(후순위) | "끝없이 모드" (점점 빡세지다 죽음, 거리/별 점수) | 고수·점수경쟁용. 메인 완성 후 |

### 게임의 척추: "갈라짐 → 합류 → 갈라짐" 리듬
대부분 각자 레인을 진행(내 화면=내 캐릭터, 부드러움), 핵심 순간만 합류 구간에서 만남.
상대 위치는 진행도 인디케이터(기존 `rivalGauge` 확장)로 표시.

---

## 2. 리뷰 반영 변경점 (v0.3 → v0.4)

codex(엔지니어링) + gemini(UX) 리뷰 결과 반영:

1. **정체성 재정의 (codex, 최우선):** "실시간 협동 플랫포머" ❌ → **"각자 로컬 플랫포머 + 느슨한 공유상태 협동"** ✅.
   DO = 물리 시뮬레이터가 **아니라** *공유 상태 머신 권위자*. 움직이는 적·정밀 발판·즉사 위험은 **클라 판정**(서버는 느슨한 검증만), 서버 권위로 만들지 않음.
2. **1차에 더미 2P 고스트 포함 (codex+gemini 공통):** "협동은 그다음"으로 완전히 미루지 않음. 손맛은 먼저 맞추되, **더미 2P 고스트 + 각자 카메라/인디케이터 로직을 1차에 같이 검증**(나중에 물리·레벨 갈아엎기 방지).
3. **관대한 판정 (둘 다):** 스위치는 즉시가 아니라 **3~5초 유지**. 보간 버퍼 100ms → **120~200ms 적응형**.
4. **세로 화면 시야 (gemini):** **카메라 바이어스** — 캐릭터를 화면 좌측 25~30%에 고정해 전방 시야 확보. 청크에 지그재그/상향 요소 섞기.
5. **입력 관대함 (gemini):** 점프 버퍼 **0.2초+**, 히트박스 넓게. 자동달리기는 `controlMode` 폴백으로 유지.
6. **이모트 버튼 추가 (gemini):** "빨리 와 / 미안 / 굿" 큰 아이콘 — 초딩 협동 핵심 재미. (채팅 대체)
7. **실패/거부 UX (codex):** 롤백 대신 "넉넉한 판정 + 늦게 확정돼도 자연스러운 연출". 별 중복 획득 등은 서버 first-touch + 부드러운 회수 연출.
8. **치트 검증 강화 (codex):** 속도상한 + 클리어 시간 하한 + 별 획득 구간/순서 + 체크포인트 순서 + 텔레포트 방지 + D1 idempotency. (멀티/진도 D1 동기화 단계에서)
9. **Phaser 운영 (codex):** 파일명에 버전 명시, IIFE/모듈로 전역오염 차단, 에셋 매니페스트·씬·입력추상화 처음부터 분리. 무빌드는 **영구 전략 아님** — 2~3 스테이지+협동 네트워크 도달 시 Vite 전환 검토.

---

## 3. 네트워크 모델 (v0.4 확정)

> **로컬 플레이어 이동/점프/피격감 = 클라이언트 즉시 처리. DO = 방 단위 공유 이벤트와 진행 상태만 권위. 정밀 물리 협동 금지. 공유 기믹은 넓은 판정·긴 활성시간·체크포인트 게이트 중심.**

- **내 캐릭터:** 로컬 시뮬레이션 (예측) → 핑 무관 즉각 (요구사항: "내 건 안 끊김")
- **상대 캐릭터:** 보간 **120~200ms 적응형** (+외삽). 대부분 화면 밖이라 부담 적음. "고스트/동료" 취급
- **DO 권위 대상:** 스위치·문·체크포인트·별·부활·합류 게이트 등 **이벤트 중심 상태**
- **DO 비권위(클라 판정):** 움직이는 적, 정밀 발판, 즉사 위험 → 서버는 느슨한 검증만
- **전송:** 상대 위치 10~15Hz / 공유 오브젝트는 이벤트 발생 시 + 상태 스냅샷 (분리)
- **고정 타임스텝** 시뮬레이션 (예측·보정 일관성)
- **치트:** §2-8 목록

---

## 4. 협동 재미 메커닉 (전부 지연 안전 — 공유세계 경유, 직접 물리충돌 금지)

| 메커닉 | 내용 | 1인 버전 | 2인 버전 |
|---|---|---|---|
| 비대칭 스위치 | 밟으면 문 열림 (**3~5초 유지**) | 타이머 스위치(밟고 빨리 통과) | 파트너가 밟아줌 |
| 릴레이 발판 | 블록 밀어두면 점프대 | 고정 발판으로 대체 | 한 명이 밀고 한 명이 점프 |
| 능력 분담 | 캐릭터별 능력 차 | 단일 능력 | 둘 다 필요한 퍼즐 |
| 구출/부활 | 떨어지면 살림 (**너그러운 근접 판정**) | 죽으면 끝(재시작) | 상대가 부활(횟수 제한), 둘 다 죽어야 끝 |
| 공유 위험 | 차오르는 용암 등 (클라 판정) | 동일 | 둘 다 압박 |
| 공유 별 | 합쳐서 N개 | 혼자 수집 | 갈라 맡기 (서버 first-touch) |
| **이모트** | "빨리와/미안/굿" 아이콘 | — | 협동 핵심 소통 |

긴장 요소: 공동 운명(둘 다 위험), 시간/추격(차오르는 위험), 공동 점수("우리 기록").

---

## 5. 진도 저장 / 식별

- 현 `playerId`는 **일회성 세션 ID**(relay.js `m.playerId`) → 영속 식별 불가
- **신규 도입:** 기기 고정 익명 ID (localStorage). 진도는 **듀오가 아니라 개인 단위** 저장
- 협동 시 **둘 중 높은 진도까지 선택 가능**, 클리어하면 **둘 다 개인 진도 상승** (조합 키 불필요)
- 다른 기기 이어하기용 **"이어하기 코드"** (재사용 가능한 저장 코드)
- ❌ "캐릭터 이름 조합(AAA+BBB)" 키 — 네임스페이스 충돌·파편화·무인증으로 **기각**
- **D1 스키마:** `player_progress(player_id TEXT PK, max_stage INT, stars TEXT(JSON), updated_at INT)`
- 단계: 1차 = localStorage 로컬 저장으로 시작 → 멀티 진도 공유 필요 시 D1 동기화 추가 (idempotency 포함)

---

## 6. 모바일 조작

- 가상패드: 좌하단 ◀▶ / 우하단 점프 (+ 능력/이모트 버튼)
- 멀티터치, `pointerdown/up/cancel`, 버튼별 `pointerId` 추적, 매 프레임 상태 폴링
- `touch-action: none`, `safe-area-inset` 대응
- **손맛 3종(필수):** 코요테 타임 / **점프 버퍼 0.2초+** / 가변 점프
- **카메라 바이어스:** 캐릭터 화면 좌측 25~30% 고정 (세로 폰 전방 시야)
- 세로 폰에서 횡스크롤 플레이 (눕히기 강제 안 함)
- `controlMode: "manual" | "auto-run"` 추상화 — 기본 manual, 모바일 난이도 문제 시 auto-run 폴백

---

## 7. 기술 구조 (무빌드 Phaser)

```
shared/vendor/phaser-<ver>.min.js     # 버전 고정 vendor (전 Phaser 게임 공유 캐시)
games/_template-phaser/               # 새 Phaser 게임 표준 템플릿
  index.html  style.css
  game.js                             # IIFE/모듈, 전역오염 차단
  src/  (input.js, scenes/, assets-manifest.js …)  # 처음부터 분리
games/coop-adventure/
  index.html  style.css  game.js
  DESIGN.md (이 문서)
  src/  levels/(청크 JSON)  assets/(나중에 일괄 생성, 지금 플레이스홀더)
```
GameBoot 연동: `window.GameBoot.submitResult({ score })`, `.exit()` (기존 그대로).

---

## 8. 개발 진행 상태

> **재개 지점:** 아래 "현재 단계"부터. 각 단계 완료 시 체크 + 날짜 기록.

### 현재 단계
**솔로 완주 가능 범위 완료** — S1·S2·S3·S4(배선)·S5·S7·S8·S10 모두 브라우저 계측 검증 + codex 리뷰 반영.
다음은 **사용자 단계가 필요한 작업**: ① S4 실멀티 통합테스트(RelayTransport+worker+2클라), ② S6 부활/합류(실 피어 상호작용 필요), ③ S5 2인 이벤트 권위(DO), ④ S9 D1 진도 동기화(worker).
> 검증 방식: 프리뷰 페이지가 hidden 탭이라 rAF가 멈춤 → `g.loop.step(t)`로 결정적 프레임 펌프 + 계측 eval로 검증(스크린샷은 hidden-rAF로 타임아웃). S1~S10 모두 이 방식으로 통과. 멀티는 페이크 동기 transport 주입으로 PlayScene 배선까지 검증.

### ⚠️ S4 검증 경계 (혼자 못 끝내는 지점)
S4 실제 멀티는 (a) worker(wrangler dev) 구동 + (b) **클라 2개(2기기/2탭)**가 있어야 end-to-end 검증 가능.
`wrangler dev --assets .`는 무한 reload 이슈(메모리 [[platform_wrangler_dev_reload_loop]])로 프리뷰 검증이 막힘.
→ **대안:** S4를 "transport 추상화"로 짜고, **in-page 2-client 루프백**(BroadcastChannel/직접 버스, 지연·지터 시뮬)으로 송수신+보간 파이프라인을 *혼자 검증*. 실제 `RelayTransport`(shared/relay.js 래핑)는 코드로 작성하되 worker+2클라 통합테스트는 사용자 단계.

### S4 구현 가이드 (codex 리뷰 — 재개용)
net.js에 이미 반영됨: RemoteClock(EWMA), push seq/단조검사, delay 180/maxExtrap 90, 외삽 dt·속도 clamp.
남은 작업:
1. `transport.js`: `LoopbackTransport`(로컬 검증) + `RelayTransport`(shared/relay.js: join→welcome→relay_joined, `send`/`on('message',{from,payload,ts})`).
2. `netclient.js`: 로컬 위치를 **10~15Hz로 throttle 송신** `{type:'pos',seq,x,y,vx,vy,grounded,facing}`. 수신 시 `from`을 identity로(payload.playerId 신뢰 금지), `remoteClock.observe(msg.ts, scene.time.now)` → `remote.push({seq,t:toLocal(ts),x,y,vx,vy})`.
3. 연결 규칙: `relay.ready` 후 송신 / `from===playerId` 무시 / presence 이탈 시 buffer 제거 / reconnect 시 `remote.reset()` 후 첫 2스냅까지 hold.
4. DO는 권위 아님 → 비정상 좌표는 clamp만, 승패 판정엔 미사용.

### 다음 작업
**솔로 검증 가능 범위(S1~S8·S10·S4배선)는 모두 완료.** 남은 건 실멀티 환경이 필요:
1. **(사용자 단계) S4 실멀티 통합테스트** — `worker`(wrangler dev) + 2클라(2탭/2기기). registry에 `RelayTransport` 주입. wrangler reload 이슈([[platform_wrangler_dev_reload_loop]]) 우회 확인 필요.
2. **(사용자 단계) S6 부활/합류** — 실 피어 근접 부활·공동 운명. NetClient 피어 sample 위에 구현하되 검증은 2클라 필요.
3. **(사용자 단계) S5 2인 이벤트 권위 / S9 D1 진도 동기화** — DO 공유상태·idempotency, worker 필요.
4. (정리, 솔로 가능) `games/_template-phaser/` 표준 템플릿 추출.

### S4 배선 메모 (codex 3차 리뷰 반영 — 2026-06-06)
- **주입 계약:** PlayScene은 registry `coopTransportFactory`(전송계층 **팩토리 함수**)를 읽는다. 없으면 솔로. 있으면 매 create마다 `_transport=factory()` 새로 만들고 NetClient 생성, shutdown에서 `_transport.leave()`. → transport 소유권=PlayScene, 재진입 시 죽은 transport 재사용 안 함(HIGH 수정).
- **반영:** (HIGH)팩토리 소유권, (MED1)`net.ready` 후에만 sendPos(relay는 WS open 전 send=false라 초기 위치 드롭 방지).
- **실멀티 통합 단계 TODO(실 RelayTransport+worker+2클라에서만 발현·검증):**
  - (MED2) scene pause/transition 중 WS 수신 콜백이 멈춘 `scene.time.now`로 `RemoteClock.observe`를 오염시킬 수 있음 → 비활성 시 수신 무시 또는 monotonic clock.
  - (MED3) 같은 id 무중단 재합류 / sender seq 0 리셋 시 `RemotePlayer.lastSeq`로 새 스냅 장기 drop → reconnect 시 `remote.reset()` 계약 구현.
  - (MED4) `firstPeerId()`는 2인 전용. 3인+면 친구 슬롯/파티 페어/전체 렌더 중 택1 명시.
  - (LOW) 수신 좌표 finite-huge clamp(월드 밖 ghost 방지), grounded/facing을 sample 결과에 반영(원격 애니메이션), 이탈 후 지연 메시지의 ghost 일시 재생성.

### S4 메모 (codex 2차 리뷰 반영 완료)
- transport.js(Loopback+Relay) + netclient.js 작성·하드닝 완료. 루프백 결정적 검증 통과.
- 적용된 codex 수정: roster 키 정규화(worker `{id}` vs loopback `{playerId}` 둘 다 수용 — 안 하면 활성 peer 삭제됨), 깨진 payload 방어(ts/x/y/seq 유한수 검사), `sample(id, now)` 계약, index.html에 config/bootstrap/relay 로드.
- PlayScene 배선 시: NetClient 1회 생성·ready 전 구독·ready 후 sendPos, 시간축 일관(`now:()=>this.time.now` + `sample(id,this.time.now)`), peer null이면 고스트/마커 숨김, shutdown에서 `transport.leave()`. DummyPeer의 remote/remoteClock/_rxSeq 제거.

### 결정 변경
- **화면: 세로형 3:4 → 반응형(RESIZE) + 가로모드 지향**으로 변경(2026-06-06, 사용자). 세로 폰은 횡스크롤 전방 시야가 좁다는 판단. 세로일 때 회전 안내 오버레이 표시(터치+portrait 한정). 특정 기기 유불리는 감수.

### 구현 메모 (재개용)
- 서버: `npx http-server` (`.claude/launch.json`의 `static`, 포트 8090). URL: `/games/coop-adventure/index.html`
- 엔진: `shared/vendor/phaser-3.88.2.min.js` (버전 고정)
- 디버그: `window.__coop = { game, input }` 노출. `input._pressJump()/_releaseJump()`, `input.right=true` 등으로 입력 주입 가능. HUD에 vx/vy/grounded/coyote 표시.
- 카메라 좌측 바이어스: `setFollowOffset(-GAME_W*0.20, ...)` (음수가 좌측 바이어스 — 부호 주의!)
- 손맛 파라미터(play.js 클래스 속성): MOVE 250, JUMP_V -560, COYOTE 100ms, BUFFER 200ms, CUT 0.45, GRAVITY 1400

### 단계 체크리스트 (codex 권장 순서 + gemini 더미2P 반영)

- [x] **S1. 단일 캐릭터 손맛** — 가상패드, 코요테, 점프버퍼, 가변점프, 카메라 바이어스 ✅ 2026-06-06 (계측+시각 검증 완료)
- [x] **S2. 단일 로컬 스테이지** — 골인 깃발, 체크포인트, 별 수집, 죽음/재시작 ✅ 2026-06-06 (4기믹 계측+클리어 화면 검증)
- [x] **S3. 더미 2P 고스트** — 보간 렌더 레이어(net.js) + 진행도 인디케이터 ✅ 2026-06-06 (10Hz 피드→60fps 보간 매끄러움 계측, codex 리뷰 반영 후 재검증)
- [~] **S4. DO 상대 위치 중계** — ✅ transport 추상화(Loopback+Relay)+NetClient+루프백 검증. ✅ **PlayScene 배선 완료**(DummyPeer 제거 → registry 'coopTransport' 주입 시 멀티/없으면 솔로, ghost·진행바 가시성 토글, shutdown leave). 솔로+페이크 동기 transport 멀티 계측 검증. ⬜ 남음: RelayTransport+worker+2클라 **실멀티 통합테스트(사용자 단계)**
- [x] **S5. 공유 상태(솔로 버전)** — 비대칭 스위치→문(게이트, 4초 유지) + 게이트 뒤 보상 별 ✅ 2026-06-06 (계측 검증 + codex 리뷰: 끼임방지 pending-close/bounds판정/카운트다운 표시 반영). 2인 이벤트 권위는 S4 배선 후 확장
- [ ] **S6. 부활/합류 체크포인트** — 너그러운 근접 판정, 공동 운명 (S4 배선 후: 피어 대상)
- [x] **S7. 월드맵 + 진도 저장(localStorage)** — 별 1~3 평가, 스테이지 해금 ✅ 2026-06-06 (MapScene + ProgressStore + stages.js, 부트가 맵→플레이 연결, 클리어 시 recordClear)
- [x] **S8. 이모트 + 폴리시** — 이모트 버튼 3종(말풍선) + 별 획득 "+1"/HUD펀치 + DDA(3사망→코요테·버퍼 관대, 리스폰 무적 깜빡임) ✅ 2026-06-06 (계측 검증 + codex 리뷰 반영)
- [ ] **S9. D1 진도 동기화 + 이어하기 코드** — idempotency, 치트 검증(§2-8)
- [ ] **S10. 이미지 에셋 일괄 적용** — codex imagegen 위탁 (플레이스홀더 교체)
- [ ] **(후순위) 보너스 끝없이 모드 / 추가 스테이지 / Vite 전환 검토**

### 변경 로그
- 2026-06-06: v0.4 확정 (codex·gemini 리뷰 반영). 문서 생성, S1 착수.
- 2026-06-06: **S1 완료** — Phaser 무빌드 부트 + 입력추상화(input.js) + PlayScene 손맛(이동/마찰/코요테/버퍼/가변점프) + 좌측 바이어스 카메라. 브라우저 계측·시각 검증 통과. 카메라 offset 부호 버그 1건 수정.
- 2026-06-06: **S2 완료** — 별 수집(거리판정)+카운터 HUD, 체크포인트, 낙사 구덩이→죽음/체크포인트 리스폰, 골인 깃발→클리어 화면+탭 재시작. 4기믹 계측 + 클리어 화면 시각 검증 통과.
- 2026-06-06: **S3 완료** — net.js 보간 레이어(RemotePlayer) + 더미 피드(10Hz) + 진행도 바(나/친구 마커). codex 넷코드 리뷰 받아 RemoteClock(클럭 도메인 분리)·seq 중복제거·외삽 폭주 방지·delay 180 반영 → S4-ready. 보간 매끄러움 재검증.
- 2026-06-06: **반응형 전환** — Scale.RESIZE로 기기 꽉 채움, _layout()이 회전/리사이즈마다 카메라 offset·HUD·진행바 재배치. 가로 회전 안내 오버레이 추가. 점프 -560→-700(상승 ~169px). 800×965/900×450 양쪽 검증.
- 2026-06-06: **S4 루프백 레이어 완료** — transport.js(LoopbackTransport 검증용 + RelayTransport 프로덕션) + netclient.js(송신 throttle/peer관리/clock매핑/seq). in-page 2클라 결정적 검증(보간 knot=200·중간=150, clock 도메인 오프셋 학습, seq/깨진payload drop, roster 정규화). codex 2차 리뷰로 roster 키 불일치(HIGH)·payload 방어·sample(id,now)·shared 스크립트 로드 수정. 남음: PlayScene 배선 + 실멀티 통합테스트(worker+2클라).
- 2026-06-06: **S7 완료(문서 후행 동기화)** — MapScene(월드맵/스테이지 선택, 반응형 _layout) + ProgressStore(기기고정 익명 ID + 개인단위 진도 localStorage) + stages.js(1-1·1-2·1-3). 부트가 [MapScene, PlayScene]로 맵 우선, 클리어 시 별평가→recordClear→해금. (코드가 이전 세션에서 먼저 들어갔고 이번에 추적기 반영)
- 2026-06-06: **S5 완료** — 비대칭 스위치→문(게이트). 솔로: 밟으면 4초 유지, 게이트 뒤 보상 별. codex 리뷰 반영: (HIGH)게이트 닫힘 시 플레이어 겹침이면 'closing' 상태로 바디 재활성 보류→끼임/튕김 방지, (MED)스위치 판정을 switchPlate.getBounds() 기반 overlap으로, (LOW)카운트다운은 밟는 중 🔓·내려온 뒤 초표시. 결정적 계측 검증(open/closing/closed 전이).
- 2026-06-06: **S8 완료** — 이모트 버튼 3종(🙋빨리와/🙇미안/👍굿) 머리 위 말풍선(추후 파트너 전송), 별 획득 "+1" 팝+HUD 펀치, DDA(같은 스테이지 3사망→coyote+80·buffer+100 1회 발동 + 리스폰 무적 깜빡임 INVULN_MS). 계측 검증(이모트/별+1/DDA 발동/무적 set).
- 2026-06-06: **S10 캐릭터 스프라이트** — codex imagegen 위탁으로 말랑병아리(나)·민트고양이(친구) 측면 달리기 스프라이트 생성(크로마키 제거+128px). 물리 사각형(30x40)은 비가시로 유지하고 스프라이트 오버레이로 적용 → 손맛/충돌 회귀 0. 이동방향 flipX. 계측 검증.
- 2026-06-06: **S4 PlayScene 배선 완료** — DummyPeer 제거, registry 'coopTransport' 주입 시 NetClient로 멀티(내 위치 sendPos throttle + 원격 firstPeer sample 보간), 없으면 솔로(친구·진행바 숨김). now=scene 시간축 통일. shutdown에서 transport.leave(). 솔로+페이크 동기 transport 멀티 계측 검증(피어 등록·고스트 추적·진행바). 실 RelayTransport+worker+2클라 통합은 사용자 단계.
- 2026-06-06: **애니메이션 + 리액션/juice + 클리어 연출** (사용자 방향: 밀도=촘촘 프레임, 재미=합류/클리어 연출+리액션):
  - **달리기 애니메이션**: codex imagegen으로 말랑병아리·민트고양이 **3x3=9프레임 측면 달리기 시트** 생성→크로마 제거→768px(프레임 256). Phaser spritesheet 직접 그리드 슬라이스 + anims(frameRate 14, loop). playerSprite/ghost를 image→**sprite**로 교체. 상태머신: 공중=점프(f4)/낙하(f1) 포즈, 접지+이동=run, 접지+정지=idle(f0).
  - **리액션 juice**: 점프 스트레치·착지 스쿼시(쿨다운 150ms)를 **스케일 스프링**(매 프레임 base로 lerp, 트윈 아님)으로 — 프레임 애니(텍스처)·무적(alpha)과 속성 분리해 충돌 없음. 재등장 💨 뿅.
  - **클리어 연출**: 꽃가루 22 + 환호 바운스(친구 있으면 함께). codex 리뷰 반영: 클리어 시 스쿼시/alpha 잔상 base 정규화, 친구 바운스 ghost.visible 가드+ghostTag 동반.
  - 계측 검증: run 프레임 진행(0→1)·공중 f4/f1·idle f0·스케일 스프링 공존·클리어 정규화. 콘솔 에러 0.
  - 결정: locomotion은 촘촘 9프레임, 정지/공중은 단일 포즈. 추후 jump/fall/hurt/win 전용 포즈 시트 추가 시 같은 리그에 프레임만 확장.
- 2026-06-06: **에셋 재생성(스타일 교정 + 촘촘 + idle)** — 사용자 피드백 반영:
  - **스타일**: 기존 하드 셀셰이딩(두꺼운 검은 외곽선·진한 원형 볼터치·쨍한 노랑) → 정전 말랑병아리(jump-climber 에셋) 기준 **부드러운 파스텔 에어브러시풍·은은한 타원 볼터치·연버터색·얇은 외곽선**으로 재생성.
  - **촘촘**: 달리기 9→**16프레임(4x4)**, frameRate 14→20.
  - **idle 포즈 신규**: 기존엔 달리기 프레임(한 발)을 idle로 써서 어색 → 두 발로 선 전용 idle 텍스처(chick-idle/cat-idle). 상태머신 idle은 텍스처 전환.
  - **정렬 파이프라인**: 슬라이서가 크로마 제거→프레임 트림→중앙값 높이 단일 스케일(크기 pulsing 방지)→발 baseline+가로중심 정렬. 게임은 origin(0.5,1)로 발을 바디 바닥(player.y+20)에 고정(스쿼시도 발 기준).
  - idle/run/air 텍스처 모두 프레임 256 → setTexture해도 scale base 일정(juice 스프링 유지). 미사용 chick.png/cat.png 제거.
  - 계측 검증: 16프레임·idle 텍스처 발 y=700(바디바닥)·달리기 진행·공중 스트레치 공존. 콘솔 에러 0.
- 2026-06-06: **에셋 일괄 생성(19종) + 비율버그 근본수정** — 자세한 처리/반영은 `assets/ASSETS_PLAN.md`.
  - codex 병렬 생성: 캐릭터 5(병아리·강아지·고양이·토끼·햄스터, 각 **idle+달리기 단일 시트**), 배경 3, 발판타일 3, 이펙트 4, UI/배너 4.
  - **#1 비율 어색함 수정**: idle/run 따로 생성→몸 비율 달랐던 것. **한 시트(frame0=idle, 1~15=run)에서 생성**해 같은 디퓨전 패스로 비율 일치. 측정으로 원인 확인 후 적용.
  - 측면 보장: 1차 정면 생성됨 → 측면 강조 재생성. cat·puppy·rabbit 프로필, 둥근 chick·hamster는 2차 재생성으로 측면 확보.
  - play.js를 단일시트 방식으로 전환(idle=setFrame0, run anims 1~15, 공중 f6/f12, 텍스처 교체 제거). chick(나)·cat(친구) 배선·검증 완료. 나머지(캐릭터선택·배경·타일·이펙트·UI)는 ASSETS_PLAN대로 다음 세션 반영.

---

## 9. 미해결 / 추후 사용자 리뷰 필요 항목
- 게임 정식 한글 타이틀 확정 ("말랑프렌즈 협동대모험" 가제)
- 등장 캐릭터/능력 세트 (jump-climber 캐릭터 재사용 여부)
- 이미지 아트 방향 (codex 일괄 생성 시점에 결정)
- 월드/스테이지 수, 보스 도입 여부 (메인 루프 검증 후)
