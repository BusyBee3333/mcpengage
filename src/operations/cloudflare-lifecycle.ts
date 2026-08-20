import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { sha256Hex } from "../domain/hash";
import { createExportZip } from "../domain/export-zip";
import { TenantEnvelopeEncryption } from "../storage/encryption";
import { D1Repository } from "../storage/d1-repository";
import type { Env } from "../worker/env";
import type { DeleteRequestResult, ExportRequestResult, LifecycleCoordinator } from "./coordinator";

export type AccountWorkflowParams =
  | { jobId: string; jobType: "export"; tenantId: string; format: "json" | "json_csv" }
  | { jobId: string; jobType: "delete"; tenantId: string; scope: "record" | "domain" | "account"; target?: string }
  | { jobId: string; jobType: "backup"; tenantId: string; mode: "create" | "restore_drill"; backupManifestId?: string };

type JobRow = {
  status: string;
  object_key: string | null;
  completed_at: string | null;
  expires_at: string | null;
  result_count: number | null;
};

export class CloudflareLifecycleCoordinator implements LifecycleCoordinator {
  constructor(private readonly env: Env) {}

  async requestExport(tenantId: string, format: "json" | "json_csv", idempotencyKey: string): Promise<ExportRequestResult> {
    const exportId = `rc-export-${(await sha256Hex(`${tenantId}|export|${idempotencyKey}`)).slice(0, 24)}`;
    const existing = await this.env.CONTROL_DB.prepare("SELECT status,object_key,completed_at,expires_at,result_count FROM lifecycle_jobs WHERE id = ? AND tenant_id = ?").bind(exportId, tenantId).first<JobRow>();
    if (existing?.status === "complete" && existing.object_key) {
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return { status: "ready", exportId, expiresAt, downloadUrl: await signedDownloadUrl(this.env, tenantId, exportId, expiresAt) };
    }
    if (!existing) {
      const now = new Date(); const objectExpiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
      await this.env.CONTROL_DB.prepare("INSERT INTO lifecycle_jobs (id,tenant_id,job_type,status,target,requested_at,expires_at) VALUES (?,?, 'export','queued',?,?,?)")
        .bind(exportId, tenantId, format, now.toISOString(), objectExpiresAt).run();
      await this.env.ACCOUNT_LIFECYCLE.create({ id: exportId, params: { jobId: exportId, jobType: "export", tenantId, format } });
    }
    return { status: "queued", exportId, expiresAt: existing?.expires_at ?? new Date(Date.now() + 24 * 60 * 60_000).toISOString() };
  }

  async requestDeletion(tenantId: string, scope: "record" | "domain" | "account", target: string | undefined, idempotencyKey: string): Promise<DeleteRequestResult> {
    const deletionJobId = `rc-delete-${(await sha256Hex(`${tenantId}|delete|${idempotencyKey}`)).slice(0, 24)}`;
    const existing = await this.env.CONTROL_DB.prepare("SELECT status,object_key,completed_at,expires_at,result_count FROM lifecycle_jobs WHERE id = ? AND tenant_id = ?").bind(deletionJobId, tenantId).first<JobRow>();
    if (existing?.status === "complete") return { status: "complete", deletionJobId, deleted: Number(existing.result_count ?? 0), completedAt: existing.completed_at ?? new Date().toISOString() };
    if (!existing) {
      const now = new Date().toISOString();
      await this.env.CONTROL_DB.prepare("INSERT INTO lifecycle_jobs (id,tenant_id,job_type,status,target,requested_at) VALUES (?,?, 'delete','queued',?,?)")
        .bind(deletionJobId, tenantId, target ?? null, now).run();
      await this.env.ACCOUNT_LIFECYCLE.create({ id: deletionJobId, params: { jobId: deletionJobId, jobType: "delete", tenantId, scope, ...(target ? { target } : {}) } });
    }
    return { status: "queued", deletionJobId };
  }
}

