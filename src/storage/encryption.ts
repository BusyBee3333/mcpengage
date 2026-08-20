export class TenantEnvelopeEncryption {
  private readonly rawMaster?: Uint8Array;

  constructor(masterKeyBase64?: string) {
    if (!masterKeyBase64) return;
    const raw = decodeBase64(masterKeyBase64);
    if (raw.byteLength !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    this.rawMaster = raw;
  }

  get enabled(): boolean { return this.rawMaster !== undefined; }

  async encrypt(tenantId: string, purpose: string, plaintext: string): Promise<string> {
    if (!this.rawMaster) return plaintext;
    const key = await this.tenantKey(tenantId, purpose);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(`revenue-copilot:${tenantId}:${purpose}:v1`);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, new TextEncoder().encode(plaintext));
    return `enc:v1:${encodeBase64(iv)}:${encodeBase64(new Uint8Array(ciphertext))}`;
  }

  async decrypt(tenantId: string, purpose: string, stored: string): Promise<string> {
    if (!stored.startsWith("enc:v1:")) return stored;
    if (!this.rawMaster) throw new Error("ENCRYPTED_DATA_KEY_UNAVAILABLE");
    const [, , encodedIv, encodedCiphertext] = stored.split(":");
    if (!encodedIv || !encodedCiphertext) throw new Error("INVALID_ENCRYPTED_VALUE");
    const key = await this.tenantKey(tenantId, purpose);
    const iv = decodeBase64(encodedIv); const ciphertext = decodeBase64(encodedCiphertext);
    const aad = new TextEncoder().encode(`revenue-copilot:${tenantId}:${purpose}:v1`);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: arrayBuffer(iv), additionalData: aad }, key, arrayBuffer(ciphertext));
    return new TextDecoder().decode(plaintext);
  }

  private async tenantKey(tenantId: string, purpose: string): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey("raw", arrayBuffer(this.rawMaster!), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(tenantId), info: new TextEncoder().encode(`revenue-copilot:${purpose}:v1`) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
}

function encodeBase64(value: Uint8Array): string { let raw = ""; for (const byte of value) raw += String.fromCharCode(byte); return btoa(raw); }
function decodeBase64(value: string): Uint8Array { const raw = atob(value); return Uint8Array.from(raw, (character) => character.charCodeAt(0)); }
function arrayBuffer(value: Uint8Array): ArrayBuffer { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }
