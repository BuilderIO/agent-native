
import crypto from "node:crypto";

import {
  getHeader,
  getQuery,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";

import { getAppConfig } from "../app-config/index.js";
import { normalizeAnalyticsAnonymousId } from "../shared/analytics-anonymous-id.js";
import { normalizeAppPath } from "../shared/sign-in-journey.js";
import { getAppBasePathFromViteEnv } from "./app-base-path.js";
import {
  readAnalyticsAnonymousId,
  signupAttributionFromCookieHeader,
} from "./attribution.js";
import {
  getBetterAuthUserIdForEmail,
  hasBetterAuthUserEmail,
  trackSignupEvent,
} from "./better-auth-instance.js";
import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";
import { writeDesktopSso } from "./desktop-sso.js";
import { getPublicFrameworkPathname } from "./framework-request-context.js";
import {
  canonicalFrameworkPathname,
  isRetiredInternalFrameworkPath,
  publicFrameworkPath,
} from "./framework-route-prefix.js";
import { setIdentityGoogleAuthCookie } from "./identity-auth-provider.js";
import {
  isNetlifyDeployPermalinkGoogleOAuthClientOrigin,
  isNetlifyDeployPermalinkGoogleOAuthClientRequest,
} from "./identity-sso-store.js";
import { appendSessionToOAuthReturnUrl } from "./oauth-return-url.js";
import {
  EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS,
  firstOriginFromEnv,
  getConfiguredOriginAllowlist,
  isLoopbackHost,
  normalizeOrigin,
  WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS,
} from "./origin-allowlist.js";
import { isWorkspaceOAuthCallbackRelayEnabled } from "./workspace-oauth.js";

function safeReturnPath(raw: string | null | undefined): string {
  return normalizeAppPath(raw) ?? "/";
}


function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

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

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isElectron(event: H3Event): boolean {
  return /AgentNativeDesktop/i.test(getHeader(event, "user-agent") || "");
}

function getDesktopOAuthProtocol(
  event: H3Event,
): "agentnative" | "agentnative-nightly" {
  return /AgentNativeDesktopNightly/i.test(getHeader(event, "user-agent") || "")
    ? "agentnative-nightly"
    : "agentnative";
}

export function isMobile(event: H3Event): boolean {
  return /iPhone|iPad|iPod|Android/i.test(getHeader(event, "user-agent") || "");
}

export function isConfiguredAppOrigin(value: string | undefined): boolean {
  const origin = normalizeOrigin(value);
  return !!origin && getConfiguredOriginAllowlist().has(origin);
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
    // coercion-ok: malformed callback URLs are rejected as invalid input.
    return false;
  }
}

export function getOrigin(
  event: H3Event,
  options: { useForwardedHost?: boolean } = {},
): string {
  const headerHost =
    options.useForwardedHost === false
      ? getHeader(event, "host")
      : getHeader(event, "x-forwarded-host") || getHeader(event, "host");
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
    if (allow.size > 0) {
      const inbound = headerHost ? `${headerProto}://${headerHost}` : "";
      if (inbound && allow.has(inbound)) return inbound;
      return [...allow][0];
    }
    return `${headerProto}://${headerHost ?? ""}`;
  }

  return `${headerProto}://${headerHost ?? "localhost"}`;
}

export function getAppBasePath(): string {
  return getAppBasePathFromViteEnv();
}

export function getAppUrl(event: H3Event, path = "/"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${getOrigin(event)}${getAppBasePath()}${publicFrameworkPath(cleanPath)}`;
}

export const NETLIFY_PREVIEW_GOOGLE_OAUTH_CALLBACK_URL =
  "https://beta.dispatch.agent-native.com/_agent-native/google/callback";
export const AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV =
  "AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET";
export const NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX =
  "agent-native-preview-google-relay.";
const NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_TTL_MS = 10 * 60 * 1000;
const NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_CLOCK_SKEW_MS = 2 * 60 * 1000;
const NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_MAX_LENGTH = 32 * 1024;
const NETLIFY_PREVIEW_GOOGLE_OAUTH_CALLBACK_PATH_RE =
  /^(?:\/[a-z0-9-]+)?\/_agent-native\/google\/(?:add-account\/)?callback$/;

function isNetlifyPreviewGoogleOAuthCallbackPath(path: string): boolean {
  return NETLIFY_PREVIEW_GOOGLE_OAUTH_CALLBACK_PATH_RE.test(path);
}

export function getNetlifyPreviewGoogleOAuthCallbackUrl(
  event: H3Event,
  path = "/_agent-native/google/callback",
): string | undefined {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const host = getHeader(event, "host")?.trim().toLowerCase();
  if (
    !host ||
    !isNetlifyPreviewGoogleOAuthCallbackPath(cleanPath) ||
    !isNetlifyDeployPermalinkGoogleOAuthClientRequest(
      host,
      getHeader(event, "x-forwarded-proto"),
    )
  ) {
    return undefined;
  }
  const basePath = isRequestUnderAppBasePath(event) ? getAppBasePath() : "";
  return `https://${host}${basePath}${cleanPath}`;
}

