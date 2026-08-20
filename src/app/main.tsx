import "@openai/apps-sdk-ui/css";
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { REVIEW_FIXTURES } from "./fixtures";

type Json = Record<string, any>;

function RevenueCopilotApp() {
  const [result, setResult] = useState<CallToolResult | null>(null);
  const [host, setHost] = useState<McpUiHostContext>();
  const { app, error } = useApp({
    appInfo: { name: "Revenue Copilot", version: "0.1.0" },
    capabilities: {},
    strict: true,
    onAppCreated: (created) => {
      created.ontoolresult = (next) => setResult(next);
      created.onhostcontextchanged = (next) => setHost((prior) => ({ ...prior, ...next }));
      created.ontoolcancelled = () => undefined;
      created.onerror = (next) => console.error("Revenue Copilot app error", next);
      created.onteardown = async () => ({});
    }
  });
  useHostStyles(app);
  useEffect(() => { if (app) setHost(app.getHostContext()); }, [app]);

  if (error) return <StatePanel kind="error" title="Revenue Copilot could not load" body="The essential result remains available in chat. Try the action again if you need the interactive view." />;
  if (!app || !result) return <LoadingState />;
  if (result.isError) return <StatePanel kind="error" title="Nothing changed" body={textContent(result) || "Revenue Copilot could not complete the local operation."} />;
  const data = asObject(result.structuredContent);
  return <SurfaceRouter app={app} envelope={data} host={host} />;
}

function ReviewPreview() {
  const parameters = new URLSearchParams(window.location.search);
  const name = parameters.get("fixture") ?? "revenue_pulse";
  const state = parameters.get("state");
  const envelope = { ...(REVIEW_FIXTURES[name] ?? REVIEW_FIXTURES.revenue_pulse!), ...(state ? { uiState: state } : {}) };
  const previewApp = {
    sendMessage: async () => ({ isError: false }),
    requestDisplayMode: async ({ mode }: { mode: string }) => ({ mode })
  } as unknown as App;
  return <SurfaceRouter app={previewApp} envelope={envelope} host={{ theme: parameters.get("theme") === "dark" ? "dark" : "light", displayMode: "inline", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }} />;
}

function SurfaceRouter({ app, envelope, host }: { app: App; envelope: Json; host?: McpUiHostContext | undefined }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const surface = String(envelope.surface ?? inferSurface(envelope));
  const data = asObject(envelope.data ?? envelope);
  const uiState = String(envelope.uiState ?? "ready");
  const action = primaryAction(surface, data);
  const safeStyle = {
    paddingTop: host?.safeAreaInsets?.top,
    paddingRight: host?.safeAreaInsets?.right,
    paddingBottom: host?.safeAreaInsets?.bottom,
    paddingLeft: host?.safeAreaInsets?.left
  };
  const send = async () => {
    if (!action) return;
    setBusy(true); setNotice(undefined);
    try {
      const response = await app.sendMessage({ role: "user", content: [{ type: "text", text: action.prompt }] }, { signal: AbortSignal.timeout(10_000) });
      setNotice(response.isError ? "Chat did not accept the continuation. Nothing changed." : "Prepared in chat. Nothing has been submitted or changed yet.");
    } catch { setNotice("The continuation timed out. Nothing changed."); }
    finally { setBusy(false); }
  };
  const fullscreen = async () => {
    try { await app.requestDisplayMode({ mode: host?.displayMode === "fullscreen" ? "inline" : "fullscreen" }); }
    catch { setNotice("Fullscreen is not available in this host."); }
  };

  if (uiState === "initial_loading" || uiState === "partial_loading") return <LoadingState />;
  const blockingState = BLOCKING_STATES[uiState];
  if (blockingState) return <StatePanel kind={blockingState.kind} title={blockingState.title} body={blockingState.body} />;

  return (
    <main className="rc-shell" style={safeStyle} data-surface={surface}>
      <header className="rc-header">
        <div className="brand-mark" aria-hidden="true"><SparkIcon /></div>
        <div className="header-copy">
          <p className="eyebrow">Revenue Copilot</p>
          <h1>{surfaceTitle(surface)}</h1>
        </div>
        <CapabilityBadge value={leadingCapability(envelope.capabilities)} />
      </header>
      <ProvenanceStrip envelope={envelope} />
      {envelope.summary ? <p className="summary">{String(envelope.summary)}</p> : null}
      <Warnings values={Array.isArray(envelope.warnings) ? envelope.warnings : []} />
      <OperationalState state={uiState} />
      <section className="surface-content" aria-live="polite">
        {surface === "capabilities" ? <Capabilities data={data} /> : null}
        {surface === "revenue_pulse" ? <RevenuePulse data={data} /> : null}
        {surface === "opportunity_review" ? <Opportunities data={data} /> : null}
        {surface === "proposal_studio" ? <ProposalStudio data={data} /> : null}
        {surface === "inbox_triage" ? <Inbox data={data} /> : null}
        {surface === "workroom" ? <Workroom data={data} /> : null}
        {surface === "market_presence" ? <MarketPresence data={data} /> : null}
        {!KNOWN_SURFACES.has(surface) ? <StatePanel kind="empty" title="Result ready" body="The structured result is available in chat." /> : null}
      </section>
      {notice ? <div className="receipt-banner" role="status"><CheckIcon />{notice}</div> : null}
      <footer className="action-footer">
        {action ? <button className="primary-action" onClick={send} disabled={busy}>{busy ? "Preparing…" : action.label}</button> : null}
        {surface === "proposal_studio" ? <button className="secondary-action" onClick={fullscreen}>{host?.displayMode === "fullscreen" ? "Exit fullscreen" : "Open editor"}</button> : null}
      </footer>
      <p className="independence-note">Independent decision support. Official provider tools remain the authority for current state and marketplace actions.</p>
    </main>
  );
}