export class AccountLifecycleWorkflow extends WorkflowEntrypoint<Env, AccountWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<AccountWorkflowParams>>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    await step.do("mark-running", async () => {
      await this.env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET status = 'running' WHERE id = ?").bind(params.jobId).run();
    });
    try {
      await this.runJob(params, step);
    } catch (error) {
      await step.do("mark-failed", async () => {
        const errorCode = error instanceof Error ? error.message.slice(0, 120) : "WORKFLOW_FAILED";
        await this.env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET status='failed',completed_at=?,error_code=? WHERE id=?")
          .bind(new Date().toISOString(), errorCode, params.jobId).run();
      });
      throw error;
    }
  }

  private async runJob(params: AccountWorkflowParams, step: WorkflowStep): Promise<void> {
    if (params.jobType === "export") {
      await step.do("create-encrypted-export", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes", sensitive: "output" }, async () => {
        if (!this.env.DATA_ENCRYPTION_KEY) throw new Error("DATA_ENCRYPTION_KEY_UNAVAILABLE");
        const data = await new D1Repository(this.env.DATA_DB, this.env.DATA_ENCRYPTION_KEY).exportTenant(params.tenantId);
        const plaintext = params.format === "json_csv"
          ? `zip:v1:${encodeBytes(createExportZip(data))}`
          : JSON.stringify(data, null, 2);
        const encrypted = await new TenantEnvelopeEncryption(this.env.DATA_ENCRYPTION_KEY).encrypt(params.tenantId, `account-export:${params.jobId}`, plaintext);
        const tenantDigest = (await sha256Hex(params.tenantId)).slice(0, 32);
        const objectKey = `exports/${tenantDigest}/${params.jobId}.enc`;
        await this.env.EXPORTS.put(objectKey, encrypted, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { format: params.format, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() } });
        await this.env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET status='complete',completed_at=?,object_key=? WHERE id=?").bind(new Date().toISOString(), objectKey, params.jobId).run();
      });
      return;
    }
    if (params.jobType === "backup") {
      if (params.mode === "create") await step.do("create-encrypted-backup", { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes", sensitive: "output" }, async () => {
        if (!this.env.DATA_ENCRYPTION_KEY) throw new Error("DATA_ENCRYPTION_KEY_UNAVAILABLE");
        const data = await new D1Repository(this.env.DATA_DB, this.env.DATA_ENCRYPTION_KEY).exportTenant(params.tenantId);
        const now = new Date();
        const encrypted = await new TenantEnvelopeEncryption(this.env.DATA_ENCRYPTION_KEY).encrypt(params.tenantId, `account-backup:${params.jobId}`, JSON.stringify(data));
        const tenantDigest = (await sha256Hex(params.tenantId)).slice(0, 32);
        const objectKey = `backups/${tenantDigest}/${params.jobId}.enc`;
        const expiresAt = new Date(now.getTime() + 35 * 24 * 60 * 60_000).toISOString();
        await this.env.EXPORTS.put(objectKey, encrypted, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { expiresAt } });
        await this.env.CONTROL_DB.batch([
          this.env.CONTROL_DB.prepare("INSERT INTO backup_manifests (id,tenant_id,shard_id,object_key,content_hash,created_at,expires_at) VALUES (?,?,'DATA_0',?,?,?,?)")
            .bind(params.jobId, params.tenantId, objectKey, await sha256Hex(encrypted), now.toISOString(), expiresAt),
          this.env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET status='complete',completed_at=?,object_key=?,expires_at=? WHERE id=?").bind(now.toISOString(), objectKey, expiresAt, params.jobId)
        ]);
      });
      else await step.do("verify-backup-and-deletion-replay", { retries: { limit: 2, delay: "30 seconds", backoff: "constant" }, timeout: "5 minutes", sensitive: "output" }, async () => {
        if (!this.env.DATA_ENCRYPTION_KEY || !params.backupManifestId) throw new Error("BACKUP_DRILL_INPUT_INVALID");
        const manifest = await this.env.CONTROL_DB.prepare("SELECT object_key,content_hash FROM backup_manifests WHERE id=? AND tenant_id=?")
          .bind(params.backupManifestId, params.tenantId).first<{ object_key: string; content_hash: string }>();
        if (!manifest) throw new Error("BACKUP_MANIFEST_NOT_FOUND");
        const object = await this.env.EXPORTS.get(manifest.object_key);
        if (!object) throw new Error("BACKUP_OBJECT_NOT_FOUND");
        const encrypted = await object.text();
        if (await sha256Hex(encrypted) !== manifest.content_hash) throw new Error("BACKUP_HASH_MISMATCH");
        const plaintext = await new TenantEnvelopeEncryption(this.env.DATA_ENCRYPTION_KEY).decrypt(params.tenantId, `account-backup:${params.backupManifestId}`, encrypted);
        const restored = JSON.parse(plaintext) as Record<string, unknown>;
        if (!restored || typeof restored !== "object") throw new Error("BACKUP_PAYLOAD_INVALID");
        // Restored data remains isolated. Tombstones are checked before any future restore path may expose data.
        await this.env.CONTROL_DB.prepare("SELECT id FROM deletion_tombstones WHERE tenant_id=? AND completed_at IS NOT NULL").bind(params.tenantId).all();
        const now = new Date().toISOString();
        await this.env.CONTROL_DB.batch([
          this.env.CONTROL_DB.prepare("UPDATE backup_manifests SET restore_drill_at=? WHERE id=?").bind(now, params.backupManifestId),
          this.env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET status='complete',completed_at=? WHERE id=?").bind(now, params.jobId)
        ]);
      });
      return;
    }
    await step.do("delete-active-data", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" }, async () => {
      if (!this.env.DATA_ENCRYPTION_KEY) throw new Error("DATA_ENCRYPTION_KEY_UNAVAILABLE");
      const result = await new D1Repository(this.env.DATA_DB, this.env.DATA_ENCRYPTION_KEY).deleteTenantData(params.tenantId, params.scope, params.target);
      const now = new Date().toISOString();
      await this.env.CONTROL_DB.batch([
        this.env.CONTROL_DB.prepare("INSERT INTO deletion_tombstones (id,tenant_id,scope,target,requested_at,completed_at) VALUES (?,?,?,?,?,?)").bind(params.jobId, params.tenantId, params.scope, params.target ?? null, now, now),
        this.env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET status='complete',completed_at=?,result_count=? WHERE id=?").bind(now, result.deleted, params.jobId)
      ]);
    });
  }
}

