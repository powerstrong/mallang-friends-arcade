# 협동대모험 — "마음 탐정" 모드 (v0.2)

> v0.1 → v0.2: codex(엔지니어링)·gemini(UX/키즈) 1차 리뷰 반영.
> 핵심 변경: ①제로 텍스트(단서=픽토그램/동작) ②협동=시각 자동공유 보드(말 필요 없음) ③오답=짧고 웃긴 반응 ④스코프 1동사로 축소 ⑤episode=플레이가능 구역 스펙으로 스키마 강화 ⑥테마 "마음 탐정".

---

## 0. 한 줄 컨셉
> **때리는 게임이 아니라 같이 있어주는 게임.** 곤란에 빠진 친구의 *마음을 탐정처럼 알아채서* 도와주고 길을 연다.
> 테마 래핑: **"마음 탐정"** — 단서를 *수집·발견*하는 재미(gemini).

## 1. 설계 5대 원칙 (리뷰 합의 = 절대 규칙)
1. **READ 금지, SEE 강제.** 단서·감정·선택지는 전부 **픽토그램 + 캐릭터 동작(과장된 피지컬 코미디)**. 문장은 보조일 뿐, 없어도 풀려야 함.
2. **내면감정 = 외적 단서.** "서운함" 같은 추상은 금지. 반드시 눈에 보이는 신호와 1:1 연결(배고픔→배 문지르기+🍎, 부딪힘→💢별+범프 자국).
3. **오답은 콘텐츠.** 틀리면 1초 내 *귀여운 silly reaction* 후 즉시 재선택. 벌 없음·되돌림 없음.
4. **협동은 눈으로.** "뭐 들었어?" 말 의존 금지 → **단서 자동 시각공유**(내가 단서 얻으면 친구 화면에도 아이콘 뜸).
5. **1~2분 사수.** 이동 짧고 밀도↑, NPC 최소, 선택지 3개 고정, 텍스트 0~1줄.

## 2. 한 판(구역) 루프
```
[짧고 밀도높은 달리기] → [메인 친구 발견(길 막음, 과장 동작으로 감정 표출)]
   → [근처 NPC/오브젝트에서 단서 픽토그램 수집(자동 시각공유)]
   → [진단: 감정카드 3택(아이콘)] → [정답 해결동사 1방]
   → [친구 풀림(비켜줌/발판/합류) + "채워지는" juice 보상] → [다음 구역]
```
목표 시간 **75~90초**.

## 3. v0.1 수직슬라이스 (codex 권고대로 1동사로 고정)
**"삐진 토끼"**: 단서 2개(픽토그램) → 감정카드 3택 → 정답=🙇 미안 이모트 → 토끼가 비켜 문 열림.
- 해결 동사 = **이모트 달래기 1종만**. (찾아다주기/위험치우기는 2차 — 스코프·UI 큼)
- NPC: 힌트형 1 + (잡소리형 1, 선택). 힌트 티어 2단(흐릿→친절).
- 솔로 경로 + 2인 경로 + DO 라운드 상태 + 체크포인트 리스폰 = **반드시 포함**(이게 검증 대상).
- 보상 변주 없음: 문 열림 + 짧은 juice + 별 1.

## 4. 진단 UI (gemini: 시험지처럼 보이면 안 됨)
- 선택지 = **감정 카드**(큰 아이콘): 예) 😢서운 / 😴졸림 / 😋배고픔. 글 없이 그림.
- "정답 고르기"가 아니라 "마음 알아맞히기" 톤. 카드 호버 시 캐릭터가 그 감정 미리보기 흉내(피드백).
- 오답: 카드 흔들+토끼가 갸웃/더 삐짐(웃김) → 0.8초 후 재선택.

