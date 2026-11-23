# 말랑프렌즈 키우기 — 리뉴얼 결과와 다음 검증

최종 갱신: 2026-11-22. 이번 구현의 단일 설계 원천은 [RENEWAL_PLAN.md](RENEWAL_PLAN.md).
사용자가 S1~S6 전체 구현을 승인했다. git 커밋·원격 배포·새 이미지 생성은 하지 않았다.
기존 `tests/browser-harness.js`의 `Page.navigate` 변경은 유지했다.

## 추가 작업: 퐁당 펭귄 (작업 트리만)

- 기존 쓰다듬기 미커밋 변경을 유지했다. 커밋·배포 없음.
- `penguin` / 퐁당 펭귄 / 💧 / 15층 / 공격력 +12%. 10층 편성 슬롯 이후,
  22층 푸딩 이전에 세 속성을 고를 수 있다. 기존 해금·컷신 화자는 유지.
- art2/out의 8종 PNG와 메타를 assets에 복사해 전투/친구/성장/응원/쓰다듬기에 연결.
  합류 컷신, 도감의 ‘함께하는 친구’, 민트와 짝꿍 ‘시원한 바람’(이동 -5%p) 추가.
- 1~30층 심술 구름을 🔥로 바꿔 일반 몹 속성을 각 100마리로 맞췄다. 보스 🍃 유지.
- 세이브 v12: 기존 v11의 빠진 펭귄 레벨만 1로 추가. 로컬·공유 계약·SQLite API에서
  기존 편성/성장/마음방울/쓰다듬기 보존과 새 펭귄 편성·레벨 저장을 검증했다.
- 밸런스 허용 범위 완화 없음. 30분 59층/여유비 2.188, 24h 217층/벽 3745.5초.
  선택 근거와 전후 지표는 BALANCE.md의 펭귄 절에 기록했다.
- 순수 Node: 게임+Worker 188 통과/2 기존 skip, 다른 게임 4개 파일 통과.
  4 seed×2 모델·오프라인 세션 포함. 카드 순서에 의존하던 UI fixture를 id 기준으로 변경.
- 지정 CHROME_PATH로 전체 브라우저 순차 실행 완료, 실패 0: 첫 방문 13·친구 모션 17·
  멀티탭 6·전투 무대 112 내부 검사, 펭귄 실좌표 편성/대표/성장/도감/전투,
  쓰다듬기 일반·감속 모드 통과. `git diff --check` 통과.
  400px 스크린샷: `work/shots/penguin_combat.png`, `work/shots/penguin_friends.png`
  (절대 경로 `/data/projects/mallang_idle_v2/work/shots/`).
- 실제 HTTP Worker/D1 브라우저 복원은 `IDLE_TEST_API` 미설정으로 skip. SQLite API 검증은 통과.

## 추가 작업: 친구 쓰다듬기 (작업 트리만)

- 필드 친구 좌표 히트박스(최소 48px): 선봉·따라오는 친구·선택한 알 친구. 다른 필드 탭의 응원/시련 건너뛰기는 유지.
- `engine/pet.js`: 친구별 1.5초 쿨다운, 행동 중에는 하트만, KST 하루 최대 5회 마음방울 +1. 시계 역행으로 일일 보상이 초기화되지 않음.
- `render/game.js` 입력/힌트/토스트, `render/stage.js` cute → cheer → CSS 행동과 위치별 하트/보상 표시. 감속 모드는 하트 1개와 페이드.
- 세이브 v11 `pet:{day,count}`, v10 이하 기본값 마이그레이션, 공유 save-contract 검증, `petHint` 튜토리얼 저장. 클라우드는 통째 스냅샷 규칙 유지.
- 검증: 게임 Node 11개 파일 137개 통과, Worker 120개 통과/2개 skip. 일일 한도·KST 날짜 변경/역행·로컬/클라우드 왕복·힌트/한도 안내 1회 테스트 포함.
- 지정 Chrome으로 브라우저 5개 파일 통과. 쓰다듬기 실좌표 탭 → 행동 클래스 부착을 일반/감속 모드 모두 확인. 기존 first-visit/friends-motion/multi-tab/stage 회귀도 통과. cloud-save 브라우저 테스트는 `IDLE_TEST_API`(로컬 Worker/D1) 미설정으로 skip.
- 커밋·배포 없음. 전투 계산과 엔진 RNG 변경 없음.

