/**
 * Shared Google OAuth utilities for all templates.
 *
 * Handles platform detection (desktop/mobile), state encoding,
 * session token creation, and deep-link responses — the logic
 * that was previously copy-pasted across every template's
 * google-auth.ts handler.
 */

import crypto from "node:crypto";
import {
  getHeader,
  getQuery,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import {
  addSession,
  getSession,
  getSessionMaxAge,
  setFrameworkSessionCookie,
} from "./auth.js";
import { getAppName } from "./app-name.js";
import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";
import { writeDesktopSso } from "./desktop-sso.js";
import { appendSessionToOAuthReturnUrl } from "./oauth-return-url.js";

// ─── Platform Detection ─────────────────────────────────────────────────────

/** Return an HTML response with the correct Content-Type.
 *  Uses a web-standard Response to ensure the header survives
 *  Nitro dev mode's mock-node-response pipeline. */
function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Shared markup for OAuth success "close this tab" pages. Renders a green
 *  check icon above the message, with a little breathing room between the
 *  headline and secondary line. Used by every template that goes through the
 *  shared Google OAuth flow. */
function oauthDebugFlowId(flowId?: string): string | undefined {
  return flowId ? flowId.slice(-10) : undefined;
}

function oauthSuccessCloseTabHtml(
  headline: string,
  footnote: string,
  debugFlowId?: string,
): string {
  const debug = debugFlowId
    ? `<p style="font-size:11px;color:#555;margin:12px 0 0 0">Debug flow: ${escapeHtml(debugFlowId)}</p>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2l4 -4"/></svg><p style="font-size:16px;margin:0 0 12px 0">${headline}</p><p style="font-size:13px;color:#888;margin:0">${footnote}</p>${debug}<script>console.info("[agent-native][google-oauth] success page loaded",{flow:${JSON.stringify(debugFlowId || null)}});setTimeout(function(){try{window.close()}catch(e){}},250)</script></body></html>`;
}

/**
 * HTML escape — minimal but covers the cases that matter when interpolating
 * user-controlled values into our OAuth callback HTML. Mirrors the helper in
 * email-template.ts; kept inline here to avoid a circular import.
 */
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Detect requests from the Agent Native desktop app specifically.
 *
 * The desktop app appends `AgentNativeDesktop/<version>` to its user-agent
 * (see `packages/desktop-app/src/main/index.ts`). We check for that marker
 * rather than matching generic `Electron`, which would also match other
 * Electron-based webviews like Builder.io's Fusion, Slack desktop, Discord,
 * etc. Falsely treating those as "the desktop app" sends users to the
 * `agentnative://oauth-complete` deep-link success page after Google sign-in,
 * where the protocol handler can't fire and the "Open Agent Native" button
 * does nothing.
 *
 * Kept exported as `isElectron` for backwards compatibility with consumers.
 */
export function isElectron(event: H3Event): boolean {
  return /AgentNativeDesktop/i.test(getHeader(event, "user-agent") || "");
}

/** Detect requests from a mobile browser (iOS/Android). */
export function isMobile(event: H3Event): boolean {
  return /iPhone|iPad|iPod|Android/i.test(getHeader(event, "user-agent") || "");
}

/**
 * Build the static allowlist of origins we trust for `getOrigin`. Reads
 * deployment-known public URLs. Each entry is normalised to
 * `${proto}://${host}` (no path). Duplicates collapse, invalid entries are
 * dropped silently.
 */
const EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS = [
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "APP_URL",
  "VITE_APP_URL",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "URL",
  "DEPLOY_URL",
] as const;

const WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS = [
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
] as const;

function normalizeOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

function addNormalizedOrigin(
  out: Set<string>,
  raw: string | undefined,
  options: { allowLoopback: boolean },
): void {
  const origin = normalizeOrigin(raw);
  if (!origin) return;
  if (!options.allowLoopback && isLoopbackOrigin(origin)) return;
  out.add(origin);
}

function firstOriginFromEnv(
  keys: readonly string[],
  options: { allowLoopback: boolean },
): string | undefined {
  for (const key of keys) {
    const origin = normalizeOrigin(process.env[key]);
    if (!origin) continue;
    if (!options.allowLoopback && isLoopbackOrigin(origin)) continue;
    return origin;
  }
  return undefined;
}

function getConfiguredOriginAllowlist(): Set<string> {
  const out = new Set<string>();
  for (const key of EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS) {
    addNormalizedOrigin(out, process.env[key], { allowLoopback: true });
  }
  for (const key of WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS) {
    addNormalizedOrigin(out, process.env[key], { allowLoopback: false });
  }
  return out;
}

function firstConfiguredOrigin(): string | undefined {
  return [...getConfiguredOriginAllowlist()][0];
}

function getWorkspaceCallbackOrigin(): string | undefined {
  const publicAuthOrigin = firstOriginFromEnv(EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS, {
    allowLoopback: true,
  });
  if (publicAuthOrigin) return publicAuthOrigin;

  return firstOriginFromEnv(WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS, {
    allowLoopback: false,
  });
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}

function isBuilderPreviewHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "builderio.xyz" ||
      hostname.endsWith(".builderio.xyz") ||
      hostname === "builderio.dev" ||
      hostname.endsWith(".builderio.dev") ||
      hostname === "builder.codes" ||
      hostname.endsWith(".builder.codes") ||
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my")
    );
  } catch {
    return false;
  }
}

