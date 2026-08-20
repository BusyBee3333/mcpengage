import { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { sha256Hex } from "../domain/hash";
import { verifyDownloadToken } from "../operations/cloudflare-lifecycle";
import { TenantEnvelopeEncryption } from "../storage/encryption";

export interface AuthProps {
  tenantId: string;
  issuer: string;
  subject: string;
  scopes: string[];
}

export async function handleAuthorizationRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/authorize" && request.method === "GET") return beginAuthorization(request, env);
  if (url.pathname === "/auth/callback" && request.method === "GET") return finishIdentity(request, env);
  if (url.pathname === "/consent" && request.method === "GET") return consentPage(request, env);
  if (url.pathname === "/consent" && request.method === "POST") return completeConsent(request, env);
  return publicRoute(request, env);
}

async function beginAuthorization(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return setupRequired();
  let oauthRequest: AuthRequest;
  try { oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request); }
  catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return htmlPage("Authorization could not start", escapeHtml(error.description), 400);
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    if (error.issuer) redirect.searchParams.set("iss", error.issuer);
    return Response.redirect(redirect, 302);
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return htmlPage("Unknown client", "Revenue Copilot could not validate this OAuth client.", 400);
  const state = crypto.randomUUID();
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = crypto.randomUUID();
  const now = new Date();
  await env.CONTROL_DB.prepare("INSERT INTO oauth_authorization_state (state,oauth_request_json,pkce_verifier,nonce,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(state, JSON.stringify(oauthRequest), verifier, nonce, now.toISOString(), new Date(now.getTime() + 10 * 60_000).toISOString()).run();
  const target = new URL("/authorize", auth0Issuer(env));
  target.searchParams.set("response_type", "code");
  target.searchParams.set("client_id", env.AUTH0_CLIENT_ID!);
  target.searchParams.set("redirect_uri", `${env.PUBLIC_ORIGIN}/auth/callback`);
  target.searchParams.set("scope", "openid profile");
  target.searchParams.set("state", state);
  target.searchParams.set("nonce", nonce);
  target.searchParams.set("code_challenge_method", "S256");
  target.searchParams.set("code_challenge", await pkceChallenge(verifier));
  return redirectWithState(target, state);
}

async function finishIdentity(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (!state || !code || cookieValue(request, "rc_auth_state") !== state) return htmlPage("Authorization expired", "Restart the Revenue Copilot connection from ChatGPT.", 400);
  const row = await loadState(env, state);
  if (!row || Date.parse(row.expires_at) < Date.now()) return htmlPage("Authorization expired", "Restart the Revenue Copilot connection from ChatGPT.", 400);
  const tokenResponse = await fetch(new URL("/oauth/token", auth0Issuer(env)), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: env.AUTH0_CLIENT_ID, client_secret: env.AUTH0_CLIENT_SECRET, code, redirect_uri: `${env.PUBLIC_ORIGIN}/auth/callback`, code_verifier: row.pkce_verifier })
  });
  if (!tokenResponse.ok) return htmlPage("Sign-in could not finish", "The identity provider rejected the authorization code. Restart the connection.", 400);
  const tokens = await tokenResponse.json<{ id_token?: string }>();
  if (!tokens.id_token) return htmlPage("Sign-in could not finish", "The identity provider did not return a verifiable identity.", 400);
  const identity = await verifyIdToken(tokens.id_token, env, row.nonce);
  await env.CONTROL_DB.prepare("UPDATE oauth_authorization_state SET subject = ?, issuer = ? WHERE state = ?").bind(identity.sub, identity.iss, state).run();
  return Response.redirect(`${env.PUBLIC_ORIGIN}/consent?state=${encodeURIComponent(state)}`, 302);
}

async function consentPage(request: Request, env: Env): Promise<Response> {
  const state = new URL(request.url).searchParams.get("state");
  if (!state || cookieValue(request, "rc_auth_state") !== state) return htmlPage("Consent expired", "Restart the Revenue Copilot connection from ChatGPT.", 400);
  const row = await loadState(env, state); if (!row?.subject || Date.parse(row.expires_at) < Date.now()) return htmlPage("Consent expired", "Restart the Revenue Copilot connection from ChatGPT.", 400);
  const oauth = JSON.parse(row.oauth_request_json) as AuthRequest;
  const requested = oauth.scope.filter((scope) => SUPPORTED_SCOPES.includes(scope)).map((scope) => `<li><strong>${escapeHtml(scope)}</strong> — ${scopeDescription(scope)}</li>`).join("");
  const body = `<p>Revenue Copilot is independent from Upwork. It stores normalized marketplace content you choose to pass into it until you delete that data.</p><ul>${requested}</ul><p>It never receives your Upwork password, cookies, OAuth token, attachment binaries, or raw provider archive.</p><form method="post" action="/consent"><input type="hidden" name="state" value="${escapeHtml(state)}"><button type="submit">Allow Revenue Copilot</button></form><p class="fine">You can export or delete retained data at any time.</p>`;
  return htmlPage("Allow Revenue Copilot?", body, 200, true);
}

