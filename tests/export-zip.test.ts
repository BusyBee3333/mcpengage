import { describe, expect, it } from "vitest";
import { createExportZip } from "../src/domain/export-zip";

describe("account export archive", () => {
  it("produces a valid ZIP envelope with JSON and CSV file names", () => {
    const archive = createExportZip({ preferences: { timezone: "America/New_York" }, proofs: [{ id: "proof-1", claim: "Verified result" }] });
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const binaryText = new TextDecoder().decode(archive);
    expect(binaryText).toContain("revenue-copilot.json");
    expect(binaryText).toContain("csv/preferences.csv");
    expect(binaryText).toContain("csv/proofs.csv");
    expect([...archive.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
