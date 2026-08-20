import { WorkerEntrypoint } from "cloudflare:workers";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import appHtml from "../../dist/revenue-copilot.html";
import { createRevenueCopilotServer } from "../server/register";
import { sha256Hex } from "../domain/hash";
import { D1Repository } from "../storage/d1-repository";
import { MemoryRepository } from "../storage/memory-repository";
import { handleAuthorizationRoutes, publicRoute, type AuthProps } from "./auth";
import type { Env } from "./env";
import { AccountLifecycleWorkflow, CloudflareLifecycleCoordinator } from "../operations/cloudflare-lifecycle";

export { AccountLifecycleWorkflow };

const developmentRepository = new MemoryRepository();

class ProtectedMcpHandler extends WorkerEntrypoint<Env, AuthProps> {
  async fetch(request: Request): Promise<Response> {
    if (!this.ctx.props.scopes.includes("copilot.read")) return new Response("Missing copilot.read scope", { status: 403 });
    if (!this.env.DATA_ENCRYPTION_KEY) return new Response("Revenue Copilot encryption is not configured", { status: 503 });
    if (!(await withinRateLimit(this.env.CONTROL_DB, this.ctx.props.tenantId))) return new Response("Revenue Copilot request limit reached. Try again shortly.", { status: 429, headers: { "retry-after": "60" } });
    return serveMcp(request, this.env, this.ctx, new D1Repository(this.env.DATA_DB, this.env.DATA_ENCRYPTION_KEY, this.env.DERIVED_QUEUE), this.ctx.props.tenantId, this.ctx.props.scopes, new CloudflareLifecycleCoordinator(this.env));
  }
}

const authorizationHandler: ExportedHandler<Env> = {
  fetch(request, env) { return handleAuthorizationRoutes(request, env); }
};

function providerFor(env: Env) {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: ProtectedMcpHandler,
    defaultHandler: authorizationHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ["copilot.read", "copilot.write", "copilot.account"],
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    allowTokenExchangeGrant: false,
    accessTokenTTL: 15 * 60,
    refreshTokenTTL: 90 * 24 * 60 * 60,
    resourceMetadata: {
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [env.PUBLIC_ORIGIN],
      scopes_supported: ["copilot.read", "copilot.write", "copilot.account"],
      bearer_methods_supported: ["header"],
      resource_name: "Revenue Copilot"
    }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (env.AUTH_MODE === "development") {
      if (url.pathname === "/mcp") return serveMcp(request, env, ctx, developmentRepository, request.headers.get("x-revenue-copilot-tenant") ?? "developer");
      return publicRoute(request, env);
    }
    return providerFor(env).fetch(request, env, ctx);
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body;
      if (!body || typeof body !== "object" || !("tenantId" in body) || typeof body.tenantId !== "string") { message.ack(); continue; }
      try { await refreshDailyFacts(env.DATA_DB, body.tenantId); message.ack(); }
      catch { message.retry({ delaySeconds: 30 }); }
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runInternalMaintenance(env));
  }
} satisfies ExportedHandler<Env>;

function serveMcp(request: Request, env: Env, ctx: ExecutionContext, repository: D1Repository | MemoryRepository, tenantId: string, scopes?: readonly string[], lifecycle?: CloudflareLifecycleCoordinator): Promise<Response> {
  const grantedScopes = (scopes ?? ["copilot.read", "copilot.write", "copilot.account"]).filter((scope): scope is "copilot.read" | "copilot.write" | "copilot.account" => scope === "copilot.read" || scope === "copilot.write" || scope === "copilot.account");
  const handler = createMcpHandler(() => createRevenueCopilotServer(repository, tenantId, appHtml, grantedScopes, lifecycle), {
    route: "/mcp",
    corsOptions: { origin: env.PUBLIC_ORIGIN, methods: "GET, POST, DELETE, OPTIONS", headers: "authorization, content-type, mcp-protocol-version, mcp-session-id", exposeHeaders: "mcp-session-id" },
    allowedOriginHostnames: env.ENVIRONMENT === "development" ? ["localhost", "127.0.0.1"] : [new URL(env.PUBLIC_ORIGIN).hostname]
  });
  return handler(request, env, ctx);
}