## 5. 협동: 시각 자동공유 보드 (gemini HIGH)
- 화면 가장자리에 **단서 트레이**: 슬롯이 비어있다가, 누구든 단서 발견 시 **양쪽 화면 모두**에 아이콘 채워짐("내가 발견"=밝게 / "친구가 발견"=테두리 색 구분).
- 말로 안 해도 "아 저거구나" 가능. 진단은 보드가 다 차면 활성.
- 마지막 한 방(코덱스 HIGH): **정밀 동시입력 금지.** 둘 다 토끼 근처 trigger zone + 3초 내 둘 다 ready → 해결. 실패해도 벌 없음.
- 솔로: 단서가 전부 내 동선, 보드는 혼자 채움, 마지막 1인 분기.

## 6. 액션 손맛 대체 = "채워지는 juice" (gemini MED)
- 도움 성공 시: 파스텔 파티클 분출 + 친구 행복 댄스 + **"파바박" 꽃피는 사운드**(맑은 '팅' 말고 강한 긍정).
- 조작 쫀득함 유지: (2차 찾아다주기 때) 물건이 통통/자석처럼 붙음.
- 레퍼런스: **Chuchel**(비언어 리액션), **Snipperclips**(협동 피지컬), **Sky**(비폭력 감정 상호작용).

## 7. episode 데이터 스키마 (codex: "이야기"가 아니라 "플레이가능 구역 스펙")
```js
{
  version: 1,
  id: "zone1_rabbit_sulky_emote",
  mode: "heart_help",
  locale: "ko",
  durationTargetSec: 90,

  main: { actorId: "rabbit_01", emotion: "sulky",
          diagnosisAnswer: "needs_apology", solveVerb: "emote", requiredEmote: "sorry" },

  actors: [
    { id: "main",   type: "mainFriend", prefab: "rabbit", x: 820, y: 360, anim: "sulk" },
    { id: "hint_a", type: "hintNpc",    prefab: "cat",   x: 420, y: 360, clueId: "clue_bump" },
    { id: "flav_a", type: "flavorNpc",  prefab: "duck",  x: 620, y: 360 }
  ],

  // 단서: 표시용 픽토그램(텍스트 아님). text는 선택적 보조.
  clues: [
    { id: "clue_bump",     tier: 1, pictogram: "fx_bump",  text: "" },
    { id: "clue_not_angry",tier: 2, pictogram: "icon_soft", text: "" }
  ],
  requiredClues: ["clue_bump"],            // 진단 활성에 필요한 최소 단서

  // 판정용 answerId ↔ 표시용 아이콘 분리(codex)
  diagnosis: {
    options: [
      { answerId: "hungry",         icon: "card_hungry" },
      { answerId: "sleepy",         icon: "card_sleepy" },
      { answerId: "needs_apology",  icon: "card_sorry"  }
    ],
    correct: "needs_apology",
    wrongResponse: { anim: "tilt", sfx: "boing", ms: 800 }   // 짧고 웃긴 무벌 반응
  },

  coopVariant: { requiredPlayers: 2, clueOwnership: { p1: ["clue_bump"], p2: ["clue_not_angry"] },
                 finalAction: "both_near_and_emote", finalWindowSec: 3 },
  soloVariant: { clueOwnership: "any", finalAction: "single_emote" },

  gates: [ { id: "rabbit_block", opensWhen: "episode_solved" } ],
  reward: { stars: 1, companion: "rabbit_01" },
  failSoftResponse: { neverBlock: true },
  assetKeys: ["rabbit", "cat", "duck", "fx_bump", "icon_soft", "card_hungry", "card_sleepy", "card_sorry"],
  textLimits: { clue: 0, dialogue: 24 }
}
```

## 8. 코드 구조 (무빌드 Phaser, 과분할 금지 — codex)
```
episodes/manifest.json            # 팩 목록
episodes/zone1_rabbit.json        # 에피소드 데이터
src/content/EpisodeLoader.js      # fetch+가벼운 필수필드 체크(런타임)
src/content/EpisodeValidator.js   # 제작/검수용 풀 검증(런타임 미탑재)
src/modes/HeartHelpController.js  # episode → 런타임 오브젝트로 변환·진행 관리
src/scenes/PlayScene.js           # 씬은 episode 직접 해석 X, 컨트롤러가 구동
```
- 전역 네임스페이스: `window.Coop.Content.EpisodeLoader` 식 정리.
- 런타임은 **가벼운 필수필드 체크만**. 풀 JSON Schema 검증은 제작 단계.

