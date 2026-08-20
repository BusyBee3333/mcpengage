import { z } from "zod";
import {
  ActionIntentSchema,
  CapabilityStateSchema,
  OpportunityScoreSchema,
  ProofClaimSchema,
  ProposalDraftSchema,
  ProviderOutcomeSchema,
  ProviderRecordSchema,
  UserPreferencesSchema,
  WorkspaceStatusSchema,
  surfaceEnvelopeSchema
} from "../domain/schemas";

const IdempotencyKey = z.string().min(8).max(200).describe("A unique key for this exact local write. Reuse only to safely replay the same request.");
const Identifier = z.string().min(1).max(300);
const IsoDate = z.string().datetime({ offset: true });

export const GetWorkspaceStatusInput = z.object({}).strict();
export const GetWorkspaceStatusOutput = surfaceEnvelopeSchema(z.literal("capabilities"), z.object({ status: WorkspaceStatusSchema }).strict());

export const SavePreferencesInput = z.object({ preferences: UserPreferencesSchema, idempotencyKey: IdempotencyKey }).strict();
export const SavePreferencesOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), replayed: z.boolean(), preferences: UserPreferencesSchema }).strict();

export const ListProofClaimsInput = z.object({ includeArchived: z.boolean().default(false) }).strict();
export const ListProofClaimsOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), claims: z.array(ProofClaimSchema) }).strict();

export const SaveProofClaimInput = z.object({ claim: ProofClaimSchema, idempotencyKey: IdempotencyKey }).strict();
export const SaveProofClaimOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), replayed: z.boolean(), claim: ProofClaimSchema }).strict();

export const SyncMarketplaceContextInput = z.object({
  records: z.array(ProviderRecordSchema).min(1).max(200),
  capabilities: z.record(z.string().min(1), CapabilityStateSchema).optional(),
  observedAt: IsoDate,
  idempotencyKey: IdempotencyKey
}).strict();
export const SyncMarketplaceContextOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), replayed: z.boolean(), accepted: z.number().int(), ignoredAsOlder: z.number().int(), unchanged: z.number().int(), currentCounts: z.record(z.string(), z.number().int()) }).strict();

const PulseAction = z.object({ id: Identifier, kind: z.enum(["opportunity", "inbox", "workroom", "market_presence", "setup"]), title: z.string(), reason: z.string(), estimatedUpside: z.string(), priority: z.number().int().min(1).max(3), targetId: Identifier.optional() }).strict();
export const GetRevenuePulseInput = z.object({ limit: z.number().int().min(1).max(3).default(3) }).strict();
export const GetRevenuePulseOutput = surfaceEnvelopeSchema(z.literal("revenue_pulse"), z.object({ actions: z.array(PulseAction).max(3), officialRevenueMinor: z.number().int().optional(), officialRevenueCurrency: z.string().length(3).optional(), connectsBalance: z.number().int().optional() }).strict());

const RankedOpportunity = z.object({ job: ProviderRecordSchema, score: OpportunityScoreSchema }).strict();
export const FindOpportunitiesInput = z.object({ classification: z.enum(["all", "strong", "review", "archive", "blocked"]).default("all"), limit: z.number().int().min(1).max(5).default(5) }).strict();
export const FindOpportunitiesOutput = surfaceEnvelopeSchema(z.literal("opportunity_review"), z.object({ opportunities: z.array(RankedOpportunity).max(5), totalAvailable: z.number().int().min(0) }).strict());

export const ReviewOpportunityInput = z.object({ jobProviderObjectId: Identifier }).strict();
export const ReviewOpportunityOutput = surfaceEnvelopeSchema(z.literal("opportunity_review"), z.object({ opportunity: RankedOpportunity.nullable(), proofClaims: z.array(ProofClaimSchema), nextStep: z.string() }).strict());

export const PrepareProposalInput = z.object({
  jobProviderObjectId: Identifier,
  opening: z.string().max(10_000).optional(),
  approach: z.string().max(20_000).optional(),
  questions: z.array(z.string().max(2_000)).max(20).default([]),
  closing: z.string().max(10_000).optional(),
  proofClaimIds: z.array(Identifier).max(100).default([]),
  rateMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  screeningAnswers: z.array(z.object({ question: z.string().max(5_000), answer: z.string().max(10_000) }).strict()).max(50).default([]),
  idempotencyKey: IdempotencyKey
}).strict();
export const PrepareProposalOutput = surfaceEnvelopeSchema(z.literal("proposal_studio"), z.object({ draft: ProposalDraftSchema, score: OpportunityScoreSchema, readyForProviderReview: z.boolean(), claimCoverage: z.array(ProofClaimSchema), nothingSubmitted: z.literal(true), replayed: z.boolean() }).strict());

export const ListProposalsInput = z.object({ limit: z.number().int().min(1).max(100).default(25) }).strict();
export const ListProposalsOutput = surfaceEnvelopeSchema(z.literal("proposal_studio"), z.object({ drafts: z.array(ProposalDraftSchema), providerProposals: z.array(ProviderRecordSchema), total: z.number().int().min(0) }).strict());

const ConversationSummary = z.object({ conversation: ProviderRecordSchema, messages: z.array(ProviderRecordSchema).max(10), priority: z.enum(["urgent", "today", "normal"]), reason: z.string(), suggestedReply: z.string().optional() }).strict();
export const TriageInboxInput = z.object({ limit: z.number().int().min(1).max(5).default(5), draftReplies: z.boolean().default(false) }).strict();
export const TriageInboxOutput = surfaceEnvelopeSchema(z.literal("inbox_triage"), z.object({ conversations: z.array(ConversationSummary).max(5), nothingSent: z.literal(true) }).strict());