async function refreshDailyFacts(db: D1Database, tenantId: string): Promise<void> {
  const rows = await db.prepare("SELECT entity_type,COUNT(*) AS value FROM provider_entities WHERE tenant_id=? GROUP BY entity_type").bind(tenantId).all<{ entity_type: string; value: number }>();
  const date = new Date().toISOString().slice(0, 10); const now = new Date().toISOString();
  if (rows.results.length === 0) return;
  await db.batch(rows.results.map((row) => db.prepare("INSERT INTO daily_analytics_facts (tenant_id,fact_date,metric_key,metric_version,value_number,source_event_count,calculated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id,fact_date,metric_key,metric_version) DO UPDATE SET value_number=excluded.value_number,source_event_count=excluded.source_event_count,calculated_at=excluded.calculated_at").bind(tenantId, date, `current_${row.entity_type}_count`, "1.0", Number(row.value), Number(row.value), now)));
}

async function runInternalMaintenance(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.CONTROL_DB.prepare("DELETE FROM oauth_authorization_state WHERE expires_at < ?").bind(now).run();
  await env.CONTROL_DB.prepare("DELETE FROM rate_limit_windows WHERE window_start < ?").bind(new Date(Date.now() - 10 * 60_000).toISOString().slice(0, 16)).run();
  const expired = await env.CONTROL_DB.prepare("SELECT id,object_key FROM lifecycle_jobs WHERE job_type='export' AND object_key IS NOT NULL AND expires_at < ? LIMIT 100").bind(now).all<{ id: string; object_key: string }>();
  for (const row of expired.results) {
    await env.EXPORTS.delete(row.object_key);
    await env.CONTROL_DB.prepare("UPDATE lifecycle_jobs SET object_key=NULL WHERE id=?").bind(row.id).run();
  }
  await scheduleTenantBackups(env);
}

async function scheduleTenantBackups(env: Env): Promise<void> {
  const date = new Date();
  const today = date.toISOString().slice(0, 10);
  const accounts = await env.CONTROL_DB.prepare("SELECT id FROM accounts ORDER BY id").all<{ id: string }>();
  for (const account of accounts.results) {
    const tenantDigest = await sha256Hex(account.id);
    const suffix = tenantDigest.slice(0, 16);
    const jobId = `rc-backup-${today}-${suffix}`;
    const exists = await env.CONTROL_DB.prepare("SELECT id FROM lifecycle_jobs WHERE id=?").bind(jobId).first();
    if (!exists) {
      await env.CONTROL_DB.prepare("INSERT INTO lifecycle_jobs (id,tenant_id,job_type,status,requested_at) VALUES (?,?, 'backup','queued',?)")
        .bind(jobId, account.id, new Date().toISOString()).run();
      await env.ACCOUNT_LIFECYCLE.create({ id: jobId, params: { jobId, jobType: "backup", tenantId: account.id, mode: "create" } });
    }
    if (date.getUTCDate() !== 1 || ![0, 3, 6, 9].includes(date.getUTCMonth())) continue;
    const manifest = await env.CONTROL_DB.prepare("SELECT id FROM backup_manifests WHERE tenant_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 1")
      .bind(account.id, new Date().toISOString()).first<{ id: string }>();
    if (!manifest) continue;
    const drillId = `rc-drill-${today}-${suffix}`;
    const drill = await env.CONTROL_DB.prepare("SELECT id FROM lifecycle_jobs WHERE id=?").bind(drillId).first();
    if (!drill) {
      await env.CONTROL_DB.prepare("INSERT INTO lifecycle_jobs (id,tenant_id,job_type,status,target,requested_at) VALUES (?,?, 'backup','queued',?,?)")
        .bind(drillId, account.id, manifest.id, new Date().toISOString()).run();
      await env.ACCOUNT_LIFECYCLE.create({ id: drillId, params: { jobId: drillId, jobType: "backup", tenantId: account.id, mode: "restore_drill", backupManifestId: manifest.id } });
    }
  }
}

async function withinRateLimit(db: D1Database, tenantId: string): Promise<boolean> {
  const windowStart = new Date().toISOString().slice(0, 16);
  const row = await db.prepare("INSERT INTO rate_limit_windows (tenant_id,window_start,request_count) VALUES (?,?,1) ON CONFLICT(tenant_id,window_start) DO UPDATE SET request_count=request_count+1 RETURNING request_count").bind(tenantId, windowStart).first<{ request_count: number }>();
  return Number(row?.request_count ?? 1) <= 120;
}
