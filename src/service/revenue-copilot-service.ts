import { canonicalJson, sha256Hex } from "../domain/hash";
import { scoreOpportunity } from "../domain/scoring";
import type {
  ActionIntent,
  CapabilityState,
  ContractRecord,
  ConversationRecord,
  JobRecord,
  MessageRecord,
  MilestoneRecord,
  ProfileRecord,
  ProofClaim,
  ProposalDraft,
  ProposalRecord,
  ProviderRecord,
  ServiceRecord,
  SurfaceEnvelope
} from "../domain/contracts";
import type { RevenueCopilotRepository } from "../storage/repository";
import type { LifecycleCoordinator } from "../operations/coordinator";

export class RevenueCopilotService {
  constructor(private readonly repository: RevenueCopilotRepository, private readonly tenantId: string, private readonly lifecycle?: LifecycleCoordinator) {}

  async workspaceStatus() {
    const status = await this.repository.getWorkspaceStatus(this.tenantId);
    return this.envelope("capabilities", status.capabilities, [], { status }, status.accountConnected ? "Revenue Copilot is ready. Review capability badges before provider-facing work." : "Revenue Copilot is ready; the official provider has not been checked yet.");
  }

  async savePreferences(preferences: Parameters<RevenueCopilotRepository["savePreferences"]>[1], key: string) {
    const result = await this.repository.savePreferences(this.tenantId, preferences, key);
    return { schemaVersion: "1.0" as const, summary: result.replayed ? "Preferences were already saved." : "Preferences saved.", replayed: result.replayed, preferences: result.value };
  }

  async listProofClaims(includeArchived: boolean) {
    const claims = await this.repository.listProofClaims(this.tenantId, includeArchived);
    return { schemaVersion: "1.0" as const, summary: `${claims.length} proof claim${claims.length === 1 ? "" : "s"} available.`, claims };
  }

  async saveProofClaim(claim: ProofClaim, key: string) {
    const result = await this.repository.saveProofClaim(this.tenantId, claim, key);
    return { schemaVersion: "1.0" as const, summary: result.replayed ? "Proof claim was already saved." : "Proof claim saved.", replayed: result.replayed, claim: result.value };
  }

  async syncContext(records: ProviderRecord[], capabilities: Record<string, CapabilityState> | undefined, observedAt: string, key: string) {
    const saved = await this.repository.ingestProviderRecords(this.tenantId, records, key);
    if (capabilities) await this.repository.saveCapabilities(this.tenantId, capabilities, observedAt, `${key}:capabilities`);
    const status = await this.repository.getWorkspaceStatus(this.tenantId);
    return { schemaVersion: "1.0" as const, summary: `Accepted ${saved.value.accepted}; ignored ${saved.value.ignoredAsOlder} older record${saved.value.ignoredAsOlder === 1 ? "" : "s"}.`, replayed: saved.replayed, ...saved.value, currentCounts: status.historyCounts };
  }

