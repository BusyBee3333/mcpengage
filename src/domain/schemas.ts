import { z } from "zod";
import {
  ACTION_INTENT_STATES,
  CAPABILITY_STATES,
  FRESHNESS_STATES,
  PROVIDER_ENTITY_TYPES,
  PROVIDER_OUTCOMES
} from "./contracts";

export const CapabilityStateSchema = z.enum(CAPABILITY_STATES);
export const FreshnessStateSchema = z.enum(FRESHNESS_STATES);
export const ProviderOutcomeSchema = z.enum(PROVIDER_OUTCOMES);
export const ProviderEntityTypeSchema = z.enum(PROVIDER_ENTITY_TYPES);

export const ProvenanceSchema = z.object({
  source: z.enum(["official_provider", "user", "local_computed", "migrated_history"]),
  providerObjectId: z.string().min(1).optional(),
  providerUpdatedAt: z.string().datetime({ offset: true }).optional(),
  observedAt: z.string().datetime({ offset: true }),
  contentHash: z.string().min(1),
  freshness: FreshnessStateSchema
}).strict();

export const SurfaceWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
}).strict();

export const SchedulePreferencesSchema = z.object({
  timezone: z.string().min(1).max(100),
  morningBrief: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  opportunityScans: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(6),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  enabledDays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
}).strict();

export const UserPreferencesSchema = z.object({
  targetSkills: z.array(z.string().min(1).max(100)).max(100),
  targetServices: z.array(z.string().min(1).max(160)).max(50),
  targetIndustries: z.array(z.string().min(1).max(100)).max(50),
  excludedTerms: z.array(z.string().min(1).max(100)).max(100),
  minimumHourlyRateMinor: z.number().int().min(0),
  minimumFixedBudgetMinor: z.number().int().min(0),
  maximumJobAgeHours: z.number().int().min(1).max(8760),
  maximumConnectsPerProposal: z.number().int().min(0).max(1000).optional(),
  strongFitThreshold: z.number().int().min(1).max(100),
  reviewThreshold: z.number().int().min(0).max(99),
  availabilityHoursPerWeek: z.number().int().min(0).max(168),
  writingTone: z.enum(["direct", "consultative", "technical", "warm"]),
  schedule: SchedulePreferencesSchema
}).strict().refine((value) => value.reviewThreshold < value.strongFitThreshold, {
  message: "reviewThreshold must be below strongFitThreshold"
});

export const ProofClaimSchema = z.object({
  id: z.string().min(1).max(100),
  claim: z.string().min(1).max(1000),
  category: z.string().min(1).max(100),
  skills: z.array(z.string().min(1).max(100)).max(50),
  evidenceLabel: z.string().min(1).max(240),
  evidenceUrl: z.string().url().refine((value) => value.startsWith("https://"), "Evidence URLs must use HTTPS").optional(),
  verified: z.boolean(),
  allowedContexts: z.array(z.string().min(1).max(100)).max(20),
  observedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const AttachmentMetadataSchema = z.object({
  providerObjectId: z.string().min(1),
  name: z.string().min(1).max(500),
  mediaType: z.string().max(200).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  digest: z.string().max(256).optional(),
  accessible: z.boolean().optional()
}).strict();

export const ClientSignalsSchema = z.object({
  paymentVerified: z.boolean().optional(),
  totalSpentMinor: z.number().int().min(0).optional(),
  hireRatePercent: z.number().min(0).max(100).optional(),
  averageRating: z.number().min(0).max(5).optional(),
  hires: z.number().int().min(0).optional()
}).strict();

const ProviderBaseShape = {
  provider: z.literal("official_marketplace"),
  providerObjectId: z.string().min(1).max(300),
  providerUpdatedAt: z.string().datetime({ offset: true }).optional(),
  observedAt: z.string().datetime({ offset: true }),
  source: z.enum(["official_provider", "migrated_history"]),
  sourceCallId: z.string().min(1).max(300).optional()
} as const;

export const JobRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("job"),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(100_000),
  skills: z.array(z.string().min(1).max(150)).max(100),
  mustHaveSkills: z.array(z.string().min(1).max(150)).max(50).optional(),
  status: z.enum(["open", "closed", "unavailable", "unknown"]),
  contractType: z.enum(["hourly", "fixed", "unknown"]),
  currency: z.string().length(3),
  hourlyMinMinor: z.number().int().min(0).optional(),
  hourlyMaxMinor: z.number().int().min(0).optional(),
  fixedBudgetMinor: z.number().int().min(0).optional(),
  postedAt: z.string().datetime({ offset: true }).optional(),
  connectsCost: z.number().int().min(0).optional(),
  proposalsCount: z.number().int().min(0).optional(),
  client: ClientSignalsSchema.optional(),
  attachments: z.array(AttachmentMetadataSchema).max(100)
}).strict();

