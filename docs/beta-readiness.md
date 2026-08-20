# Beta readiness

## Live environment

- Endpoint: `https://revenue-beta.mcpengage.com/mcp`
- Public health: `https://revenue-beta.mcpengage.com/healthz`
- Marketplace writes from Revenue Copilot: disabled by architecture
- Public policy and OAuth metadata routes: deployed and passing smoke checks
- D1, KV, encrypted R2, Queue, Workflow, cron, and custom-domain bindings: deployed
- Export retention: 24 hours; signed link: 15 minutes
- Backup retention: 35 days; isolated quarterly restore verification enabled

## Connection blocker

The beta authorization endpoint intentionally returns `503` until the following Auth0 values are configured as Worker secrets:

- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`

The Auth0 application must allow this callback exactly:

`https://revenue-beta.mcpengage.com/auth/callback`

After those values are configured, create the no-MFA synthetic reviewer user and run the OAuth protocol tests before inviting real beta testers.

## External feasibility gate

These checks cannot be certified by unit tests or by Revenue Copilot alone. Run them in ChatGPT Developer Mode with both Revenue Copilot and the official Upwork app connected:

1. Both apps remain connected in one conversation.
2. A current official read can be passed to `sync_marketplace_context`.
3. Revenue Copilot renders the normalized result.
4. `Prepare in chat` starts a visible official-provider confirmation flow.
5. Official receipt plus independent read-back can be recorded with `record_provider_outcome`.
6. A scheduled provider-read and Revenue-Copilot-score workflow works without hidden writes.
7. Disconnect, permission-denied, unsupported, stale, and uncertain outcomes remain truthful.

Checks 1–5 block any public claim of integrated marketplace management. Check 6 controls whether proactive official scanning is included in the beta.

## Not ready for public submission

Public submission remains blocked until Auth0/reviewer access, the external feasibility gate, publisher identity, OpenAI domain challenge, production resources, final icon/screenshots/listing copy, and three consecutive release-candidate passes are complete.
