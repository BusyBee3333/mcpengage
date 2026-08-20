import { describe, expect, it } from "vitest";
import type { JobRecord, ProofClaim, UserPreferences } from "../src/domain/contracts";
import { DEFAULT_PREFERENCES } from "../src/domain/contracts";
import { scoreOpportunity } from "../src/domain/scoring";

const now = new Date("2026-08-20T16:00:00.000Z");

const preferences: UserPreferences = {
  ...DEFAULT_PREFERENCES,
  targetSkills: ["HubSpot", "Salesforce", "RevOps"],
  targetServices: ["CRM implementation"],
  minimumHourlyRateMinor: 7_500,
  minimumFixedBudgetMinor: 150_000,
  maximumConnectsPerProposal: 20
};

const proof: ProofClaim = {
  id: "proof-1",
  claim: "Led CRM implementations spanning lifecycle automation and reporting.",
  category: "CRM",
  skills: ["HubSpot", "RevOps"],
  evidenceLabel: "Verified portfolio case study",
  verified: true,
  allowedContexts: ["proposals", "profile", "services"],
  observedAt: "2026-08-19T12:00:00.000Z"
};

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    entityType: "job",
    provider: "official_marketplace",
    providerObjectId: "job-1",
    observedAt: now.toISOString(),
    source: "official_provider",
    title: "HubSpot RevOps implementation",
    description: "We need a senior HubSpot specialist to audit our lifecycle, rebuild automation, and produce clean revenue reporting. The consultant should lead discovery, document the architecture, implement changes, and train our team.",
    skills: ["HubSpot", "RevOps"],
    status: "open",
    contractType: "hourly",
    currency: "USD",
    hourlyMinMinor: 8_500,
    hourlyMaxMinor: 12_500,
    postedAt: "2026-08-20T14:00:00.000Z",
    connectsCost: 16,
    proposalsCount: 8,
    client: {
      paymentVerified: true,
      totalSpentMinor: 2_000_000,
      hireRatePercent: 75,
      averageRating: 4.9,
      hires: 12
    },
    attachments: [],
    ...overrides
  };
}

describe("scoreOpportunity", () => {
  it("classifies a fresh, evidenced, well-paid opportunity as strong", () => {
    const result = scoreOpportunity(job(), preferences, [proof], now);
    expect(result.classification).toBe("strong");
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.matchedProofClaimIds).toEqual(["proof-1"]);
    expect(result.hardGateReasons).toEqual([]);
  });

  it("hard-blocks an unavailable job regardless of its weighted score", () => {
    const result = scoreOpportunity(job({ status: "unavailable" }), preferences, [proof], now);
    expect(result.classification).toBe("blocked");
    expect(result.hardGateReasons[0]).toContain("unavailable");
  });

  it("hard-blocks proposals that cannot be grounded in verified proof", () => {
    const result = scoreOpportunity(job(), preferences, [], now);
    expect(result.classification).toBe("blocked");
    expect(result.hardGateReasons.join(" ")).toContain("No verified proof");
  });

  it("does not invent authoritative Connects data when none was supplied", () => {
    const withoutConnects = job();
    delete withoutConnects.connectsCost;
    const result = scoreOpportunity(withoutConnects, preferences, [proof], now);
    const connects = result.factors.find((factor) => factor.key === "connects");
    expect(connects?.reason).toContain("not provided");
    expect(result.hardGateReasons.join(" ")).not.toContain("Connect");
  });
});