export const ProposalRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("proposal"),
  jobProviderObjectId: z.string().min(1).max(300),
  status: z.enum(["draft", "submitted", "viewed", "interview", "offer", "hired", "withdrawn", "declined", "unknown"]),
  submittedAt: z.string().datetime({ offset: true }).optional(),
  amountMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  connectsSpent: z.number().int().min(0).optional()
}).strict();

export const ConversationRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("conversation"),
  subject: z.string().max(500).optional(),
  participantLabel: z.string().min(1).max(300),
  unreadCount: z.number().int().min(0).optional(),
  lastMessageAt: z.string().datetime({ offset: true }).optional(),
  contractProviderObjectId: z.string().max(300).optional()
}).strict();

export const MessageRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("message"),
  conversationProviderObjectId: z.string().min(1).max(300),
  senderLabel: z.string().min(1).max(300),
  body: z.string().min(1).max(100_000),
  sentAt: z.string().datetime({ offset: true }),
  direction: z.enum(["inbound", "outbound", "unknown"]),
  attachments: z.array(AttachmentMetadataSchema).max(100)
}).strict();

export const ContractRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("contract"),
  title: z.string().min(1).max(500),
  clientLabel: z.string().min(1).max(300),
  status: z.enum(["active", "paused", "ended", "unknown"]),
  contractType: z.enum(["hourly", "fixed", "unknown"]),
  currency: z.string().length(3).optional(),
  amountMinor: z.number().int().min(0).optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const MilestoneRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("milestone"),
  contractProviderObjectId: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  status: z.enum(["not_started", "active", "submitted", "approved", "changes_requested", "unknown"]),
  amountMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  funded: z.boolean().optional()
}).strict();

export const ProfileRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("profile"),
  title: z.string().min(1).max(500),
  overview: z.string().min(1).max(100_000),
  skills: z.array(z.string().min(1).max(150)).max(100),
  hourlyRateMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  availabilityHoursPerWeek: z.number().int().min(0).max(168).optional()
}).strict();

export const ServiceRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("service"),
  title: z.string().min(1).max(500),
  status: z.enum(["draft", "submitted_for_review", "approved", "published", "rejected", "unknown"]),
  category: z.string().max(200).optional(),
  currency: z.string().length(3).optional(),
  startingPriceMinor: z.number().int().min(0).optional(),
  tierCount: z.number().int().min(1).max(3).optional()
}).strict();

export const ConnectsObservationRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("connects_observation"),
  balance: z.number().int().min(0)
}).strict();

export const RevenueEventRecordSchema = z.object({
  ...ProviderBaseShape,
  entityType: z.literal("revenue_event"),
  eventType: z.enum(["earned", "pending", "refunded", "bonus", "unknown"]),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  occurredAt: z.string().datetime({ offset: true }),
  contractProviderObjectId: z.string().max(300).optional()
}).strict();

