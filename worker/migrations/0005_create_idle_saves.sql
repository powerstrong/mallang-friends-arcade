CREATE TABLE IF NOT EXISTS idle_saves (
 namespace TEXT NOT NULL, code_hash TEXT NOT NULL, revision INTEGER NOT NULL,
 schema_version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
 last_request TEXT NOT NULL, PRIMARY KEY(namespace,code_hash)
);
CREATE TABLE IF NOT EXISTS idle_save_backups (
 namespace TEXT NOT NULL, code_hash TEXT NOT NULL, kind TEXT NOT NULL, slot TEXT NOT NULL,
 revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(namespace,code_hash,kind,slot)
);
CREATE INDEX IF NOT EXISTS idle_backup_revision ON idle_save_backups(namespace,code_hash,revision);
CREATE TABLE IF NOT EXISTS idle_save_requests (
 namespace TEXT NOT NULL, code_hash TEXT NOT NULL, request_id TEXT NOT NULL,
 revision INTEGER NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(namespace,code_hash,request_id)
);
CREATE TABLE IF NOT EXISTS idle_request_limits (
 namespace TEXT NOT NULL, subject TEXT NOT NULL, bucket INTEGER NOT NULL,
 count INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(namespace,subject,bucket)
);
CREATE INDEX IF NOT EXISTS idle_requests_expiry ON idle_save_requests(expires_at);
CREATE INDEX IF NOT EXISTS idle_limits_expiry ON idle_request_limits(expires_at);