/**
 * Get the origin from forwarded headers or Host.
 *
 * Defends against Host-header injection: in production we require the resolved
 * origin to match `APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_GATEWAY_URL`,
 * falling back to those values when inbound headers are missing or don't match.
 * In dev we accept inbound `Host` so localhost / ngrok / preview hosts keep
 * working without configuration, except workspace OAuth requests from loopback
 * or Builder preview hosts use the configured gateway origin when one exists.
 * The protocol defaults to `https` in production (so a TLS-terminating proxy
 * that drops `x-forwarded-proto` doesn't downgrade us to plain HTTP).
 */
export function getOrigin(event: H3Event): string {
  const headerHost =
    getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const isProd = process.env.NODE_ENV === "production";
  const headerProto =
    getHeader(event, "x-forwarded-proto") || (isProd ? "https" : "http");
  const workspaceCallbackOrigin = isWorkspaceOAuthCallbackRelayEnabled()
    ? getWorkspaceCallbackOrigin()
    : undefined;

  if (
    workspaceCallbackOrigin &&
    (isLoopbackHost(headerHost) || isBuilderPreviewHost(headerHost))
  ) {
    return workspaceCallbackOrigin;
  }

  if (isProd) {
    const allow = getConfiguredOriginAllowlist();
    // If the deploy declares its public URL, prefer it over inbound headers.
    if (allow.size > 0) {
      const inbound = headerHost ? `${headerProto}://${headerHost}` : "";
      if (inbound && allow.has(inbound)) return inbound;
      // Inbound didn't match — fall back to the first configured origin.
      return [...allow][0];
    }
    // No allowlist configured: still default to https, but accept the
    // inbound Host (best we can do without a configured base URL).
    return `${headerProto}://${headerHost ?? ""}`;
  }

  return `${headerProto}://${headerHost ?? "localhost"}`;
}

function normalizeAppBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