export const ProviderRecordSchema = z.discriminatedUnion("entityType", [
  JobRecordSchema,
  ProposalRecordSchema,
  ConversationRecordSchema,
  MessageRecordSchema,
  ContractRecordSchema,
  MilestoneRecordSchema,
  ProfileRecordSchema,
  ServiceRecordSchema,
  ConnectsObservationRecordSchema,
  RevenueEventRecordSchema
]);

export const ScoreFactorSchema = z.object({
  key: z.enum(["fit", "proof", "revenue", "client", "feasibility", "timing", "connects"]),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  reason: z.string()
}).strict();

export const OpportunityScoreSchema = z.object({
  version: z.literal("opportunity-v1"),
  score: z.number().int().min(0).max(100),
  classification: z.enum(["strong", "review", "archive", "blocked"]),
  factors: z.array(ScoreFactorSchema),
  riskPenalty: z.number().int().min(0).max(30),
  hardGateReasons: z.array(z.string()),
  matchedProofClaimIds: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"])
}).strict();

export const ProposalDraftSchema = z.object({
  id: z.string().min(1).max(100),
  jobProviderObjectId: z.string().min(1).max(300),
  version: z.number().int().min(1),
  status: z.enum(["draft", "ready_for_review", "handoff_requested", "provider_confirmed", "outcome_uncertain"]),
  opening: z.string().max(10_000),
  proof: z.string().max(20_000),
  approach: z.string().max(20_000),
  questions: z.array(z.string().max(2_000)).max(20),
  closing: z.string().max(10_000),
  rateMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  screeningAnswers: z.array(z.object({ question: z.string().max(5_000), answer: z.string().max(10_000) }).strict()).max(50),
  proofClaimIds: z.array(z.string().min(1)).max(100),
  unsupportedClaims: z.array(z.string().max(2_000)).max(100),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const ActionIntentSchema = z.object({
  id: z.string().min(1).max(100),
  actionKind: z.enum(["proposal_submission", "reply_send", "milestone_submission", "profile_update", "service_update"]),
  providerTargetId: z.string().min(1).max(300),
  frozenPayload: z.string().min(1).max(250_000),
  payloadHash: z.string().min(1).max(256),
  sourceVersionHash: z.string().min(1).max(256),
  providerRevision: z.string().max(300).optional(),
  costConnects: z.number().int().min(0).optional(),
  state: z.enum(ACTION_INTENT_STATES),
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  outcome: ProviderOutcomeSchema.optional(),
  providerReceiptId: z.string().max(500).optional(),
  providerReadBackAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const ProviderReceiptSchema = z.object({
  intentId: z.string().min(1).max(100),
  outcome: ProviderOutcomeSchema,
  providerReceiptId: z.string().max(500).optional(),
  providerReadBackAt: z.string().datetime({ offset: true }).optional(),
  providerStateSummary: z.string().max(10_000),
  recordedAt: z.string().datetime({ offset: true })
}).strict();

export const WorkspaceStatusSchema = z.object({
  accountConnected: z.boolean(),
  providerLastCheckedAt: z.string().datetime({ offset: true }).optional(),
  capabilities: z.record(z.string(), CapabilityStateSchema),
  historyCounts: z.record(ProviderEntityTypeSchema, z.number().int().min(0)),
  draftCount: z.number().int().min(0),
  proofCount: z.number().int().min(0),
  dataRetention: z.literal("until_user_deletes")
}).strict();

export function surfaceEnvelopeSchema<T extends z.ZodType>(surface: z.ZodLiteral<string>, data: T) {
  return z.object({
    schemaVersion: z.literal("1.0"),
    surface,
    viewId: z.string().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    timezone: z.string().min(1),
    summary: z.string(),
    provenance: z.array(ProvenanceSchema),
    capabilities: z.record(z.string(), CapabilityStateSchema),
    warnings: z.array(SurfaceWarningSchema),
    data
  }).strict();
}

export const IdempotencyInputSchema = z.object({
  idempotencyKey: z.string().min(8).max(200)
}).strict();
