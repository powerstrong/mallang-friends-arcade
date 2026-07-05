-- 리더보드에 캐릭터 표시용 — 어떤 캐릭터로 낸 기록인지 저장한다.
-- 주의: SQLite ALTER TABLE ADD COLUMN 은 IF NOT EXISTS 가 없어 재실행하면
-- duplicate column 오류가 난다. 배포 워크플로에서 이 파일만 실패 허용으로 실행한다.
ALTER TABLE scores ADD COLUMN character_id TEXT;
