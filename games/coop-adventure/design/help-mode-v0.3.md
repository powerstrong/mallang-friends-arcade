# 협동대모험 — "마음 탐정" 모드 (v0.3 · 확정 결정 + S-H1 빌드 플랜)

> v0.1 → v0.2 → v0.3: codex(엔지니어링)·gemini(UX) **2라운드** 리뷰 반영. v0.2의 설계 근거 위에 **구현 계약·작업분해**를 확정.
> 결론(양 모델 합치): 방향 좋음. **"추리는 눈으로, 보상은 수집으로", 서버 권위 + 클라 예측, 스코프 1동사."** 다음 = S-H1 수직슬라이스 구현.

---

## A. 확정 원칙 (절대 규칙)
1. **READ 금지, SEE 강제** — 단서/감정/선택지 전부 픽토그램+과장동작. 텍스트 0줄로도 풀려야 함.
2. **내면감정 = 외적단서 1:1** — 추상 금지. 난이도 레버는 *단서 수·헷갈림단서·반전*이지 *감정의 미묘함이 아님*.
3. **오답 = 콘텐츠** — 0.8초 silly 반응 후 즉시 재선택. 벌·롤백 없음. (오답이 정답을 오래 막으면 grief)
4. **협동은 눈으로** — 단서 자동 시각공유. 말 의존 0.
5. **1~2분 사수(75~90초)** — 이동 짧고 밀도↑, NPC 최소, 선택지 3택, 텍스트 0~1줄.
6. **서버 권위 + 클라 예측** — 보드/진단/게이트는 DO가 권위, 클라는 optimistic affordance까지만.

## B. v0.1 수직슬라이스(S-H1) 범위 = "삐진 토끼"
단서 2개(픽토그램) → 감정카드 3택 → 정답=🙇미안 이모트 → 토끼 비켜 문 열림. **해결동사=이모트 1종만.** 솔로+2인+DO+게이트+리스폰 포함. 목표 75~90초.
- 컷: 찾아다주기/위험치우기 동사(2차), 보상 변주, 힌트 3티어(→2티어), AI 자동생성(손으로 JSON).
- 필수 포함(검증 대상): 데이터 episode 로드 / NPC 상호작용 / 단서 보드 / 진단 UI / 무벌 오답 / 정답 해결 / DO 라운드 상태 / 솔로 경로 / 2인 경로 / 게이트 오픈 / 체크포인트 리스폰.

---

## C. 구현 계약 (codex 2R)

### C1. 단서 보드 = 서버 권위, 클라 예측
- 클라: overlap 감지 → `touchClue{episodeId, clueId, eventId}` 요청.
- DO: clueId/slot/ownership/phase 검증, `touchedClues[clueId]` 없을 때만 기록(first-touch). 매 mutation 뒤 `diagnosisEnabled = requiredClues.every(touched)` 계산해 snapshot에 포함, `rev++`.
- 클라: `diagnosisEnabled`를 직접 결정 X — snapshot/rev를 따름. 로컬은 버튼 밝힘 같은 affordance만.
- **race**: DO 단일 이벤트 순서가 권위. 동시 마지막단서 → 첫 처리에서 채워지고 둘째는 no-op ack. `by`=최초획득자(필요시 `alsoBy[]`).
- **reconnect**: join/rejoin 시 DO가 `HEART_SNAPSHOT{rev,episodeId,touchedClues,diagnosis,finalAction,gateOpen,diagnosisEnabled,serverNow,slotMap}` 송신 → 클라 전부 재구성. rev보다 오래된 ack/broadcast 폐기.
- **영속**: DO state를 `ctx.storage`에 episode별 저장(현 moduleGames는 in-memory Map → hibernation에 약함).
- **멱등**: `eventId = playerId + pageInstanceId + localSeq`. 같은 eventId 다른 payload → `EVENT_ID_REUSE` 거절. processed-cache는 bounded.

