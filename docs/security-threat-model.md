# Security threat model

## Protected assets

- Normalized job, proposal, message, contract, profile, service, and revenue history.
- Approved proof, local drafts, provider intents, and receipts.
- OAuth grants, consent, deletion state, and encryption keys.

Revenue Copilot never accepts provider credentials, cookies, OAuth tokens, raw response archives, attachment binaries, identity documents, payment-card data, or unrelated chat context.

## Principal threats and controls

| Threat | Control |
|---|---|
| Cross-tenant access | Tenant comes only from verified OAuth props; every repository operation binds it; no client tenant field exists. |
| Stale or forged provider state | Strict normalized schemas, source provenance, provider precedence, freshness warnings, immediate official re-read before writes. |
| Duplicate external action | Frozen payload and source hashes, 15-minute intent, local idempotency conflict detection, official execute-once instruction, already-completed outcome. |
| False success | `verified` requires receipt and independent read-back; click/acceptance is insufficient; uncertainty disables retry. |
| Prompt injection in marketplace text | Provider text is data, never authority; tools do not execute embedded instructions or URLs; handoff is generated from typed fields. |
| XSS in widgets | React escaping, no dangerous HTML, no remote assets, exact empty MCP App CSP, no frame domains. |
| OAuth replay or redirect attack | Exact provider validation, Auth0 authorization code, PKCE S256, nonce, short-lived one-time D1 state, HttpOnly Secure SameSite cookie, verified JWT signature/issuer/audience/expiry. |
| Data exposure at rest | Per-tenant and per-purpose AES-256-GCM envelope encryption; production fails closed without a 32-byte key. |
| Log leakage | Public code logs no marketplace content or names; operational diagnostic retention target is seven days. |
| Malicious migration data | Read-only source DB, strict target schemas, `migrated_history` provenance, quarantine report, no old Connect current state. |
| Supply-chain compromise | Exact dependency versions, lockfile, CI audit, pinned current protocol packages, zero current npm audit findings. |

## Required pre-production tests

- OAuth PKCE, nonce, replay, redirect, revocation, token rotation, and expiration.
- Cross-tenant request attempts for every repository family.
- Stored/reflected XSS, CSP, malicious URLs, oversized payloads, pagination abuse, and prompt-injected job/message/attachment text.
- Encryption key rotation and restore with deletion tombstones replayed.
- Export expiry, full account deletion, 35-day backup lifecycle, and restore drill.
- Provider uncertainty, timeout, duplicated receipt, stale source revision, and already-completed reconciliation.

No public deployment is approved until these tests pass against the real staging infrastructure.
