# Architecture

## Trust boundary

The Worker accepts normalized provider fields only when ChatGPT has obtained them from the separately connected official marketplace app. It has no Upwork OAuth client, session, cookie, password, browser, iframe, scraper, or CDP path.

```text
official provider read
  -> visible ChatGPT orchestration
  -> strict normalized Revenue Copilot schema
  -> tenant repository + provenance
  -> deterministic analysis / local draft
  -> frozen provider handoff
  -> official provider confirmation and execution
  -> official independent read-back
  -> normalized Revenue Copilot receipt
```

## Runtime

- Cloudflare Worker: stateless Streamable HTTP MCP and versioned App HTML resources.
- Cloudflare Workers OAuth Provider: authorization server, token rotation, resource metadata, CIMD/DCR compatibility.
- Auth0: upstream user authentication only. Operational tables store `issuer + sub`, not email.
- `CONTROL_DB`: accounts, consent, OAuth state, flags, deletion tombstones.
- `DATA_DB`: tenant-scoped normalized history, immutable versions, drafts, capabilities, action intents, receipts, idempotency, audit facts.
- R2/Queues/Workflows: encrypted asynchronous exports, nightly backups, deletion, and derived analytics are active in beta. Migration and backfills use the same bounded lifecycle model. No cron or queue may poll Upwork or cause provider writes.

## Authority and freshness

Authority is deterministic: newer official observation, older official observation, migrated history, then local draft/inference. Current-state projections never allow migrated history to overwrite official state.

Freshness thresholds are five minutes for inbox/workroom, 15 minutes for opportunities/proposals, and 24 hours for profile/services/analytics. Consequential actions always require an immediate official re-read.

## Tool design

All 19 tools have exact Zod input/output contracts, model-readable structured content, text fallback, complete annotations, and stable `schemaVersion: 1.0`. Tool names never imply a marketplace mutation. Breaking resource contracts receive a new `ui://.../vN.html` URI.

## Action state machine

`draft -> previewed -> handoff_requested -> provider_confirmation_pending -> provider_pending -> receipt_recorded -> verified | failed_no_change | outcome_uncertain | already_completed`

The current server creates at `handoff_requested`; official orchestration owns the provider-confirmation phases and records the terminal receipt. Intent expiry prevents execution from stale source state but never prevents recording a provider outcome that already occurred.

## Tenant isolation

The OAuth grant supplies a server-derived tenant ID. No tool accepts a tenant ID. Repositories require the tenant parameter for every operation. Sensitive normalized JSON is encrypted using a per-tenant/purpose AES-GCM key derived from the environment master key with HKDF.
