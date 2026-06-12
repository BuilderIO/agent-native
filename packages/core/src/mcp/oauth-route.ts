/**
 * Standard remote MCP OAuth 2.1 endpoints.
 *
 * These routes let MCP hosts such as Claude Code and ChatGPT authenticate
 * through their native remote-MCP OAuth flow instead of pasting bearer tokens.
 * The issued access tokens are audience-bound to `/_agent-native/mcp`, carry
 * the same user/org identity as the existing connect flow, and are mediated by
 * `verifyAuth` before any MCP tool/resource request runs.
 */

import type { H3Event } from "h3";
import { getHeader, getMethod, getQuery, setResponseStatus } from "h3";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readBody } from "../server/h3-helpers.js";
import { getConfiguredLoginHtml, getSession } from "../server/auth.js";
import { getAuthSecret } from "../server/better-auth-instance.js";
import { getOrgDomain } from "../org/context.js";
import {
  createOAuthCode,
  createOAuthRefreshToken,
  consumeOAuthCode,
  generateOpaqueToken,
  getOAuthClient,
  getOAuthCode,
  getOAuthRefreshToken,
  registerOAuthClient,
  touchOAuthRefreshToken,
} from "./oauth-store.js";
import {
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_DEFAULT_SCOPE,
  MCP_OAUTH_SCOPES,
  normalizeOAuthScope,
  signMcpOAuthAccessToken,
} from "./oauth-token.js";

export interface McpOAuthRouteOptions {
  appId?: string;
  appName?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function isSameOriginPost(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  if (!origin) return true;
  const issuer = getMcpOAuthIssuer(event);
  if (!issuer) return false;
  try {
    return new URL(origin).origin === new URL(issuer).origin;
  } catch {
    return false;
  }
}

function oauthError(
  error: string,
  description: string,
  status = 400,
): Response {
  return json({ error, error_description: description }, status);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "");
}

function configuredBasePath(): string {
  return normalizeBasePath(
    process.env.APP_BASE_PATH || process.env.VITE_APP_BASE_PATH,
  );
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredPublicBaseUrl(): string | undefined {
  for (const key of [
    "WORKSPACE_OAUTH_ORIGIN",
    "VITE_WORKSPACE_OAUTH_ORIGIN",
    "APP_URL",
    "VITE_APP_URL",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
  ]) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      url.search = "";
      url.hash = "";
      return stripTrailingSlash(`${url.origin}${url.pathname}`);
    } catch {
      // Ignore invalid operator-provided URL values and fall back to headers.
    }
  }
  return undefined;
}

function appendConfiguredBasePath(baseUrl: string): string {
  const basePath = configuredBasePath();
  if (!basePath) return stripTrailingSlash(baseUrl);
  try {
    const url = new URL(baseUrl);
    const pathname = normalizeBasePath(url.pathname);
    if (pathname === basePath || pathname.endsWith(`${basePath}`)) {
      return stripTrailingSlash(`${url.origin}${pathname}`);
    }
    return stripTrailingSlash(`${url.origin}${pathname}${basePath}`);
  } catch {
    return `${stripTrailingSlash(baseUrl)}${basePath}`;
  }
}

function deriveOrigin(event: H3Event): string {
  const forwardedProto = getHeader(event, "x-forwarded-proto");
  const host = getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    (host && /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)
      ? "http"
      : "https");
  return host ? `${proto}://${host}` : "";
}

export function getMcpOAuthIssuer(event: H3Event): string | undefined {
  const baseUrl = configuredPublicBaseUrl() || deriveOrigin(event);
  if (!baseUrl) return undefined;
  return appendConfiguredBasePath(baseUrl);
}

export function getMcpOAuthResource(event: H3Event): string | undefined {
  const issuer = getMcpOAuthIssuer(event);
  if (!issuer) return undefined;
  return `${issuer}/_agent-native/mcp`;
}

/**
 * All plausible MCP OAuth resource audiences for the given request, deduped.
 *
 * When a configured public base URL differs from the request-derived origin
 * (e.g. during Netlify deploy-preview or behind a reverse proxy), a token
 * minted against the configured URL must still verify against the request-
 * derived URL and vice-versa.  Returns both so `verifyMcpOAuthAccessToken`
 * accepts either without issuing a 401.
 */
