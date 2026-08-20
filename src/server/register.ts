import { McpServer } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps";
import type { RevenueCopilotRepository } from "../storage/repository";
import type { ProofClaim, ProviderRecord, UserPreferences } from "../domain/contracts";
import { RevenueCopilotService } from "../service/revenue-copilot-service";
import type { LifecycleCoordinator } from "../operations/coordinator";
import * as S from "./tool-schemas";

export const APP_RESOURCES = {
  capabilities: "ui://revenue-copilot/capabilities/v1.html",
  revenuePulse: "ui://revenue-copilot/revenue-pulse/v1.html",
  opportunities: "ui://revenue-copilot/opportunities/v1.html",
  proposalStudio: "ui://revenue-copilot/proposal-studio/v1.html",
  inbox: "ui://revenue-copilot/inbox/v1.html",
  workroom: "ui://revenue-copilot/workroom/v1.html",
  marketPresence: "ui://revenue-copilot/market-presence/v1.html"
} as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const OPEN_WORLD_LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

type CopilotScope = "copilot.read" | "copilot.write" | "copilot.account";

export function createRevenueCopilotServer(repository: RevenueCopilotRepository, tenantId: string, appHtml: string, grantedScopes: readonly CopilotScope[] = ["copilot.read", "copilot.write", "copilot.account"], lifecycle?: LifecycleCoordinator): McpServer {
  const server = new McpServer({ name: "Revenue Copilot", version: "0.1.0" }, { capabilities: { logging: {} }, instructions: "Revenue Copilot provides strategy, evidence, drafts, analytics, and workflow UI. It never performs marketplace mutations. Use the separately connected official marketplace app for current provider reads, confirmation, execution, and read-back." });
  const service = new RevenueCopilotService(repository, tenantId, lifecycle);

  for (const [name, uri] of Object.entries(APP_RESOURCES)) {
    server.registerResource(`revenue-copilot-${name}`, uri, {
      title: resourceTitle(name),
      description: "Revenue Copilot MCP App. Essential content is also returned as tool text.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false },
        "openai/widgetDomain": "https://revenue.mcpengage.com",
        "openai/widgetPrefersBorder": false,
        "openai/widgetCSP": { connect_domains: [], resource_domains: [] }
      }
    }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: appHtml, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } } }] }));
  }

  server.registerTool("get_workspace_status", {
    title: "Check Revenue Copilot workspace",
    description: "Read Revenue Copilot connection history, capability observations, proof count, draft count, and retained data counts. This does not contact or mutate Upwork.",
    inputSchema: S.GetWorkspaceStatusInput, outputSchema: S.GetWorkspaceStatusOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.capabilities, "copilot.read")
  }, async () => ok(await service.workspaceStatus()));

  server.registerTool("save_preferences", {
    title: "Save freelancer preferences",
    description: "Save Revenue Copilot targeting, qualification, writing, and schedule preferences. This changes only Revenue Copilot data and never a marketplace account.",
    inputSchema: S.SavePreferencesInput, outputSchema: S.SavePreferencesOutput, annotations: LOCAL_WRITE, _meta: authMeta("copilot.write")
  }, async ({ preferences, idempotencyKey }) => withScope("copilot.write", () => service.savePreferences(preferences as UserPreferences, idempotencyKey)));

  server.registerTool("list_proof_claims", {
    title: "List approved proof claims",
    description: "Read the evidence library used to prevent unsupported claims in proposals, profile drafts, and service drafts.",
    inputSchema: S.ListProofClaimsInput, outputSchema: S.ListProofClaimsOutput, annotations: READ_ONLY, _meta: authMeta("copilot.read")
  }, async ({ includeArchived }) => safe(() => service.listProofClaims(includeArchived)));

  server.registerTool("save_proof_claim", {
    title: "Save a proof claim",
    description: "Create or revise one evidence claim in Revenue Copilot. Verification must reflect evidence the user has actually reviewed.",
    inputSchema: S.SaveProofClaimInput, outputSchema: S.SaveProofClaimOutput, annotations: LOCAL_WRITE, _meta: authMeta("copilot.write")
  }, async ({ claim, idempotencyKey }) => withScope("copilot.write", () => service.saveProofClaim(claim as ProofClaim, idempotencyKey)));

  server.registerTool("sync_marketplace_context", {
    title: "Store official marketplace context",
    description: "Validate and retain normalized fields that ChatGPT obtained from the separately connected official marketplace app. Raw provider payloads, credentials, and attachment binaries are rejected by the schema. This tool does not contact Upwork.",
    inputSchema: S.SyncMarketplaceContextInput, outputSchema: S.SyncMarketplaceContextOutput, annotations: OPEN_WORLD_LOCAL_WRITE, _meta: appMeta(APP_RESOURCES.capabilities, "copilot.write")
  }, async ({ records, capabilities, observedAt, idempotencyKey }) => withScope("copilot.write", () => service.syncContext(records as ProviderRecord[], capabilities, observedAt, idempotencyKey)));

  server.registerTool("get_revenue_pulse", {
    title: "Get highest-value next moves",
    description: "Prioritize up to three next actions from retained official observations and Revenue Copilot analysis. Official monetary values remain distinct from local estimates.",
    inputSchema: S.GetRevenuePulseInput, outputSchema: S.GetRevenuePulseOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.revenuePulse, "copilot.read")
  }, async ({ limit }) => safe(() => service.revenuePulse(limit)));

  server.registerTool("find_opportunities", {
    title: "Rank retained opportunities",
    description: "Score and rank official job observations using deterministic factors and hard gates. It does not search or refresh Upwork; call the official app first for current jobs.",
    inputSchema: S.FindOpportunitiesInput, outputSchema: S.FindOpportunitiesOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.opportunities, "copilot.read")
  }, async ({ classification, limit }) => safe(() => service.findOpportunities(classification, limit)));

  server.registerTool("review_opportunity", {
    title: "Review one opportunity",
    description: "Explain one retained official job's score, risks, hard gates, and approved proof coverage. It does not submit a proposal.",
    inputSchema: S.ReviewOpportunityInput, outputSchema: S.ReviewOpportunityOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.opportunities, "copilot.read")
  }, async ({ jobProviderObjectId }) => safe(() => service.reviewOpportunity(jobProviderObjectId)));

  server.registerTool("prepare_proposal", {
    title: "Prepare an evidence-bound proposal",
    description: "Create or version a Revenue Copilot proposal draft using only selected verified proof claims. Nothing is submitted to Upwork.",
    inputSchema: S.PrepareProposalInput, outputSchema: S.PrepareProposalOutput, annotations: LOCAL_WRITE, _meta: appMeta(APP_RESOURCES.proposalStudio, "copilot.write")
  }, async (input) => withScope("copilot.write", () => service.prepareProposal(compactOptional(input))));

  server.registerTool("list_proposals", {
    title: "Review proposal drafts and observations",
    description: "Read local proposal drafts and retained official proposal-status observations. This never refreshes or changes provider state.",
    inputSchema: S.ListProposalsInput, outputSchema: S.ListProposalsOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.proposalStudio, "copilot.read")
  }, async ({ limit }) => safe(() => service.listProposals(limit)));

  server.registerTool("triage_inbox", {
    title: "Triage retained marketplace conversations",
    description: "Prioritize retained official conversation and message observations and optionally draft local replies. Nothing is sent.",
    inputSchema: S.TriageInboxInput, outputSchema: S.TriageInboxOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.inbox, "copilot.read")
  }, async ({ limit, draftReplies }) => safe(() => service.triageInbox(limit, draftReplies)));

  server.registerTool("review_workroom", {
    title: "Review contracts and milestones",
    description: "Summarize retained official contract and milestone observations, deadlines, and safe next steps. Nothing is submitted or changed.",
    inputSchema: S.ReviewWorkroomInput, outputSchema: S.ReviewWorkroomOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.workroom, "copilot.read")
  }, async ({ limit }) => safe(() => service.reviewWorkroom(limit)));

  server.registerTool("audit_market_presence", {
    title: "Audit profile and services",
    description: "Audit retained official profile and service observations and propose evidence-aware improvements. Nothing is changed on the provider.",
    inputSchema: S.AuditMarketPresenceInput, outputSchema: S.AuditMarketPresenceOutput, annotations: READ_ONLY, _meta: appMeta(APP_RESOURCES.marketPresence, "copilot.read")
  }, async ({ includeServices }) => safe(() => service.auditPresence(includeServices)));

  server.registerTool("prepare_profile_revision", {
    title: "Prepare a profile revision",
    description: "Create a section-level local diff against a retained official profile observation. It never updates Upwork; verified provider capability controls the later handoff path.",
    inputSchema: S.PrepareProfileRevisionInput, outputSchema: S.PrepareProfileRevisionOutput, annotations: LOCAL_WRITE, _meta: appMeta(APP_RESOURCES.marketPresence, "copilot.write")
  }, async (input) => withScope("copilot.write", () => service.prepareProfileRevision(compactOptional(input))));

  server.registerTool("prepare_service_package", {
    title: "Prepare a service package",
    description: "Create a structured local Project Catalog/service package draft. It never creates, submits, or publishes on Upwork.",
    inputSchema: S.PrepareServicePackageInput, outputSchema: S.PrepareServicePackageOutput, annotations: LOCAL_WRITE, _meta: appMeta(APP_RESOURCES.marketPresence, "copilot.write")
  }, async (input) => withScope("copilot.write", () => service.prepareServicePackage(compactOptional(input))));

  server.registerTool("prepare_provider_handoff", {
    title: "Freeze a provider action handoff",
    description: "Freeze an exact short-lived action intent and produce a visible continuation for the separately connected official marketplace app. This does not execute or proxy the provider action.",
    inputSchema: S.PrepareProviderHandoffInput, outputSchema: S.PrepareProviderHandoffOutput, annotations: LOCAL_WRITE, _meta: appMeta(APP_RESOURCES.proposalStudio, "copilot.write")
  }, async (input) => withScope("copilot.write", () => service.prepareHandoff(compactOptional(input))));

  server.registerTool("record_provider_outcome", {
    title: "Record an official provider outcome",
    description: "Record the receipt and independent read-back from an action performed through the official marketplace app. Verified requires both; uncertainty disables retries.",
    inputSchema: S.RecordProviderOutcomeInput, outputSchema: S.RecordProviderOutcomeOutput, annotations: OPEN_WORLD_LOCAL_WRITE, _meta: appMeta(APP_RESOURCES.capabilities, "copilot.write")
  }, async (input) => withScope("copilot.write", () => service.recordOutcome(compactOptional(input))));

  server.registerTool("export_account_data", {
    title: "Export Revenue Copilot data",
    description: "Prepare an export of the user's normalized Revenue Copilot data. It excludes marketplace credentials, raw provider archives, and attachment binaries.",
    inputSchema: S.ExportAccountDataInput, outputSchema: S.ExportAccountDataOutput, annotations: LOCAL_WRITE, _meta: authMeta("copilot.account")
  }, async ({ format, idempotencyKey }) => withScope("copilot.account", () => service.exportData(format, idempotencyKey)));

  server.registerTool("delete_account_data", {
    title: "Delete Revenue Copilot data",
    description: "Permanently delete a Revenue Copilot record, a retained data domain, or the entire Revenue Copilot account dataset after exact confirmation. It never deletes the user's Upwork account or provider data.",
    inputSchema: S.DeleteAccountDataInput, outputSchema: S.DeleteAccountDataOutput, annotations: DESTRUCTIVE, _meta: authMeta("copilot.account")
  }, async ({ scope, target, idempotencyKey }) => withScope("copilot.account", () => service.deleteData(scope, target, idempotencyKey)));

  function withScope<T extends object>(scope: CopilotScope, execute: () => Promise<T>) {
    return safe(async () => {
      if (!grantedScopes.includes(scope)) throw new Error(`MISSING_SCOPE:${scope}`);
      return execute();
    });
  }

  return server;
}

