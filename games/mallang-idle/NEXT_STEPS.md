# 말랑프렌즈 키우기 — 리뉴얼 결과와 다음 검증

최종 갱신: 2026-11-22. 이번 구현의 단일 설계 원천은 [RENEWAL_PLAN.md](RENEWAL_PLAN.md).
사용자가 S1~S6 전체 구현을 승인했다. git 커밋·원격 배포·새 이미지 생성은 하지 않았다.
기존 `tests/browser-harness.js`의 `Page.navigate` 변경은 유지했다.

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