const WorkroomItem = z.object({ contract: ProviderRecordSchema, milestones: z.array(ProviderRecordSchema), urgency: z.enum(["overdue", "due_soon", "on_track", "unknown"]), nextAction: z.string() }).strict();
export const ReviewWorkroomInput = z.object({ limit: z.number().int().min(1).max(5).default(5) }).strict();
export const ReviewWorkroomOutput = surfaceEnvelopeSchema(z.literal("workroom"), z.object({ workrooms: z.array(WorkroomItem).max(5), nothingSubmitted: z.literal(true) }).strict());

const PresenceSuggestion = z.object({ area: z.enum(["profile", "service"]), providerObjectId: Identifier.optional(), title: z.string(), rationale: z.string(), currentValue: z.string(), suggestedValue: z.string(), evidenceNeeded: z.array(z.string()) }).strict();
export const AuditMarketPresenceInput = z.object({ includeServices: z.boolean().default(true) }).strict();
export const AuditMarketPresenceOutput = surfaceEnvelopeSchema(z.literal("market_presence"), z.object({ profiles: z.array(ProviderRecordSchema), services: z.array(ProviderRecordSchema), suggestions: z.array(PresenceSuggestion), nothingChanged: z.literal(true) }).strict());

export const PrepareProfileRevisionInput = z.object({ providerObjectId: Identifier, proposedTitle: z.string().max(500).optional(), proposedOverview: z.string().max(100_000).optional(), proposedSkills: z.array(z.string().max(150)).max(100).optional(), idempotencyKey: IdempotencyKey }).strict();
export const PrepareProfileRevisionOutput = surfaceEnvelopeSchema(z.literal("market_presence"), z.object({ revisionId: Identifier, providerObjectId: Identifier, changes: z.array(z.object({ field: z.string(), before: z.string(), after: z.string() }).strict()), unsupportedClaims: z.array(z.string()), capability: CapabilityStateSchema, nothingChanged: z.literal(true), replayed: z.boolean() }).strict());

const ServiceTier = z.object({ name: z.string().min(1).max(100), priceMinor: z.number().int().min(0), deliveryDays: z.number().int().min(1).max(365), description: z.string().max(10_000) }).strict();
export const PrepareServicePackageInput = z.object({ providerObjectId: Identifier.optional(), title: z.string().min(1).max(500), category: z.string().max(200).optional(), currency: z.string().length(3), tiers: z.array(ServiceTier).min(1).max(3), description: z.string().max(100_000), idempotencyKey: IdempotencyKey }).strict();
export const PrepareServicePackageOutput = surfaceEnvelopeSchema(z.literal("market_presence"), z.object({ packageId: Identifier, title: z.string(), category: z.string().optional(), currency: z.string(), tiers: z.array(ServiceTier), description: z.string(), capability: CapabilityStateSchema, nothingChanged: z.literal(true), replayed: z.boolean() }).strict());

export const PrepareProviderHandoffInput = z.object({
  actionKind: z.enum(["proposal_submission", "reply_send", "milestone_submission", "profile_update", "service_update"]),
  providerTargetId: Identifier,
  payload: z.string().min(1).max(250_000),
  sourceVersionHash: z.string().min(1).max(256),
  providerRevision: z.string().max(300).optional(),
  costConnects: z.number().int().min(0).optional(),
  idempotencyKey: IdempotencyKey
}).strict();
export const PrepareProviderHandoffOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), intent: ActionIntentSchema, continuation: z.string(), nothingSubmitted: z.literal(true), replayed: z.boolean() }).strict();

export const RecordProviderOutcomeInput = z.object({ intentId: Identifier, outcome: ProviderOutcomeSchema, providerReceiptId: z.string().max(500).optional(), providerReadBackAt: IsoDate.optional(), providerStateSummary: z.string().max(10_000), idempotencyKey: IdempotencyKey }).strict().superRefine((value, ctx) => {
  if (value.outcome === "verified" && (!value.providerReceiptId || !value.providerReadBackAt)) ctx.addIssue({ code: "custom", message: "Verified outcomes require both provider receipt and independent read-back time." });
});
export const RecordProviderOutcomeOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), intent: ActionIntentSchema, replayed: z.boolean() }).strict();

export const ExportAccountDataInput = z.object({ format: z.enum(["json", "json_csv"]).default("json_csv"), idempotencyKey: IdempotencyKey }).strict();
export const ExportAccountDataOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), status: z.enum(["ready_inline", "queued", "ready"]), exportId: Identifier, format: z.enum(["json", "json_csv"]), expiresAt: IsoDate, downloadUrl: z.string().url().optional(), data: z.record(z.string(), z.union([z.object({}).passthrough(), z.array(z.object({}).passthrough())])).optional() }).strict();

export const DeleteAccountDataInput = z.object({ scope: z.enum(["record", "domain", "account"]), target: z.string().max(300).optional(), confirmation: z.literal("DELETE REVENUE COPILOT DATA"), idempotencyKey: IdempotencyKey }).strict().superRefine((value, ctx) => {
  if (value.scope !== "account" && !value.target) ctx.addIssue({ code: "custom", message: "A target is required for record and domain deletion." });
});
export const DeleteAccountDataOutput = z.object({ schemaVersion: z.literal("1.0"), summary: z.string(), status: z.enum(["queued", "complete"]), deletionJobId: Identifier, deleted: z.number().int().min(0).optional(), scope: z.enum(["record", "domain", "account"]), completedAt: IsoDate }).strict();

export type AnyToolOutput = Record<string, unknown>;