function authMeta(scope: CopilotScope): Record<string, unknown> {
  return { securitySchemes: [{ type: "oauth2", scopes: [scope] }] };
}

function appMeta(resourceUri: string, scope: CopilotScope): Record<string, unknown> {
  return {
    ...authMeta(scope),
    ui: { resourceUri, visibility: ["model", "app"] },
    [RESOURCE_URI_META_KEY]: resourceUri,
    "openai/outputTemplate": resourceUri,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": "Preparing Revenue Copilot view…",
    "openai/toolInvocation/invoked": "Revenue Copilot view ready"
  };
}

function ok<T extends object>(payload: T) {
  const structuredContent = { ...payload } as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: structuredContent.summary ? String(structuredContent.summary) : "Revenue Copilot result ready." }], structuredContent };
}

async function safe<T extends object>(execute: () => Promise<T>) {
  try { return ok(await execute()); }
  catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return { isError: true as const, content: [{ type: "text" as const, text: userSafeError(code) }] };
  }
}

function userSafeError(code: string): string {
  const known: Record<string, string> = {
    JOB_NOT_FOUND: "The job is not in current Revenue Copilot context. Re-fetch it through the official marketplace app and sync the normalized fields.",
    PROFILE_NOT_FOUND: "The profile is not in current Revenue Copilot context. Re-fetch it through the official marketplace app.",
    INTENT_NOT_FOUND: "The action intent was not found. Prepare a new handoff; nothing was executed.",
    INTENT_EXPIRED: "The action intent expired. Re-fetch official state and prepare a new handoff; do not reuse the old one.",
    IDEMPOTENCY_CONFLICT: "That idempotency key was already used with different content. Use a new key for this changed request.",
    VERIFICATION_REQUIRES_RECEIPT_AND_READBACK: "A verified outcome requires both the official provider receipt and an independent provider read-back. Record uncertainty instead if either is missing."
  };
  if (code.startsWith("MISSING_SCOPE:")) return `This Revenue Copilot connection is missing ${code.slice("MISSING_SCOPE:".length)} permission. Reconnect with that scope; nothing was changed.`;
  return known[code] ?? "Revenue Copilot could not complete this local operation. Nothing was changed on the marketplace.";
}

function resourceTitle(name: string): string {
  return ({ capabilities: "Connection & Capability", revenuePulse: "Revenue Pulse", opportunities: "Opportunity Review", proposalStudio: "Proposal Studio", inbox: "Inbox Triage", workroom: "Workroom", marketPresence: "Market Presence" } as Record<string, string>)[name] ?? "Revenue Copilot";
}

function compactOptional<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined)) as T;
}
