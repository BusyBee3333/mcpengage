PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS deletion_tombstones (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('record', 'domain', 'account')),
  target TEXT,
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS feature_flags (
  tenant_id TEXT NOT NULL,
  flag TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, flag)
);

CREATE TABLE IF NOT EXISTS oauth_authorization_state (
  state TEXT PRIMARY KEY,
  oauth_request_json TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  subject TEXT,
  issuer TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
