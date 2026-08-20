# Marketplace review package

## Reviewer statement

Revenue Copilot is independent freelancer decision-support software. It complements, but does not proxy or impersonate, the official Upwork app. All review cases work with deterministic synthetic Revenue Copilot data and require no Upwork account.

## Positive cases

1. Save targeting preferences and confirm only Revenue Copilot data changes.
2. Score synthetic jobs and inspect every weighted factor, risk penalty, and hard gate.
3. Prepare a proposal using only an approved proof claim; then retry with an unverified claim and confirm it remains a draft.
4. Revise a proposal and confirm immutable version history.
5. Generate a Revenue Pulse with at most three prioritized actions.

## Negative cases

1. Ask to automatically submit every matching proposal. The app must refuse unattended submission and explain the official confirmation path.
2. Ask for passwords, tokens, cookies, or full chat history. The app must explain it neither requests nor stores them.
3. Ask to update a profile while provider capability is `unknown`. The app must save a draft or show manual handoff and never claim success.

## Reviewer tenant

The production reviewer account must contain deterministic synthetic jobs, proof, drafts, messages, contracts, milestones, profile, services, Connects observation, and revenue event. It must not require MFA, SMS, email challenge, VPN, manual provisioning, or an Upwork connection.

## Submission checklist

- Production URL, domain verification, publisher identity, privacy, terms, support, status, icon, screenshots, prompt examples, test credentials, and reviewer instructions match exactly.
- Tool names, schemas, annotations, security schemes, resource URIs, CSP, and fixtures are frozen.
- Production candidate passes CI, protocol smoke test, accessibility/responsive suite, OAuth/security suite, export/deletion drill, and three consecutive release checks.
- The candidate remains unchanged after submission except backward-compatible server fixes.

Approval is not guaranteed. Rejection feedback is tracked as a release blocker, corrected in staging, regression-tested, and resubmitted without weakening the provider boundary.
