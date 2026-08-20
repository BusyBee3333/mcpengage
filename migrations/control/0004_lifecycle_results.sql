ALTER TABLE lifecycle_jobs ADD COLUMN result_count INTEGER;

ALTER TABLE backup_manifests ADD COLUMN tenant_id TEXT;

CREATE INDEX IF NOT EXISTS backup_manifests_by_tenant_time
  ON backup_manifests (tenant_id, created_at DESC);
