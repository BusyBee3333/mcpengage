import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JobRecordSchema, ProposalDraftSchema, ProposalRecordSchema, ServiceRecordSchema } from "../src/domain/schemas";

type LegacyState = Record<string, unknown>;
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value, all[index + 1]?.startsWith("--") ? "true" : all[index + 1] ?? "true"] : ["", ""]));
const databasePath = resolve(args.get("--database") ?? `${process.env.HOME}/.local/share/upwork-command-center/state.sqlite`);
const outputPath = args.get("--output") ? resolve(args.get("--output")!) : undefined;

if (!existsSync(databasePath)) throw new Error(`Legacy database not found: ${databasePath}`);
const db = new DatabaseSync(databasePath, { readOnly: true });
const rows = db.prepare("SELECT key,value,updated_at FROM state ORDER BY key").all() as Array<{ key: string; value: string; updated_at: string }>;
const state = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)])) as LegacyState;
const rejected: Array<{ category: string; legacyId: string; issues: unknown[] }> = [];
const legacyJobIdByTitle = new Map(array(state.jobs).map((job) => [string(job.title).trim().toLowerCase(), string(job.id)]));

const jobs = array(state.jobs).flatMap((legacy) => accept("job", string(legacy.id), JobRecordSchema.safeParse({
  entityType: "job", provider: "official_marketplace", providerObjectId: string(legacy.id), observedAt: string(legacy.capturedAt, new Date(0).toISOString()), source: "migrated_history",
  title: string(legacy.title, "Historical job"), description: string(legacy.description, "Historical job description was not retained."), skills: array(legacy.skills).map(String), status: "unknown",
  contractType: legacy.budgetType === "hourly" ? "hourly" : legacy.budgetType === "fixed" ? "fixed" : "unknown", currency: "USD",
  ...(number(legacy.budgetMin) !== undefined ? { hourlyMinMinor: Math.round(number(legacy.budgetMin)! * 100) } : {}),
  ...(number(legacy.budgetMax) !== undefined ? { hourlyMaxMinor: Math.round(number(legacy.budgetMax)! * 100) } : {}),
  ...(legacy.budgetType === "fixed" && number(legacy.budgetMax ?? legacy.budgetMin) !== undefined ? { fixedBudgetMinor: Math.round(number(legacy.budgetMax ?? legacy.budgetMin)! * 100) } : {}),
  ...(number(legacy.connects) !== undefined ? { connectsCost: Math.round(number(legacy.connects)!) } : {}), attachments: []
})));

const providerProposals = array(state.providerProposals).flatMap((legacy) => accept("providerProposal", string(legacy.id), ProposalRecordSchema.safeParse({
  entityType: "proposal", provider: "official_marketplace", providerObjectId: string(legacy.id), jobProviderObjectId: string(legacy.jobId, jobIdFromUrl(legacy.jobUrl) ?? legacyJobIdByTitle.get(string(legacy.title).trim().toLowerCase()) ?? ""), observedAt: string(legacy.observedAt ?? legacy.submittedAt, new Date(0).toISOString()), source: "migrated_history",
  status: proposalStatus(legacy.status), ...(legacy.submittedAt ? { submittedAt: String(legacy.submittedAt) } : {}), ...(number(legacy.connectsSpent) !== undefined ? { connectsSpent: Math.round(number(legacy.connectsSpent)!) } : {})
})));

const drafts = array(state.proposalDrafts).flatMap((legacy, index) => accept("proposalDraft", string(legacy.id, String(index)), ProposalDraftSchema.safeParse({
  id: `migrated-${string(legacy.id, String(index))}`, jobProviderObjectId: string(legacy.jobId), version: 1,
  status: legacy.status === "submitted" ? "provider_confirmed" : "draft", opening: "", proof: "", approach: string(legacy.coverLetter), questions: [], closing: "",
  ...(number(legacy.bidAmount) !== undefined ? { rateMinor: Math.round(number(legacy.bidAmount)! * 100), currency: "USD" } : {}), screeningAnswers: array(legacy.screeningAnswers).map((item) => ({ question: string(item.question), answer: string(item.answer) })), proofClaimIds: [],
  unsupportedClaims: ["Migrated draft has not yet been rebound to the Revenue Copilot proof library."], createdAt: string(legacy.updatedAt ?? legacy.submittedAt, new Date(0).toISOString()), updatedAt: string(legacy.updatedAt ?? legacy.submittedAt, new Date(0).toISOString())
})));

const services = array(state.services).flatMap((legacy) => accept("service", string(legacy.id), ServiceRecordSchema.safeParse({
  entityType: "service", provider: "official_marketplace", providerObjectId: string(legacy.id), observedAt: string(legacy.updatedAt ?? rows.find((row) => row.key === "services")?.updated_at, new Date(0).toISOString()), source: "migrated_history", title: string(legacy.title),
  status: "draft", ...(legacy.category ? { category: String(legacy.category) } : {}), currency: "USD", ...(array(legacy.tiers)[0] && number(array(legacy.tiers)[0].price) !== undefined ? { startingPriceMinor: Math.round(number(array(legacy.tiers)[0].price)! * 100), tierCount: Math.min(3, array(legacy.tiers).length) } : {})
})));

const packageData = { schemaVersion: "1.0", generatedAt: new Date().toISOString(), source: { databasePath, sha256: sha256(readFileSync(databasePath)) }, provenance: "migrated_history", providerRecords: [...jobs, ...providerProposals, ...services], proposalDrafts: drafts };
const report = {
  sourceDatabase: databasePath, sourceSha256: packageData.source.sha256, stateKeys: rows.map((row) => row.key),
  importable: { jobs: jobs.length, providerProposals: providerProposals.length, proposalDrafts: drafts.length, services: services.length },
  deliberatelySkipped: { connectsSnapshots: state.connectsSnapshot ? 1 : 0, reason: "Legacy Connect balances and stale statuses can never become current provider state." },
  quarantined: { count: rejected.length, records: rejected },
  cautions: ["All records are marked migrated_history.", "Migrated proposal text is quarantined with an unsupported-claim warning until proof is rebound.", "A newer official observation always outranks these records."],
  output: outputPath ?? "dry-run only"
};
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(packageData, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(report, null, 2));

function array(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function string(value: unknown, fallback = ""): string { return typeof value === "string" && value ? value : fallback; }
function number(value: unknown): number | undefined { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; }
function jobIdFromUrl(value: unknown): string | undefined { const match = typeof value === "string" ? value.match(/~0[12](\d{10,})/) : undefined; return match?.[1]; }
function proposalStatus(value: unknown): "submitted" | "viewed" | "interview" | "offer" | "hired" | "withdrawn" | "declined" | "unknown" { return ["submitted", "viewed", "interview", "offer", "hired", "withdrawn", "declined"].includes(String(value)) ? String(value) as any : "unknown"; }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function accept<T>(category: string, legacyId: string, result: { success: true; data: T } | { success: false; error: { issues: unknown[] } }): T[] {
  if (result.success) return [result.data];
  rejected.push({ category, legacyId: legacyId || "missing", issues: result.error.issues });
  return [];
}
