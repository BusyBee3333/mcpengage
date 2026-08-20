CREATE TABLE IF NOT EXISTS local_drafts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  draft_kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS local_draft_versions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  draft_kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id, version)
);