/** App mount prefix, if the template is served under APP_BASE_PATH. */
export function getAppBasePath(): string {
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

/** Build an absolute same-origin URL that preserves APP_BASE_PATH. */
export function getAppUrl(event: H3Event, path = "/"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${getOrigin(event)}${getAppBasePath()}${cleanPath}`;
}

function isWorkspaceOAuthCallbackRelayEnabled(): boolean {
  return (
    process.env.AGENT_NATIVE_WORKSPACE === "1" ||
    process.env.VITE_AGENT_NATIVE_WORKSPACE === "1"
  );
}

function isFrameworkOAuthCallbackPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_agent-native/") &&
    (pathname.endsWith("/callback") || pathname.includes("/callback/"))
  );
}

function getOriginalRequestPath(event: H3Event): string {
  const mountedPathname = (event as any).context?._mountedPathname;
  if (typeof mountedPathname === "string" && mountedPathname) {
    return mountedPathname;
  }

  const urlPathname = (event as any).url?.pathname;
  if (typeof urlPathname === "string" && urlPathname) return urlPathname;

  const nodeUrl = event.node?.req?.url;
  if (typeof nodeUrl === "string" && nodeUrl) {
    const queryStart = nodeUrl.indexOf("?");
    return queryStart >= 0 ? nodeUrl.slice(0, queryStart) : nodeUrl;
  }

  const eventPath = (event as any).path;
  if (typeof eventPath === "string" && eventPath) {
    const queryStart = eventPath.indexOf("?");
    return queryStart >= 0 ? eventPath.slice(0, queryStart) : eventPath;
  }

  return "/";
}

function isRequestUnderAppBasePath(event: H3Event): boolean {
  const basePath = getAppBasePath();
  if (!basePath) return false;
  const requestPath = getOriginalRequestPath(event);
  return (
    requestPath === `${basePath}/_agent-native` ||
    requestPath.startsWith(`${basePath}/_agent-native/`)
  );
}

function getDefaultOAuthRedirectUrl(event: H3Event, path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (
    isWorkspaceOAuthCallbackRelayEnabled() &&
    isFrameworkOAuthCallbackPath(cleanPath)
  ) {
    return `${getOrigin(event)}${cleanPath}`;
  }
  const basePath = isRequestUnderAppBasePath(event) ? getAppBasePath() : "";
  return `${getOrigin(event)}${basePath}${cleanPath}`;
}

// ─── redirect_uri Allowlist ──────────────────────────────────────────────────

/**
 * Validate a user-supplied `redirect_uri` for OAuth flows.
 *
 * Defends against authorization-code interception (RFC 6819 §4.4.1.7):
 * even though the upstream provider (Google/Atlassian/Zoom) refuses
 * unregistered redirect URIs, prefix-style registrations and side
 * registrations on the same host let a malicious caller swap in an
 * attacker-controlled URI that the provider still accepts. We reject any
 * candidate that isn't on this server's own origin AND under the
 * framework's `/_agent-native/` namespace. Returns the validated URI on
 * success, or `undefined` on rejection — callers must treat `undefined`
 * as a 400.
 *
 * The intentional shape is exact-prefix:
 *   - Origin must equal `getOrigin(event)` — no Host-header injection
 *     reusing somebody else's registered redirect URI.
 *   - Path must start with `${appBasePath}/_agent-native/` so we never
 *     hand auth codes to a public marketing or open-redirect endpoint
 *     on the same registered host.
 *
 * For desktop / native flows that need ephemeral `http://127.0.0.1:<port>`
 * loopback URIs, callers should validate those at the template level
 * with a dedicated allowlist — this helper rejects them by design.
 */
export function isAllowedOAuthRedirectUri(
  candidate: string,
  event: H3Event,
): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  // Must be same origin as our server.
  const expectedOrigin = getOrigin(event);
  let expectedUrl: URL;
  try {
    expectedUrl = new URL(expectedOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== expectedUrl.protocol) return false;
  if (url.host !== expectedUrl.host) return false;
  // Must live under the framework's namespace. Workspace deploys can route
  // root /_agent-native/* to Dispatch even when Dispatch itself is mounted at
  // /dispatch, but app-prefixed requests should not be able to swap their
  // callback to that root namespace.
  const basePath = getAppBasePath();
  const allowedPrefixes =
    basePath && isRequestUnderAppBasePath(event)
      ? [
          `${basePath}/_agent-native/`,
          ...(isWorkspaceOAuthCallbackRelayEnabled() &&
          isFrameworkOAuthCallbackPath(url.pathname)
            ? ["/_agent-native/"]
            : []),
        ]
      : ["/_agent-native/"];
  if (!allowedPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    return false;
  }
  return true;
}

/**
 * Resolve the `redirect_uri` for an outbound OAuth `auth-url` request.
 *
 * Reads `?redirect_uri=` from the query and validates it via
 * `isAllowedOAuthRedirectUri`. Returns:
 *   - the validated URI when supplied and allowed, OR
 *   - the framework default when no override was supplied, OR
 *   - `null` when an override was supplied but rejected — callers must
 *     respond with 400 in that case.
 *
 * Templates that need a non-default redirect path can pass it via
 * `defaultPath` (e.g. `"/_agent-native/google/desktop-callback"` for
 * desktop flows).
 */
export function resolveOAuthRedirectUri(
  event: H3Event,
  defaultPath = "/_agent-native/google/callback",
): string | null {
  const supplied = getQuery(event).redirect_uri;
  if (typeof supplied === "string" && supplied.length > 0) {
    return isAllowedOAuthRedirectUri(supplied, event) ? supplied : null;
  }
  return getDefaultOAuthRedirectUrl(event, defaultPath);
}

// ─── OAuth State ─────────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  redirectUri: string;
  owner?: string;
  desktop?: boolean;
  addAccount?: boolean;
  app?: string;
  /**
   * Same-origin path to redirect to after a successful web-flow sign-in.
   * Threaded through the (HMAC-signed) state so it survives the round trip
   * to Google. Validated again on decode via safeReturnPath as defence in
   * depth. Has no effect on desktop / mobile / add-account flows, which
   * use their own deep-link / close-tab handling.
   */
  returnUrl?: string;
  flowId?: string;
}

/**
 * Ephemeral in-memory state-signing key for development. Generated lazily
 * on first read so dev sessions don't depend on filesystem writability or
 * env-var configuration. Sessions reset on each restart, which is fine
 * for dev — no real users / production data are involved.
 */
let _devStateSigningKey: string | undefined;

/**
 * Derive a server-only signing key for HMAC verification of OAuth state.
 *
 * Uses a dedicated secret — never an OAuth client secret. Reusing a
 * client_secret (which is shared with Google / GitHub / Atlassian) as our
 * own HMAC key conflates two trust domains: rotating the client secret
 * silently invalidates every in-flight OAuth state, and any leak of the
 * client secret also lets an attacker forge our state envelopes.
 *
 * Resolution order:
 *   1. OAUTH_STATE_SECRET (preferred — dedicated to this purpose)
 *   2. BETTER_AUTH_SECRET (already used by Better Auth as a server secret)
 *   3. Hosted workspace deploys derive a per-purpose key from A2A_SECRET
 *   4. In dev only, an ephemeral random key (per-process)
 *
 * In production, throws if no usable server secret is set.
 */
function getStateSigningKey(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    getWorkspaceA2ADerivedSecret("oauth-state");
  if (secret) return secret;

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    throw new Error(
      "OAuth state signing requires a server secret. " +
        "Set OAUTH_STATE_SECRET, BETTER_AUTH_SECRET, or A2A_SECRET in production workspace deploys.",
    );
  }

  if (!_devStateSigningKey) {
    _devStateSigningKey = crypto.randomBytes(32).toString("hex");
  }
  return _devStateSigningKey;
}

