CREATE TABLE IF NOT EXISTS rate_limit_windows (
  tenant_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, window_start)
);
