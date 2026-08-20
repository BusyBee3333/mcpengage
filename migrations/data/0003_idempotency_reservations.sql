ALTER TABLE idempotency_records ADD COLUMN state TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE idempotency_records ADD COLUMN reservation_id TEXT;
