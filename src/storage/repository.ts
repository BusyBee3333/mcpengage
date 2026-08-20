import type {
  ActionIntent,
  CapabilityState,
  ProofClaim,
  ProposalDraft,
  ProviderReceipt,
  ProviderEntityType,
  ProviderRecord,
  UserPreferences,
  WorkspaceStatus
} from "../domain/contracts";

export interface SaveResult<T> {
  value: T;
  replayed: boolean;
}

export interface RevenueCopilotRepository {
  getWorkspaceStatus(tenantId: string): Promise<WorkspaceStatus>;
  getPreferences(tenantId: string): Promise<UserPreferences>;
  savePreferences(tenantId: string, preferences: UserPreferences, idempotencyKey: string): Promise<SaveResult<UserPreferences>>;
  listProofClaims(tenantId: string, includeArchived?: boolean): Promise<ProofClaim[]>;
  saveProofClaim(tenantId: string, claim: ProofClaim, idempotencyKey: string): Promise<SaveResult<ProofClaim>>;
  ingestProviderRecords(tenantId: string, records: ProviderRecord[], idempotencyKey: string): Promise<SaveResult<{ accepted: number; ignoredAsOlder: number; unchanged: number }>>;
  listProviderRecords<T extends ProviderRecord>(tenantId: string, entityType: ProviderEntityType): Promise<T[]>;
  getProviderRecord<T extends ProviderRecord>(tenantId: string, entityType: ProviderEntityType, providerObjectId: string): Promise<T | undefined>;
  saveCapabilities(tenantId: string, capabilities: Record<string, CapabilityState>, observedAt: string, idempotencyKey: string): Promise<SaveResult<Record<string, CapabilityState>>>;
  saveProposalDraft(tenantId: string, draft: ProposalDraft, idempotencyKey: string): Promise<SaveResult<ProposalDraft>>;
  listProposalDrafts(tenantId: string): Promise<ProposalDraft[]>;
  saveActionIntent(tenantId: string, intent: ActionIntent, idempotencyKey: string): Promise<SaveResult<ActionIntent>>;
  getActionIntent(tenantId: string, intentId: string): Promise<ActionIntent | undefined>;
  updateActionIntent(tenantId: string, intent: ActionIntent, idempotencyKey: string): Promise<SaveResult<ActionIntent>>;
  recordProviderReceipt(tenantId: string, receipt: ProviderReceipt, idempotencyKey: string): Promise<SaveResult<ProviderReceipt>>;
  exportTenant(tenantId: string): Promise<Record<string, object[] | object>>;
  deleteTenantData(tenantId: string, scope: "record" | "domain" | "account", target?: string): Promise<{ deleted: number }>;
}
