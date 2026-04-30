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
  setCookie,
  sendRedirect,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import {
  addSession,
  getSession,
  COOKIE_NAME,
  getSessionMaxAge,
  safeReturnPath,
} from "./auth.js";
import { writeDesktopSso } from "./desktop-sso.js";

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

/** Detect requests from the Electron desktop app webview. */
export function isElectron(event: H3Event): boolean {
  return /Electron/i.test(getHeader(event, "user-agent") || "");
}

/** Detect requests from a mobile browser (iOS/Android). */
export function isMobile(event: H3Event): boolean {
  return /iPhone|iPad|iPod|Android/i.test(getHeader(event, "user-agent") || "");
}

/**
 * Build the static allowlist of origins we trust for `getOrigin`. Reads
 * `APP_URL` and `BETTER_AUTH_URL` (both are deployment-known public URLs).
 * Each entry is normalised to `${proto}://${host}` (no path). Duplicates
 * collapse, invalid entries are dropped silently.
 */
function getConfiguredOriginAllowlist(): Set<string> {
  const out = new Set<string>();
  for (const raw of [process.env.APP_URL, process.env.BETTER_AUTH_URL]) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      out.add(`${u.protocol}//${u.host}`);
    } catch {
      // Ignore — env value isn't a parseable URL.
    }
  }
  return out;
}

/**
 * Get the origin from forwarded headers or Host.
 *
 * Defends against Host-header injection: in production we require the
 * resolved origin to match `APP_URL` / `BETTER_AUTH_URL`, falling back to
 * those values when the inbound headers are missing or don't match. In
 * dev we accept the inbound `Host` so localhost / ngrok / preview hosts
 * keep working without configuration. The protocol defaults to `https`
 * in production (so a TLS-terminating proxy that drops `x-forwarded-proto`
 * doesn't downgrade us to plain HTTP).
 */
export function getOrigin(event: H3Event): string {
  const headerHost =
    getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const isProd = process.env.NODE_ENV === "production";
  const headerProto =
    getHeader(event, "x-forwarded-proto") || (isProd ? "https" : "http");

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
  // Must live under the framework's namespace.
  const basePath = getAppBasePath();
  const required = `${basePath}/_agent-native/`;
  if (!url.pathname.startsWith(required)) return false;
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
  return getAppUrl(event, defaultPath);
}

// ─── OAuth State ─────────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  redirectUri: string;
  owner?: string;
  desktop?: boolean;
  addAccount?: boolean;
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
 *   3. In dev only, an ephemeral random key (per-process)
 *
 * In production, throws if neither secret is set.
 */
function getStateSigningKey(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    throw new Error(
      "OAuth state signing requires a server secret. " +
        "Set OAUTH_STATE_SECRET or BETTER_AUTH_SECRET in production.",
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
  isDevSession: boolean;
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
  const isDevSession = existingSession?.email === "local@localhost";
  const hasProductionSession = !!(existingSession?.email && !isDevSession);

  // Never use "local@localhost" as a token owner — it creates shared-ownership
  // bugs where multiple users can see the same tokens.
  const owner = hasProductionSession
    ? existingSession!.email
    : stateOwner || undefined;

  return { owner, isDevSession, hasProductionSession };
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
    setCookie(event, COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
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
  },
): Response | string | void | Promise<Response | string | void> {
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
    const msg = email ? `Connected ${email}!` : "Connected!";
    return htmlResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${msg}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`,
    );
  }

  // Desktop exchange flow (Tauri tray app): the tray app polls the
  // desktop-exchange endpoint for the token — no deep link needed.
  if (opts.desktop && opts.flowId) {
    const msg = email ? `Signed in as ${email}!` : "Signed in!";
    return htmlResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${msg}</p><p style="font-size:13px;color:#888">You can close this tab and return to Clips.</p></body></html>`,
    );
  }

  // Desktop login: deep link back to Electron app
  if (opts.desktop) {
    return desktopSuccessPage(event, email, opts.sessionToken, callbackState);
  }

  // Add-account web flow: close-tab page
  if (opts.addAccount) {
    const safeEmail = JSON.stringify(email);
    return htmlResponse(`<!DOCTYPE html><html><body><script>
        window.close();
        var p = document.createElement('p');
        p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
        p.textContent = 'Connected ' + ${safeEmail} + '! You can close this tab.';
        document.body.appendChild(p);
      </script></body></html>`);
  }

  // Web: redirect to the requested return path (validated same-origin) or
  // "/" if no return was supplied / the return failed validation.
  // Use h3's native redirect (not web Response) to preserve Set-Cookie headers
  // from createOAuthSession — a raw `new Response()` drops them.
  setResponseStatus(event, 302);
  setResponseHeader(event, "Location", safeReturnPath(opts.returnUrl));
  return "";
}

/** HTML error page for OAuth failures. */
export function oauthErrorPage(message: string): Response {
  return htmlResponse(
    `<!DOCTYPE html><html><body>
    <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
      <p style="font-size:15px;color:#e55">${message}</p>
      <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
    </div>
  </body></html>`,
    400,
  );
}

// ─── Internal ────────────────────────────────────────────────────────────────

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
  const msg = email ? `Connected ${email}!` : "Connected!";
  if (sessionToken) {
    const deepLink = buildOAuthCompleteDeepLink(sessionToken, state);
    const deepLinkJson = JSON.stringify(deepLink);
    return htmlResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title><style>@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}.spinner{width:28px;height:28px;border:2px solid #333;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.fallback{display:none;flex-direction:column;align-items:center;gap:8px;animation:fadeIn .2s ease-out}.fallback.show{display:flex}</style></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px"><p style="font-size:16px;margin:0">${msg}</p><div id="loading" class="spinner"></div><div id="fallback" class="fallback"><a href=${deepLinkJson} style="display:inline-block;padding:10px 24px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Agent Native</a><p style="font-size:12px;color:#666;margin:0">If the app didn\u2019t open automatically, click the button above.</p></div><script>window.location.href=${deepLinkJson};setTimeout(function(){document.getElementById("loading").style.display="none";document.getElementById("fallback").classList.add("show")},3000)</script></body></html>`,
    );
  }
  return htmlResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${msg}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`,
  );
}
