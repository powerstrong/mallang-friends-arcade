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
**S4 — PlayScene NetClient 배선** (다음 착수, 코드 솔로 가능). S1·S2·S3·**S5·S7·S8 완료**(브라우저 계측 검증 + codex 리뷰 반영). 보간 레이어(net.js)/transport/netclient는 S4-ready.
> 검증 방식: 프리뷰 페이지가 hidden 탭이라 rAF가 멈춤 → `g.loop.step(t)`로 결정적 프레임 펌프 + 계측 eval로 검증(스크린샷은 hidden-rAF로 타임아웃). S1~S8 모두 이 방식으로 통과.

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

### 다음 작업 (즉시 할 것)
1. (혼자 검증 OK) **S7 월드맵 + localStorage 진도** — 스테이지 선택·별 평가·해금
2. (혼자 검증 OK) **S8 이모트 + 폴리시 + DDA**
3. S4 마무리(부분 solo): PlayScene에 NetClient 배선(DummyPeer 교체, `controlMode`처럼 멀티/솔로 분기). 단, **실 동작은 RelayTransport+worker+2클라 통합테스트(사용자)** 필요.
4. (정리) `games/_template-phaser/` 추출

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
- [~] **S4. DO 상대 위치 중계** — 진행중. ✅ transport 추상화(Loopback+Relay)+NetClient+루프백 결정적 검증(clock도메인/seq/보간). ⬜ PlayScene에 NetClient 배선(DummyPeer 교체) ⬜ RelayTransport worker+2클라 통합테스트(사용자 단계)
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

---

## 9. 미해결 / 추후 사용자 리뷰 필요 항목
- 게임 정식 한글 타이틀 확정 ("말랑프렌즈 협동대모험" 가제)
- 등장 캐릭터/능력 세트 (jump-climber 캐릭터 재사용 여부)
- 이미지 아트 방향 (codex 일괄 생성 시점에 결정)
- 월드/스테이지 수, 보스 도입 여부 (메인 루프 검증 후)