/**
 * Options for the named-argument form of {@link encodeOAuthState}.
 * Prefer this form — the positional overload is easy to misuse (the mail
 * and calendar templates historically passed `flowId` in the `returnUrl`
 * slot, smuggling state into a defence-in-depth path).
 */
export interface EncodeOAuthStateOptions {
  redirectUri: string;
  owner?: string;
  desktop?: boolean;
  addAccount?: boolean;
  app?: string;
  returnUrl?: string;
  flowId?: string;
}

/**
 * Encode OAuth state into a signed base64url string.
 * The state is HMAC-signed so the callback can verify it wasn't forged,
 * preventing CSRF attacks on the OAuth flow.
 *
 * Two call shapes are supported:
 *   - Recommended: pass an options object — clear, mismatch-proof.
 *     `encodeOAuthState({ redirectUri, owner, desktop, ... })`
 *   - Legacy positional form (kept working for backward compatibility):
 *     `encodeOAuthState(redirectUri, owner, desktop, addAccount, app, returnUrl, flowId)`.
 *     Callers should migrate to the options form — see the audit on
 *     templates/mail and templates/calendar where the positional shape
 *     led to `flowId` being smuggled in via the `returnUrl` slot.
 */
export function encodeOAuthState(opts: EncodeOAuthStateOptions): string;
export function encodeOAuthState(
  redirectUri: string,
  owner?: string,
  desktop?: boolean,
  addAccount?: boolean,
  app?: string,
  returnUrl?: string,
  flowId?: string,
): string;
export function encodeOAuthState(
  redirectUriOrOpts: string | EncodeOAuthStateOptions,
  owner?: string,
  desktop?: boolean,
  addAccount?: boolean,
  app?: string,
  returnUrl?: string,
  flowId?: string,
): string {
  const opts: EncodeOAuthStateOptions =
    typeof redirectUriOrOpts === "string"
      ? {
          redirectUri: redirectUriOrOpts,
          owner,
          desktop,
          addAccount,
          app,
          returnUrl,
          flowId,
        }
      : redirectUriOrOpts;

  const nonce = crypto.randomBytes(8).toString("hex");
  const payload: Record<string, string | boolean> = {
    n: nonce,
    r: opts.redirectUri,
  };
  if (opts.owner) payload.o = opts.owner;
  if (opts.desktop) payload.d = true;
  if (opts.addAccount) payload.a = true;
  if (opts.app) payload.app = opts.app;
  if (opts.returnUrl) payload.r2 = opts.returnUrl;
  if (opts.flowId) payload.f = opts.flowId;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getStateSigningKey())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Decode and verify OAuth state from the callback's state query parameter.
 * Rejects forged or tampered state by checking the HMAC signature.
 * Falls back to the provided URI if decoding or verification fails.
 */