export function isNetlifyPreviewGoogleOAuthCallbackUrl(
  value: string | undefined,
): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      `${url.origin}${url.pathname}` === value &&
      isNetlifyDeployPermalinkGoogleOAuthClientOrigin(url.origin) &&
      isNetlifyPreviewGoogleOAuthCallbackPath(url.pathname)
    );
  } catch {
    // coercion-ok: malformed callback URLs are rejected as invalid input.
    return false;
  }
}

export function isNetlifyPreviewGoogleOAuthRelayState(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_MAX_LENGTH &&
    value.startsWith(NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX)
  );
}

function getNetlifyPreviewGoogleOAuthRelaySigningKey(): string {
  const secret =
    process.env[AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(
      `${AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV} is required for the Netlify preview Google OAuth relay.`,
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `${AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV} must be at least 32 characters long.`,
    );
  }
  return secret;
}

export function encodeNetlifyPreviewGoogleOAuthRelayState(
  state: string,
  callbackUri: string,
  now = Date.now(),
): string {
  if (
    !state ||
    state.length > 16 * 1024 ||
    !isNetlifyPreviewGoogleOAuthCallbackUrl(callbackUri)
  ) {
    throw new Error("Invalid Netlify preview Google OAuth relay state.");
  }
  const payload = {
    v: 1,
    t: callbackUri,
    s: state,
    i: now,
    e: now + NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = crypto
    .createHmac("sha256", getNetlifyPreviewGoogleOAuthRelaySigningKey())
    .update(encodedPayload)
    .digest("base64url");
  return `${NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX}${encodedPayload}.${signature}`;
}

export function decodeNetlifyPreviewGoogleOAuthRelayState(
  value: string | undefined,
  now = Date.now(),
): { callbackUri: string; state: string } | null {
  if (!isNetlifyPreviewGoogleOAuthRelayState(value)) return null;
  try {
    const encodedEnvelope = value.slice(
      NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX.length,
    );
    const delimiter = encodedEnvelope.lastIndexOf(".");
    if (delimiter <= 0 || delimiter === encodedEnvelope.length - 1) return null;
    const encodedPayload = encodedEnvelope.slice(0, delimiter);
    const signature = encodedEnvelope.slice(delimiter + 1);
    const expectedSignature = crypto
      .createHmac("sha256", getNetlifyPreviewGoogleOAuthRelaySigningKey())
      .update(encodedPayload)
      .digest("base64url");
    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      )
    ) {
      return null;
    }
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const issuedAt = parsed.i;
    const expiresAt = parsed.e;
    const callbackUri = parsed.t;
    const state = parsed.s;
    if (
      parsed.v !== 1 ||
      typeof callbackUri !== "string" ||
      typeof state !== "string" ||
      state.length > 16 * 1024 ||
      typeof issuedAt !== "number" ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      issuedAt > now + NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_CLOCK_SKEW_MS ||
      expiresAt < issuedAt ||
      expiresAt < now ||
      !isNetlifyPreviewGoogleOAuthCallbackUrl(callbackUri)
    ) {
      return null;
    }
    return { callbackUri, state };
  } catch {
    // coercion-ok: malformed relay state is rejected as invalid input.
    return null;
  }
}

export function wrapNetlifyPreviewGoogleOAuthState(
  event: H3Event,
  state: string,
  callbackPath = "/_agent-native/google/callback",
): string {
  const callbackUri = getNetlifyPreviewGoogleOAuthCallbackUrl(
    event,
    callbackPath,
  );
  return callbackUri
    ? encodeNetlifyPreviewGoogleOAuthRelayState(state, callbackUri)
    : state;
}

function isFrameworkOAuthCallbackPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_agent-native/") &&
    (pathname.endsWith("/callback") || pathname.includes("/callback/"))
  );
}

function getOriginalRequestPath(event: H3Event): string {
  const publicPathname = getPublicFrameworkPathname(event);
  if (publicPathname) return publicPathname;

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
  const frameworkPrefixes = [
    `${basePath}/_agent-native`,
    `${basePath}${publicFrameworkPath("/_agent-native")}`,
  ];
  return frameworkPrefixes.some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`),
  );
}

export type OAuthRedirectUriOptions = {
  allowRootCallback?: boolean;
  useNetlifyPreviewGoogleOAuthRelay?: boolean;
};

function getDefaultOAuthRedirectUrl(
  event: H3Event,
  path: string,
  options: OAuthRedirectUriOptions = {},
): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (
    (isWorkspaceOAuthCallbackRelayEnabled() || options.allowRootCallback) &&
    isFrameworkOAuthCallbackPath(cleanPath)
  ) {
    return `${getOrigin(event)}${publicFrameworkPath(cleanPath)}`;
  }
  const basePath = isRequestUnderAppBasePath(event) ? getAppBasePath() : "";
  return `${getOrigin(event)}${basePath}${publicFrameworkPath(cleanPath)}`;
}


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
 *   - Origin must equal the resolved request origin — no Host-header injection
 *     reusing somebody else's registered redirect URI. Callers with a
 *     separately verified origin may pass it as `expectedOrigin`.
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
  expectedOrigin = getOrigin(event),
  options: OAuthRedirectUriOptions = {},
): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  let expectedUrl: URL;
  try {
    expectedUrl = new URL(expectedOrigin);
  } catch {
    return false;
  }
  if (
    options.useNetlifyPreviewGoogleOAuthRelay &&
    candidate === NETLIFY_PREVIEW_GOOGLE_OAUTH_CALLBACK_URL &&
    getNetlifyPreviewGoogleOAuthCallbackUrl(event) !== undefined
  ) {
    return true;
  }
  if (url.protocol !== expectedUrl.protocol) return false;
  if (url.host !== expectedUrl.host) return false;
  if (isRetiredInternalFrameworkPath(url.pathname)) return false;
  const pathname = canonicalFrameworkPathname(url.pathname);
  const basePath = getAppBasePath();
  const allowedPrefixes =
    basePath && isRequestUnderAppBasePath(event)
      ? [
          `${basePath}/_agent-native/`,
          ...((isWorkspaceOAuthCallbackRelayEnabled() ||
            options.allowRootCallback) &&
          isFrameworkOAuthCallbackPath(pathname)
            ? ["/_agent-native/"]
            : []),
        ]
      : ["/_agent-native/"];
  if (!allowedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  return true;
}

export function resolveOAuthRedirectUri(
  event: H3Event,
  defaultPath = "/_agent-native/google/callback",
  options: OAuthRedirectUriOptions = {},
): string | null {
  const supplied = getQuery(event).redirect_uri;
  const previewCallbackUri = options.useNetlifyPreviewGoogleOAuthRelay
    ? getNetlifyPreviewGoogleOAuthCallbackUrl(event, defaultPath)
    : undefined;
  if (previewCallbackUri) {
    if (
      typeof supplied === "string" &&
      supplied.length > 0 &&
      supplied !== previewCallbackUri
    ) {
      return null;
    }
    return NETLIFY_PREVIEW_GOOGLE_OAUTH_CALLBACK_URL;
  }
  if (typeof supplied === "string" && supplied.length > 0) {
    return isAllowedOAuthRedirectUri(supplied, event, getOrigin(event), options)
      ? supplied
      : null;
  }
  return getDefaultOAuthRedirectUrl(event, defaultPath, options);
}


export interface OAuthStatePayload {
  redirectUri: string;
  owner?: string;
  orgId?: string;
  desktop?: boolean;
  mobile?: boolean;
  addAccount?: boolean;
  app?: string;
  scope?: string;
  provider?: string;
  returnUrl?: string;
  flowId?: string;
  oauthTargetId?: string;
  desktopVerifierHash?: string;
  desktopBrowserBindingHash?: string;
  desktopWebview?: boolean;
  signupAttribution?: Record<string, string | undefined>;
  signupAnonymousId?: string;
}

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
export function getOAuthStateSigningKey(): string {
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

export interface EncodeOAuthStateOptions {
  redirectUri: string;
  owner?: string;
  orgId?: string;
  desktop?: boolean;
  mobile?: boolean;
  addAccount?: boolean;
  app?: string;
  scope?: string;
  provider?: string;
  returnUrl?: string;
  flowId?: string;
  oauthTargetId?: string;
  desktopVerifierHash?: string;
  desktopBrowserBindingHash?: string;
  desktopWebview?: boolean;
  signupAttribution?: Record<string, string | undefined>;
  signupAnonymousId?: string;
}

function sanitizeStateAttribution(
  value: unknown,
): Record<string, string | undefined> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string | undefined> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStateAnonymousId(value: unknown): string | undefined {
  return normalizeAnalyticsAnonymousId(value);
}

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
  const payload: Record<string, unknown> = {
    n: nonce,
    r: opts.redirectUri,
  };
  if (opts.owner) payload.o = opts.owner;
  if (opts.orgId) payload.g = opts.orgId;
  if (opts.desktop) payload.d = true;
  if (opts.mobile) payload.m = true;
  if (opts.addAccount) payload.a = true;
  if (opts.app) payload.app = opts.app;
  if (opts.scope) payload.s = opts.scope;
  if (opts.provider) payload.p = opts.provider;
  if (opts.returnUrl) payload.r2 = opts.returnUrl;
  if (opts.flowId) payload.f = opts.flowId;
  if (opts.oauthTargetId) payload.ot = opts.oauthTargetId;
  if (opts.desktopVerifierHash) payload.vh = opts.desktopVerifierHash;
  if (opts.desktopBrowserBindingHash)
    payload.bh = opts.desktopBrowserBindingHash;
  if (opts.desktopWebview) payload.dw = true;
  if (opts.signupAttribution) payload.ft = opts.signupAttribution;
  const signupAnonymousId = normalizeAnalyticsAnonymousId(
    opts.signupAnonymousId,
  );
  if (signupAnonymousId) payload.ai = signupAnonymousId;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getOAuthStateSigningKey())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export type OAuthStateDecodeFailureReason =
  | "missing-state"
  | "missing-delimiter"
  | "bad-signature"
  | "malformed-payload";

export type DecodeOAuthStateResult =
  | ({ ok: true } & OAuthStatePayload)
  | { ok: false; reason: OAuthStateDecodeFailureReason; redirectUri: string };

export function decodeOAuthState(
  stateParam: string | undefined,
  fallbackUri: string,
): DecodeOAuthStateResult {
  if (!stateParam) {
    return { ok: false, reason: "missing-state", redirectUri: fallbackUri };
  }
  try {
    const dotIdx = stateParam.lastIndexOf(".");
    if (dotIdx === -1) {
      return {
        ok: false,
        reason: "missing-delimiter",
        redirectUri: fallbackUri,
      };
    }

    const data = stateParam.slice(0, dotIdx);
    const sig = stateParam.slice(dotIdx + 1);
    const expected = crypto
      .createHmac("sha256", getOAuthStateSigningKey())
      .update(data)
      .digest("base64url");

    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return { ok: false, reason: "bad-signature", redirectUri: fallbackUri };
    }

    const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
    return {
      ok: true,
      redirectUri: parsed.r || fallbackUri,
      owner: parsed.o || undefined,
      orgId: typeof parsed.g === "string" ? parsed.g : undefined,
      desktop: !!parsed.d,
      mobile: !!parsed.m,
      addAccount: !!parsed.a,
      app: typeof parsed.app === "string" ? parsed.app : undefined,
      scope: typeof parsed.s === "string" ? parsed.s : undefined,
      provider: typeof parsed.p === "string" ? parsed.p : undefined,
      returnUrl: typeof parsed.r2 === "string" ? parsed.r2 : undefined,
      flowId: parsed.f || undefined,
      oauthTargetId: typeof parsed.ot === "string" ? parsed.ot : undefined,
      desktopVerifierHash:
        typeof parsed.vh === "string" ? parsed.vh : undefined,
      desktopBrowserBindingHash:
        typeof parsed.bh === "string" ? parsed.bh : undefined,
      desktopWebview: parsed.dw === true,
      signupAttribution: sanitizeStateAttribution(parsed.ft),
      signupAnonymousId: sanitizeStateAnonymousId(parsed.ai),
    };
  } catch {
    return { ok: false, reason: "malformed-payload", redirectUri: fallbackUri };
  }
}

export function logOAuthStateDecodeFailure(
  event: H3Event,
  reason: OAuthStateDecodeFailureReason,
  provider?: string,
): void {
  console.warn("[agent-native][oauth] state decode failed", {
    reason,
    provider,
    path: getOriginalRequestPath(event),
  });
}


export interface OAuthOwnerResult {
  owner: string | undefined;
  hasProductionSession: boolean;
}

export async function resolveOAuthOwner(
  event: H3Event,
  stateOwner?: string,
): Promise<OAuthOwnerResult> {
  const { getSession } = await import("./auth.js");
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

export async function createOAuthSession(
  event: H3Event,
  email: string,
  opts: {
    hasProductionSession: boolean;
    desktop?: boolean;
    mobile?: boolean;
    authProvider?: "google" | `sso:${string}` | null;
    trackSignup?: {
      authProvider: string;
      authUserId?: string;
      canonicalAuthUserId?: string;
      name?: string | null;
      attribution?: Record<string, string | undefined>;
      signupAnonymousId?: string;
      isNewUser?: boolean;
    };
  },
): Promise<OAuthSessionResult> {
  const {
    addSession,
    getSessionMaxAge,
    hasLegacySessionForEmail,
    setFirstRunOnboardingCookie,
    setFrameworkSessionCookie,
  } = await import("./auth.js");
  const mobile = opts.mobile || isMobile(event);
  const needsDeepLink = opts.desktop || mobile;
  const maxAge = getSessionMaxAge();

  let sessionToken: string | undefined;
  let shouldTrackSignup = false;
  if (!opts.hasProductionSession || needsDeepLink) {
    if (opts.trackSignup && !opts.hasProductionSession) {
      shouldTrackSignup =
        opts.trackSignup.isNewUser ??
        (await Promise.all([
          hasLegacySessionForEmail(email).catch(() => true),
          hasBetterAuthUserEmail(email).catch(() => true),
        ]).then(
          ([hasLegacySession, hasUser]) => !hasLegacySession && !hasUser,
        ));
    }

    sessionToken = crypto.randomBytes(32).toString("hex");
    await addSession(sessionToken, email);
    setFrameworkSessionCookie(event, sessionToken);
    if (opts.authProvider !== null) {
      setIdentityGoogleAuthCookie(event, email);
    }
    if (opts.trackSignup && opts.trackSignup.isNewUser !== false) {
      setFirstRunOnboardingCookie(event);
    }
    if (shouldTrackSignup && opts.trackSignup) {
      const attribution =
        opts.trackSignup.attribution ??
        signupAttributionFromCookieHeader(getHeader(event, "cookie") ?? null);
      const anonymousId =
        opts.trackSignup.signupAnonymousId ??
        readAnalyticsAnonymousId(getHeader(event, "cookie") ?? null);
      const authUserId =
        (await getBetterAuthUserIdForEmail(email)) ??
        opts.trackSignup.canonicalAuthUserId;
      await trackSignupEvent({
        authProvider: opts.trackSignup.authProvider,
        origin: "google_oauth",
        signupMethod: "google",
        authUserId,
        email,
        name: opts.trackSignup.name,
        attribution,
        anonymousId,
      });
    }
    // same token without a DB row of their own. Only the PRIMARY
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


export function oauthCallbackResponse(
  event: H3Event,
  email: string,
  opts: {
    sessionToken?: string;
    desktop?: boolean;
    mobile?: boolean;
    addAccount?: boolean;
    returnUrl?: string;
    flowId?: string;
    appName?: string;
    desktopWebview?: boolean;
  },
): unknown {
  const mobile = opts.mobile || isMobile(event);
  const query = getQuery(event);
  const callbackState =
    typeof query.state === "string" && query.state.length > 0
      ? query.state
      : undefined;

  if (mobile) {
    const deepLink = buildOAuthCompleteDeepLink(
      event,
      opts.sessionToken,
      callbackState,
    );
    const webFallback = appendSessionToOAuthReturnUrl(
      opts.returnUrl,
      opts.sessionToken,
    );
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
    });
    for (const cookie of event.res?.headers?.getSetCookie?.() ?? []) {
      headers.append("set-cookie", cookie);
    }
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><title>Connected</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to app…</p><script>window.location.href=${JSON.stringify(deepLink)};setTimeout(function(){window.location.href=${JSON.stringify(webFallback)}},1500)</script></body></html>`,
      { status: 200, headers },
    );
  }

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

  if (opts.desktop && opts.flowId && isElectron(event) && opts.sessionToken) {
    return desktopSuccessPage(event, email, opts.sessionToken, callbackState);
  }

  if (opts.desktop && opts.flowId && opts.desktopWebview) {
    const returnPath = safeReturnPath(opts.returnUrl);
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    });
    for (const cookie of event.res?.headers?.getSetCookie?.() ?? []) {
      headers.append("set-cookie", cookie);
    }
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:Canvas;color:CanvasText;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to Clips…</p><script>setTimeout(function(){window.location.replace(${JSON.stringify(returnPath)})},50)</script></body></html>`,
      { status: 200, headers },
    );
  }

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

  if (opts.desktop && isElectron(event)) {
    return desktopSuccessPage(event, email, opts.sessionToken, callbackState);
  }

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

  const location = appendSessionToOAuthReturnUrl(
    opts.returnUrl,
    opts.sessionToken,
  );
  setResponseStatus(event, 302);
  setResponseHeader(event, "Location", location);
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const headers = new Headers({
    Location: location,
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of event.res?.headers?.getSetCookie?.() ?? []) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

export function oauthErrorPage(message: string, status = 400): Response {
  const safe = escapeHtml(message);
  return htmlResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connection failed</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;text-align:center"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg><p style="font-size:16px;margin:0 0 12px 0;color:#ddd">${safe}</p><p style="font-size:13px;color:#888;margin:0"><a href="/" style="color:#888;text-decoration:underline;text-underline-offset:3px">Back to login</a></p></body></html>`,
    status,
  );
}

