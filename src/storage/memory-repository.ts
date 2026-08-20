import { canonicalJson } from "../domain/hash";
import {
  DEFAULT_PREFERENCES,
  PROVIDER_ENTITY_TYPES,
  type ActionIntent,
  type CapabilityState,
  type ProofClaim,
  type ProposalDraft,
  type ProviderReceipt,
  type ProviderEntityType,
  type ProviderRecord,
  type UserPreferences,
  type WorkspaceStatus
} from "../domain/contracts";
import type { RevenueCopilotRepository, SaveResult } from "./repository";

interface TenantState {
  preferences: UserPreferences;
  proofs: Map<string, ProofClaim>;
  records: Map<string, ProviderRecord>;
  capabilities: Record<string, CapabilityState>;
  providerLastCheckedAt?: string;
  drafts: Map<string, ProposalDraft>;
  intents: Map<string, ActionIntent>;
  receipts: Map<string, ProviderReceipt>;
  idempotency: Map<string, { body: string; result: object }>;
}

export class MemoryRepository implements RevenueCopilotRepository {
  private readonly tenants = new Map<string, TenantState>();

  async getWorkspaceStatus(tenantId: string): Promise<WorkspaceStatus> {
    const state = this.state(tenantId);
    const historyCounts = Object.fromEntries(PROVIDER_ENTITY_TYPES.map((type) => [type, 0])) as Record<ProviderEntityType, number>;
    for (const record of state.records.values()) historyCounts[record.entityType] += 1;
    return {
      accountConnected: true,
      ...(state.providerLastCheckedAt ? { providerLastCheckedAt: state.providerLastCheckedAt } : {}),
      capabilities: { ...state.capabilities },
      historyCounts,
      draftCount: state.drafts.size,
      proofCount: [...state.proofs.values()].filter((proof) => !proof.archivedAt).length,
      dataRetention: "until_user_deletes"
    };
  }

  async getPreferences(tenantId: string): Promise<UserPreferences> {
    return structuredClone(this.state(tenantId).preferences);
  }

  async savePreferences(tenantId: string, preferences: UserPreferences, idempotencyKey: string): Promise<SaveResult<UserPreferences>> {
    return this.idempotent(tenantId, "save_preferences", idempotencyKey, preferences, () => {
      this.state(tenantId).preferences = structuredClone(preferences);
      return structuredClone(preferences);
    });
  }

  async listProofClaims(tenantId: string, includeArchived = false): Promise<ProofClaim[]> {
    return [...this.state(tenantId).proofs.values()]
      .filter((claim) => includeArchived || !claim.archivedAt)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .map((claim) => structuredClone(claim));
  }

  async saveProofClaim(tenantId: string, claim: ProofClaim, idempotencyKey: string): Promise<SaveResult<ProofClaim>> {
    return this.idempotent(tenantId, "save_proof_claim", idempotencyKey, claim, () => {
      this.state(tenantId).proofs.set(claim.id, structuredClone(claim));
      return structuredClone(claim);
    });
  }

  async ingestProviderRecords(tenantId: string, records: ProviderRecord[], idempotencyKey: string): Promise<SaveResult<{ accepted: number; ignoredAsOlder: number; unchanged: number }>> {
    return this.idempotent(tenantId, "ingest_provider_records", idempotencyKey, { records }, () => {
      const state = this.state(tenantId);
      let accepted = 0;
      let ignoredAsOlder = 0;
      let unchanged = 0;
      for (const record of records) {
        const key = `${record.entityType}:${record.providerObjectId}`;
        const existing = state.records.get(key);
        if (existing && canonicalJson(existing) === canonicalJson(record)) {
          unchanged += 1;
          continue;
        }
        if (existing && compareAuthority(record, existing) < 0) {
          ignoredAsOlder += 1;
          continue;
        }
        state.records.set(key, structuredClone(record));
        accepted += 1;
      }
      const officialTimes = records.filter((record) => record.source === "official_provider").map((record) => record.observedAt).sort();
      const newestOfficial = officialTimes.at(-1);
      if (newestOfficial) state.providerLastCheckedAt = newestOfficial;
      return { accepted, ignoredAsOlder, unchanged };
    });
  }

  async listProviderRecords<T extends ProviderRecord>(tenantId: string, entityType: ProviderEntityType): Promise<T[]> {
    return [...this.state(tenantId).records.values()]
      .filter((record) => record.entityType === entityType)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .map((record) => structuredClone(record) as T);
  }

  async getProviderRecord<T extends ProviderRecord>(tenantId: string, entityType: ProviderEntityType, providerObjectId: string): Promise<T | undefined> {
    const value = this.state(tenantId).records.get(`${entityType}:${providerObjectId}`);
    return value ? structuredClone(value) as T : undefined;
  }

  async saveCapabilities(tenantId: string, capabilities: Record<string, CapabilityState>, observedAt: string, idempotencyKey: string): Promise<SaveResult<Record<string, CapabilityState>>> {
    return this.idempotent(tenantId, "save_capabilities", idempotencyKey, { capabilities, observedAt }, () => {
      const state = this.state(tenantId);
      state.capabilities = { ...capabilities };
      state.providerLastCheckedAt = observedAt;
      return { ...capabilities };
    });
  }

