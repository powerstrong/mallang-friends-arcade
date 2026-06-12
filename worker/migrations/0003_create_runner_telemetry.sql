-- 러너류 게임 플레이 텔레메트리 — 난이도 튜닝용(클리어율만으론 튜닝 불가).
-- 게이트 선택/사망 원인/보스 잔여 HP 등을 런 단위로 적재한다.
-- 닉네임 등 개인정보는 받지 않는다(run_id 는 클라가 생성한 무작위 토큰).
-- 보관기간은 worker scheduled(cron) 가 world 로그와 함께 정리한다.

CREATE TABLE IF NOT EXISTS runner_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT NOT NULL,      -- 'machine-animal-runner' 등 게임 슬러그
  run_id     TEXT NOT NULL,      -- 한 판(런) 식별자, 클라 생성 무작위 토큰
  stage      INTEGER NOT NULL,   -- 스테이지 번호(1~)
  ev         TEXT NOT NULL,      -- run_start | gate | death | run_end
  payload    TEXT,               -- JSON 상세(게이트 선택·전후 수치·사망원인·보스 HP 등)
  ts         INTEGER NOT NULL,   -- epoch ms (클라 시각)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 기간 집계·보관기간 정리(ts 범위)용.
CREATE INDEX IF NOT EXISTS idx_runner_events_ts ON runner_events (ts);
-- 런 단위 묶음 조회(게이트 선택 흐름 추적)용.
CREATE INDEX IF NOT EXISTS idx_runner_events_run ON runner_events (run_id);
