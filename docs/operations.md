# Operations

## Objectives

- 99.9% MCP availability.
- Database-only reads under 750 ms p95.
- Synchronous scoring and ingestion acknowledgment under two seconds p95.
- Zero false-success marketplace actions and zero cross-tenant exposure.
- Seven-day diagnostic logs with no marketplace content.

Alert on 5xx above 2% for five minutes, auth failures above 5%, any dead-letter event, queue age above five minutes, failed export/deletion/backup, storage thresholds, and projected monthly cost above $20 and $50.

## Release

1. `npm ci && npm run audit && npm run check && npm run build && npm run deploy:dry-run`.
2. Apply expand-only migrations to staging.
3. Run OAuth, protocol, App, export, deletion, and restore checks.
4. Deploy 5%, observe; deploy 25%, observe; then 100%.
5. Stop automatically on SLO regression. Roll back the immutable Worker release only while reviewed contracts remain compatible.

## Capability shutdown

Provider-facing preparation is feature-gated independently from read/scoring surfaces. A severe provider, security, or privacy problem disables only the affected capability where safe; unpublish the app when containment requires it.

## Data lifecycle

Active deletion target is 24 hours. Export URLs expire after 15 minutes and objects after 24 hours. Encrypted backup residue expires after 35 days. Quarterly drills verify backup integrity, decryption, parsing, and deletion-tombstone availability in isolation; drill data is never made available to users. Any future production restore must replay applicable tombstones before restored data can be exposed.

## Scheduled workflows

ChatGPT Scheduled Tasks coordinate official reads and Revenue Copilot analysis. Worker cron performs internal maintenance only. No scheduled path polls Upwork or triggers marketplace writes.
