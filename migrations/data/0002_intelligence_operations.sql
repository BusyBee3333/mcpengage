PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS policy_versions (
  tenant_id TEXT NOT NULL,
  policy_kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, policy_kind, version)
);

CREATE TABLE IF NOT EXISTS score_versions (
  tenant_id TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  classification TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider_object_id, model_version, content_hash)
);

CREATE TABLE IF NOT EXISTS recommendation_versions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  priority INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id, model_version)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_call_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  provider_cursor TEXT,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entity_type)
);

CREATE TABLE IF NOT EXISTS daily_analytics_facts (
  tenant_id TEXT NOT NULL,
  fact_date TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_version TEXT NOT NULL,
  value_number REAL NOT NULL,
  source_event_count INTEGER NOT NULL,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, fact_date, metric_key, metric_version)
);

CREATE TABLE IF NOT EXISTS metric_versions (
  metric_key TEXT NOT NULL,
  version TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (metric_key, version)
);

CREATE TABLE IF NOT EXISTS attachment_metadata (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  provider_object_id TEXT,
  filename_digest TEXT NOT NULL,
  media_type TEXT,
  byte_size INTEGER,
  content_digest TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS score_versions_by_tenant_time
  ON score_versions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_by_tenant_date
  ON daily_analytics_facts (tenant_id, fact_date DESC);
