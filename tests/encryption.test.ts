import { describe, expect, it } from "vitest";
import { TenantEnvelopeEncryption } from "../src/storage/encryption";

describe("tenant envelope encryption", () => {
  const key = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)));

  it("round-trips sensitive content without exposing plaintext", async () => {
    const encryption = new TenantEnvelopeEncryption(key);
    const stored = await encryption.encrypt("tenant-a", "proposal-draft", "sensitive proposal text");
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain("sensitive proposal text");
    await expect(encryption.decrypt("tenant-a", "proposal-draft", stored)).resolves.toBe("sensitive proposal text");
  });

  it("binds ciphertext to tenant and purpose", async () => {
    const encryption = new TenantEnvelopeEncryption(key);
    const stored = await encryption.encrypt("tenant-a", "message", "hello");
    await expect(encryption.decrypt("tenant-b", "message", stored)).rejects.toThrow();
    await expect(encryption.decrypt("tenant-a", "proposal", stored)).rejects.toThrow();
  });
});