export function decodeOAuthState(
  stateParam: string | undefined,
  fallbackUri: string,
): OAuthStatePayload {
  if (stateParam) {
    try {
      const dotIdx = stateParam.lastIndexOf(".");
      if (dotIdx === -1) return { redirectUri: fallbackUri };

      const data = stateParam.slice(0, dotIdx);
      const sig = stateParam.slice(dotIdx + 1);
      const expected = crypto
        .createHmac("sha256", getStateSigningKey())
        .update(data)
        .digest("base64url");

      if (
        sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      ) {
        return { redirectUri: fallbackUri };
      }

      const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
      return {
        redirectUri: parsed.r || fallbackUri,
        owner: parsed.o || undefined,
        desktop: !!parsed.d,
        addAccount: !!parsed.a,
        app: typeof parsed.app === "string" ? parsed.app : undefined,
        // Pass returnUrl through as-is — same-origin validation runs at the
        // consumer (oauthCallbackResponse → safeReturnPath). The state is
        // HMAC-signed, but we still validate at consumption as defence in
        // depth in case the signing key ever leaks.
        returnUrl: typeof parsed.r2 === "string" ? parsed.r2 : undefined,
        flowId: parsed.f || undefined,
      };
    } catch {}
  }
  return { redirectUri: fallbackUri };
}

// ─── Session Creation ────────────────────────────────────────────────────────

export interface OAuthOwnerResult {
  owner: string | undefined;
  hasProductionSession: boolean;
}

/**
 * Determine the token owner from the current session and OAuth state.
 * Call this BEFORE exchangeCode to get the owner parameter.
 */
export async function resolveOAuthOwner(
  event: H3Event,
  stateOwner?: string,
): Promise<OAuthOwnerResult> {
  const existingSession = await getSession(event);
  const hasProductionSession = !!existingSession?.email;
  const owner = hasProductionSession
    ? existingSession!.email
    : stateOwner || undefined;

  return { owner, hasProductionSession };
}

export interface OAuthSessionResult {
  sessionToken: string | undefined;
}

/**
 * Create a session token after a successful OAuth exchange.
 *
 * Desktop and mobile apps have separate cookie jars from the system
 * browser, so they always get a fresh session token (even if the browser
 * already has one). The token is then passed via deep link so the native
 * app can inject it.
 */
export async function createOAuthSession(
  event: H3Event,
  email: string,
  opts: {
    hasProductionSession: boolean;
    desktop?: boolean;
  },
): Promise<OAuthSessionResult> {
  const mobile = isMobile(event);
  const needsDeepLink = opts.desktop || mobile;
  const maxAge = getSessionMaxAge();

  let sessionToken: string | undefined;
  if (!opts.hasProductionSession || needsDeepLink) {
    sessionToken = crypto.randomBytes(32).toString("hex");
    await addSession(sessionToken, email);
    setFrameworkSessionCookie(event, sessionToken);
    // Desktop SSO: record this session in the home-dir broker file so
    // sibling templates (each with its own database) can resolve the
    // same token without a DB row of their own. Only the PRIMARY
    // sign-in writes the broker — if a production session already
    // exists, this is an add-account flow (connecting a secondary
    // Google account for scraping) and must never switch the active
    // user across sibling templates.
    if (opts.desktop && !opts.hasProductionSession) {
      await writeDesktopSso({
        email,
        token: sessionToken,
        expiresAt: Date.now() + maxAge * 1000,
      });
    }
  }

  return { sessionToken };
}

