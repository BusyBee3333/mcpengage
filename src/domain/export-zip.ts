export function createExportZip(data: Record<string, object[] | object>): Uint8Array {
  const files = [
    { name: "revenue-copilot.json", bytes: new TextEncoder().encode(JSON.stringify(data, null, 2)) },
    ...Object.entries(csvTables(data)).map(([name, csv]) => ({ name: `csv/${safeFileName(name)}.csv`, bytes: new TextEncoder().encode(csv) }))
  ];
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const checksum = crc32(file.bytes);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(checksum), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), name, file.bytes
    ]);
    localParts.push(local);
    centralParts.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(checksum), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name
    ]));
    offset += local.length;
  }
  const central = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0)
  ]);
  return concatBytes([...localParts, central, end]);
}

function csvTables(data: Record<string, object[] | object>): Record<string, string> {
  return Object.fromEntries(Object.entries(data).map(([name, value]) => {
    const rows = Array.isArray(value) ? value : [value];
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const csv = [keys, ...rows.map((row) => keys.map((key) => JSON.stringify((row as Record<string, unknown>)[key] ?? "")))]
      .map((row) => row.join(",")).join("\n");
    return [name, csv];
  }));
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "data";
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