## 9. DO(서버) — 에피소드 이벤트 상태 권위만 (codex HIGH)
```js
{ episodeId, touchedClues:{id:{by,at}}, diagnosis:{selectedBy,answer,correct},
  finalAction:{p1Ready,p2Ready,solved}, gateOpen }
```
- **멱등성 필수**: `eventId = clientId + localSeq`, DO에 짧은 processed-cache. `touchClue/submitDiagnosis/readyFinalAction/solveEpisode`는 중복 와도 동일 결과.
- 단서 first-touch 기록(중복보상 방지). 위치 치팅은 강하게 막지 않음(비용 대비 가치 낮음, 느슨한 sanity check).
- 클라 낙관적 연출 → DO 확정 시 gate/reward 확정.

## 10. AI 제작 파이프라인 (codex HIGH)
`seed template → LLM 후보 → 자동검증(플레이가능성 lint) → 사람검수 → 플레이어블 프리뷰 → pack freeze`
- **LLM 담당**: 힌트/잡소리/감정반응 문구, 같은 뼈대 변주. **LLM 금지**: 정답판정·해결동사 로직·맵구조·협동조건·안전 최종판단.
- 자동 lint(함정 방지): 참조 소품/asset이 맵에 존재? 단서↔정답 연결? 텍스트 길이? 감정↔해결동사 정합?
- 캐릭터별 말투 가이드 + 금칙어/길이 lint(톤 섞임 방지).
- pack 메타: `packVersion, createdBy, reviewedBy, reviewStatus, contentHash`.
- 검수툴: 1차엔 로컬 HTML preview + JSON validation + 체크리스트면 충분.
- **v0.1엔 자동생성 안 함** — "AI가 만들었다 치고" 손으로 JSON 1~3개 넣어 포맷/검수 흐름만 확인(codex MED).

## 11. 연령 대응 (gemini)
- 저학년(6~8): 효능감 자체가 보상. 1:1(슬픔→위로) 직관 + **과장 리액션**으로 지루함 방지.
- 고학년(9~12): 단순반복 금방 질림 → **반전 사정**(우는데 사실 매운 거 먹어서). 단, 반전도 **외적 단서로 보여줘야**(🌶️아이콘) — 미묘하면 '랜덤 찍기'됨(codex 경고와 합치).
- 난이도 레버 = 단서 수·헷갈림 단서(red herring)·반전. **감정의 미묘함이 아님.**

## 12. 신선함 레버 (양산 ≠ 새로움; gemini MED) — 2차+
- 상황(에피소드)만 양산하지 말고 **환경 변주**를 곱하기: 중력/바람/미끄럼 등 플랫포머 제약 × 마음진단. 매판 체감 달라짐.

## 13. 단계 (수직슬라이스 우선)
- **S-H1 (v0.1):** 삐진 토끼 1에피소드 데이터구동 완주(솔로+2인+DO+gate+리스폰). 75~90초 안정 = 확장 가치 검증. ← 지금 목표
- S-H2: 오답 silly 반응·juice·사운드 폴리시, 힌트 티어 2.
- S-H3: 2번째 해결동사(위험 치우기) + 감정 1종 추가.
- S-H4: AI 제작 파이프라인 lint + 검수 프리뷰 + 첫 콘텐츠 팩(손검수).
- S-H5: 찾아다주기 동사 + 환경 변주 + 동료 도감.

---

## 2라운드에서 물을 것
- (codex) §7 픽토그램 단서 스키마 + §9 단서 자동공유의 DO 이벤트/멱등 흐름이 견고한가. EpisodeLoader/Controller 경계와 PlayScene 배선(기존 코드 재사용)에서 빠진 곳. S-H1 작업 분해(파일/순서).
- (gemini) 제로텍스트 픽토그램 "언어"를 아이가 실제로 해독하나(배문지르기+🍎, 범프+💢). 작은 모바일 화면에 2인용 단서 트레이 배치. 첫 플레이 온보딩을 글자 없이 어떻게 가르치나.