function Capabilities({ data }: { data: Json }) {
  const status = asObject(data.status);
  const capabilities = asObject(status.capabilities);
  const counts = asObject(status.historyCounts);
  return <>
    <DecisionCard tone={status.accountConnected ? "positive" : "neutral"} title={status.accountConnected ? "Official context received" : "Provider not checked"} body={status.accountConnected ? `Last checked ${formatDate(status.providerLastCheckedAt)}. Consequential actions still require an immediate provider re-read.` : "Ask ChatGPT to check the separately connected official marketplace app, then pass selected normalized fields into Revenue Copilot."} />
    <div className="metric-row"><Metric label="Proof claims" value={status.proofCount ?? 0} /><Metric label="Drafts" value={status.draftCount ?? 0} /><Metric label="Provider records" value={Object.values(counts).reduce((sum: number, value) => sum + Number(value), 0)} /></div>
    <div className="section-block"><h2>Verified capabilities</h2>{Object.keys(capabilities).length ? <ul className="clean-list">{Object.entries(capabilities).slice(0, 8).map(([name, value]) => <li key={name}><span>{humanize(name)}</span><CapabilityBadge value={String(value)} /></li>)}</ul> : <EmptyLine text="Capabilities have not been tested in this connection." />}</div>
  </>;
}

function RevenuePulse({ data }: { data: Json }) {
  const actions = arrayOf(data.actions);
  return actions.length ? <div className="ranked-list">{actions.map((item, index) => <article className="rank-card" key={String(item.id)}><div className="rank-number">{index + 1}</div><div><div className="record-top"><h2>{String(item.title)}</h2><span className="upside">{String(item.estimatedUpside)}</span></div><p>{String(item.reason)}</p></div></article>)}</div> : <StatePanel kind="empty" title="No urgent move yet" body="Refresh official marketplace context or finish setup to generate a supported recommendation." />;
}