### C2. 진단(submitDiagnosis) = 누구나 누름 (합의 X)
- 75~90초에 진단까지 합의 요구하면 흐름 막힘. 합의감은 **마지막 finalAction(둘 ready)**에서만.
- 전제: `diagnosisEnabled===true && diagnosis.correct!==true`. DO가 answerId ∈ options 검증.
- 정답 → **terminal**: `{selectedBy,answer,correct:true,at}`, `rev++`, 이후 submit은 동일 ack.
- 오답 → **non-terminal**: clues/board 유지, `lastWrong{selectedBy,answer,at,retryAfter}`만 갱신(짧게). 정답 처리 후 들어온 오답은 무시.

### C3. 코드 경계 (소유권)
- **PlayScene** = 센서/액추에이터: actor/zone overlap 측정, 이모트 raw 입력, `_setGateOpen(open)` 렌더/물리, 리스폰.
- **HeartHelpController** = 규칙 소유자: episode phase, clue 요청, 진단 가능 여부, final ready window, gate 의미상태, snapshot 적용.
- **HeartHelpClient** = 모듈 WS: `mod` 송수신, eventId/rev/ack.
- **NetClient** = 지금처럼 위치 보간 전용 유지(절대 섞지 말 것).
- **S5 재사용/충돌**: `_setGateOpen`(play.js:313) 재사용. 단 **heart mode에서 기존 로컬 switchPlate 판정(play.js:450) 비활성** — 안 그러면 DO가 닫은 문을 로컬 S5가 다시 엶.
```js
if (this.heartHelp) { this.heartHelp.update(t, { playerBounds, emote: this.consumeHeartEmote() });
                      this._setGateOpen(this.heartHelp.state.gateOpen); }
else { this._updateS5LocalGate(t); }
```
- `solveEpisode`는 클라 명령 아님 — DO가 finalAction 충족 시 내부 terminal transition. 클라 노출 명령은 `readyFinalAction`까지.

### C4. 서버 = 기존 모듈 게임 경로에 붙임 (코드 확인됨)
- 워커에 `SERVER_GAME_MODULES`(gameModules.js) 레지스트리 존재. 인터페이스 `onJoin/onMessage/onLeave` + `ctx.state/storage/sessions/roster/broadcast/sendTo`. 레퍼런스 `worker/src/games/example_server_game.js`.
- → `worker/src/games/heart-help.js` 모듈 작성 후 gameModules.js에 등록. 클라는 `join_game{gameId}` 후 `{type:'mod', payload}` 통신.
- 'coop-adventure'는 예약 id 아님 → 등록 가능. registry/worker GAME_PATHS에 coop-adventure 추가 필요할 수 있음(현재 미등록).
- **서버권위=코어 변경 → 관리자 리뷰 필수**(docs/SERVER_GAMES.md).

### C5. EpisodeLoader 런타임 hard-fail 최소목록 (이거 없으면 크래시)
- root: version,id,mode,durationTargetSec
- main: actorId,diagnosisAnswer,solveVerb,requiredEmote
- actors: non-empty, 각 id/(type|prefab)/finite x,y/anim; main.actorId ∈ actors
- clues: 각 id,tier,pictogram; text 없거나 문자열(→ `''` normalize)
- requiredClues: 모든 id ∈ clues
- diagnosis.options ≥2, 각 answerId,icon; correct == main.diagnosisAnswer 이고 둘 다 option에 존재
- coopVariant.requiredPlayers===2 → clueOwnership.p1/p2, finalAction, finalWindowSec
- gates/assetKeys 없으면 [] normalize; failSoftResponse/reward/textLimits/locale/wrongResponse 기본값 normalize
- 참조무결성·unused asset·textLimits·ownership·정합은 **EpisodeValidator(검수용, 런타임 미탑재)**가 담당.

---

## D. UX 계약 (gemini 2R)

### D1. 픽토그램 안전망 = 시각적 점진 노출 (해독 못해도 풀리게)
1. **발견**: 단서 획득 시 아이콘이 머리 위 0.5초 크게 뿅.
2. **강조**: 진단 진입 시 관련 신체부위 glow + 캐릭터가 그 부위 만지는 전용 대기 애니.
3. **실패**: 오답 시 힌트 NPC가 말풍선으로 단서 아이콘 **리플레이**(텍스트 대신).
- Ref: Toca Life World(글자 0, 아이콘+애니로 수백 상황).