export function getMcpOAuthAudiences(event: H3Event): string[] {
  const derived = getMcpOAuthResource(event);
  const configured = (() => {
    const base = configuredPublicBaseUrl();
    if (!base) return undefined;
    // Re-apply base path if present so the configured resource is also
    // base-path-aware, consistent with how getMcpOAuthResource computes it.
    const withPath = appendConfiguredBasePath(base);
    return `${withPath}/_agent-native/mcp`;
  })();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [derived, configured]) {
    const n = r?.replace(/\/+$/, "");
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function getMcpOAuthProtectedResourceMetadataUrl(
  event: H3Event,
): string | undefined {
  const issuer = getMcpOAuthIssuer(event);
  if (!issuer) return undefined;
  return `${issuer}/.well-known/oauth-protected-resource`;
}

export function buildMcpOAuthChallenge(event: H3Event): string {
  const metadata = getMcpOAuthProtectedResourceMetadataUrl(event);
  const scope = MCP_OAUTH_DEFAULT_SCOPE;
  return metadata
    ? `Bearer resource_metadata="${metadata}", scope="${scope}"`
    : `Bearer scope="${scope}"`;
}

function authorizationEndpoint(event: H3Event): string | undefined {
  const issuer = getMcpOAuthIssuer(event);
  return issuer ? `${issuer}/_agent-native/mcp/oauth/authorize` : undefined;
}

function tokenEndpoint(event: H3Event): string | undefined {
  const issuer = getMcpOAuthIssuer(event);
  return issuer ? `${issuer}/_agent-native/mcp/oauth/token` : undefined;
}

function registrationEndpoint(event: H3Event): string | undefined {
  const issuer = getMcpOAuthIssuer(event);
  return issuer ? `${issuer}/_agent-native/mcp/oauth/register` : undefined;
}

export function handleMcpOAuthProtectedResourceMetadata(
  event: H3Event,
): Response {
  if (getMethod(event) !== "GET") {
    return oauthError("invalid_request", "Method not allowed", 405);
  }
  const resource = getMcpOAuthResource(event);
  const issuer = getMcpOAuthIssuer(event);
  if (!resource || !issuer) {
    return oauthError("server_error", "Unable to derive MCP resource", 500);
  }
  return json({
    resource,
    authorization_servers: [issuer],
    scopes_supported: MCP_OAUTH_SCOPES,
    resource_documentation: issuer,
  });
}

export function handleMcpOAuthAuthorizationServerMetadata(
  event: H3Event,
): Response {
  if (getMethod(event) !== "GET") {
    return oauthError("invalid_request", "Method not allowed", 405);
  }
  const issuer = getMcpOAuthIssuer(event);
  const authorize = authorizationEndpoint(event);
  const token = tokenEndpoint(event);
  const register = registrationEndpoint(event);
  if (!issuer || !authorize || !token || !register) {
    return oauthError("server_error", "Unable to derive OAuth endpoints", 500);
  }
  return json({
    issuer,
    authorization_endpoint: authorize,
    token_endpoint: token,
    registration_endpoint: register,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: MCP_OAUTH_SCOPES,
  });
}

function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function handleRegister(event: H3Event): Promise<Response> {
  if (getMethod(event) !== "POST") {
    return oauthError("invalid_request", "Method not allowed", 405);
  }
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >;
  const redirectUris = parseStringArray(body.redirect_uris);
  if (
    redirectUris.length === 0 ||
    redirectUris.length > 20 ||
    !redirectUris.every(isAllowedRedirectUri)
  ) {
    return oauthError(
      "invalid_client_metadata",
      "redirect_uris must contain valid HTTPS or localhost callback URLs",
    );
  }

  const grantTypes = parseStringArray(body.grant_types);
  if (
    grantTypes.length &&
    !grantTypes.every(
      (g) => g === "authorization_code" || g === "refresh_token",
    )
  ) {
    return oauthError("invalid_client_metadata", "Unsupported grant_type");
  }
  const responseTypes = parseStringArray(body.response_types);
  if (responseTypes.length && !responseTypes.every((r) => r === "code")) {
    return oauthError("invalid_client_metadata", "Unsupported response_type");
  }
  const method =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "none";
  if (method !== "none") {
    return oauthError(
      "invalid_client_metadata",
      "Only public OAuth clients are supported",
    );
  }

  const clientName =
    typeof body.client_name === "string"
      ? body.client_name.trim().slice(0, 120)
      : null;
  let client;
  try {
    client = await registerOAuthClient({
      clientName,
      redirectUris: [...new Set(redirectUris)],
      grantTypes: grantTypes.length ? grantTypes : undefined,
      responseTypes: responseTypes.length ? responseTypes : undefined,
      tokenEndpointAuthMethod: method,
    });
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED") {
      return oauthError("slow_down", "Too many client registrations", 429);
    }
    throw err;
  }
  return json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor((client.createdAt ?? Date.now()) / 1000),
      client_name: client.clientName ?? undefined,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    },
    201,
  );
}

