import { canonicalJson, sha256Hex } from "../domain/hash";
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
import { TenantEnvelopeEncryption } from "./encryption";

type Row = Record<string, string | number | null>;

export class D1Repository implements RevenueCopilotRepository {
  private readonly encryption: TenantEnvelopeEncryption;
  constructor(private readonly db: D1Database, masterKeyBase64?: string, private readonly derivedQueue?: Queue<{ tenantId: string; eventKind: string }>) { this.encryption = new TenantEnvelopeEncryption(masterKeyBase64); }

  async getWorkspaceStatus(tenantId: string): Promise<WorkspaceStatus> {
    const [counts, capabilities, drafts, proofs, latest] = await Promise.all([
      this.db.prepare("SELECT entity_type, COUNT(*) AS count FROM provider_entities WHERE tenant_id = ? GROUP BY entity_type").bind(tenantId).all<Row>(),
      this.db.prepare("SELECT capability, state FROM capability_observations WHERE tenant_id = ?").bind(tenantId).all<Row>(),
      this.db.prepare("SELECT COUNT(*) AS count FROM proposal_drafts WHERE tenant_id = ?").bind(tenantId).first<Row>(),
      this.db.prepare("SELECT COUNT(*) AS count FROM proof_claims WHERE tenant_id = ? AND archived_at IS NULL").bind(tenantId).first<Row>(),
      this.db.prepare("SELECT MAX(observed_at) AS observed_at FROM provider_entities WHERE tenant_id = ? AND source = 'official_provider'").bind(tenantId).first<Row>()
    ]);
    const historyCounts = Object.fromEntries(PROVIDER_ENTITY_TYPES.map((type) => [type, 0])) as Record<ProviderEntityType, number>;
    for (const row of counts.results) historyCounts[String(row.entity_type) as ProviderEntityType] = Number(row.count);
    return {
      accountConnected: Boolean(latest?.observed_at),
      ...(latest?.observed_at ? { providerLastCheckedAt: String(latest.observed_at) } : {}),
      capabilities: Object.fromEntries(capabilities.results.map((row) => [String(row.capability), String(row.state) as CapabilityState])),
      historyCounts,
      draftCount: Number(drafts?.count ?? 0),
      proofCount: Number(proofs?.count ?? 0),
      dataRetention: "until_user_deletes"
    };
  }

  async getPreferences(tenantId: string): Promise<UserPreferences> {
    const row = await this.db.prepare("SELECT normalized_json FROM tenant_preferences WHERE tenant_id = ?").bind(tenantId).first<Row>();
    return row ? JSON.parse(await this.encryption.decrypt(tenantId, "preferences", String(row.normalized_json))) as UserPreferences : structuredClone(DEFAULT_PREFERENCES);
  }

  async savePreferences(tenantId: string, value: UserPreferences, key: string): Promise<SaveResult<UserPreferences>> {
    return this.idempotent(tenantId, "save_preferences", key, value, async () => {
      const now = new Date().toISOString();
      const json = await this.encryption.encrypt(tenantId, "preferences", canonicalJson(value));
      await this.db.prepare("INSERT INTO tenant_preferences (tenant_id,schema_version,normalized_json,content_hash,updated_at) VALUES (?, '1.0', ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET normalized_json=excluded.normalized_json,content_hash=excluded.content_hash,updated_at=excluded.updated_at")
        .bind(tenantId, json, await hashObject(value), now).run();
      return value;
    });
  }

  async listProofClaims(tenantId: string, includeArchived = false): Promise<ProofClaim[]> {
    const query = `SELECT * FROM proof_claims WHERE tenant_id = ?${includeArchived ? "" : " AND archived_at IS NULL"} ORDER BY observed_at DESC`;
    const rows = await this.db.prepare(query).bind(tenantId).all<Row>();
    return Promise.all(rows.results.map((row) => this.proofFromRow(tenantId, row)));
  }