  async saveProposalDraft(tenantId: string, draft: ProposalDraft, idempotencyKey: string): Promise<SaveResult<ProposalDraft>> {
    return this.idempotent(tenantId, "save_proposal_draft", idempotencyKey, draft, () => {
      this.state(tenantId).drafts.set(draft.id, structuredClone(draft));
      return structuredClone(draft);
    });
  }

  async listProposalDrafts(tenantId: string): Promise<ProposalDraft[]> {
    return [...this.state(tenantId).drafts.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((draft) => structuredClone(draft));
  }

  async saveActionIntent(tenantId: string, intent: ActionIntent, idempotencyKey: string): Promise<SaveResult<ActionIntent>> {
    return this.idempotent(tenantId, "save_action_intent", idempotencyKey, intent, () => {
      this.state(tenantId).intents.set(intent.id, structuredClone(intent));
      return structuredClone(intent);
    });
  }

  async getActionIntent(tenantId: string, intentId: string): Promise<ActionIntent | undefined> {
    const intent = this.state(tenantId).intents.get(intentId);
    return intent ? structuredClone(intent) : undefined;
  }

  async updateActionIntent(tenantId: string, intent: ActionIntent, idempotencyKey: string): Promise<SaveResult<ActionIntent>> {
    return this.idempotent(tenantId, "update_action_intent", idempotencyKey, intent, () => {
      this.state(tenantId).intents.set(intent.id, structuredClone(intent));
      return structuredClone(intent);
    });
  }

  async recordProviderReceipt(tenantId: string, receipt: ProviderReceipt, idempotencyKey: string): Promise<SaveResult<ProviderReceipt>> {
    return this.idempotent(tenantId, "record_provider_receipt", idempotencyKey, receipt, () => {
      this.state(tenantId).receipts.set(`${receipt.intentId}:${receipt.recordedAt}`, structuredClone(receipt));
      return structuredClone(receipt);
    });
  }

  async exportTenant(tenantId: string): Promise<Record<string, object[] | object>> {
    const state = this.state(tenantId);
    return {
      preferences: structuredClone(state.preferences),
      proofs: [...state.proofs.values()].map((value) => structuredClone(value)),
      providerRecords: [...state.records.values()].map((value) => structuredClone(value)),
      proposalDrafts: [...state.drafts.values()].map((value) => structuredClone(value)),
      actionIntents: [...state.intents.values()].map((value) => structuredClone(value)),
      providerReceipts: [...state.receipts.values()].map((value) => structuredClone(value)),
      capabilities: { ...state.capabilities }
    };
  }

  async deleteTenantData(tenantId: string, scope: "record" | "domain" | "account", target?: string): Promise<{ deleted: number }> {
    const state = this.state(tenantId);
    if (scope === "account") {
      const before = state.records.size + state.proofs.size + state.drafts.size + state.intents.size + state.receipts.size;
      this.tenants.delete(tenantId);
      return { deleted: before };
    }
    if (!target) return { deleted: 0 };
    if (scope === "record") {
      const collections = [state.records, state.proofs, state.drafts, state.intents, state.receipts] as Array<Map<string, object>>;
      for (const collection of collections) if (collection.delete(target)) return { deleted: 1 };
      return { deleted: 0 };
    }
    let deleted = 0;
    for (const [key, record] of state.records) {
      if (record.entityType === target) {
        state.records.delete(key);
        deleted += 1;
      }
    }
    return { deleted };
  }

  private state(tenantId: string): TenantState {
    let state = this.tenants.get(tenantId);
    if (!state) {
      state = {
        preferences: structuredClone(DEFAULT_PREFERENCES),
        proofs: new Map(),
        records: new Map(),
        capabilities: {},
        drafts: new Map(),
        intents: new Map(),
        receipts: new Map(),
        idempotency: new Map()
      };
      this.tenants.set(tenantId, state);
    }
    return state;
  }

  private async idempotent<T extends object>(
    tenantId: string,
    operation: string,
    idempotencyKey: string,
    body: object,
    execute: () => T
  ): Promise<SaveResult<T>> {
    const state = this.state(tenantId);
    const key = `${operation}:${idempotencyKey}`;
    const canonical = canonicalJson(body);
    const existing = state.idempotency.get(key);
    if (existing) {
      if (existing.body !== canonical) throw new Error("IDEMPOTENCY_CONFLICT");
      return { value: structuredClone(existing.result) as T, replayed: true };
    }
    const value = execute();
    state.idempotency.set(key, { body: canonical, result: structuredClone(value) });
    return { value, replayed: false };
  }
}

function compareAuthority(incoming: ProviderRecord, existing: ProviderRecord): number {
  const incomingAuthority = incoming.source === "official_provider" ? 2 : 1;
  const existingAuthority = existing.source === "official_provider" ? 2 : 1;
  if (incomingAuthority !== existingAuthority) return incomingAuthority - existingAuthority;
  const incomingTime = new Date(incoming.providerUpdatedAt ?? incoming.observedAt).getTime();
  const existingTime = new Date(existing.providerUpdatedAt ?? existing.observedAt).getTime();
  return incomingTime - existingTime;
}