async function completeConsent(request: Request, env: Env): Promise<Response> {
  const form = await request.formData(); const state = String(form.get("state") ?? "");
  if (!state || cookieValue(request, "rc_auth_state") !== state) return htmlPage("Consent expired", "Restart the connection from ChatGPT.", 400);
  const row = await loadState(env, state); if (!row?.subject || !row.issuer || Date.parse(row.expires_at) < Date.now()) return htmlPage("Consent expired", "Restart the connection from ChatGPT.", 400);
  const oauth = JSON.parse(row.oauth_request_json) as AuthRequest;
  const granted = oauth.scope.filter((scope) => SUPPORTED_SCOPES.includes(scope));
  const client = await env.OAUTH_PROVIDER.lookupClient(oauth.clientId);
  if (!client) return htmlPage("Unknown client", "Revenue Copilot could not validate this OAuth client.", 400);
  const tenantId = `tenant_${(await sha256Hex(`${row.issuer}|${row.subject}`)).slice(0, 32)}`;
  const now = new Date().toISOString();
  await env.CONTROL_DB.prepare("INSERT INTO accounts (id,issuer,subject,consent_version,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET consent_version=excluded.consent_version,updated_at=excluded.updated_at")
    .bind(tenantId, row.issuer, row.subject, "2026-08-20", now, now).run();
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({ request: oauth, userId: row.subject, metadata: { clientName: client.clientName ?? "MCP client", consentVersion: "2026-08-20" }, scope: granted, props: { tenantId, issuer: row.issuer, subject: row.subject, scopes: granted } satisfies AuthProps });
  await env.CONTROL_DB.prepare("DELETE FROM oauth_authorization_state WHERE state = ?").bind(state).run();
  const response = Response.redirect(redirectTo, 302); response.headers.append("Set-Cookie", "rc_auth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"); return response;
}

export async function publicRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.startsWith("/exports/")) return downloadExport(url, env);
  if (url.pathname === "/healthz") return Response.json({ status: "ok", service: "revenue-copilot", environment: env.ENVIRONMENT, marketplaceWrites: false }, { headers: { "cache-control": "no-store" } });
  if (url.pathname === "/.well-known/openai-apps-challenge") return new Response(env.OPENAI_APPS_CHALLENGE ?? "challenge-not-configured", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  if (url.pathname === "/privacy") return htmlPage("Revenue Copilot Privacy", `<p>Revenue Copilot stores normalized operational history the user chooses to provide until deletion. It does not store marketplace credentials, provider OAuth tokens, raw provider archives, identity documents, payment-card data, or attachment binaries.</p><p>Active deletion completes within 24 hours; encrypted backup residue expires within 35 days. Diagnostic logs are retained for seven days without marketplace content.</p><p>Contact: privacy@mcpengage.com</p>`);
  if (url.pathname === "/terms") return htmlPage("Revenue Copilot Terms", `<p>Revenue Copilot is independent decision-support software and is not affiliated with or endorsed by Upwork. The official provider remains authoritative for current state and marketplace actions.</p><p>Revenue Copilot does not guarantee work, income, proposal acceptance, or provider availability.</p>`);
  if (url.pathname === "/support") return htmlPage("Revenue Copilot Support", `<p>For help, contact support@mcpengage.com. Include the Revenue Copilot action intent ID when reporting an uncertain provider outcome. Never send passwords, cookies, tokens, or identity documents.</p>`);
  if (url.pathname === "/status") return htmlPage("Revenue Copilot Status", `<p>Service health is available at <code>/healthz</code>. Provider capability is connection-specific and is shown as verified, manual, unavailable, or not checked.</p>`);
  if (url.pathname === "/" ) return htmlPage("Revenue Copilot", `<p>Revenue-first freelancer decision support for ChatGPT, designed to work alongside separately connected official marketplace tools.</p><p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a> · <a href="/status">Status</a></p>`);
  return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
}

async function downloadExport(url: URL, env: Env): Promise<Response> {
  const exportId = decodeURIComponent(url.pathname.slice("/exports/".length)); const token = url.searchParams.get("token");
  if (!exportId || !token || !env.DATA_ENCRYPTION_KEY) return new Response("Export link is invalid or expired", { status: 403, headers: securityHeaders("text/plain; charset=utf-8") });
  const verified = await verifyDownloadToken(env, exportId, token);
  if (!verified) return new Response("Export link is invalid or expired", { status: 403, headers: securityHeaders("text/plain; charset=utf-8") });
  const job = await env.CONTROL_DB.prepare("SELECT object_key,expires_at,status FROM lifecycle_jobs WHERE id=? AND tenant_id=? AND job_type='export'").bind(exportId, verified.tenantId).first<{ object_key: string | null; expires_at: string | null; status: string }>();
  if (!job?.object_key || job.status !== "complete" || !job.expires_at || Date.parse(job.expires_at) < Date.now()) return new Response("Export is unavailable", { status: 410, headers: securityHeaders("text/plain; charset=utf-8") });
  const object = await env.EXPORTS.get(job.object_key); if (!object) return new Response("Export is unavailable", { status: 410, headers: securityHeaders("text/plain; charset=utf-8") });
  const encrypted = await object.text(); const plaintext = await new TenantEnvelopeEncryption(env.DATA_ENCRYPTION_KEY).decrypt(verified.tenantId, `account-export:${exportId}`, encrypted);
  const headers = new Headers(securityHeaders("application/json; charset=utf-8")); headers.set("cache-control", "private, no-store"); headers.set("content-disposition", `attachment; filename="revenue-copilot-${exportId}.json"`);
  return new Response(plaintext, { headers });
}