  async saveProofClaim(tenantId: string, value: ProofClaim, key: string): Promise<SaveResult<ProofClaim>> {
    return this.idempotent(tenantId, "save_proof_claim", key, value, async () => {
      await this.db.prepare("INSERT INTO proof_claims (tenant_id,id,claim,category,skills_json,evidence_label,evidence_url,verified,allowed_contexts_json,observed_at,archived_at,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET claim=excluded.claim,category=excluded.category,skills_json=excluded.skills_json,evidence_label=excluded.evidence_label,evidence_url=excluded.evidence_url,verified=excluded.verified,allowed_contexts_json=excluded.allowed_contexts_json,observed_at=excluded.observed_at,archived_at=excluded.archived_at,content_hash=excluded.content_hash")
        .bind(tenantId, value.id, await this.encryption.encrypt(tenantId, "proof-claim", value.claim), value.category, canonicalJson(value.skills), await this.encryption.encrypt(tenantId, "proof-evidence", value.evidenceLabel), value.evidenceUrl ? await this.encryption.encrypt(tenantId, "proof-url", value.evidenceUrl) : null, value.verified ? 1 : 0, canonicalJson(value.allowedContexts), value.observedAt, value.archivedAt ?? null, await hashObject(value)).run();
      return value;
    });
  }

  async ingestProviderRecords(tenantId: string, records: ProviderRecord[], key: string): Promise<SaveResult<{ accepted: number; ignoredAsOlder: number; unchanged: number }>> {
    return this.idempotent(tenantId, "ingest_provider_records", key, { records }, async () => {
      let accepted = 0; let ignoredAsOlder = 0; let unchanged = 0;
      for (const record of records) {
        const existing = await this.getProviderRecord<ProviderRecord>(tenantId, record.entityType, record.providerObjectId);
        if (existing && canonicalJson(existing) === canonicalJson(record)) { unchanged += 1; continue; }
        if (existing && compareAuthority(record, existing) < 0) { ignoredAsOlder += 1; continue; }
        const json = await this.encryption.encrypt(tenantId, `provider-${record.entityType}`, canonicalJson(record)); const hash = await hashObject(record);
        await this.db.batch([
          this.db.prepare("INSERT OR IGNORE INTO provider_entity_versions (tenant_id,entity_type,provider_object_id,observed_at,source,normalized_json,content_hash,schema_version) VALUES (?,?,?,?,?,?,?,'1.0')").bind(tenantId, record.entityType, record.providerObjectId, record.observedAt, record.source, json, hash),
          this.db.prepare("INSERT INTO provider_entities (tenant_id,entity_type,provider_object_id,provider_updated_at,observed_at,source,source_call_id,normalized_json,content_hash,schema_version) VALUES (?,?,?,?,?,?,?,?,?,'1.0') ON CONFLICT(tenant_id,entity_type,provider_object_id) DO UPDATE SET provider_updated_at=excluded.provider_updated_at,observed_at=excluded.observed_at,source=excluded.source,source_call_id=excluded.source_call_id,normalized_json=excluded.normalized_json,content_hash=excluded.content_hash").bind(tenantId, record.entityType, record.providerObjectId, record.providerUpdatedAt ?? null, record.observedAt, record.source, record.sourceCallId ?? null, json, hash)
        ]);
        accepted += 1;
      }
      if (accepted > 0 && this.derivedQueue) await this.derivedQueue.send({ tenantId, eventKind: "provider_context_ingested" }, { contentType: "json" });
      return { accepted, ignoredAsOlder, unchanged };
    });
  }

  async listProviderRecords<T extends ProviderRecord>(tenantId: string, entityType: ProviderEntityType): Promise<T[]> {
    const rows = await this.db.prepare("SELECT normalized_json FROM provider_entities WHERE tenant_id = ? AND entity_type = ? ORDER BY observed_at DESC").bind(tenantId, entityType).all<Row>();
    return Promise.all(rows.results.map(async (row) => JSON.parse(await this.encryption.decrypt(tenantId, `provider-${entityType}`, String(row.normalized_json))) as T));
  }