  async revenuePulse(limit: number) {
    const [jobs, conversations, messages, contracts, milestones, profile, connects, revenue, preferences, proof] = await Promise.all([
      this.records<JobRecord>("job"), this.records<ConversationRecord>("conversation"), this.records<MessageRecord>("message"), this.records<ContractRecord>("contract"), this.records<MilestoneRecord>("milestone"), this.records<ProfileRecord>("profile"), this.records<ProviderRecord & { entityType: "connects_observation"; balance: number }>("connects_observation"), this.records<ProviderRecord & { entityType: "revenue_event"; amountMinor: number; currency: string }>("revenue_event"), this.repository.getPreferences(this.tenantId), this.repository.listProofClaims(this.tenantId)
    ]);
    const actions: Array<{ id: string; kind: "opportunity" | "inbox" | "workroom" | "market_presence" | "setup"; title: string; reason: string; estimatedUpside: string; priority: number; targetId?: string }> = [];
    const ranked = jobs.map((job) => ({ job, score: scoreOpportunity(job, preferences, proof) })).filter((item) => item.score.classification === "strong").sort((a, b) => b.score.score - a.score.score);
    if (ranked[0]) actions.push({ id: `opportunity:${ranked[0].job.providerObjectId}`, kind: "opportunity", title: `Review ${ranked[0].job.title}`, reason: `Strong fit at ${ranked[0].score.score}/100 with ${ranked[0].score.matchedProofClaimIds.length} applicable proof claim(s).`, estimatedUpside: "High-value proposal opportunity", priority: 1, targetId: ranked[0].job.providerObjectId });
    const unread = conversations.filter((item) => (item.unreadCount ?? 0) > 0).sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    if (unread[0]) actions.push({ id: `inbox:${unread[0].providerObjectId}`, kind: "inbox", title: `Reply to ${unread[0].participantLabel}`, reason: `${unread[0].unreadCount ?? 0} unread message(s); a prompt reply may protect an active opportunity.`, estimatedUpside: "Protect pipeline momentum", priority: actions.length + 1, targetId: unread[0].providerObjectId });
    const activeMilestone = milestones.filter((item) => item.status === "active" && item.dueAt).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0];
    if (activeMilestone) actions.push({ id: `milestone:${activeMilestone.providerObjectId}`, kind: "workroom", title: `Check ${activeMilestone.title}`, reason: `The next official milestone deadline is ${activeMilestone.dueAt}.`, estimatedUpside: "Protect delivery and payment", priority: actions.length + 1, targetId: activeMilestone.providerObjectId });
    if (!profile[0] && actions.length < limit) actions.push({ id: "setup:profile", kind: "setup", title: "Check official market presence", reason: "No current official profile observation has been provided.", estimatedUpside: "Improve decision completeness", priority: actions.length + 1 });
    const officialRevenueMinor = revenue.filter((item) => item.source === "official_provider").reduce((sum, item) => sum + item.amountMinor, 0);
    const currency = revenue.find((item) => item.source === "official_provider")?.currency;
    return this.envelope("revenue_pulse", {}, [...jobs, ...conversations, ...messages, ...contracts, ...milestones, ...profile], { actions: actions.slice(0, limit), ...(revenue.length ? { officialRevenueMinor, ...(currency ? { officialRevenueCurrency: currency } : {}) } : {}), ...(connects[0] ? { connectsBalance: connects[0].balance } : {}) }, actions.length ? `${Math.min(limit, actions.length)} highest-value next move${Math.min(limit, actions.length) === 1 ? "" : "s"} identified.` : "No urgent action is supported by current data.");
  }

  async findOpportunities(classification: string, limit: number) {
    const [jobs, preferences, proof] = await Promise.all([this.records<JobRecord>("job"), this.repository.getPreferences(this.tenantId), this.repository.listProofClaims(this.tenantId)]);
    const all = jobs.map((job) => ({ job, score: scoreOpportunity(job, preferences, proof) })).sort((a, b) => b.score.score - a.score.score);
    const filtered = classification === "all" ? all : all.filter((item) => item.score.classification === classification);
    return this.envelope("opportunity_review", {}, jobs, { opportunities: filtered.slice(0, limit), totalAvailable: filtered.length }, filtered.length ? `${filtered.length} opportunity${filtered.length === 1 ? "" : "ies"} match the selected view.` : "No opportunities match the selected view.");
  }

  async reviewOpportunity(jobId: string) {
    const [job, preferences, proof] = await Promise.all([this.repository.getProviderRecord<JobRecord>(this.tenantId, "job", jobId), this.repository.getPreferences(this.tenantId), this.repository.listProofClaims(this.tenantId)]);
    const opportunity = job ? { job, score: scoreOpportunity(job, preferences, proof) } : null;
    const matched = opportunity ? proof.filter((item) => opportunity.score.matchedProofClaimIds.includes(item.id)) : [];
    const nextStep = !opportunity ? "Re-fetch the job from the official provider." : opportunity.score.classification === "blocked" ? "Resolve the hard gates before drafting." : "Prepare an evidence-bound proposal draft.";
    return this.envelope("opportunity_review", {}, job ? [job] : [], { opportunity, proofClaims: matched, nextStep }, opportunity ? `${job?.title}: ${opportunity.score.score}/100 ${opportunity.score.classification} fit.` : "The requested job is not in current Revenue Copilot context.");
  }

  async prepareProposal(input: { jobProviderObjectId: string; opening?: string | undefined; approach?: string | undefined; questions: string[]; closing?: string | undefined; proofClaimIds: string[]; rateMinor?: number | undefined; currency?: string | undefined; screeningAnswers: Array<{ question: string; answer: string }>; idempotencyKey: string }) {
    const [job, prefs, allProof, existing] = await Promise.all([this.repository.getProviderRecord<JobRecord>(this.tenantId, "job", input.jobProviderObjectId), this.repository.getPreferences(this.tenantId), this.repository.listProofClaims(this.tenantId), this.repository.listProposalDrafts(this.tenantId)]);
    if (!job) throw new Error("JOB_NOT_FOUND");
    const score = scoreOpportunity(job, prefs, allProof);
    const selected = allProof.filter((claim) => input.proofClaimIds.includes(claim.id) && claim.verified && !claim.archivedAt);
    const rejectedIds = input.proofClaimIds.filter((id) => !selected.some((claim) => claim.id === id));
    const current = existing.find((draft) => draft.jobProviderObjectId === job.providerObjectId);
    const now = new Date().toISOString();
    const draft: ProposalDraft = {
      id: current?.id ?? `rc-proposal-${crypto.randomUUID()}`,
      jobProviderObjectId: job.providerObjectId,
      version: (current?.version ?? 0) + 1,
      status: score.hardGateReasons.length === 0 && selected.length > 0 && rejectedIds.length === 0 ? "ready_for_review" : "draft",
      opening: input.opening ?? `Your ${job.title} project appears to need a clear, revenue-focused implementation plan before tools are changed.`,
      proof: selected.map((claim) => claim.claim).join("\n\n"),
      approach: input.approach ?? "I would validate the current workflow and revenue bottleneck first, then implement the smallest high-leverage change and measure the result.",
      questions: input.questions,
      closing: input.closing ?? "If this direction matches what you need, I can start with a focused discovery pass and turn it into an implementation plan.",
      ...(input.rateMinor !== undefined ? { rateMinor: input.rateMinor } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      screeningAnswers: input.screeningAnswers,
      proofClaimIds: selected.map((claim) => claim.id),
      unsupportedClaims: rejectedIds.map((id) => `Proof claim ${id} is missing, archived, or unverified.`),
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    const saved = await this.repository.saveProposalDraft(this.tenantId, draft, input.idempotencyKey);
    return this.envelope("proposal_studio", {}, [job], { draft: saved.value, score, readyForProviderReview: draft.status === "ready_for_review", claimCoverage: selected, nothingSubmitted: true as const, replayed: saved.replayed }, draft.status === "ready_for_review" ? "Draft saved and ready for provider review. Nothing has been submitted." : "Draft saved with evidence or qualification gaps. Nothing has been submitted.");
  }

  async listProposals(limit: number) {
    const [drafts, provider] = await Promise.all([this.repository.listProposalDrafts(this.tenantId), this.records<ProposalRecord>("proposal")]);
    return this.envelope("proposal_studio", {}, provider, { drafts: drafts.slice(0, limit), providerProposals: provider.slice(0, limit), total: drafts.length + provider.length }, `${drafts.length} local draft${drafts.length === 1 ? "" : "s"}; ${provider.length} provider proposal observation${provider.length === 1 ? "" : "s"}.`);
  }

  async triageInbox(limit: number, draftReplies: boolean) {
    const [conversations, messages] = await Promise.all([this.records<ConversationRecord>("conversation"), this.records<MessageRecord>("message")]);
    const rows = conversations.map((conversation) => {
      const related = messages.filter((message) => message.conversationProviderObjectId === conversation.providerObjectId).slice(0, 10);
      const latest = related[0];
      const urgent = /urgent|today|deadline|offer|interview/i.test(latest?.body ?? "");
      return { conversation, messages: related, priority: urgent ? "urgent" as const : (conversation.unreadCount ?? 0) > 0 ? "today" as const : "normal" as const, reason: urgent ? "The latest message contains time-sensitive language." : (conversation.unreadCount ?? 0) > 0 ? "There are unread official messages." : "No urgent signal was detected.", ...(draftReplies && latest?.direction === "inbound" ? { suggestedReply: "Thanks for the update. I’ve reviewed this and will respond with the next concrete step shortly." } : {}) };
    }).sort((a, b) => priorityValue(a.priority) - priorityValue(b.priority));
    return this.envelope("inbox_triage", {}, [...conversations, ...messages], { conversations: rows.slice(0, limit), nothingSent: true as const }, rows.length ? `${rows.length} conversation${rows.length === 1 ? "" : "s"} triaged. Nothing has been sent.` : "No official conversations are in context.");
  }

  async reviewWorkroom(limit: number) {
    const [contracts, milestones] = await Promise.all([this.records<ContractRecord>("contract"), this.records<MilestoneRecord>("milestone")]);
    const now = Date.now();
    const workrooms = contracts.map((contract) => {
      const related = milestones.filter((milestone) => milestone.contractProviderObjectId === contract.providerObjectId);
      const next = related.filter((item) => item.dueAt && !["approved"].includes(item.status)).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0];
      const hours = next?.dueAt ? (new Date(next.dueAt).getTime() - now) / 3_600_000 : undefined;
      const urgency = hours === undefined ? "unknown" as const : hours < 0 ? "overdue" as const : hours <= 48 ? "due_soon" as const : "on_track" as const;
      return { contract, milestones: related, urgency, nextAction: next ? `Review ${next.title} and prepare the official-provider handoff if delivery is ready.` : "No open official milestone was found." };
    });
    return this.envelope("workroom", {}, [...contracts, ...milestones], { workrooms: workrooms.slice(0, limit), nothingSubmitted: true as const }, workrooms.length ? `${workrooms.length} workroom${workrooms.length === 1 ? "" : "s"} reviewed. Nothing has been submitted.` : "No official contracts are in context.");
  }

  async auditPresence(includeServices: boolean) {
    const [profiles, services, proof] = await Promise.all([this.records<ProfileRecord>("profile"), includeServices ? this.records<ServiceRecord>("service") : Promise.resolve([]), this.repository.listProofClaims(this.tenantId)]);
    const suggestions: Array<{ area: "profile" | "service"; providerObjectId?: string; title: string; rationale: string; currentValue: string; suggestedValue: string; evidenceNeeded: string[] }> = [];
    const profile = profiles[0];
    if (profile && profile.title.length < 35) suggestions.push({ area: "profile", providerObjectId: profile.providerObjectId, title: "Make the profile title outcome-specific", rationale: "The current title is broad and may hide the highest-value service.", currentValue: profile.title, suggestedValue: `${profile.title} | Revenue Systems & Implementation`, evidenceNeeded: [] });
    if (!profile) suggestions.push({ area: "profile", title: "Check the official profile", rationale: "Revenue Copilot has no current official profile observation.", currentValue: "Not checked", suggestedValue: "Re-fetch through the official provider", evidenceNeeded: [] });
    if (profile && proof.length === 0) suggestions.push({ area: "profile", providerObjectId: profile.providerObjectId, title: "Add proof before strengthening claims", rationale: "Profile optimization should be backed by approved evidence.", currentValue: profile.overview, suggestedValue: "Keep current claims until proof is approved.", evidenceNeeded: ["At least one verified outcome or portfolio reference"] });
    return this.envelope("market_presence", {}, [...profiles, ...services], { profiles, services, suggestions, nothingChanged: true as const }, `${suggestions.length} market-presence suggestion${suggestions.length === 1 ? "" : "s"}. Nothing has been changed.`);
  }

  async prepareProfileRevision(input: { providerObjectId: string; proposedTitle?: string | undefined; proposedOverview?: string | undefined; proposedSkills?: string[] | undefined; idempotencyKey: string }) {
    const [profile, capabilities] = await Promise.all([this.repository.getProviderRecord<ProfileRecord>(this.tenantId, "profile", input.providerObjectId), this.repository.getWorkspaceStatus(this.tenantId)]);
    if (!profile) throw new Error("PROFILE_NOT_FOUND");
    const changes = [input.proposedTitle !== undefined && input.proposedTitle !== profile.title ? { field: "title", before: profile.title, after: input.proposedTitle } : null, input.proposedOverview !== undefined && input.proposedOverview !== profile.overview ? { field: "overview", before: profile.overview, after: input.proposedOverview } : null, input.proposedSkills !== undefined && canonicalJson({ value: input.proposedSkills }) !== canonicalJson({ value: profile.skills }) ? { field: "skills", before: profile.skills.join(", "), after: input.proposedSkills.join(", ") } : null].filter((value): value is { field: string; before: string; after: string } => value !== null);
    const unsupportedClaims = await this.detectUnsupportedClaims(input.proposedOverview ?? "");
    const capability = capabilities.capabilities.profile_update ?? "unknown";
    return this.envelope("market_presence", { profile_update: capability }, [profile], { revisionId: `rc-profile-${await shortHash(input)}`, providerObjectId: input.providerObjectId, changes, unsupportedClaims, capability, nothingChanged: true as const, replayed: false }, `Profile revision prepared with ${changes.length} change${changes.length === 1 ? "" : "s"}. Nothing has been changed on the provider.`);
  }

  async prepareServicePackage(input: { providerObjectId?: string | undefined; title: string; category?: string | undefined; currency: string; tiers: Array<{ name: string; priceMinor: number; deliveryDays: number; description: string }>; description: string; idempotencyKey: string }) {
    const status = await this.repository.getWorkspaceStatus(this.tenantId); const capability = status.capabilities.service_update ?? "unknown";
    return this.envelope("market_presence", { service_update: capability }, [], { packageId: input.providerObjectId ?? `rc-service-${await shortHash(input)}`, title: input.title, ...(input.category ? { category: input.category } : {}), currency: input.currency, tiers: input.tiers, description: input.description, capability, nothingChanged: true as const, replayed: false }, "Service package prepared. Nothing has been changed on the provider.");
  }

  async prepareHandoff(input: { actionKind: ActionIntent["actionKind"]; providerTargetId: string; payload: string; sourceVersionHash: string; providerRevision?: string | undefined; costConnects?: number | undefined; idempotencyKey: string }) {
    const now = new Date(); const payloadHash = await sha256Hex(input.payload);
    const intent: ActionIntent = { id: `RC-${crypto.randomUUID()}`, actionKind: input.actionKind, providerTargetId: input.providerTargetId, frozenPayload: input.payload, payloadHash, sourceVersionHash: input.sourceVersionHash, ...(input.providerRevision ? { providerRevision: input.providerRevision } : {}), ...(input.costConnects !== undefined ? { costConnects: input.costConnects } : {}), state: "handoff_requested", expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), createdAt: now.toISOString() };
    const saved = await this.repository.saveActionIntent(this.tenantId, intent, input.idempotencyKey);
    const continuation = `Prepare ${input.actionKind.replaceAll("_", " ")} intent ${saved.value.id} with the connected official marketplace app. Re-fetch target ${input.providerTargetId}${input.providerRevision ? ` at revision ${input.providerRevision}` : ""}, re-check any cost, show the exact frozen payload and terms, require provider confirmation, execute once, independently read back the resulting provider state, then record the outcome with Revenue Copilot. Do not retry if the outcome is uncertain.`;
    return { schemaVersion: "1.0" as const, summary: "Provider handoff prepared. Nothing has been submitted or changed.", intent: saved.value, continuation, nothingSubmitted: true as const, replayed: saved.replayed };
  }

  async recordOutcome(input: { intentId: string; outcome: "verified" | "failed_no_change" | "outcome_uncertain" | "already_completed"; providerReceiptId?: string | undefined; providerReadBackAt?: string | undefined; providerStateSummary: string; idempotencyKey: string }) {
    const existing = await this.repository.getActionIntent(this.tenantId, input.intentId);
    if (!existing) throw new Error("INTENT_NOT_FOUND");
    if (input.outcome === "verified" && (!input.providerReceiptId || !input.providerReadBackAt)) throw new Error("VERIFICATION_REQUIRES_RECEIPT_AND_READBACK");
    const updated: ActionIntent = { ...existing, state: input.outcome, outcome: input.outcome, ...(input.providerReceiptId ? { providerReceiptId: input.providerReceiptId } : {}), ...(input.providerReadBackAt ? { providerReadBackAt: input.providerReadBackAt } : {}) };
    const saved = await this.repository.updateActionIntent(this.tenantId, updated, input.idempotencyKey);
    await this.repository.recordProviderReceipt(this.tenantId, { intentId: input.intentId, outcome: input.outcome, ...(input.providerReceiptId ? { providerReceiptId: input.providerReceiptId } : {}), ...(input.providerReadBackAt ? { providerReadBackAt: input.providerReadBackAt } : {}), providerStateSummary: input.providerStateSummary, recordedAt: new Date().toISOString() }, `${input.idempotencyKey}:receipt`);
    return { schemaVersion: "1.0" as const, summary: outcomeSummary(input.outcome), intent: saved.value, replayed: saved.replayed };
  }

  async exportData(format: "json" | "json_csv", idempotencyKey: string) {
    if (this.lifecycle) {
      const result = await this.lifecycle.requestExport(this.tenantId, format, idempotencyKey);
      return { schemaVersion: "1.0" as const, summary: result.status === "ready" ? "Encrypted account export is ready. The download link expires in 15 minutes." : "Encrypted account export queued. Call this tool again with the same idempotency key to check readiness.", status: result.status === "ready" ? "ready" as const : "queued" as const, exportId: result.exportId, format, expiresAt: result.expiresAt, ...(result.downloadUrl ? { downloadUrl: result.downloadUrl } : {}) };
    }
    const data = await this.repository.exportTenant(this.tenantId); const now = new Date();
    return { schemaVersion: "1.0" as const, summary: "Account export prepared inline. It contains normalized Revenue Copilot data only.", status: "ready_inline" as const, exportId: `rc-export-${crypto.randomUUID()}`, format, expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), data };
  }

  async deleteData(scope: "record" | "domain" | "account", target: string | undefined, idempotencyKey: string) {
    if (this.lifecycle) {
      const result = await this.lifecycle.requestDeletion(this.tenantId, scope, target, idempotencyKey);
      return { schemaVersion: "1.0" as const, summary: result.status === "complete" ? `Deleted ${result.deleted ?? 0} active records. Backup residue follows the published 35-day expiry.` : "Deletion queued and will complete within 24 hours.", status: result.status, deletionJobId: result.deletionJobId, ...(result.deleted !== undefined ? { deleted: result.deleted } : {}), scope, completedAt: result.completedAt ?? new Date().toISOString() };
    }
    const result = await this.repository.deleteTenantData(this.tenantId, scope, target);
    return { schemaVersion: "1.0" as const, summary: `Deleted ${result.deleted} active record${result.deleted === 1 ? "" : "s"}. Backup residue follows the published 35-day expiry.`, status: "complete" as const, deletionJobId: `rc-delete-${crypto.randomUUID()}`, deleted: result.deleted, scope, completedAt: new Date().toISOString() };
  }

  private async records<T extends ProviderRecord>(type: T["entityType"]): Promise<T[]> { return this.repository.listProviderRecords<T>(this.tenantId, type); }

  private envelope<S extends SurfaceEnvelope<unknown>["surface"], T>(surface: S, capabilities: Record<string, CapabilityState>, records: ProviderRecord[], data: T, summary: string): SurfaceEnvelope<T> {
    const observed = records.sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    return { schemaVersion: "1.0", surface, viewId: crypto.randomUUID(), generatedAt: new Date().toISOString(), timezone: "America/New_York", summary, provenance: observed ? [{ source: observed.source, providerObjectId: observed.providerObjectId, ...(observed.providerUpdatedAt ? { providerUpdatedAt: observed.providerUpdatedAt } : {}), observedAt: observed.observedAt, contentHash: "normalized-provider-record", freshness: freshnessFor(surface, observed.observedAt) }] : [{ source: "local_computed", observedAt: new Date().toISOString(), contentHash: "local-empty-state", freshness: "unknown" }], capabilities, warnings: observed && freshnessFor(surface, observed.observedAt) === "stale" ? [{ code: "STALE_PROVIDER_CONTEXT", message: "Official provider context is stale. Re-fetch before consequential decisions." }] : [], data };
  }

  private async detectUnsupportedClaims(text: string): Promise<string[]> {
    if (!text.trim()) return [];
    const proof = await this.repository.listProofClaims(this.tenantId);
    if (proof.some((claim) => claim.verified && text.toLowerCase().includes(claim.claim.toLowerCase()))) return [];
    return /increased|grew|generated|saved|delivered|expert|years of experience/i.test(text) ? ["The proposed overview contains an outcome or experience claim that is not tied to an approved proof claim."] : [];
  }
}

function freshnessFor(surface: SurfaceEnvelope<unknown>["surface"], observedAt: string): "fresh" | "stale" | "unknown" {
  const ageMs = Date.now() - Date.parse(observedAt);
  if (!Number.isFinite(ageMs)) return "unknown";
  const threshold = surface === "inbox_triage" || surface === "workroom" ? 5 * 60_000 : surface === "opportunity_review" || surface === "proposal_studio" ? 15 * 60_000 : 24 * 60 * 60_000;
  return ageMs <= threshold ? "fresh" : "stale";
}

function priorityValue(value: "urgent" | "today" | "normal"): number { return value === "urgent" ? 0 : value === "today" ? 1 : 2; }
function shortHash(value: object): Promise<string> { return sha256Hex(canonicalJson(value)).then((hash) => hash.slice(0, 12)); }
function outcomeSummary(outcome: string): string { return outcome === "verified" ? "Provider outcome verified by receipt and independent read-back." : outcome === "failed_no_change" ? "Provider reported failure with no change." : outcome === "already_completed" ? "Provider action was already completed; no duplicate action was taken." : "Provider outcome is uncertain. Retries are disabled until official state is checked."; }