### D2. 2인 단서 트레이 = 양끝단 수직 분할(Peripheral Split)
- **좌상**: 내 단서(P1 테두리) / **우상**: 친구 단서(P2 테두리) / **중상**: 둘 다 차면 진단(돋보기) 버튼 내려옴.
- 엄지 사정거리 밖 상단 코너=정보확인 최적, 중앙 시야 확보. 색은 **server slot 기준**(reconnect 후 안정).

### D3. 온보딩 = 강제 루프 + 유령 손가락 (글자 0)
1. 첫 판 단서는 무조건 앞길에 배치(이동 중 자동 획득).
2. 획득 즉시 일시정지 + **유령 손가락**이 트레이→NPC→감정카드 동선을 글로우로 지시.
3. 첫 진단은 선택지 1개만 활성(강제 정답).
- Ref: Sago Mini(손가락 지시선만으로 복합기능 교육).

### D4. 감정카드 미리보기 = 정답유출 아닌 자기교정
- 미리보기는 캐릭터가 직접 수행하되 정답일 때만 '반짝이는 눈', 오답은 '갸우뚱' → 추리 여지 유지. 아이에겐 추리보다 *결과를 미리 아는 안전함*이 효능감.

### D5. 테마/리텐션 = 마음 스티커 → 탐정 수첩
- 성공 시 NPC가 **마음 스티커** 드롭 → 먹으면 **탐정 수첩(도감)** 등록 → 탐정 장비(돋보기/모자/망토) 업글·꾸미기 해금. "도왔다"(도덕) + "모았다"(수집).

### D6. 부모 소구 = SEL(사회정서학습)
- "외적 신호로 내면 감정을 유추하는 공감의 인지과정을 게임화." 포지션="비언어 소통 협동 퍼즐". 리포트 "오늘 토끼의 서운함을 읽어냈어요" 한 줄.

### D7. 액션 손맛 대체 = "채워지는 juice"
- 성공: 파스텔 파티클+행복댄스+'파바박' 꽃피는 사운드. Ref: Chuchel/Snipperclips/Sky.

---

## E. S-H1 작업 분해 (파일·순서·검증)
> 검증: 프리뷰 hidden탭 rAF 멈춤 → `g.loop.step(t)` 펌프 + eval 계측(스크린샷 대신). 서버 로직은 worker 단위테스트.

1. **데이터** `episodes/manifest.json`, `episodes/zone1_rabbit.json` — 기존 asset key만. 검증: EpisodeValidator 통과.
2. **EpisodeValidator.js** (Node/브라우저 순수함수, 런타임 미탑재) — 잘못된 clue ref/missing main/wrong correct fixture가 fail.
3. **EpisodeLoader.js** — fetch/normalize/`window.Coop.Content.loadEpisode(id)`. 검증: eval로 normalized defaults·required 확인.
4. **worker/src/games/heart-help.js** — onJoin(snapshot), onMessage(touchClue/submitDiagnosis/readyFinalAction), state(rev,touchedClues,diagnosis,finalAction,gateOpen,processed), ctx.storage 영속. 검증: `worker/tests/heart-help.test.mjs`(동시 마지막단서/중복eventId/reconnect snapshot/오답 retry/정답 terminal).
5. **gameModules.js (+ room.js/world.js/GAME_PATHS)** — 모듈 등록, coop-adventure path mirror. 검증: join_game→HEART_SNAPSHOT unit.
6. **HeartHelpClient.js** — 모듈 WS, rev/ack/eventId. 검증: fake WS로 rev discard/중복 ack/reconnect apply.
7. **HeartHelpController.js** — episode→런타임, 보드/진단/final/gate 소유. 검증: applySnapshot/onClueOverlap/onDiagnosisPick 상태.
8. **play.js** — heart mode 분기, S5 local gate 비활성, _setGateOpen/리스폰/카메라 재사용. 검증: 펌프 후 clue overlap→board fill→diagnosis→final ready→gate open 계측.
9. **index.html/game.js** — 스크립트 로드 순서(client/controller는 play scene 전; validator는 런타임 제외). 검증: 전역 존재 확인.

**솔로 우선** 구현(1·3·7·8 핵심) → 75~90초 완주 계측 → 그 다음 서버권위(4·5·6)·2인 경로. 서버 코어 변경 전 사용자/관리자 리뷰.
