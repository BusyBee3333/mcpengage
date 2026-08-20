# Legacy containment record

Containment date: 2026-08-20.

- Recoverable snapshot: `/Users/jackshard/Documents/Upwork/archive/revenue-copilot-legacy-snapshot-20260820T0645Z.tar.gz`
- SHA-256: `9c200acf912cdfee06b768a086e577b585cd3a1d039ba9b7565acb45e700d6bf`
- Archive entries: 126.
- Contents: legacy launch-agent definitions, pipeline code/config/history/state, duplicate dashboard source excluding build/dependency caches, and the legacy command-center SQLite database.
- `com.codex.upwork-sniper` and `com.codex.upwork-controller` were unloaded and persistently disabled.
- `upwork-pipeline/config/auto-apply-policy.json` is now approval-required with auto-apply, prebuild, browser assist, and CRM updates disabled.

These controls are reversible during migration, but the legacy system must remain read-only. Do not re-enable either agent or any browser write path. Final removal happens only after Revenue Copilot parity acceptance.