## 추가 작업: 전원 모션·편성 UX·대표/속성 (2026-11-22)

사용자 지시에 따라 작업 트리만 수정했다. 커밋·배포·저장 버전 변경 없음.

- 후위 2명도 1.7/2.3초 주기로 자기 공격 시트와 지원 사격을 함께 재생한다.
  4~8초 행동·작은 이모트, 보스 처치/챕터 클리어/친구 성장의 시간차 응원,
  선택한 알 친구의 뒤따르기·하트·회전을 기존 Stage.update 안에서 처리한다.
  전투 RNG/수치 변경 없음. DOM 재사용, 추가 타이머 없음, 감속 모드에서 새 모션 없음.
- 별도 작업자의 cheer/cute PNG 12장을 art/out에서 복사하고 meta.json 폭/프레임을 반영했다.
  모두 높이 220px 검증. 누락/로드 실패 시 CSS 동작으로 대체한다.
- 3칸 편성 바·대표 메뉴·명시적 자리 교체·취소·카드 안 키우기·짝꿍 칩 구현.
  빼기 후 빈자리는 저장/복원에도 유지한다. 최소 1명만 보장하며 자동으로 다시 채우지 않는다.
- 속성 배정은 사용자 제안 그대로. 대표 자기 패시브 ×1.5, 유리 피해 ×1.25,
  성장/요일과 곱하고 불리 패널티는 없다. 본편/시련/시뮬/파밍 예상 수입에 같은 상성을 사용한다.
  시뮬은 대표 순서도 비교한다. 계수·회귀 기준 변경 이유는 BALANCE.md 마지막 절 참고.
- 최종 baseline: 5분/30분/24h 각각 6/60/214층, 첫 벽 42초.
  최종 24h 최장 벽 3626.5초, 돌파 여유비 1.696. 첫 보스 도달/승리 26.5/49.5초.

검증:
- 모든 *.test.js를 지정 CHROME_PATH로 실행한 통합 실행: Node runner 54 통과, 실패 0.
  이후 추가한 시련 검사를 포함한 최종 순수 Node 실행은 50 통과, 실패 0
  (balance 42 / queue 18 / UI 계약 16 내부 검사도 각각 통과).
- 최종 브라우저 내부 검사: first-visit 13, multi-tab 6, stage 112,
  friends-motion 17 = 148 통과, 실패 0. 최신 모션 검사는 통합 실행 후 별도 재실행했다.
- cloud-save.browser는 IDLE_TEST_API 미설정으로 SKIP. 실제 로컬 Worker/D1 연결 검사는 미실시.
- git diff --check 통과. 400×900 스크린샷:
  /data/projects/mallang_idle_v2/work/shots/combat.png
  /data/projects/mallang_idle_v2/work/shots/friends.png
- 새 검사: 조용한 교체 방지/취소/대표 지정/빈자리 복원, 성장·요일·대표 수치,
  상성 HP/사건 시간/시련 소요 시간, PNG 규격, Stage.update 공격·행동·CSS 대체·감속·DOM 배치.
  코드상 남은 알려진 문제 없음. 실제 기기 체감/운영 저장 복구 미실시는 아래 기존 인수 상태 유지.

## 인수 상태