function Opportunities({ data }: { data: Json }) {
  const rows = data.opportunity ? [data.opportunity] : arrayOf(data.opportunities);
  return rows.length ? <div className="ranked-list">{rows.map((row, index) => { const job = asObject(row.job); const score = asObject(row.score); return <article className="record-card" key={String(job.providerObjectId ?? index)}><div className="record-top"><div><p className="micro-label">{String(score.classification ?? "not checked")}</p><h2>{String(job.title ?? "Untitled opportunity")}</h2></div><ScorePill score={Number(score.score ?? 0)} /></div><p className="clamp">{String(job.description ?? "No description was provided.")}</p><div className="chip-row">{arrayOf(job.skills).slice(0, 5).map((skill) => <span className="chip" key={String(skill)}>{String(skill)}</span>)}</div>{arrayOf(score.hardGateReasons).length ? <RiskCallout text={String(score.hardGateReasons[0])} /> : <EvidenceLine count={arrayOf(score.matchedProofClaimIds).length} />}</article>; })}</div> : <StatePanel kind="empty" title="No opportunities in this view" body="Ask the official provider for current jobs, then sync selected normalized fields." />;
}

function ProposalStudio({ data }: { data: Json }) {
  const draft = asObject(data.draft ?? arrayOf(data.drafts)[0]);
  if (!Object.keys(draft).length) return <StatePanel kind="empty" title="No proposal draft yet" body="Review a qualified opportunity, select approved proof, and prepare a local draft." />;
  return <div className="editor-card"><div className="record-top"><div><p className="micro-label">Version {String(draft.version ?? 1)}</p><h2>{draft.status === "ready_for_review" ? "Ready for provider review" : "Draft needs attention"}</h2></div><StatusDot state={String(draft.status)} /></div><DraftSection label="Opening" value={draft.opening} /><DraftSection label="Approved proof" value={draft.proof || "Evidence needed before this can be ready."} /><DraftSection label="Approach" value={draft.approach} />{arrayOf(draft.questions).length ? <DraftSection label="Questions" value={arrayOf(draft.questions).map((q, i) => `${i + 1}. ${String(q)}`).join("\n")} /> : null}{arrayOf(draft.unsupportedClaims).length ? <RiskCallout text={String(draft.unsupportedClaims[0])} /> : <div className="truth-check"><CheckIcon />All included proof is bound to approved claims.</div>}</div>;
}

function Inbox({ data }: { data: Json }) {
  const rows = arrayOf(data.conversations);
  return rows.length ? <div className="ranked-list">{rows.map((row, index) => { const conversation = asObject(row.conversation); const messages = arrayOf(row.messages); return <article className="record-card" key={String(conversation.providerObjectId ?? index)}><div className="record-top"><div><p className="micro-label">{String(row.priority)}</p><h2>{String(conversation.participantLabel ?? "Conversation")}</h2></div><span className="count-badge">{Number(conversation.unreadCount ?? 0)} unread</span></div><p>{String(row.reason)}</p>{messages[0] ? <blockquote>{String(messages[0].body)}</blockquote> : null}{row.suggestedReply ? <DraftSection label="Draft reply" value={row.suggestedReply} /> : null}</article>; })}</div> : <StatePanel kind="empty" title="Inbox not checked" body="Ask the official provider for current conversations. Revenue Copilot will prioritize and draft, but never send by itself." />;
}

function Workroom({ data }: { data: Json }) {
  const rows = arrayOf(data.workrooms);
  return rows.length ? <div className="ranked-list">{rows.map((row, index) => { const contract = asObject(row.contract); return <article className="record-card" key={String(contract.providerObjectId ?? index)}><div className="record-top"><div><p className="micro-label">{String(row.urgency)}</p><h2>{String(contract.title ?? "Contract")}</h2></div><span className="count-badge">{arrayOf(row.milestones).length} milestones</span></div><p>{String(row.nextAction)}</p></article>; })}</div> : <StatePanel kind="empty" title="Workroom not checked" body="Ask the official provider for current contracts and milestones before making delivery decisions." />;
}

