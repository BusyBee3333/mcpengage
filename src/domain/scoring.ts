import type { JobRecord, OpportunityScore, ProofClaim, ScoreFactor, UserPreferences } from "./contracts";

const WEIGHTS = {
  fit: 0.25,
  proof: 0.2,
  revenue: 0.15,
  client: 0.15,
  feasibility: 0.1,
  timing: 0.1,
  connects: 0.05
} as const;

export function scoreOpportunity(
  job: JobRecord,
  preferences: UserPreferences,
  proofClaims: ProofClaim[],
  now = new Date()
): OpportunityScore {
  const hardGateReasons = evaluateHardGates(job, preferences, proofClaims, now);
  const matchedSkills = intersection(normalize(job.skills), normalize(preferences.targetSkills));
  const activeProof = proofClaims.filter((claim) => claim.verified && !claim.archivedAt);
  const matchedProof = activeProof.filter((claim) => intersection(normalize(claim.skills), normalize(job.skills)).length > 0);
  const factors: ScoreFactor[] = [
    factor("fit", "Solution fit", skillFit(job, preferences, matchedSkills), WEIGHTS.fit,
      matchedSkills.length > 0 ? `Matches ${matchedSkills.slice(0, 3).join(", ")}.` : "No configured target skill matched."),
    factor("proof", "Proof coverage", proofCoverage(job, matchedProof), WEIGHTS.proof,
      matchedProof.length > 0 ? `${matchedProof.length} verified proof claim${matchedProof.length === 1 ? "" : "s"} apply.` : "No verified proof claim covers the listed skills."),
    factor("revenue", "Revenue fit", revenueFit(job, preferences), WEIGHTS.revenue, revenueReason(job, preferences)),
    factor("client", "Client quality", clientQuality(job), WEIGHTS.client, clientReason(job)),
    factor("feasibility", "Delivery feasibility", feasibility(job), WEIGHTS.feasibility,
      job.description.length >= 250 ? "The scope contains enough detail for a responsible first estimate." : "The scope is brief and needs clarification."),
    factor("timing", "Freshness and timing", timing(job, now), WEIGHTS.timing, timingReason(job, now)),
    factor("connects", "Connect efficiency", connectsEfficiency(job, preferences), WEIGHTS.connects,
      job.connectsCost === undefined ? "Connect cost was not provided by the official source." : `${job.connectsCost} Connects reported by the official source.`)
  ];

  const riskPenalty = riskPenaltyFor(job, preferences);
  const weighted = factors.reduce((total, item) => total + item.score * item.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(weighted - riskPenalty)));
  const classification = hardGateReasons.length > 0
    ? "blocked"
    : score >= preferences.strongFitThreshold
      ? "strong"
      : score >= preferences.reviewThreshold
        ? "review"
        : "archive";

  return {
    version: "opportunity-v1",
    score,
    classification,
    factors,
    riskPenalty,
    hardGateReasons,
    matchedProofClaimIds: matchedProof.map((claim) => claim.id),
    confidence: confidenceFor(job, activeProof)
  };
}

function evaluateHardGates(job: JobRecord, prefs: UserPreferences, proof: ProofClaim[], now: Date): string[] {
  const reasons: string[] = [];
  if (job.status === "unavailable" || job.status === "closed") reasons.push("The official provider reports that the job is unavailable.");
  if (job.contractType === "hourly" && job.hourlyMaxMinor !== undefined && job.hourlyMaxMinor < prefs.minimumHourlyRateMinor) {
    reasons.push("The maximum hourly rate is below your configured minimum.");
  }
  if (job.contractType === "fixed" && job.fixedBudgetMinor !== undefined && job.fixedBudgetMinor < prefs.minimumFixedBudgetMinor) {
    reasons.push("The fixed budget is below your configured minimum.");
  }
  if (job.postedAt && ageHours(job.postedAt, now) > prefs.maximumJobAgeHours) reasons.push("The job is older than your configured maximum age.");
  if (job.connectsCost !== undefined && prefs.maximumConnectsPerProposal !== undefined && job.connectsCost > prefs.maximumConnectsPerProposal) {
    reasons.push("The official Connect cost exceeds your configured maximum.");
  }
  const normalizedText = `${job.title} ${job.description}`.toLowerCase();
  const excluded = prefs.excludedTerms.find((term) => normalizedText.includes(term.toLowerCase()));
  if (excluded) reasons.push(`The job contains excluded term “${excluded}”.`);
  if (job.description.trim().length < 80) reasons.push("The full job description is missing or too incomplete to finalize a proposal.");
  if (job.skills.length > 0 && !proof.some((claim) => claim.verified && intersection(normalize(claim.skills), normalize(job.skills)).length > 0)) {
    reasons.push("No verified proof supports the listed must-have skills.");
  }
  return reasons;
}

function factor(key: ScoreFactor["key"], label: string, score: number, weight: number, reason: string): ScoreFactor {
  return { key, label, score: clamp(score), weight, reason };
}

function skillFit(job: JobRecord, prefs: UserPreferences, matched: string[]): number {
  if (prefs.targetSkills.length === 0) return 50;
  const skillRatio = matched.length / Math.max(1, new Set(normalize(job.skills)).size);
  const serviceText = normalize(prefs.targetServices).some((service) => `${job.title} ${job.description}`.toLowerCase().includes(service));
  return Math.round(Math.min(100, skillRatio * 100 + (serviceText ? 20 : 0)));
}

