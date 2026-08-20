# Revenue Copilot

Revenue Copilot is an independent, official-provider-first MCP server and MCP App suite for managing a freelancer business from ChatGPT. It identifies the highest-value next move, explains the evidence and risk, prepares truthful work, and preserves a trustworthy operating history.

It deliberately does **not** scrape Upwork, drive a browser, store Upwork credentials, proxy the official MCP, or claim to perform marketplace actions.

```text
ChatGPT
├── Official marketplace app
│   └── Current provider data, confirmation, execution, read-back
└── Revenue Copilot
    └── Strategy, scoring, evidence, drafts, analytics, history, workflow UI
```

## What is implemented

- 19 exact, goal-oriented MCP tools with concrete input/output schemas and complete safety annotations.
- Seven versioned MCP App resources: capability, Revenue Pulse, opportunities, Proposal Studio, inbox, workroom, and market presence.
- Deterministic opportunity scoring with the approved 25/20/15/15/10/10/5 weights, a 30-point risk penalty, and non-overridable hard gates.
- An evidence library that prevents unverified claims from entering ready proposals.
- Short-lived frozen provider intents, payload hashes, idempotency, receipt/read-back verification, and explicit uncertain outcomes.
- Typed D1 control and data planes with tenant isolation, immutable provider/draft versions, audit structures, exports, deletion, and receipt history.
- Per-tenant AES-256-GCM envelope encryption derived from a 32-byte master key with HKDF.
- OAuth 2.1 through Cloudflare Workers OAuth Provider, Auth0 identity, PKCE S256, 15-minute access tokens, and rotating 90-day refresh-token grants.
- A read-only typed legacy importer that quarantines malformed rows, skips old Connect balances, and marks all imported records `migrated_history`.
- Public health, privacy, terms, support, status, and OpenAI challenge routes.

## Local development

Requirements: Node.js 24+, npm, and Wrangler.

```bash
npm ci
npm run check
npm run build
npm run db:migrate:local
npm run dev
```

Connect an MCP client to `http://localhost:8787/mcp`. Development mode uses an isolated in-memory tenant and never contacts a marketplace.

Useful checks:

```bash
npm run audit
npm run migrate:legacy:dry-run
npm run deploy:dry-run
```

## Production configuration

Create separate Cloudflare resources for staging, beta, and production. Replace every placeholder binding in `wrangler.jsonc`; do not deploy with all-zero IDs.

Required secrets:

- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `DATA_ENCRYPTION_KEY` — base64-encoded 32 random bytes
- `OPENAI_APPS_CHALLENGE`

Required bindings:

- `CONTROL_DB`
- `DATA_DB`
- `OAUTH_KV`
- encrypted export/backup R2 storage, derived-processing queues, and account lifecycle workflows in beta

Auth0 must allow `${PUBLIC_ORIGIN}/auth/callback`. The reviewer tenant must use deterministic synthetic data and require no MFA, SMS, email challenge, VPN, or manual setup.

## Provider handoff

Revenue Copilot widgets can call only their own MCP tools. The primary action sends a visible follow-up into chat. ChatGPT then invokes the separately connected official marketplace app, shows its confirmation, executes at most once, reads official state back independently, and records the result in Revenue Copilot.

`verified` is impossible without both a provider receipt and read-back timestamp. `outcome_uncertain` is a terminal safety state until official state is checked.

## Current beta

The public beta shell is deployed at `https://revenue-beta.mcpengage.com`. Health, policy, OAuth metadata, data lifecycle, and internal processing are live. User authorization remains fail-closed until Auth0 credentials and a reviewer identity are configured. The exact remaining gate is tracked in `docs/beta-readiness.md`.

## Repository layout

- `src/domain` — stable contracts, schemas, scoring, hashing
- `src/storage` — tenant-aware memory and D1 repositories, encryption
- `src/service` — product workflows and safety state machine
- `src/server` — the 19 tools and seven resources
- `src/app` — the shared responsive MCP App UI
- `src/worker` — Streamable HTTP, OAuth, public routes
- `migrations` — control-plane and operational D1 schemas
- `scripts` — migration and release tooling
- `tests` — scoring, authority, idempotency, encryption, and public-contract tests
- `docs` — architecture, security, review, operations, and containment evidence

## Independence

Revenue Copilot is not affiliated with, endorsed by, or an official product of Upwork. Upwork and its official connected app remain authoritative for current marketplace data and actions. Revenue Copilot never guarantees work or income.