// ─── Callback Responses ──────────────────────────────────────────────────────

/**
 * Return the appropriate response after a successful OAuth callback.
 *
 * Handles mobile deep links, desktop deep links, add-account close-tab
 * pages, and plain web redirects — so templates don't have to.
 */
export function oauthCallbackResponse(
  event: H3Event,
  email: string,
  opts: {
    sessionToken?: string;
    desktop?: boolean;
    addAccount?: boolean;
    /**
     * Same-origin path to return the viewer to after a successful web
     * sign-in. Validated via safeReturnPath; falls back to "/" for any
     * shape that escapes same-origin. Has no effect on desktop / mobile
     * / add-account flows — those use their own deep-link handling.
     */
    returnUrl?: string;
    flowId?: string;
    appName?: string;
  },
): Response | string | unknown | Promise<Response | string | unknown> {
  const mobile = isMobile(event);
  const query = getQuery(event);
  const callbackState =
    typeof query.state === "string" && query.state.length > 0
      ? query.state
      : undefined;

  // Mobile: deep link back to native app
  if (mobile) {
    const deepLink = buildOAuthCompleteDeepLink(
      opts.sessionToken,
      callbackState,
    );
    return htmlResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><title>Connected</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to app…</p><script>window.location.href=${JSON.stringify(deepLink)};setTimeout(function(){window.location.href="/"},1500)</script></body></html>`,
    );
  }

  // Desktop add-account: close-tab page (must come before general desktop check
  // to ensure no deep link fires and the existing session is never switched).
  if (opts.desktop && opts.addAccount) {
    const safeEmail = email ? escapeHtml(email) : "";
    const safeAppName = escapeHtml(resolveOAuthAppName(opts.appName));
    const msg = safeEmail ? `Connected ${safeEmail}!` : "Connected!";
    return htmlResponse(
      oauthSuccessCloseTabHtml(
        msg,
        `You can close this tab and return to ${safeAppName}.`,
        oauthDebugFlowId(opts.flowId),
      ),
    );
  }

  // Electron desktop exchange flow: mail/calendar still pass a flow id so the
  // renderer can poll as a fallback, but the main handoff should use the
  // protocol deep link so the popup returns focus to the desktop app.
  if (opts.desktop && opts.flowId && isElectron(event) && opts.sessionToken) {
    return desktopSuccessPage(event, email, opts.sessionToken, callbackState);
  }

  // Desktop exchange flow (non-Electron tray app): the tray app polls the
  // desktop-exchange endpoint for the token — no deep link needed.
  if (opts.desktop && opts.flowId) {
    const safeEmail = email ? escapeHtml(email) : "";
    const safeAppName = escapeHtml(resolveOAuthAppName(opts.appName));
    const msg = safeEmail ? `Signed in as ${safeEmail}!` : "Signed in!";
    return htmlResponse(
      oauthSuccessCloseTabHtml(
        msg,
        `You can close this tab and return to ${safeAppName}.`,
        oauthDebugFlowId(opts.flowId),
      ),
    );
  }

  // Desktop login: deep link back to Electron app — only when the callback
  // request actually carries the AgentNativeDesktop UA marker. Without this
  // check, any client whose OAuth state was minted with `desktop=true` (e.g.
  // a stale link, or an upstream that wrongly set `?desktop=1`) would land
  // on the `agentnative://` page where the deep link can't fire and the
  // "Open Agent Native" button does nothing — surfaces inside Builder.io's
  // Fusion webview hit this exact dead-end. Fall through to the web flow
  // for non-Agent-Native-Desktop clients so they get a real redirect.
  if (opts.desktop && isElectron(event)) {
    return desktopSuccessPage(event, email, opts.sessionToken, callbackState);
  }

  // Add-account web flow: close-tab page. The email is rendered into the
  // page via DOM `textContent` (safe), but we still JSON-stringify so a
  // payload containing `</script>` can't break out of the script tag —
  // and explicitly assert it's a string so a callbacks like `null` or
  // an object won't end up serialised into the page.
  if (opts.addAccount) {
    const safeEmail = JSON.stringify(typeof email === "string" ? email : "");
    return htmlResponse(`<!DOCTYPE html><html><body><script>
        window.close();
        var p = document.createElement('p');
        p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
        p.textContent = 'Connected ' + ${safeEmail} + '! You can close this tab.';
        document.body.appendChild(p);
      </script></body></html>`);
  }

  // Web: redirect to the requested return target. Path-only returns stay
  // same-origin; Builder desktop workspace returns may point back to the
  // local loopback gateway and carry the short-lived `_session` bridge so
  // the local app can promote the newly created hosted OAuth session.
  setResponseStatus(event, 302);
  setResponseHeader(
    event,
    "Location",
    appendSessionToOAuthReturnUrl(opts.returnUrl, opts.sessionToken),
  );
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  return "";
}

/** HTML error page for OAuth failures. The message is HTML-escaped — most
 *  callers pass `error.message` from a token-exchange or userinfo failure,
 *  which can echo upstream provider strings (and historically attacker-
 *  controlled query params via the `error_description` field). */
export function oauthErrorPage(message: string): Response {
  const safe = escapeHtml(message);
  return htmlResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connection failed</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;text-align:center"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg><p style="font-size:16px;margin:0 0 12px 0;color:#ddd">${safe}</p><p style="font-size:13px;color:#888;margin:0"><a href="/" style="color:#888;text-decoration:underline;text-underline-offset:3px">Back to login</a></p></body></html>`,
    400,
  );
}