export function oauthDesktopExchangePage(
  message = "Returning to the app...",
  closeWindow = true,
): Response {
  const safe = escapeHtml(message);
  const closeScript = closeWindow ? "<script>window.close()</script>" : "";
  // guard:allow-raw-color - standalone callback page intentionally uses fixed dark colors.
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Returning</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="font-size:14px">${safe}</p></body></html>`;
  return htmlResponse(page.replace("</body>", `${closeScript}</body>`));
}


function resolveOAuthAppName(explicit?: string): string {
  const raw = explicit || getAppConfig().app.name || "Agent-Native";
  if (!/^[a-z0-9_-]+$/.test(raw)) return raw;
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function buildOAuthCompleteDeepLink(
  event: H3Event,
  sessionToken?: string,
  state?: string,
): string {
  const protocol = getDesktopOAuthProtocol(event);
  const params = new URLSearchParams();
  if (sessionToken) params.set("token", sessionToken);
  if (state) params.set("state", state);
  const suffix = params.toString();
  return suffix
    ? `${protocol}://oauth-complete?${suffix}`
    : `${protocol}://oauth-complete`;
}

function desktopSuccessPage(
  event: H3Event,
  email?: string,
  sessionToken?: string,
  state?: string,
): Response {
  const safeEmail = email ? escapeHtml(email) : "";
  const msg = safeEmail ? `Connected ${safeEmail}!` : "Connected!";
  if (sessionToken) {
    const deepLink = buildOAuthCompleteDeepLink(event, sessionToken, state);
    const deepLinkJson = JSON.stringify(deepLink);
    return htmlResponse(
      // guard:allow-raw-color - standalone OAuth completion page has no app stylesheet.
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title><style>@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}.spinner{width:28px;height:28px;border:2px solid #333;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.fallback{display:none;flex-direction:column;align-items:center;gap:8px;animation:fadeIn .2s ease-out}.fallback.show{display:flex}</style></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px"><p style="font-size:16px;margin:0">${msg}</p><div id="loading" class="spinner"></div><div id="fallback" class="fallback"><a href=${deepLinkJson} style="display:inline-block;padding:10px 24px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Agent-Native</a><p style="font-size:12px;color:#666;margin:0">If the app didn\u2019t open automatically, click the button above.</p></div><script>(function(){var ua=(navigator.userAgent||"");if(ua.indexOf("AgentNativeDesktop")===-1){window.location.replace("/");return}window.location.href=${deepLinkJson};setTimeout(function(){document.getElementById("loading").style.display="none";document.getElementById("fallback").classList.add("show")},3000)})()</script></body></html>`,
    );
  }
  return htmlResponse(
    oauthSuccessCloseTabHtml(
      msg,
      "You can close this tab and return to Agent-Native.",
    ),
  );
}