| 슬라이스 | 구현 결과 | 검증 상태 |
|---|---|---|
| S1 | 공유 저장 계약·v7·D1 해시 인증/CAS/멱등/백업·namespace·배포 설정 | SQLite와 번들 통과, 실제 D1 미실시 |
| S2 | 코드 발급/복원·30초 업로드·2초 중요 저장·재시도·파일·손상/충돌/멀티탭 방어 | 통신·quota·UI 핸들러 통과, 두 프로필 실제 API 복구 미실시 |
| S3 | v8·첫 알·6종 수집·Lv.20/별3·짝꿍3·v6 마음방울 1회 소급 | 결정론·RNG 0·왕복·재화·편성 단위 테스트 통과 |
| S4 | v9·KST·3회/8h 충전·요일 변칙·누적 출석·과제·업적6·모래시계 | 날짜·역행·상한·보상 1회·세션 지표 통과 |
| S5 | v10·만/억/조·다음 목표·순서 안내·복귀 카드·배지·응원·키보드 | 형식·DOM 배선·엔진/UI 행동열 일치 통과, 실브라우저 미실시 |
| S6 | 지표 조정·4 seed/2 모델 회귀·튜너·결과 JSON·규칙/코어 문서 | 로컬 자동 검증 통과, 운영/사람 평가 미실시 |

**S1/S2의 실제 D1·두 독립 프로필 완료 기준은 아직 충족하지 않았다.** 통신 모의 테스트나
SQLite 통과를 실제 복구 리허설 완료로 부르지 않는다. 릴리즈 완료 상태도 아니다.

## 최종 자동 검증

- 게임 테스트 **102개 통과, 실패 0**: balance 40, UI 계약 16, queue 18,
  friends 4, calendar 5, cloud-save 8, format 2, renewal 6, UI boot/행동열 3.
- `npm --prefix worker test`: **13개 파일 통과, 실패 0**. 새 idle API 파일의 상세 테스트
  **3개**도 직접 실행해 통과했다. 실제 SQLite 트랜잭션으로 SQL·CAS·백업·마이그레이션 2회 실행을 검사한다.
- `node scripts/validate-games.js`: **게임 9개 통과**.
- Wrangler prod/staging **dry-run 번들 성공**. 실제 배포나 원격 D1 변경은 하지 않았다.
- stage / first-visit / multi-tab 실브라우저는 **미실행 처리**: 테스트 서버가
  `listen EPERM: operation not permitted 127.0.0.1`로 막혔다. 브라우저 통과 0개이며 회귀 실패 판정과 구분한다.
- 실제 로컬 D1도 같은 EPERM. `cloud-save.browser.test.js`는 `IDLE_TEST_API`가 없어 명시 SKIP.
  샌드박스 밖에서 아래 리허설을 실행해야 한다.

```bash
node games/mallang-idle/tests/balance.test.js
node games/mallang-idle/tests/ui-contract.test.js
node games/mallang-idle/tests/queue.test.js
npm --prefix worker test
node scripts/validate-games.js
for t in friends calendar cloud-save format renewal ui-boot; do node games/mallang-idle/tests/$t.test.js; done
for t in stage first-visit multi-tab; do CHROME_PATH=/data/projects/mallang_idle_renewal_work/chrome-nosandbox node games/mallang-idle/tests/$t.browser.test.js; done
```

## 산책 지표

| baseline, seed 1 / 일요일 KST 시작 | 5분 | 30분 | 2h | 24h | 24h 세션 15/120 |
|---|---:|---:|---:|---:|---:|
| 도달층 | 6 | 53 | 134 | 212 | 179 |
| 최장 벽(활동 초) | 46.5 | 46.5 | 77 | 4109 | 222.5 |
| 평균 층 체류(초) | 58.50 | 34.19 | 53.67 | 405.69 | 53.74 |
| 돌파 여유비 | 1.13 | 1.98 | 1.68 | 1.46 | 4.23 |
| 알 개봉 / 보유 종류 | 1/1 | 3/3 | 6/6 | 6/6 | 6/6 |
| 최고 친구 레벨 | 1 | 7 | 11 | 16 | 12 |