function redirectWithOAuthError(params: {
  redirectUri: string;
  state?: string;
  error: string;
  description?: string;
}): Response {
  const url = new URL(params.redirectUri);
  url.searchParams.set("error", params.error);
  if (params.description) {
    url.searchParams.set("error_description", params.description);
  }
  if (params.state) url.searchParams.set("state", params.state);
  return redirect(url.toString());
}

function redirectWithCode(params: {
  redirectUri: string;
  code: string;
  state?: string;
}): Response {
  const url = new URL(params.redirectUri);
  url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  return redirect(url.toString());
}

function codeChallengeForVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function base64UrlEncode(value: Buffer | string): string {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buf.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function consentSigningKey(): string {
  return process.env.A2A_SECRET?.trim() || getAuthSecret();
}

function consentPayload(params: {
  email: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
}): string {
  return JSON.stringify({
    ...params,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  });
}

function signConsentToken(params: {
  email: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
}): string {
  const payload = base64UrlEncode(consentPayload(params));
  const sig = base64UrlEncode(
    createHmac("sha256", consentSigningKey()).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

function verifyConsentToken(
  token: string | undefined,
  expected: {
    email: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    scope: string;
    codeChallenge: string;
  },
): boolean {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".", 2);
  if (!payload || !sig) return false;
  const expectedSig = base64UrlEncode(
    createHmac("sha256", consentSigningKey()).update(payload).digest(),
  );
  if (!safeEqual(sig, expectedSig)) return false;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload).toString("utf8"));
    return (
      parsed.email === expected.email &&
      parsed.clientId === expected.clientId &&
      parsed.redirectUri === expected.redirectUri &&
      parsed.resource === expected.resource &&
      parsed.scope === expected.scope &&
      parsed.codeChallenge === expected.codeChallenge &&
      typeof parsed.exp === "number" &&
      parsed.exp * 1000 >= Date.now()
    );
  } catch {
    return false;
  }
}

function isValidCodeVerifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 43 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._~-]+$/.test(value)
  );
}

