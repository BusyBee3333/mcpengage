PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shard_routes (
  tenant_id TEXT PRIMARY KEY,
  shard_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_versions (
  version TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lifecycle_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('export', 'delete', 'backup', 'migration', 'backfill')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  target TEXT,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  object_key TEXT,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS backup_manifests (
  id TEXT PRIMARY KEY,
  shard_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  restore_drill_at TEXT
);

CREATE INDEX IF NOT EXISTS lifecycle_jobs_by_tenant_time
  ON lifecycle_jobs (tenant_id, requested_at DESC);