function proofCoverage(job: JobRecord, matched: ProofClaim[]): number {
  if (job.skills.length === 0) return matched.length > 0 ? 70 : 40;
  const covered = new Set(matched.flatMap((claim) => normalize(claim.skills)));
  return Math.round((intersection([...covered], normalize(job.skills)).length / Math.max(1, new Set(normalize(job.skills)).size)) * 100);
}

function revenueFit(job: JobRecord, prefs: UserPreferences): number {
  if (job.contractType === "hourly") {
    if (job.hourlyMaxMinor === undefined) return 45;
    if (prefs.minimumHourlyRateMinor === 0) return 70;
    return Math.round(Math.min(100, (job.hourlyMaxMinor / prefs.minimumHourlyRateMinor) * 75));
  }
  if (job.contractType === "fixed") {
    if (job.fixedBudgetMinor === undefined) return 45;
    if (prefs.minimumFixedBudgetMinor === 0) return 70;
    return Math.round(Math.min(100, (job.fixedBudgetMinor / prefs.minimumFixedBudgetMinor) * 75));
  }
  return 40;
}

function clientQuality(job: JobRecord): number {
  const client = job.client;
  if (!client) return 45;
  let score = 30;
  if (client.paymentVerified) score += 20;
  if ((client.totalSpentMinor ?? 0) >= 100_000) score += 15;
  if ((client.hireRatePercent ?? 0) >= 50) score += 15;
  if ((client.averageRating ?? 0) >= 4.7) score += 10;
  if ((client.hires ?? 0) >= 5) score += 10;
  return clamp(score);
}

function feasibility(job: JobRecord): number {
  let score = job.description.length >= 500 ? 85 : job.description.length >= 250 ? 70 : 45;
  if (job.skills.length > 8) score -= 10;
  if (/urgent|asap|immediately/i.test(job.description)) score -= 8;
  return clamp(score);
}

function timing(job: JobRecord, now: Date): number {
  if (!job.postedAt) return 45;
  const hours = ageHours(job.postedAt, now);
  if (hours <= 2) return 100;
  if (hours <= 8) return 85;
  if (hours <= 24) return 70;
  if (hours <= 72) return 50;
  return 25;
}

function connectsEfficiency(job: JobRecord, prefs: UserPreferences): number {
  if (job.connectsCost === undefined) return 50;
  if (prefs.maximumConnectsPerProposal === undefined || prefs.maximumConnectsPerProposal === 0) {
    return job.connectsCost <= 12 ? 75 : 50;
  }
  return clamp(Math.round(100 - (job.connectsCost / prefs.maximumConnectsPerProposal) * 50));
}

function riskPenaltyFor(job: JobRecord, prefs: UserPreferences): number {
  let penalty = 0;
  if (!job.client?.paymentVerified) penalty += 5;
  if ((job.proposalsCount ?? 0) >= 50) penalty += 8;
  if (job.description.length < 180) penalty += 7;
  if (/free sample|telegram|whatsapp|crypto payment|outside upwork/i.test(job.description)) penalty += 10;
  if (prefs.availabilityHoursPerWeek < 10 && /full[ -]?time|40 hours/i.test(job.description)) penalty += 8;
  return Math.min(30, penalty);
}

function confidenceFor(job: JobRecord, proof: ProofClaim[]): OpportunityScore["confidence"] {
  let evidence = 0;
  if (job.postedAt) evidence += 1;
  if (job.client) evidence += 1;
  if (job.connectsCost !== undefined) evidence += 1;
  if (job.description.length >= 250) evidence += 1;
  if (proof.some((claim) => claim.verified)) evidence += 1;
  return evidence >= 4 ? "high" : evidence >= 2 ? "medium" : "low";
}

function revenueReason(job: JobRecord, prefs: UserPreferences): string {
  if (job.contractType === "hourly" && job.hourlyMaxMinor !== undefined) {
    return `Maximum official rate is ${formatMoney(job.hourlyMaxMinor, job.currency)} versus your ${formatMoney(prefs.minimumHourlyRateMinor, job.currency)} minimum.`;
  }
  if (job.contractType === "fixed" && job.fixedBudgetMinor !== undefined) {
    return `Official budget is ${formatMoney(job.fixedBudgetMinor, job.currency)} versus your ${formatMoney(prefs.minimumFixedBudgetMinor, job.currency)} minimum.`;
  }
  return "The official source did not provide enough pricing detail.";
}

function clientReason(job: JobRecord): string {
  if (!job.client) return "Client history was not provided by the official source.";
  const parts = [
    job.client.paymentVerified ? "payment verified" : "payment verification unknown",
    job.client.hireRatePercent === undefined ? undefined : `${job.client.hireRatePercent}% hire rate`,
    job.client.averageRating === undefined ? undefined : `${job.client.averageRating.toFixed(1)} rating`
  ].filter(Boolean);
  return parts.join(" • ");
}

function timingReason(job: JobRecord, now: Date): string {
  if (!job.postedAt) return "Posted time was not provided by the official source.";
  return `Posted approximately ${Math.max(0, Math.round(ageHours(job.postedAt, now)))} hours ago.`;
}

function ageHours(value: string, now: Date): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.max(0, (now.getTime() - parsed) / 3_600_000) : Number.POSITIVE_INFINITY;
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))];
}

function normalize(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}