function MarketPresence({ data }: { data: Json }) {
  const suggestions = arrayOf(data.suggestions);
  const changes = arrayOf(data.changes);
  if (changes.length) return <div className="diff-list">{changes.map((change, index) => <article className="diff-card" key={index}><h2>{humanize(String(change.field))}</h2><div className="diff-before"><span>Current</span><p>{String(change.before)}</p></div><div className="diff-after"><span>Suggested</span><p>{String(change.after)}</p></div></article>)}</div>;
  if (data.packageId) return <article className="record-card"><div className="record-top"><div><p className="micro-label">service package draft</p><h2>{String(data.title)}</h2></div><CapabilityBadge value={String(data.capability)} /></div><p>{String(data.description)}</p><div className="tier-grid">{arrayOf(data.tiers).map((tier, index) => <div className="tier" key={index}><strong>{String(tier.name)}</strong><span>{formatMoney(Number(tier.priceMinor), String(data.currency))}</span><small>{String(tier.deliveryDays)} days</small></div>)}</div>{arrayOf(data.unsupportedClaims).length ? <RiskCallout text={String(data.unsupportedClaims[0])} /> : null}</article>;
  return suggestions.length ? <div className="ranked-list">{suggestions.map((item, index) => <article className="record-card" key={index}><p className="micro-label">{String(item.area)}</p><h2>{String(item.title)}</h2><p>{String(item.rationale)}</p><div className="diff-inline"><span>{String(item.currentValue)}</span><ArrowIcon /><strong>{String(item.suggestedValue)}</strong></div>{arrayOf(item.evidenceNeeded).length ? <RiskCallout text={`Evidence needed: ${String(item.evidenceNeeded[0])}`} /> : null}</article>)}</div> : <StatePanel kind="empty" title="Market presence not checked" body="Fetch your official profile and services first. Unknown capability is not treated as unsupported." />;
}

function ProvenanceStrip({ envelope }: { envelope: Json }) {
  const first = asObject(arrayOf(envelope.provenance)[0]);
  return <div className="provenance-strip"><span><SourceIcon />{sourceLabel(String(first.source ?? "local_computed"))}</span><span className={`freshness ${String(first.freshness ?? "unknown")}`}>{freshnessLabel(String(first.freshness ?? "unknown"))}</span><span>{first.observedAt ? formatDate(first.observedAt) : "Not checked"}</span></div>;
}

function Warnings({ values }: { values: Json[] }) { return values.length ? <div className="warnings">{values.map((item, index) => <RiskCallout key={index} text={String(item.message)} />)}</div> : null; }
function DecisionCard({ title, body, tone }: { title: string; body: string; tone: string }) { return <article className={`decision-card ${tone}`}><div className="decision-icon">{tone === "positive" ? <CheckIcon /> : <SourceIcon />}</div><div><h2>{title}</h2><p>{body}</p></div></article>; }
function Metric({ label, value }: { label: string; value: unknown }) { return <div className="metric"><strong>{String(value)}</strong><span>{label}</span></div>; }
function CapabilityBadge({ value }: { value?: string }) { const state = value || "unknown"; return <span className={`capability-badge ${state}`}>{capabilityLabel(state)}</span>; }
function ScorePill({ score }: { score: number }) { return <div className="score-pill" aria-label={`Opportunity score ${score} out of 100`}><strong>{score}</strong><span>/100</span></div>; }
function StatusDot({ state }: { state: string }) { return <span className={`status-dot ${state}`}>{humanize(state)}</span>; }
function EvidenceLine({ count }: { count: number }) { return <div className="evidence-line"><CheckIcon />{count ? `${count} approved proof claim${count === 1 ? "" : "s"} apply` : "Evidence needed"}</div>; }
function RiskCallout({ text }: { text: string }) { return <div className="risk-callout"><AlertIcon /><span>{text}</span></div>; }
function DraftSection({ label, value }: { label: string; value: unknown }) { return <section className="draft-section"><h3>{label}</h3><p>{String(value ?? "")}</p></section>; }
function EmptyLine({ text }: { text: string }) { return <p className="empty-line">{text}</p>; }
function StatePanel({ title, body, kind }: { title: string; body: string; kind: string }) { return <div className={`state-panel ${kind}`} role="region" aria-live="polite"><div className="state-icon">{kind === "error" ? <AlertIcon /> : <SourceIcon />}</div><h1>{title}</h1><p>{body}</p></div>; }
function LoadingState() { return <main className="loading-shell" aria-live="polite"><div className="skeleton header-skeleton"/><div className="skeleton strip-skeleton"/><div className="skeleton card-skeleton"/><span className="sr-only">Loading Revenue Copilot</span></main>; }