const SUPPORTED_SCOPES = ["copilot.read", "copilot.write", "copilot.account"];
function configured(env: Env): boolean { return Boolean(env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET); }
function setupRequired(): Response { return htmlPage("Revenue Copilot OAuth is not configured", "Set the Auth0 domain, audience, client ID, and client secret in this environment before beta connections.", 503); }
function auth0Issuer(env: Env): URL { const raw = env.AUTH0_DOMAIN!.startsWith("https://") ? env.AUTH0_DOMAIN! : `https://${env.AUTH0_DOMAIN}`; return new URL(raw.endsWith("/") ? raw : `${raw}/`); }
async function loadState(env: Env, state: string): Promise<{ oauth_request_json: string; pkce_verifier: string; nonce: string; subject: string | null; issuer: string | null; expires_at: string } | null> { return env.CONTROL_DB.prepare("SELECT oauth_request_json,pkce_verifier,nonce,subject,issuer,expires_at FROM oauth_authorization_state WHERE state = ?").bind(state).first(); }
function redirectWithState(target: URL, state: string): Response { const response = Response.redirect(target, 302); response.headers.append("Set-Cookie", `rc_auth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`); return response; }
function cookieValue(request: Request, name: string): string | undefined { return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1); }
async function pkceChallenge(verifier: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)); return base64Url(new Uint8Array(digest)); }
function base64Url(bytes: Uint8Array): string { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function decodeBase64Url(value: string): Uint8Array { const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="); const decoded = atob(padded); return Uint8Array.from(decoded, (char) => char.charCodeAt(0)); }

async function verifyIdToken(token: string, env: Env, expectedNonce: string): Promise<{ sub: string; iss: string }> {
  const parts = token.split("."); if (parts.length !== 3) throw new Error("INVALID_ID_TOKEN");
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]!))) as { alg?: string; kid?: string };
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]!))) as { sub?: string; iss?: string; aud?: string | string[]; exp?: number; nonce?: string };
  const issuer = auth0Issuer(env).toString(); const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (header.alg !== "RS256" || !header.kid || payload.iss !== issuer || !audiences.includes(env.AUTH0_CLIENT_ID) || !payload.sub || payload.nonce !== expectedNonce || !payload.exp || payload.exp * 1000 < Date.now()) throw new Error("INVALID_ID_TOKEN_CLAIMS");
  const jwksResponse = await fetch(new URL(".well-known/jwks.json", issuer), { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!jwksResponse.ok) throw new Error("JWKS_UNAVAILABLE");
  const jwks = await jwksResponse.json<{ keys: Array<JsonWebKey & { kid?: string; alg?: string }> }>(); const jwk = jwks.keys.find((key) => key.kid === header.kid && key.alg === "RS256"); if (!jwk) throw new Error("SIGNING_KEY_NOT_FOUND");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = decodeBase64Url(parts[2]!);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("INVALID_ID_TOKEN_SIGNATURE"); return { sub: payload.sub, iss: payload.iss };
}

function htmlPage(title: string, body: string, status = 200, bodyIsHtml = true): Response {
  const content = bodyIsHtml ? body : `<p>${escapeHtml(body)}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:680px;margin:64px auto;padding:0 24px;color:#1c2230}main{border:1px solid #e2e5eb;border-radius:16px;padding:28px}h1{font-size:24px}li{margin:10px 0}button{min-height:44px;border:0;border-radius:10px;padding:0 18px;background:#2f5bd3;color:white;font-weight:700}.fine{color:#656b76;font-size:13px}a{color:#2f5bd3}</style></head><body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
  return new Response(html, { status, headers: securityHeaders("text/html; charset=utf-8") });
}
function securityHeaders(contentType: string): HeadersInit { return { "content-type": contentType, "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "permissions-policy": "camera=(), microphone=(), geolocation=()" }; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function scopeDescription(scope: string): string { return scope === "copilot.read" ? "read your Revenue Copilot workspace and retained normalized history" : scope === "copilot.write" ? "save preferences, proof, drafts, and verified provider receipts" : "export or delete your Revenue Copilot account data"; }