첫 강화 12.5초, 첫 보스 도달 30초/돌파 53.5초, 첫 알 150.5초. 24h 벽 비율 **81.01%**,
세션 활동 벽 **28.29%**, 활동 유휴 **0%**, 오프라인 골드 **80.06%**.
seed 1/7/42/2026 × baseline/upper 목표 모두 통과. 기존 upper 회귀도 유지했다.
보조 10/710은 복귀 시 강화 35회 구매 가능·시련 1충전·오프라인 층 변화 0.
결과·이전 수치·탐색 JSON은 [tools/renewal-results/](tools/renewal-results/)에 있다.

```bash
node games/mallang-idle/tools/sim.js --minutes=5 --seed=1 --json
node games/mallang-idle/tools/sim.js --minutes=30 --seed=42 --json
node games/mallang-idle/tools/sim.js --hours=2 --seed=7 --json
node games/mallang-idle/tools/sim.js --hours=24 --seed=2026 --json
node games/mallang-idle/tools/sim.js --hours=24 --sessions=15/120 --json
node games/mallang-idle/tools/sim.js --hours=24 --sessions=10/710 --json
node games/mallang-idle/tools/tune.js --renewal --top=5
```

## 샌드박스 밖에서 할 일

1. 로컬 D1에 `worker/migrations/0005_create_idle_saves.sql`을 **두 번** 실행한다.
   모든 CREATE/INDEX는 IF NOT EXISTS다. 운영 워크플로에도 0005 실행 줄을 추가했다.
2. 로컬 Worker를 `worker/wrangler.toml`로 기동한다. 예:
   `cd worker && npx wrangler dev --config wrangler.toml --port 8787`.
3. `IDLE_TEST_API=http://127.0.0.1:8787 CHROME_PATH=/data/projects/mallang_idle_renewal_work/chrome-nosandbox node games/mallang-idle/tests/cloud-save.browser.test.js`.
   서로 다른 Chrome 프로필 A 업로드 → 저장소 삭제 → B 코드 복원과 실좌표 화면을 검사한다.
   이 테스트는 localhost API만 받으며 운영 주소로 실행하지 않는다.
4. 위 브라우저 3종, 390px·키보드·감속·알 결과·복귀 카드·선택 배지를 실제 화면으로 확인한다.
5. 배포 전후 prod/staging Worker와 D1 migration을 확인한다. 같은 DB를 쓰므로
   서버의 `IDLE_NAMESPACE=prod/staging`이 필수다. 클라이언트 namespace 입력은 받지 않는다.
   `shared/config.js`의 staging 주소를 채워 프리뷰가 prod로 폴백하지 않도록 했다.
   **staging Worker 실배포/주소 도달성은 미검증**이므로 프리뷰와 기존 다른 게임의 API도 함께 확인한다.
6. 보호자/어린이의 5분 재미 평가와 실기기 발열·배터리·터치 목표 크기를 확인한다.

## 구현을 이어갈 때 지킬 것

엔진은 DOM·시계를 직접 읽지 않는다. 시간은 인자로 주입하며 보상 RNG는 연출과 분리한다.
친구/알/일일/시련 보상은 연출 전에 확정·저장한다. 오프라인은 골드만 정산한다.
코드는 payload 밖의 로컬 연결 키, 서버에는 SHA-256 해시만 둔다. 로컬 복원 의도를 먼저
기록해 quota/중간 종료 뒤에는 조회부터 재개한다. DEV의 클라우드 읽기/쓰기는 비활성화한다.
충돌은 층→친구 총 레벨→도감 종류→강화→처치→활동 시간의 전체본 선택이며 재화를 합치지 않는다.
이미 지워져 백업도 없는 과거 세이브는 이 기능으로 되살릴 수 없다. 코드와 모든 사본을 잃어도 같다.