  async getProviderRecord<T extends ProviderRecord>(tenantId: string, entityType: ProviderEntityType, id: string): Promise<T | undefined> {
    const row = await this.db.prepare("SELECT normalized_json FROM provider_entities WHERE tenant_id = ? AND entity_type = ? AND provider_object_id = ?").bind(tenantId, entityType, id).first<Row>();
    return row ? JSON.parse(await this.encryption.decrypt(tenantId, `provider-${entityType}`, String(row.normalized_json))) as T : undefined;
  }

  async saveCapabilities(tenantId: string, values: Record<string, CapabilityState>, observedAt: string, key: string): Promise<SaveResult<Record<string, CapabilityState>>> {
    return this.idempotent(tenantId, "save_capabilities", key, { values, observedAt }, async () => {
      await this.db.batch(Object.entries(values).map(([name, state]) => this.db.prepare("INSERT INTO capability_observations (tenant_id,capability,state,observed_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,capability) DO UPDATE SET state=excluded.state,observed_at=excluded.observed_at").bind(tenantId, name, state, observedAt)));
      return values;
    });
  }

  async saveProposalDraft(tenantId: string, value: ProposalDraft, key: string): Promise<SaveResult<ProposalDraft>> {
    return this.idempotent(tenantId, "save_proposal_draft", key, value, async () => {
      const json = await this.encryption.encrypt(tenantId, "proposal-draft", canonicalJson(value)); const hash = await hashObject(value);
      await this.db.batch([
        this.db.prepare("INSERT OR IGNORE INTO proposal_draft_versions (tenant_id,id,version,normalized_json,content_hash,created_at) VALUES (?,?,?,?,?,?)").bind(tenantId, value.id, value.version, json, hash, value.updatedAt),
        this.db.prepare("INSERT INTO proposal_drafts (tenant_id,id,version,status,job_provider_object_id,normalized_json,content_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET version=excluded.version,status=excluded.status,normalized_json=excluded.normalized_json,content_hash=excluded.content_hash,updated_at=excluded.updated_at").bind(tenantId, value.id, value.version, value.status, value.jobProviderObjectId, json, hash, value.createdAt, value.updatedAt)
      ]);
      return value;
    });
  }

  async listProposalDrafts(tenantId: string): Promise<ProposalDraft[]> {
    const rows = await this.db.prepare("SELECT normalized_json FROM proposal_drafts WHERE tenant_id = ? ORDER BY updated_at DESC").bind(tenantId).all<Row>();
    return Promise.all(rows.results.map(async (row) => JSON.parse(await this.encryption.decrypt(tenantId, "proposal-draft", String(row.normalized_json))) as ProposalDraft));
  }

  async saveActionIntent(tenantId: string, value: ActionIntent, key: string): Promise<SaveResult<ActionIntent>> { return this.persistIntent(tenantId, value, key, "save_action_intent"); }
  async updateActionIntent(tenantId: string, value: ActionIntent, key: string): Promise<SaveResult<ActionIntent>> { return this.persistIntent(tenantId, value, key, "update_action_intent"); }

