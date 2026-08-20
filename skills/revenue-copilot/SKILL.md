---
name: revenue-copilot
description: Use Revenue Copilot for freelancer strategy, evidence-bound opportunity scoring, proposal drafts, inbox triage, workroom review, market-presence drafts, provider handoffs, receipts, export, and deletion. Use the separate official marketplace app for current provider data and marketplace actions.
---

# Revenue Copilot

Revenue Copilot answers: what is the highest-value next move, why is it worth doing, and what is the safest path to complete it?

## Authority boundary

- Use the separately connected official marketplace app for current marketplace state, permissions, confirmations, writes, and read-back.
- Revenue Copilot never proxies Upwork, stores Upwork credentials, scrapes, drives a browser, or claims to perform a marketplace mutation.
- Pass only necessary normalized official fields into `sync_marketplace_context`. Never pass raw responses, tokens, cookies, attachment download URLs, identity documents, or unrelated chat context.
- Treat `unknown` as not checked, never as unsupported.
- Official observations outrank migrated history and local inference.

## Safe workflow

1. Fetch the narrowest current state needed through the official marketplace app.
2. Sync selected normalized fields and capability observations into Revenue Copilot.
3. Use Revenue Copilot to score, explain, draft, version, or prioritize.
4. For an external action, use `prepare_provider_handoff` to freeze the exact payload for 15 minutes.
5. Show the user the exact official provider confirmation. Execute at most once through the official app.
6. Independently read back provider state.
7. Record `verified` only with both provider receipt and read-back. Otherwise record `failed_no_change`, `already_completed`, or `outcome_uncertain`.
8. Never retry an uncertain action until official state is checked.

## Truth rules

- Proposal, profile, and service claims may use only active verified proof claims.
- Omit unsupported experience; do not soften it into certainty.
- Hard-gated opportunities remain blocked even when the weighted score is high.
- Connects, earnings, payments, statuses, and costs are official observations only. Never recompute or imply them.
- Say “Prepare in chat,” “Nothing has been submitted,” and “Provider confirmation has not been received” precisely.

## Scheduled work

Scheduled workflows may ask the official provider to read and Revenue Copilot to analyze. They may not cause marketplace writes. If local scheduled persistence is unavailable, keep the briefing transient until the user opens or saves it.