export function oauthDesktopExchangePage(
  message = "Returning to the app...",
): Response {
  const safe = escapeHtml(message);
  return htmlResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Returning</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="font-size:14px">${safe}</p><script>window.close()</script></body></html>`,
  );
}

// ─── Internal ────────────────────────────────────────────────────────────────

function resolveOAuthAppName(explicit?: string): string {
  const raw = explicit || getAppName() || "Agent Native";
  if (!/^[a-z0-9_-]+$/.test(raw)) return raw;
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function buildOAuthCompleteDeepLink(
  sessionToken?: string,
  state?: string,
): string {
  const params = new URLSearchParams();
  if (sessionToken) params.set("token", sessionToken);
  if (state) params.set("state", state);
  const suffix = params.toString();
  return suffix
    ? `agentnative://oauth-complete?${suffix}`
    : "agentnative://oauth-complete";
}

function desktopSuccessPage(
  _event: H3Event,
  email?: string,
  sessionToken?: string,
  state?: string,
): Response {
  const safeEmail = email ? escapeHtml(email) : "";
  const msg = safeEmail ? `Connected ${safeEmail}!` : "Connected!";
  if (sessionToken) {
    const deepLink = buildOAuthCompleteDeepLink(sessionToken, state);
    const deepLinkJson = JSON.stringify(deepLink);
    // Defence in depth: if this page somehow gets served to a UA that isn't
    // the Agent Native desktop app (server gate bypassed, stale link, etc.),
    // skip the `agentnative://` deep link entirely and bounce to the app
    // root. The deep link silently fails outside the desktop app and the
    // "Open Agent Native" button is a dead end in a generic browser/webview.
    return htmlResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title><style>@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}.spinner{width:28px;height:28px;border:2px solid #333;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.fallback{display:none;flex-direction:column;align-items:center;gap:8px;animation:fadeIn .2s ease-out}.fallback.show{display:flex}</style></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px"><p style="font-size:16px;margin:0">${msg}</p><div id="loading" class="spinner"></div><div id="fallback" class="fallback"><a href=${deepLinkJson} style="display:inline-block;padding:10px 24px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Agent Native</a><p style="font-size:12px;color:#666;margin:0">If the app didn\u2019t open automatically, click the button above.</p></div><script>(function(){var ua=(navigator.userAgent||"");if(ua.indexOf("AgentNativeDesktop")===-1){window.location.replace("/");return}window.location.href=${deepLinkJson};setTimeout(function(){document.getElementById("loading").style.display="none";document.getElementById("fallback").classList.add("show")},3000)})()</script></body></html>`,
    );
  }
  return htmlResponse(
    oauthSuccessCloseTabHtml(
      msg,
      "You can close this tab and return to Agent Native.",
    ),
  );
}