  async getActionIntent(tenantId: string, id: string): Promise<ActionIntent | undefined> {
    const row = await this.db.prepare("SELECT * FROM action_intents WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first<Row>();
    return row ? this.intentFromRow(tenantId, row) : undefined;
  }

  async recordProviderReceipt(tenantId: string, value: ProviderReceipt, key: string): Promise<SaveResult<ProviderReceipt>> {
    return this.idempotent(tenantId, "record_provider_receipt", key, value, async () => {
      const normalized = await this.encryption.encrypt(tenantId, "provider-receipt", canonicalJson(value));
      await this.db.prepare("INSERT INTO action_receipts (tenant_id,intent_id,outcome,provider_receipt_id,provider_read_back_at,recorded_at,normalized_json) VALUES (?,?,?,?,?,?,?)")
        .bind(tenantId, value.intentId, value.outcome, value.providerReceiptId ?? null, value.providerReadBackAt ?? null, value.recordedAt, normalized).run();
      return value;
    });
  }

  async exportTenant(tenantId: string): Promise<Record<string, object[] | object>> {
    const [preferences, proofs, records, drafts, intents, receipts, capabilities] = await Promise.all([
      this.getPreferences(tenantId), this.listProofClaims(tenantId, true),
      Promise.all(PROVIDER_ENTITY_TYPES.map((type) => this.listProviderRecords(tenantId, type))).then((rows) => rows.flat()),
      this.listProposalDrafts(tenantId),
      this.db.prepare("SELECT * FROM action_intents WHERE tenant_id = ? ORDER BY created_at DESC").bind(tenantId).all<Row>(),
      this.db.prepare("SELECT normalized_json FROM action_receipts WHERE tenant_id = ? ORDER BY recorded_at DESC").bind(tenantId).all<Row>(),
      this.db.prepare("SELECT capability,state FROM capability_observations WHERE tenant_id = ?").bind(tenantId).all<Row>()
    ]);
    return { preferences, proofs, providerRecords: records, proposalDrafts: drafts, actionIntents: await Promise.all(intents.results.map((row) => this.intentFromRow(tenantId, row))), providerReceipts: await Promise.all(receipts.results.map(async (row) => JSON.parse(await this.encryption.decrypt(tenantId, "provider-receipt", String(row.normalized_json))) as ProviderReceipt)), capabilities: Object.fromEntries(capabilities.results.map((row) => [String(row.capability), String(row.state)])) };
  }

  async deleteTenantData(tenantId: string, scope: "record" | "domain" | "account", target?: string): Promise<{ deleted: number }> {
    if (scope === "account") {
      const tables = ["tenant_preferences", "proof_claims", "provider_entity_versions", "provider_entities", "capability_observations", "proposal_draft_versions", "proposal_drafts", "action_receipts", "action_intents", "attachment_metadata", "daily_analytics_facts", "recommendation_versions", "score_versions", "sync_checkpoints", "sync_runs", "policy_versions", "idempotency_records", "audit_events"];
      const results = await this.db.batch(tables.map((table) => this.db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId)));
      return { deleted: results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0) };
    }
    if (!target) return { deleted: 0 };
    if (scope === "domain") {
      const results = await this.db.batch([
        this.db.prepare("DELETE FROM provider_entity_versions WHERE tenant_id = ? AND entity_type = ?").bind(tenantId, target),
        this.db.prepare("DELETE FROM provider_entities WHERE tenant_id = ? AND entity_type = ?").bind(tenantId, target)
      ]);
      return { deleted: results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0) };
    }
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM provider_entity_versions WHERE tenant_id = ? AND provider_object_id = ?").bind(tenantId, target),
      this.db.prepare("DELETE FROM provider_entities WHERE tenant_id = ? AND provider_object_id = ?").bind(tenantId, target),
      this.db.prepare("DELETE FROM proof_claims WHERE tenant_id = ? AND id = ?").bind(tenantId, target),
      this.db.prepare("DELETE FROM proposal_draft_versions WHERE tenant_id = ? AND id = ?").bind(tenantId, target),
      this.db.prepare("DELETE FROM proposal_drafts WHERE tenant_id = ? AND id = ?").bind(tenantId, target),
      this.db.prepare("DELETE FROM action_receipts WHERE tenant_id = ? AND intent_id = ?").bind(tenantId, target),
      this.db.prepare("DELETE FROM action_intents WHERE tenant_id = ? AND id = ?").bind(tenantId, target)
    ]);
    return { deleted: results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0) };
  }

  private async persistIntent(tenantId: string, value: ActionIntent, key: string, operation: string): Promise<SaveResult<ActionIntent>> {
    return this.idempotent(tenantId, operation, key, value, async () => {
      await this.db.prepare("INSERT INTO action_intents (tenant_id,id,action_kind,provider_target_id,state,payload_hash,source_version_hash,provider_revision,cost_connects,frozen_payload,expires_at,created_at,outcome,provider_receipt_id,provider_read_back_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET state=excluded.state,outcome=excluded.outcome,provider_receipt_id=excluded.provider_receipt_id,provider_read_back_at=excluded.provider_read_back_at")
        .bind(tenantId, value.id, value.actionKind, value.providerTargetId, value.state, value.payloadHash, value.sourceVersionHash, value.providerRevision ?? null, value.costConnects ?? null, await this.encryption.encrypt(tenantId, "action-payload", value.frozenPayload), value.expiresAt, value.createdAt, value.outcome ?? null, value.providerReceiptId ?? null, value.providerReadBackAt ?? null).run();
      return value;
    });
  }

  private async idempotent<T extends object>(tenantId: string, operation: string, key: string, body: object, execute: () => Promise<T>): Promise<SaveResult<T>> {
    const bodyHash = await hashObject(body);
    const prior = await this.db.prepare("SELECT body_hash,result_json FROM idempotency_records WHERE tenant_id = ? AND operation = ? AND idempotency_key = ?").bind(tenantId, operation, key).first<Row>();
    if (prior) {
      if (String(prior.body_hash) !== bodyHash) throw new Error("IDEMPOTENCY_CONFLICT");
      return { value: JSON.parse(await this.encryption.decrypt(tenantId, `idempotency-${operation}`, String(prior.result_json))) as T, replayed: true };
    }
    const value = await execute();
    await this.db.prepare("INSERT INTO idempotency_records (tenant_id,operation,idempotency_key,body_hash,result_json,created_at) VALUES (?,?,?,?,?,?)").bind(tenantId, operation, key, bodyHash, await this.encryption.encrypt(tenantId, `idempotency-${operation}`, canonicalJson(value)), new Date().toISOString()).run();
    return { value, replayed: false };
  }

  private async proofFromRow(tenantId: string, row: Row): Promise<ProofClaim> {
    return { id: String(row.id), claim: await this.encryption.decrypt(tenantId, "proof-claim", String(row.claim)), category: String(row.category), skills: JSON.parse(String(row.skills_json)) as string[], evidenceLabel: await this.encryption.decrypt(tenantId, "proof-evidence", String(row.evidence_label)), ...(row.evidence_url ? { evidenceUrl: await this.encryption.decrypt(tenantId, "proof-url", String(row.evidence_url)) } : {}), verified: Boolean(row.verified), allowedContexts: JSON.parse(String(row.allowed_contexts_json)) as string[], observedAt: String(row.observed_at), ...(row.archived_at ? { archivedAt: String(row.archived_at) } : {}) };
  }

  private async intentFromRow(tenantId: string, row: Row): Promise<ActionIntent> {
    return { id: String(row.id), actionKind: String(row.action_kind) as ActionIntent["actionKind"], providerTargetId: String(row.provider_target_id), frozenPayload: await this.encryption.decrypt(tenantId, "action-payload", String(row.frozen_payload)), payloadHash: String(row.payload_hash), sourceVersionHash: String(row.source_version_hash), ...(row.provider_revision ? { providerRevision: String(row.provider_revision) } : {}), ...(row.cost_connects !== null ? { costConnects: Number(row.cost_connects) } : {}), state: String(row.state) as ActionIntent["state"], expiresAt: String(row.expires_at), createdAt: String(row.created_at), ...(row.outcome ? { outcome: String(row.outcome) as NonNullable<ActionIntent["outcome"]> } : {}), ...(row.provider_receipt_id ? { providerReceiptId: String(row.provider_receipt_id) } : {}), ...(row.provider_read_back_at ? { providerReadBackAt: String(row.provider_read_back_at) } : {}) };
  }
}

function hashObject(value: object): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

function compareAuthority(incoming: ProviderRecord, existing: ProviderRecord): number {
  const incomingAuthority = incoming.source === "official_provider" ? 2 : 1;
  const existingAuthority = existing.source === "official_provider" ? 2 : 1;
  if (incomingAuthority !== existingAuthority) return incomingAuthority - existingAuthority;
  return new Date(incoming.providerUpdatedAt ?? incoming.observedAt).getTime() - new Date(existing.providerUpdatedAt ?? existing.observedAt).getTime();
}