function OperationalState({ state }: { state: string }) {
  const copy = NON_BLOCKING_STATES[state];
  if (!copy) return null;
  const uncertain = state === "outcome_uncertain" || state === "refresh_failure" || state === "stale_content" || state === "failed_no_change";
  return <div className={uncertain ? "risk-callout" : "receipt-banner"} role="status">{uncertain ? <AlertIcon /> : <CheckIcon />}<span>{copy}</span></div>;
}

const BLOCKING_STATES: Record<string, { kind: string; title: string; body: string }> = {
  signed_out: { kind: "empty", title: "Sign in to Revenue Copilot", body: "Reconnect Revenue Copilot to access retained drafts and history. Your official marketplace connection remains separate." },
  provider_not_checked: { kind: "empty", title: "Provider not checked", body: "Ask ChatGPT to check the separately connected official marketplace app. Not checked does not mean unsupported." },
  provider_disconnected: { kind: "error", title: "Official provider disconnected", body: "Reconnect the official marketplace app before requesting current state. Revenue Copilot has not attempted any marketplace action." },
  permission_denied: { kind: "error", title: "Permission not available", body: "The current connection did not grant this capability. Revenue Copilot can preserve a draft or prepare a manual handoff." },
  capability_unavailable: { kind: "empty", title: "Capability unavailable", body: "The official provider does not currently expose this workflow for the connected account. Nothing has been changed." }
};

const NON_BLOCKING_STATES: Record<string, string> = {
  stale_content: "Official provider context is stale. Re-fetch before making a consequential decision.",
  refresh_failure: "Refresh failed. Prior content remains visible and is labeled with its last trustworthy observation time.",
  draft_saved: "Draft saved in Revenue Copilot. Nothing has been submitted or sent.",
  preview_ready: "Exact preview ready for provider review. Nothing has been submitted or changed.",
  awaiting_confirmation: "Awaiting official provider confirmation. Revenue Copilot has not executed the action.",
  provider_working: "The official provider is processing the confirmed action. Do not retry while the outcome is pending.",
  confirmed: "Provider outcome confirmed by receipt and independent read-back.",
  failed_no_change: "The provider reported a failure and confirmed that no change occurred.",
  already_completed: "The provider action was already completed. No duplicate action was taken.",
  outcome_uncertain: "Provider outcome is uncertain. Retries are disabled until official state is checked."
};

function primaryAction(surface: string, data: Json): { label: string; prompt: string } | null {
  if (surface === "capabilities") return { label: "Check official provider", prompt: "Using the separately connected official marketplace app, check my current freelancer capabilities and the latest relevant profile, jobs, proposals, messages, contracts, services, Connects, and earnings fields that it legitimately exposes. Do not make changes. Then pass only the necessary normalized fields and capability observations to Revenue Copilot." };
  if (surface === "revenue_pulse") { const top = arrayOf(data.actions)[0]; return top ? { label: "Review top action", prompt: `Review Revenue Copilot's top action ${String(top.id)}: ${String(top.title)}. Re-fetch relevant current state through the official marketplace app before recommending or preparing anything consequential.` } : null; }
  if (surface === "opportunity_review") { const row = data.opportunity ?? arrayOf(data.opportunities)[0]; const job = asObject(asObject(row).job); return job.providerObjectId ? { label: "Draft proposal", prompt: `Use Revenue Copilot to prepare an evidence-bound proposal draft for official job ${String(job.providerObjectId)}. Use only approved proof claims, preserve hard gates, and do not submit anything.` } : null; }
  if (surface === "proposal_studio") { const draft = asObject(data.draft ?? arrayOf(data.drafts)[0]); return draft.id ? { label: "Prepare in chat", prompt: `Prepare Revenue Copilot draft ${String(draft.id)} for official provider review. Re-fetch the job and official Connect cost, compare the current provider revision with the frozen source, show the exact text and terms, require provider confirmation, execute at most once through the official marketplace app, independently read back the result, and record the outcome in Revenue Copilot. Nothing should be submitted without the provider confirmation.` } : null; }
  if (surface === "inbox_triage") { const row = arrayOf(data.conversations)[0]; const conversation = asObject(asObject(row).conversation); return conversation.providerObjectId ? { label: "Draft reply", prompt: `Prepare a truthful reply draft for official conversation ${String(conversation.providerObjectId)} using Revenue Copilot. Re-fetch the latest official messages first. Do not send it.` } : null; }
  if (surface === "workroom") { const row = arrayOf(data.workrooms)[0]; const contract = asObject(asObject(row).contract); return contract.providerObjectId ? { label: "Prepare action", prompt: `Review current official state for contract ${String(contract.providerObjectId)} and use Revenue Copilot to prepare the safest next delivery or milestone action. Do not submit or change anything until the official provider shows confirmation.` } : null; }
  if (surface === "market_presence") return { label: "Review suggested change", prompt: "Review this Revenue Copilot market-presence suggestion against my approved proof library and current official provider state. Prepare a section-level diff or service draft. Do not update or publish anything unless the official provider exposes the capability and shows confirmation followed by independent read-back." };
  return null;
}

