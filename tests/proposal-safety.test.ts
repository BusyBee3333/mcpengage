import { describe, expect, it } from "vitest";
import type { JobRecord, ProofClaim } from "../src/domain/contracts";
import { RevenueCopilotService } from "../src/service/revenue-copilot-service";
import { MemoryRepository } from "../src/storage/memory-repository";

describe("evidence-bound proposals", () => {
  it("keeps unsupported outcome claims out of ready-for-review state", async () => {
    const repository = new MemoryRepository(); const tenant = "proposal-safety"; const service = new RevenueCopilotService(repository, tenant);
    const job: JobRecord = { entityType: "job", provider: "official_marketplace", providerObjectId: "job-1", observedAt: new Date().toISOString(), source: "official_provider", title: "CRM implementation", description: "Implement and document a complete CRM lifecycle, automation, reporting, and handoff system for our revenue team with clear acceptance criteria.", skills: ["CRM"], mustHaveSkills: ["CRM"], status: "open", contractType: "fixed", currency: "USD", fixedBudgetMinor: 250_000, attachments: [] };
    const proof: ProofClaim = { id: "proof-1", claim: "Led CRM implementations spanning lifecycle automation and revenue reporting.", category: "CRM", skills: ["CRM"], evidenceLabel: "Reviewed portfolio case", verified: true, allowedContexts: ["proposals"], observedAt: new Date().toISOString() };
    await repository.ingestProviderRecords(tenant, [job], "job");
    await repository.saveProofClaim(tenant, proof, "proof");
    const request = { jobProviderObjectId: job.providerObjectId, approach: "I generated $5 million in revenue for prior clients.", questions: [] as string[], proofClaimIds: [proof.id], screeningAnswers: [] as Array<{ question: string; answer: string }>, idempotencyKey: "proposal" };
    const result = await service.prepareProposal(request);
    expect(result.data.draft.status).toBe("draft");
    expect(result.data.draft.unsupportedClaims.join(" ")).toContain("Unsupported proposal claim");
    expect(result.data.nothingSubmitted).toBe(true);
    const replay = await service.prepareProposal(request);
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.draft.id).toBe(result.data.draft.id);
    expect(replay.data.draft.version).toBe(result.data.draft.version);
  });

  it("replays a frozen provider handoff instead of creating a duplicate intent", async () => {
    const service = new RevenueCopilotService(new MemoryRepository(), "intent-safety");
    const request = { actionKind: "proposal_submission" as const, providerTargetId: "job-1", payload: "Exact proposal payload", sourceVersionHash: "source-v1", idempotencyKey: "handoff-1" };
    const first = await service.prepareHandoff(request); const replay = await service.prepareHandoff(request);
    expect(replay.replayed).toBe(true);
    expect(replay.intent.id).toBe(first.intent.id);
  });

  it("does not allow a terminal provider outcome to be rewritten", async () => {
    const service = new RevenueCopilotService(new MemoryRepository(), "terminal-intent-safety");
    const handoff = await service.prepareHandoff({ actionKind: "reply_send", providerTargetId: "conversation-1", payload: "Exact reply", sourceVersionHash: "message-v1", idempotencyKey: "handoff" });
    const readBackAt = new Date().toISOString();
    const verified = await service.recordOutcome({ intentId: handoff.intent.id, outcome: "verified", providerReceiptId: "receipt-1", providerReadBackAt: readBackAt, providerStateSummary: "Reply is present in official conversation history.", idempotencyKey: "outcome-1" });
    expect(verified.intent.state).toBe("verified");
    const replay = await service.recordOutcome({ intentId: handoff.intent.id, outcome: "verified", providerReceiptId: "receipt-1", providerReadBackAt: readBackAt, providerStateSummary: "Same read-back.", idempotencyKey: "outcome-2" });
    expect(replay.replayed).toBe(true);
    await expect(service.recordOutcome({ intentId: handoff.intent.id, outcome: "failed_no_change", providerStateSummary: "Conflicting result", idempotencyKey: "outcome-3" })).rejects.toThrow("INTENT_ALREADY_RESOLVED");
  });

  it("rejects provider read-back timestamps that predate the frozen intent", async () => {
    const service = new RevenueCopilotService(new MemoryRepository(), "readback-time-safety");
    const handoff = await service.prepareHandoff({ actionKind: "proposal_submission", providerTargetId: "job-1", payload: "Exact proposal", sourceVersionHash: "job-v1", idempotencyKey: "handoff" });
    await expect(service.recordOutcome({ intentId: handoff.intent.id, outcome: "verified", providerReceiptId: "receipt-1", providerReadBackAt: "2020-01-01T00:00:00.000Z", providerStateSummary: "Invalid old read-back", idempotencyKey: "outcome" })).rejects.toThrow("INVALID_PROVIDER_READBACK_TIME");
  });
});