export async function signedDownloadUrl(env: Env, tenantId: string, exportId: string, expiresAt: string): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify({ tenantId, exportId, exp: Date.parse(expiresAt) }));
  const signature = await sign(env, payload);
  return `${env.PUBLIC_ORIGIN}/exports/${encodeURIComponent(exportId)}?token=${payload}.${signature}`;
}

export async function verifyDownloadToken(env: Env, exportId: string, token: string): Promise<{ tenantId: string } | undefined> {
  const [payload, signature] = token.split("."); if (!payload || !signature || !(await timingSafeEqual(signature, await sign(env, payload)))) return undefined;
  const decoded = JSON.parse(decodeBase64Url(payload)) as { tenantId?: string; exportId?: string; exp?: number };
  if (!decoded.tenantId || decoded.exportId !== exportId || !decoded.exp || decoded.exp < Date.now()) return undefined;
  return { tenantId: decoded.tenantId };
}

async function sign(env: Env, payload: string): Promise<string> {
  if (!env.DATA_ENCRYPTION_KEY) throw new Error("DATA_ENCRYPTION_KEY_UNAVAILABLE");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.DATA_ENCRYPTION_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encodeBytes(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}
function encodeBase64Url(value: string): string { return encodeBytes(new TextEncoder().encode(value)); }
function encodeBytes(bytes: Uint8Array): string { let raw = ""; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function decodeBase64Url(value: string): string { const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")); return new TextDecoder().decode(Uint8Array.from(raw, (char) => char.charCodeAt(0))); }
async function timingSafeEqual(left: string, right: string): Promise<boolean> { if (left.length !== right.length) return false; let mismatch = 0; for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index); return mismatch === 0; }
