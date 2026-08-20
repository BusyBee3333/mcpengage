import { describe, expect, it } from "vitest";
import { createRevenueCopilotServer, APP_RESOURCES } from "../src/server/register";
import { MemoryRepository } from "../src/storage/memory-repository";

describe("public MCP contract", () => {
  const server = createRevenueCopilotServer(new MemoryRepository(), "contract-test", "<html></html>") as unknown as {
    _registeredTools: Record<string, { outputSchema?: object; annotations?: Record<string, boolean>; _meta?: Record<string, unknown> }>;
    _registeredResources: Record<string, { metadata: { mimeType?: string } }>;
  };

  it("exposes exactly the 19 goal-oriented tools", () => {
    expect(Object.keys(server._registeredTools)).toEqual([
      "get_workspace_status", "save_preferences", "list_proof_claims", "save_proof_claim",
      "sync_marketplace_context", "get_revenue_pulse", "find_opportunities", "review_opportunity",
      "prepare_proposal", "list_proposals", "triage_inbox", "review_workroom",
      "audit_market_presence", "prepare_profile_revision", "prepare_service_package",
      "prepare_provider_handoff", "record_provider_outcome", "export_account_data", "delete_account_data"
    ]);
  });

  it("gives every tool an exact output schema and complete safety annotations", () => {
    for (const tool of Object.values(server._registeredTools)) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({ readOnlyHint: expect.any(Boolean), destructiveHint: expect.any(Boolean), idempotentHint: expect.any(Boolean), openWorldHint: expect.any(Boolean) });
      expect(tool._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: [expect.stringMatching(/^copilot\.(read|write|account)$/)] }]);
    }
    expect(server._registeredTools.delete_account_data!.annotations?.destructiveHint).toBe(true);
    expect(server._registeredTools.prepare_provider_handoff!.annotations?.openWorldHint).toBe(false);
  });

  it("publishes seven versioned MCP App resources with the MCP App MIME type", () => {
    expect(Object.keys(server._registeredResources)).toEqual(Object.values(APP_RESOURCES));
    for (const resource of Object.values(server._registeredResources)) expect(resource.metadata.mimeType).toBe("text/html;profile=mcp-app");
  });
});
