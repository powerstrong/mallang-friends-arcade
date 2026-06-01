-- 광장(WorldChannel) 접속·대화 기록 — 관리자 통계용.
-- DO 메모리/스토리지의 채팅 보관(2시간)과 별개로, 영구 분석을 위해 D1 에 적재한다.
-- 개인정보(닉네임·대화)가 담기므로 보관기간은 worker scheduled(cron) 가 정리한다.

CREATE TABLE IF NOT EXISTS world_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  lounge_id   TEXT,
  name        TEXT NOT NULL,
  character_id TEXT,
  joined_at   INTEGER NOT NULL,   -- epoch ms
  left_at     INTEGER,            -- epoch ms, NULL = 종료 미기록(크래시/하이버네이션)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 접속자 집계(일별/동시접속 추정)용. joined_at 범위 스캔이 잦다.
CREATE INDEX IF NOT EXISTS idx_world_sessions_joined ON world_sessions (joined_at);
-- 종료 기록 UPDATE 시 session_id 로 빠르게 찾는다.
CREATE INDEX IF NOT EXISTS idx_world_sessions_session ON world_sessions (session_id);

CREATE TABLE IF NOT EXISTS world_chat_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT,
  lounge_id   TEXT,
  name        TEXT NOT NULL,
  text        TEXT NOT NULL,
  zone_id     TEXT,               -- 발화 시점에 올라서 있던 부스(없으면 NULL)
  ts          INTEGER NOT NULL,   -- epoch ms
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 최근순 조회·보관기간 정리(ts 범위)용.
CREATE INDEX IF NOT EXISTS idx_world_chat_ts ON world_chat_log (ts);
