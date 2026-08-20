import { describe, expect, it } from "vitest";
import type { JobRecord } from "../src/domain/contracts";
import { MemoryRepository } from "../src/storage/memory-repository";

function job(source: JobRecord["source"], observedAt: string, title: string): JobRecord {
  return {
    entityType: "job",
    provider: "official_marketplace",
    providerObjectId: "job-1",
    observedAt,
    source,
    title,
    description: "A complete job description that is deliberately long enough for repository tests and scoring readiness.",
    skills: ["CRM"],
    status: "open",
    contractType: "fixed",
    currency: "USD",
    fixedBudgetMinor: 100_000,
    attachments: []
  };
}

describe("MemoryRepository", () => {
  it("never lets migrated history replace current official state", async () => {
    const repository = new MemoryRepository();
    await repository.ingestProviderRecords("tenant-a", [job("official_provider", "2026-08-20T12:00:00Z", "Official current")], "official");
    const result = await repository.ingestProviderRecords("tenant-a", [job("migrated_history", "2026-08-21T12:00:00Z", "Migrated stale")], "legacy");
    const stored = await repository.getProviderRecord<JobRecord>("tenant-a", "job", "job-1");
    expect(result.value.ignoredAsOlder).toBe(1);
    expect(stored?.title).toBe("Official current");
  });

  it("replays identical idempotent writes and rejects key reuse with a different body", async () => {
    const repository = new MemoryRepository();
    const first = await repository.ingestProviderRecords("tenant-a", [job("official_provider", "2026-08-20T12:00:00Z", "Version A")], "same-key");
    const replay = await repository.ingestProviderRecords("tenant-a", [job("official_provider", "2026-08-20T12:00:00Z", "Version A")], "same-key");
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(repository.ingestProviderRecords("tenant-a", [job("official_provider", "2026-08-20T12:00:00Z", "Version B")], "same-key")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("isolates tenants", async () => {
    const repository = new MemoryRepository();
    await repository.ingestProviderRecords("tenant-a", [job("official_provider", "2026-08-20T12:00:00Z", "Tenant A")], "a");
    expect(await repository.listProviderRecords("tenant-b", "job")).toEqual([]);
  });
});
