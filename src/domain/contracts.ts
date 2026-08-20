export const CAPABILITY_STATES = [
  "verified_read_write",
  "verified_read_only",
  "manual_handoff",
  "unavailable",
  "unknown"
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const FRESHNESS_STATES = ["fresh", "stale", "partial", "unknown"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export const PROVIDER_OUTCOMES = [
  "verified",
  "failed_no_change",
  "outcome_uncertain",
  "already_completed"
] as const;
export type ProviderOutcome = (typeof PROVIDER_OUTCOMES)[number];

export const PROVIDER_ENTITY_TYPES = [
  "job",
  "proposal",
  "conversation",
  "message",
  "contract",
  "milestone",
  "profile",
  "service",
  "connects_observation",
  "revenue_event"
] as const;
export type ProviderEntityType = (typeof PROVIDER_ENTITY_TYPES)[number];

export type ProvenanceSource =
  | "official_provider"
  | "user"
  | "local_computed"
  | "migrated_history";

export interface Provenance {
  source: ProvenanceSource;
  providerObjectId?: string;
  providerUpdatedAt?: string;
  observedAt: string;
  contentHash: string;
  freshness: FreshnessState;
}

export interface SurfaceWarning {
  code: string;
  message: string;
}

export interface SurfaceEnvelope<T> {
  schemaVersion: "1.0";
  surface:
    | "capabilities"
    | "revenue_pulse"
    | "opportunity_review"
    | "proposal_studio"
    | "inbox_triage"
    | "workroom"
    | "market_presence";
  viewId: string;
  generatedAt: string;
  timezone: string;
  summary: string;
  provenance: Provenance[];
  capabilities: Record<string, CapabilityState>;
  warnings: SurfaceWarning[];
  data: T;
}

export interface SchedulePreferences {
  timezone: string;
  morningBrief: string;
  opportunityScans: string[];
  quietHoursStart: string;
  quietHoursEnd: string;
  enabledDays: number[];
}

export interface UserPreferences {
  targetSkills: string[];
  targetServices: string[];
  targetIndustries: string[];
  excludedTerms: string[];
  minimumHourlyRateMinor: number;
  minimumFixedBudgetMinor: number;
  maximumJobAgeHours: number;
  maximumConnectsPerProposal?: number;
  strongFitThreshold: number;
  reviewThreshold: number;
  availabilityHoursPerWeek: number;
  writingTone: "direct" | "consultative" | "technical" | "warm";
  schedule: SchedulePreferences;
}

export interface ProofClaim {
  id: string;
  claim: string;
  category: string;
  skills: string[];
  evidenceLabel: string;
  evidenceUrl?: string;
  verified: boolean;
  allowedContexts: string[];
  observedAt: string;
  archivedAt?: string;
}

export interface AttachmentMetadata {
  providerObjectId: string;
  name: string;
  mediaType?: string;
  sizeBytes?: number;
  digest?: string;
}

export interface ClientSignals {
  paymentVerified?: boolean;
  totalSpentMinor?: number;
  hireRatePercent?: number;
  averageRating?: number;
  hires?: number;
}

export interface ProviderRecordBase {
  entityType: ProviderEntityType;
  provider: "official_marketplace";
  providerObjectId: string;
  providerUpdatedAt?: string;
  observedAt: string;
  source: "official_provider" | "migrated_history";
  sourceCallId?: string;
}

export interface JobRecord extends ProviderRecordBase {
  entityType: "job";
  title: string;
  description: string;
  skills: string[];
  status: "open" | "closed" | "unavailable" | "unknown";
  contractType: "hourly" | "fixed" | "unknown";
  currency: string;
  hourlyMinMinor?: number;
  hourlyMaxMinor?: number;
  fixedBudgetMinor?: number;
  postedAt?: string;
  connectsCost?: number;
  proposalsCount?: number;
  client?: ClientSignals;
  attachments: AttachmentMetadata[];
}

export interface ProposalRecord extends ProviderRecordBase {
  entityType: "proposal";
  jobProviderObjectId: string;
  status: "draft" | "submitted" | "viewed" | "interview" | "offer" | "hired" | "withdrawn" | "declined" | "unknown";
  submittedAt?: string;
  amountMinor?: number;
  currency?: string;
  connectsSpent?: number;
}

export interface ConversationRecord extends ProviderRecordBase {
  entityType: "conversation";
  subject?: string;
  participantLabel: string;
  unreadCount?: number;
  lastMessageAt?: string;
  contractProviderObjectId?: string;
}

export interface MessageRecord extends ProviderRecordBase {
  entityType: "message";
  conversationProviderObjectId: string;
  senderLabel: string;
  body: string;
  sentAt: string;
  direction: "inbound" | "outbound" | "unknown";
  attachments: AttachmentMetadata[];
}

export interface ContractRecord extends ProviderRecordBase {
  entityType: "contract";
  title: string;
  clientLabel: string;
  status: "active" | "paused" | "ended" | "unknown";
  contractType: "hourly" | "fixed" | "unknown";
  currency?: string;
  amountMinor?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface MilestoneRecord extends ProviderRecordBase {
  entityType: "milestone";
  contractProviderObjectId: string;
  title: string;
  status: "not_started" | "active" | "submitted" | "approved" | "changes_requested" | "unknown";
  amountMinor?: number;
  currency?: string;
  dueAt?: string;
  funded?: boolean;
}

export interface ProfileRecord extends ProviderRecordBase {
  entityType: "profile";
  title: string;
  overview: string;
  skills: string[];
  hourlyRateMinor?: number;
  currency?: string;
  availabilityHoursPerWeek?: number;
}

export interface ServiceRecord extends ProviderRecordBase {
  entityType: "service";
  title: string;
  status: "draft" | "submitted_for_review" | "approved" | "published" | "rejected" | "unknown";
  category?: string;
  currency?: string;
  startingPriceMinor?: number;
  tierCount?: number;
}

export interface ConnectsObservationRecord extends ProviderRecordBase {
  entityType: "connects_observation";
  balance: number;
}

export interface RevenueEventRecord extends ProviderRecordBase {
  entityType: "revenue_event";
  eventType: "earned" | "pending" | "refunded" | "bonus" | "unknown";
  amountMinor: number;
  currency: string;
  occurredAt: string;
  contractProviderObjectId?: string;
}

export type ProviderRecord =
  | JobRecord
  | ProposalRecord
  | ConversationRecord
  | MessageRecord
  | ContractRecord
  | MilestoneRecord
  | ProfileRecord
  | ServiceRecord
  | ConnectsObservationRecord
  | RevenueEventRecord;

export interface ScoreFactor {
  key: "fit" | "proof" | "revenue" | "client" | "feasibility" | "timing" | "connects";
  label: string;
  score: number;
  weight: number;
  reason: string;
}

export interface OpportunityScore {
  version: "opportunity-v1";
  score: number;
  classification: "strong" | "review" | "archive" | "blocked";
  factors: ScoreFactor[];
  riskPenalty: number;
  hardGateReasons: string[];
  matchedProofClaimIds: string[];
  confidence: "low" | "medium" | "high";
}

export interface ProposalDraft {
  id: string;
  jobProviderObjectId: string;
  version: number;
  status: "draft" | "ready_for_review" | "handoff_requested" | "provider_confirmed" | "outcome_uncertain";
  opening: string;
  proof: string;
  approach: string;
  questions: string[];
  closing: string;
  rateMinor?: number;
  currency?: string;
  screeningAnswers: Array<{ question: string; answer: string }>;
  proofClaimIds: string[];
  unsupportedClaims: string[];
  createdAt: string;
  updatedAt: string;
}

export const ACTION_INTENT_STATES = [
  "draft",
  "previewed",
  "handoff_requested",
  "provider_confirmation_pending",
  "provider_pending",
  "receipt_recorded",
  "verified",
  "failed_no_change",
  "outcome_uncertain",
  "already_completed",
  "expired",
  "cancelled"
] as const;
export type ActionIntentState = (typeof ACTION_INTENT_STATES)[number];

export interface ActionIntent {
  id: string;
  actionKind: "proposal_submission" | "reply_send" | "milestone_submission" | "profile_update" | "service_update";
  providerTargetId: string;
  frozenPayload: string;
  payloadHash: string;
  sourceVersionHash: string;
  providerRevision?: string;
  costConnects?: number;
  state: ActionIntentState;
  expiresAt: string;
  createdAt: string;
  outcome?: ProviderOutcome;
  providerReceiptId?: string;
  providerReadBackAt?: string;
}

export interface ProviderReceipt {
  intentId: string;
  outcome: ProviderOutcome;
  providerReceiptId?: string;
  providerReadBackAt?: string;
  providerStateSummary: string;
  recordedAt: string;
}

export interface WorkspaceStatus {
  accountConnected: boolean;
  providerLastCheckedAt?: string;
  capabilities: Record<string, CapabilityState>;
  historyCounts: Record<ProviderEntityType, number>;
  draftCount: number;
  proofCount: number;
  dataRetention: "until_user_deletes";
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  targetSkills: [],
  targetServices: [],
  targetIndustries: [],
  excludedTerms: [],
  minimumHourlyRateMinor: 0,
  minimumFixedBudgetMinor: 0,
  maximumJobAgeHours: 72,
  strongFitThreshold: 80,
  reviewThreshold: 65,
  availabilityHoursPerWeek: 40,
  writingTone: "direct",
  schedule: {
    timezone: "America/New_York",
    morningBrief: "08:00",
    opportunityScans: ["13:00", "18:00"],
    quietHoursStart: "20:00",
    quietHoursEnd: "07:00",
    enabledDays: [0, 1, 2, 3, 4, 5, 6]
  }
};
