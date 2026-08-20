PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_preferences (
  tenant_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proof_claims (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  claim TEXT NOT NULL,
  category TEXT NOT NULL,
  skills_json TEXT NOT NULL,
  evidence_label TEXT NOT NULL,
  evidence_url TEXT,
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  allowed_contexts_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  archived_at TEXT,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS provider_entities (
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  provider_updated_at TEXT,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('official_provider', 'migrated_history')),
  source_call_id TEXT,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, provider_object_id)
);
CREATE INDEX IF NOT EXISTS provider_entities_by_tenant_type_time
  ON provider_entities (tenant_id, entity_type, observed_at DESC);

CREATE TABLE IF NOT EXISTS provider_entity_versions (
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  provider_object_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, provider_object_id, content_hash)
);

CREATE TABLE IF NOT EXISTS capability_observations (
  tenant_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  state TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, capability)
);

CREATE TABLE IF NOT EXISTS proposal_drafts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  job_provider_object_id TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS proposal_draft_versions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  normalized_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id, version)
);

CREATE TABLE IF NOT EXISTS action_intents (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  provider_target_id TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source_version_hash TEXT NOT NULL,
  provider_revision TEXT,
  cost_connects INTEGER,
  frozen_payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  outcome TEXT,
  provider_receipt_id TEXT,
  provider_read_back_at TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS action_receipts (
  tenant_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  provider_receipt_id TEXT,
  provider_read_back_at TEXT,
  recorded_at TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, intent_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  tenant_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_by_tenant_time
  ON audit_events (tenant_id, occurred_at DESC);