const KNOWN_SURFACES = new Set(["capabilities", "revenue_pulse", "opportunity_review", "proposal_studio", "inbox_triage", "workroom", "market_presence"]);
function asObject(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function arrayOf(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function textContent(result: CallToolResult): string { const block = result.content?.find((item) => item.type === "text"); return block?.type === "text" ? block.text : ""; }
function inferSurface(value: Json): string { return value.status ? "capabilities" : value.draft || value.drafts ? "proposal_studio" : "capabilities"; }
function surfaceTitle(value: string): string { return ({ capabilities: "Connection & Capability", revenue_pulse: "Revenue Pulse", opportunity_review: "Opportunity Review", proposal_studio: "Proposal Studio", inbox_triage: "Inbox Triage", workroom: "Workroom", market_presence: "Market Presence" } as Json)[value] ?? "Revenue Copilot"; }
function leadingCapability(value: unknown): string { const values = Object.values(asObject(value)); return String(values[0] ?? "unknown"); }
function capabilityLabel(value: string): string { return ({ verified_read_write: "Verified read + write", verified_read_only: "Verified read-only", manual_handoff: "Manual handoff", unavailable: "Unavailable", unknown: "Not checked" } as Json)[value] ?? "Not checked"; }
function sourceLabel(value: string): string { return ({ official_provider: "Official provider", migrated_history: "Migrated history", user: "User supplied", local_computed: "Revenue Copilot analysis" } as Json)[value] ?? "Revenue Copilot analysis"; }
function freshnessLabel(value: string): string { return ({ fresh: "Fresh", stale: "Stale", partial: "Partial", unknown: "Freshness unknown" } as Json)[value] ?? "Freshness unknown"; }
function humanize(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value: unknown): string { if (!value) return "Not checked"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "Not checked" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function formatMoney(minor: number, currency: string): string { try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100); } catch { return `${minor / 100} ${currency}`; } }

function SparkIcon() { return <svg viewBox="0 0 24 24"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6.4 6.4l2.2 2.2m6.8 6.8 2.2 2.2m0-11.2-2.2 2.2m-6.8 6.8-2.2 2.2"/><circle cx="12" cy="12" r="3"/></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>; }
function AlertIcon() { return <svg viewBox="0 0 24 24"><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></svg>; }
function SourceIcon() { return <svg viewBox="0 0 24 24"><path d="M4 7c0-2 3.6-3 8-3s8 1 8 3-3.6 3-8 3-8-1-8-3Z"/><path d="M4 7v5c0 2 3.6 3 8 3s8-1 8-3V7M4 12v5c0 2 3.6 3 8 3s8-1 8-3v-5"/></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>; }

const isReviewPreview = window.parent === window && new URLSearchParams(window.location.search).has("fixture");
createRoot(document.getElementById("root")!).render(<StrictMode>{isReviewPreview ? <ReviewPreview /> : <RevenueCopilotApp />}</StrictMode>);