function renderConsentPage(params: {
  appName: string;
  email: string;
  clientName: string;
  scopes: string[];
  fields: Record<string, string>;
}): string {
  const hidden = Object.entries(params.fields)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
    )
    .join("\n");
  const scopes = params.scopes
    .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${escapeHtml(params.appName)}</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #09090b; color: #f4f4f5; }
  body { min-height: 100vh; display: grid; place-items: center; margin: 0; padding: 24px; }
  main { width: min(520px, 100%); border: 1px solid #27272a; border-radius: 8px; background: #111113; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
  h1 { font-size: 22px; line-height: 1.2; margin: 0 0 10px; }
  p { color: #a1a1aa; line-height: 1.5; margin: 0 0 18px; }
  ul { margin: 0 0 22px; padding-left: 22px; color: #d4d4d8; }
  code { color: #67e8f9; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; }
  button { border: 0; border-radius: 6px; padding: 10px 14px; font-weight: 650; cursor: pointer; }
  .primary { background: #f4f4f5; color: #09090b; }
  .secondary { background: #27272a; color: #f4f4f5; }
</style>
</head>
<body>
<main>
  <h1>Authorize ${escapeHtml(params.clientName)}</h1>
  <p>${escapeHtml(params.appName)} will let this MCP client act as ${escapeHtml(params.email)} for these scopes:</p>
  <ul>${scopes}</ul>
  <form method="post">
    ${hidden}
    <div class="actions">
      <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
      <button class="primary" type="submit" name="decision" value="approve">Authorize</button>
    </div>
  </form>
</main>
</body>
</html>`;
}

async function resolveOrgDomain(
  orgId: string | undefined,
): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    return (await getOrgDomain(orgId)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function readOAuthParams(
  event: H3Event,
): Promise<Record<string, string>> {
  if (getMethod(event) === "GET") {
    const query = getQuery(event);
    return Object.fromEntries(
      Object.entries(query).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
  }
  const body = await readBody(event).catch(() => ({}));
  if (typeof body === "string") {
    return Object.fromEntries(new URLSearchParams(body));
  }
  if (body && typeof body === "object") {
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
  }
  return {};
}

async function handleAuthorize(
  event: H3Event,
  options: McpOAuthRouteOptions,
): Promise<Response> {
  const method = getMethod(event);
  if (method !== "GET" && method !== "POST") {
    return oauthError("invalid_request", "Method not allowed", 405);
  }
  if (method === "POST" && !isSameOriginPost(event)) {
    return oauthError(
      "invalid_request",
      "Cross-origin authorize POST rejected",
      403,
    );
  }
  const params = await readOAuthParams(event);
  const state = params.state;
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const resource = params.resource || getMcpOAuthResource(event);
  const expectedResource = getMcpOAuthResource(event);

  if (params.response_type !== "code") {
    return oauthError(
      "unsupported_response_type",
      "response_type must be code",
    );
  }
  if (!clientId || !redirectUri || !resource || resource !== expectedResource) {
    return oauthError("invalid_request", "Invalid OAuth authorization request");
  }
  if (params.code_challenge_method !== "S256" || !params.code_challenge) {
    return oauthError("invalid_request", "PKCE S256 is required");
  }

  const client = await getOAuthClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return oauthError("invalid_client", "Unknown client or redirect_uri");
  }

  const session = await getSession(event);
  if (!session?.email) {
    if (params.prompt === "none") {
      return redirectWithOAuthError({
        redirectUri,
        state,
        error: "login_required",
      });
    }
    const loginHtml = getConfiguredLoginHtml(event);
    return loginHtml
      ? html(loginHtml, 200)
      : oauthError("login_required", "Sign in required", 401);
  }

  const scope = normalizeOAuthScope(params.scope);
  if (!scope) {
    return redirectWithOAuthError({
      redirectUri,
      state,
      error: "invalid_scope",
    });
  }
  if (method === "GET") {
    return html(
      renderConsentPage({
        appName: options.appName || options.appId || "Agent Native",
        email: session.email,
        clientName: client.clientName || client.clientId,
        scopes: scope.split(/\s+/),
        fields: {
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          resource,
          scope,
          state: state ?? "",
          code_challenge: params.code_challenge,
          code_challenge_method: "S256",
          consent_token: signConsentToken({
            email: session.email,
            clientId,
            redirectUri,
            resource,
            scope,
            codeChallenge: params.code_challenge,
          }),
        },
      }),
    );
  }

  if (
    !verifyConsentToken(params.consent_token, {
      email: session.email,
      clientId,
      redirectUri,
      resource,
      scope,
      codeChallenge: params.code_challenge,
    })
  ) {
    return oauthError("invalid_request", "Invalid authorization consent token");
  }

  if (params.decision !== "approve") {
    return redirectWithOAuthError({
      redirectUri,
      state,
      error: "access_denied",
    });
  }

  const orgDomain = await resolveOrgDomain(session.orgId);
  const code = await createOAuthCode({
    clientId,
    redirectUri,
    codeChallenge: params.code_challenge,
    codeChallengeMethod: "S256",
    ownerEmail: session.email,
    orgId: session.orgId ?? null,
    orgDomain: orgDomain ?? null,
    scope,
    resource,
  });
  return redirectWithCode({ redirectUri, state, code: code.code });
}

async function issueTokenSet(params: {
  ownerEmail: string;
  orgId?: string | null;
  orgDomain?: string | null;
  clientId: string;
  scope: string;
  resource: string;
  issuer: string;
}): Promise<Record<string, unknown>> {
  const refreshToken = generateOpaqueToken();
  await createOAuthRefreshToken({
    refreshToken,
    clientId: params.clientId,
    ownerEmail: params.ownerEmail,
    orgId: params.orgId ?? null,
    orgDomain: params.orgDomain ?? null,
    scope: params.scope,
    resource: params.resource,
  });
  const accessToken = await signMcpOAuthAccessToken(params);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: params.scope,
  };
}

async function handleAuthorizationCodeGrant(
  event: H3Event,
  body: Record<string, string>,
): Promise<Response> {
  const code = body.code;
  const clientId = body.client_id;
  const redirectUri = body.redirect_uri;
  const verifier = body.code_verifier;
  if (!code || !clientId || !redirectUri || !isValidCodeVerifier(verifier)) {
    return oauthError("invalid_request", "Missing authorization-code fields");
  }
  const row = await getOAuthCode(code);
  if (!row) return oauthError("invalid_grant", "Invalid or expired code");
  if (row.clientId !== clientId || row.redirectUri !== redirectUri) {
    return oauthError("invalid_grant", "Code was issued to another client");
  }
  const expectedChallenge = codeChallengeForVerifier(verifier);
  if (!safeEqual(expectedChallenge, row.codeChallenge)) {
    return oauthError("invalid_grant", "PKCE verification failed");
  }
  const consumed = await consumeOAuthCode(code);
  if (!consumed) return oauthError("invalid_grant", "Invalid or expired code");
  const issuer = getMcpOAuthIssuer(event);
  if (!issuer)
    return oauthError("server_error", "Unable to derive issuer", 500);
  return json(
    await issueTokenSet({
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      orgDomain: row.orgDomain,
      clientId,
      scope: row.scope,
      resource: row.resource,
      issuer,
    }),
  );
}

async function handleRefreshTokenGrant(
  event: H3Event,
  body: Record<string, string>,
): Promise<Response> {
  const refreshToken = body.refresh_token;
  const clientId = body.client_id;
  if (!refreshToken) {
    return oauthError("invalid_request", "refresh_token is required");
  }
  if (!clientId) {
    return oauthError("invalid_request", "client_id is required");
  }
  const existing = await getOAuthRefreshToken(refreshToken);
  if (!existing) return oauthError("invalid_grant", "Invalid refresh token");
  if (existing.clientId !== clientId) {
    return oauthError(
      "invalid_grant",
      "Refresh token belongs to another client",
    );
  }
  await touchOAuthRefreshToken(refreshToken).catch(() => undefined);
  const issuer = getMcpOAuthIssuer(event);
  if (!issuer)
    return oauthError("server_error", "Unable to derive issuer", 500);
  const accessToken = await signMcpOAuthAccessToken({
    ownerEmail: existing.ownerEmail,
    orgId: existing.orgId,
    orgDomain: existing.orgDomain,
    clientId: existing.clientId,
    scope: existing.scope,
    resource: existing.resource,
    issuer,
  });
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: existing.scope,
  });
}

async function handleToken(event: H3Event): Promise<Response> {
  if (getMethod(event) !== "POST") {
    return oauthError("invalid_request", "Method not allowed", 405);
  }
  const body = await readOAuthParams(event);
  switch (body.grant_type) {
    case "authorization_code":
      return handleAuthorizationCodeGrant(event, body);
    case "refresh_token":
      return handleRefreshTokenGrant(event, body);
    default:
      return oauthError("unsupported_grant_type", "Unsupported grant_type");
  }
}

export async function handleMcpOAuth(
  event: H3Event,
  subpath: string,
  options: McpOAuthRouteOptions = {},
): Promise<Response> {
  const path = subpath.replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    if (path === "authorize") return await handleAuthorize(event, options);
    if (path === "token") return await handleToken(event);
    if (path === "register") return await handleRegister(event);
    setResponseStatus(event, 404);
    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    return oauthError(
      "server_error",
      err?.message || "OAuth request failed",
      500,
    );
  }
}
