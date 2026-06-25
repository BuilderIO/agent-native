import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { H3Event } from "h3";
import { getHeader } from "h3";

import {
  getAuthSecret,
  resolveSignupTrackingIdentity,
} from "./better-auth-instance.js";
import { getAppBasePath, getOrigin } from "./google-oauth.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";
const DEFAULT_BUILDER_API_HOST = "https://api.builder.io";
const BUILDER_BROWSER_HOST = "agent-native-browser";
const BUILDER_BROWSER_CLIENT_ID = "Agent Native Browser";

export const BUILDER_CALLBACK_PATH = "/_agent-native/builder/callback";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Query-param name carrying the signed CSRF state on the connect→callback
 * round-trip. Prefixed with `_an_` to avoid collisions if Builder ever
 * adds standard OAuth `state` support to cli-auth. Builder preserves
 * the path/query of `redirect_url` verbatim when redirecting back, so
 * we embed `_an_state=…` inside the redirect_url query string at
 * connect time and read it back on the callback.
 */
export const BUILDER_STATE_PARAM = "_an_state";
export const BUILDER_CONNECT_PARAM = "_an_connect";
export const BUILDER_CONNECT_OWNER_COOKIE = "an_builder_connect_owner";
export const BUILDER_SIGNUP_SOURCE_PARAM = "signupSource";
export const BUILDER_AGENT_NATIVE_FLOW_PARAM = "agentNativeFlow";
export const BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM =
  "agentNativeConnectSource";
export const BUILDER_AGENT_NATIVE_APP_PARAM = "agentNativeApp";
export const BUILDER_AGENT_NATIVE_TEMPLATE_PARAM = "agentNativeTemplate";

const BUILDER_STATE_TTL_MS = 10 * 60 * 1000;
const BUILDER_SIGNUP_SOURCE = "agent-native";

export interface BuilderConnectTrackingParams {
  signupSource?: string;
  agentNativeFlow?: string;
  agentNativeConnectSource?: string;
  agentNativeApp?: string;
  agentNativeTemplate?: string;
}

function cleanTrackingParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

export function getBuilderConnectTrackingParams(
  params: URLSearchParams,
): BuilderConnectTrackingParams {
  return {
    signupSource:
      cleanTrackingParam(params.get(BUILDER_SIGNUP_SOURCE_PARAM)) ??
      BUILDER_SIGNUP_SOURCE,
    agentNativeFlow: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_FLOW_PARAM),
    ),
    agentNativeConnectSource: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM),
    ),
    agentNativeApp: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_APP_PARAM),
    ),
    agentNativeTemplate: cleanTrackingParam(
      params.get(BUILDER_AGENT_NATIVE_TEMPLATE_PARAM),
    ),
  };
}

export function builderConnectTrackingProperties(
  tracking: BuilderConnectTrackingParams,
): Record<string, string> {
  const properties: Record<string, string> = {};
  if (tracking.signupSource) properties.signup_source = tracking.signupSource;
  if (tracking.agentNativeFlow) {
    properties.agent_native_flow = tracking.agentNativeFlow;
  }
  if (tracking.agentNativeConnectSource) {
    properties.agent_native_connect_source = tracking.agentNativeConnectSource;
  }
  if (tracking.agentNativeApp) {
    properties.agent_native_app = tracking.agentNativeApp;
  }
  if (tracking.agentNativeTemplate) {
    properties.agent_native_template = tracking.agentNativeTemplate;
  }
  return properties;
}

function applyBuilderConnectTrackingParams(
  params: URLSearchParams,
  tracking: BuilderConnectTrackingParams,
) {
  params.set(
    BUILDER_SIGNUP_SOURCE_PARAM,
    cleanTrackingParam(tracking.signupSource) ?? BUILDER_SIGNUP_SOURCE,
  );
  const flow = cleanTrackingParam(tracking.agentNativeFlow);
  if (flow) params.set(BUILDER_AGENT_NATIVE_FLOW_PARAM, flow);
  const source = cleanTrackingParam(tracking.agentNativeConnectSource);
  if (source) params.set(BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM, source);
  const app = cleanTrackingParam(tracking.agentNativeApp);
  if (app) params.set(BUILDER_AGENT_NATIVE_APP_PARAM, app);
  const template = cleanTrackingParam(tracking.agentNativeTemplate);
  if (template) params.set(BUILDER_AGENT_NATIVE_TEMPLATE_PARAM, template);
}

export interface BuilderBrowserStatus {
  configured: boolean;
  builderEnabled: boolean;
  branchProjectIdConfigured: boolean;
  branchProjectId?: string;
  /**
   * True when `BUILDER_PRIVATE_KEY` is set at the deployment level. This is a
   * fallback credential; signed-in users can still connect their own Builder
   * account, which takes precedence for their request.
   */
  envManaged: boolean;
  credentialSource?: "user" | "org" | "workspace" | "env";
  /**
   * The currently effective Builder credential was rejected by Builder's API.
   * This is durable status about the credential pair, not a failure of an
   * in-progress cli-auth callback.
   */
  authError?: { message: string; at: number };
  connectError?: { message: string; at: number };
  appHost: string;
  apiHost: string;
  /**
   * Ready-to-open Builder CLI auth URL for this request owner, when the
   * callback can return to the same deployment that minted the state. Preview
   * deployments that must callback through a gateway omit this and use
   * connectUrl so the server can write a pending-connect row first.
   */
  cliAuthUrl?: string;
  connectUrl: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  /**
   * The Builder space(s) the effective credential can reach, with their real
   * display names (derived from the Admin GraphQL API). A `bpk-` key is
   * space-scoped, so today this is one entry; the list shape lets the Sources
   * drill-down grow to multiple spaces without a restructure. Absent/empty when
   * the name can't be derived — UIs fall back to `orgName`.
   */
  spaces?: Array<{ id: string; name: string }>;
  orgKind?: string;
  subscription?: string;
  subscriptionLevel?: string;
  subscriptionName?: string;
  isEnterprise?: boolean;
  isFreeAccount?: boolean;
}

export interface BrowserConnectionArgs {
  sessionId?: string;
  projectId?: string;
  branchName?: string;
  proxyOrigin?: string;
  proxyDefaultOrigin?: string;
  proxyDestination?: string;
}

type BuilderSignedTokenPurpose = "callback" | "connect";

function signingKeyForPurpose(purpose: BuilderSignedTokenPurpose): string {
  // Preserve the original callback-state signing key for any in-flight legacy
  // callbacks; use a separate key domain for connect-entry tokens.
  return purpose === "callback"
    ? `builder-csrf:${getAuthSecret()}`
    : `builder-connect:${getAuthSecret()}`;
}

function macForParts(
  purpose: BuilderSignedTokenPurpose,
  nonce: string,
  emailEncoded: string,
  ts: number,
): string {
  return createHmac("sha256", signingKeyForPurpose(purpose))
    .update(`${nonce}.${emailEncoded}.${ts}`)
    .digest("base64url");
}

function signEmailBoundBuilderToken(
  ownerEmail: string,
  purpose: BuilderSignedTokenPurpose,
): string {
  const nonce = randomBytes(16).toString("base64url");
  const ts = Date.now();
  const emailEncoded = Buffer.from(ownerEmail, "utf8").toString("base64url");
  const mac = macForParts(purpose, nonce, emailEncoded, ts);
  return `${nonce}.${emailEncoded}.${ts}.${mac}`;
}

function verifyEmailBoundBuilderToken(
  token: string | null | undefined,
  ownerEmail: string,
  purpose: BuilderSignedTokenPurpose,
): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [nonce, emailEncoded, tsStr, mac] = parts;
  if (!nonce || !emailEncoded || !tsStr || !mac) return false;

  let boundEmail: string;
  try {
    boundEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
  } catch {
    return false;
  }
  if (boundEmail !== ownerEmail) return false;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  // Reject expired AND far-future timestamps so leaked tokens do not gain an
  // arbitrary lifetime through clock skew or forged future issue times.
  if (Math.abs(Date.now() - ts) > BUILDER_STATE_TTL_MS) return false;

  const expected = Buffer.from(macForParts(purpose, nonce, emailEncoded, ts));
  const candidate = Buffer.from(mac);
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

/**
 * Mint a signed CSRF state token bound to the current session's email
 * and a fresh nonce. Round-trips through Builder's cli-auth flow inside
 * the redirect_url query string and is verified on the callback before
 * any keys are written.
 *
 * Why bind to email: it's the only stable, universally-available
 * identity field across all auth modes (Better Auth, BYOA, AUTH_MODE=local).
 * Binding to the session token instead would put the cookie value in a
 * URL that may end up in server logs / browser history.
 */
export function signBuilderCallbackState(sessionEmail: string): string {
  return signEmailBoundBuilderToken(sessionEmail, "callback");
}

/**
 * Verify a state token produced by `signBuilderCallbackState`. Returns
 * false on any malformed, forged, expired, or cross-session token.
 */
export function verifyBuilderCallbackState(
  token: string | null | undefined,
  sessionEmail: string,
): boolean {
  return verifyEmailBoundBuilderToken(token, sessionEmail, "callback");
}

export function verifyBuilderCallbackStateAndGetOwner(
  token: string | null | undefined,
): string | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const emailEncoded = parts[1];
  if (!emailEncoded) return null;

  let ownerEmail: string;
  try {
    ownerEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!ownerEmail) return null;
  return verifyBuilderCallbackState(token, ownerEmail) ? ownerEmail : null;
}

export function signBuilderConnectToken(ownerEmail: string): string {
  return signEmailBoundBuilderToken(ownerEmail, "connect");
}

export function verifyBuilderConnectToken(
  token: string | null | undefined,
  ownerEmail: string,
): boolean {
  return verifyEmailBoundBuilderToken(token, ownerEmail, "connect");
}

export function verifyBuilderConnectTokenAndGetOwner(
  token: string | null | undefined,
): string | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const emailEncoded = parts[1];
  if (!emailEncoded) return null;

  let ownerEmail: string;
  try {
    ownerEmail = Buffer.from(emailEncoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!ownerEmail) return null;
  return verifyBuilderConnectToken(token, ownerEmail) ? ownerEmail : null;
}

export function appendBuilderConnectToken(
  connectUrl: string,
  ownerEmail: string,
): string {
  const url = new URL(connectUrl);
  url.searchParams.set(
    BUILDER_CONNECT_PARAM,
    signBuilderConnectToken(ownerEmail),
  );
  return url.toString();
}

function isAllowedBrowserReturnUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedProtocol =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    const isBuilderDomain =
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "builderio.xyz" ||
      hostname.endsWith(".builderio.xyz") ||
      hostname === "builderio.dev" ||
      hostname.endsWith(".builderio.dev") ||
      hostname === "builder.codes" ||
      hostname.endsWith(".builder.codes");
    const isAgentNativeDomain =
      hostname === "agent-native.com" || hostname.endsWith(".agent-native.com");
    return (
      isAllowedProtocol &&
      (isLocalhost || isBuilderDomain || isAgentNativeDomain)
    );
  } catch {
    return false;
  }
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function getBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

export function getBuilderApiHost(): string {
  return (
    process.env.AIR_HOST ||
    process.env.BUILDER_HOST ||
    process.env.BUILDER_API_HOST ||
    DEFAULT_BUILDER_API_HOST
  );
}

function getConfiguredBuilderBranchProjectId(): string | undefined {
  const projectId =
    process.env.DISPATCH_BUILDER_PROJECT_ID ||
    process.env.BUILDER_BRANCH_PROJECT_ID ||
    process.env.BUILDER_PROJECT_ID;
  return projectId?.trim() || undefined;
}

export function getBuilderBranchProjectId(): string {
  return getConfiguredBuilderBranchProjectId() || "";
}

export function isBuilderBranchingEnabled(): boolean {
  return !!getConfiguredBuilderBranchProjectId();
}

export async function resolveBuilderBranchProjectId(): Promise<string> {
  const envProjectId = getConfiguredBuilderBranchProjectId();
  if (envProjectId) return envProjectId;

  try {
    const { resolveSecret } = await import("./credential-provider.js");
    for (const key of [
      "DISPATCH_BUILDER_PROJECT_ID",
      "BUILDER_BRANCH_PROJECT_ID",
      "BUILDER_PROJECT_ID",
    ]) {
      const value = await resolveSecret(key);
      if (value?.trim()) return value.trim();
    }
  } catch {
    // Secrets table or request context not ready — treat as not configured.
  }

  return "";
}

export async function resolveIsBuilderBranchingEnabled(): Promise<boolean> {
  return !!(await resolveBuilderBranchProjectId());
}

function isBuilderCliAuthAllowedOrigin(origin: string | null | undefined) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowedProtocol =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    const isBuilderDomain =
      hostname === "builder.io" || hostname.endsWith(".builder.io");
    const isAgentNativeDomain =
      hostname === "agent-native.com" || hostname.endsWith(".agent-native.com");
    return (
      isAllowedProtocol &&
      (isLocalhost || isBuilderDomain || isAgentNativeDomain)
    );
  } catch {
    return false;
  }
}

function firstBuilderCliAuthCallbackOriginFromEnv(): string | null {
  for (const key of [
    "APP_URL",
    "VITE_APP_URL",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
    "WORKSPACE_GATEWAY_URL",
    "VITE_WORKSPACE_GATEWAY_URL",
  ]) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      if (isBuilderCliAuthAllowedOrigin(origin)) return origin;
    } catch {
      // Ignore malformed environment values.
    }
  }
  return null;
}

/**
 * Query param on the callback URL that carries the original preview opener
 * origin when cli-auth's allow-list forces `preview_url` to the gateway.
 * Read on the callback to derive the correct postMessage targetOrigin.
 *
 * Not signed: the receive-side trust check in `useBuilderStatus` still
 * gates messages by allow-listed origin. The worst an attacker could do by
 * crafting a different `_an_opener` value is target a postMessage to an
 * origin that doesn't match the actual opener — postMessage drops the
 * message in that case, identical to the legacy wildcard-fallback path.
 */
export const BUILDER_OPENER_PARAM = "_an_opener";

function isBuilderOpenerOriginSafe(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Build the Builder cli-auth URL for the connect popup. When a signed
 * `state` token is supplied it is embedded inside the `redirect_url`
 * query string so it survives Builder's redirect verbatim — Builder
 * preserves the redirect_url's existing query when appending p-key /
 * api-key / etc., so we don't depend on Builder echoing a top-level
 * `state` parameter (it doesn't).
 *
 * Status responses can surface this URL directly; the legacy
 * `/_agent-native/builder/connect` trampoline still calls this helper for
 * clients that only know the app-local connect URL.
 */
export function buildBuilderCliAuthUrl(
  callbackOrigin: string,
  state: string | null = null,
  options: {
    previewOrigin?: string;
    tracking?: BuilderConnectTrackingParams;
  } = {},
): string {
  const normalizedCallbackOrigin = normalizeOrigin(callbackOrigin);
  const requestedPreviewOrigin = normalizeOrigin(
    options.previewOrigin || callbackOrigin,
  );
  const normalizedPreviewOrigin = isBuilderCliAuthAllowedOrigin(
    requestedPreviewOrigin,
  )
    ? requestedPreviewOrigin
    : normalizedCallbackOrigin;
  const appBasePath = getAppBasePath();
  const callbackUrl = new URL(
    `${appBasePath}${BUILDER_CALLBACK_PATH}`,
    normalizedCallbackOrigin,
  );
  if (state) {
    callbackUrl.searchParams.set(BUILDER_STATE_PARAM, state);
  }
  // When the cli-auth allow-list forces preview_url onto the gateway origin,
  // the callback would otherwise lose the real opener origin and post its
  // success message to the gateway instead of the preview tab. Embed the
  // original preview origin in the callback's own query string so the
  // callback handler can recover it for parentOrigin / postMessage. Builder
  // preserves the redirect_url's query verbatim, so this round-trips.
  if (
    requestedPreviewOrigin &&
    requestedPreviewOrigin !== normalizedPreviewOrigin &&
    isBuilderOpenerOriginSafe(requestedPreviewOrigin)
  ) {
    callbackUrl.searchParams.set(BUILDER_OPENER_PARAM, requestedPreviewOrigin);
  }
  const identity = resolveSignupTrackingIdentity();
  const tracking = {
    signupSource: BUILDER_SIGNUP_SOURCE,
    agentNativeApp: identity.app,
    agentNativeTemplate: identity.template,
    ...options.tracking,
  };
  applyBuilderConnectTrackingParams(callbackUrl.searchParams, tracking);
  const url = new URL("/cli-auth", getBuilderAppHost());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("host", BUILDER_BROWSER_HOST);
  url.searchParams.set("client_id", BUILDER_BROWSER_CLIENT_ID);
  url.searchParams.set("redirect_url", callbackUrl.toString());
  url.searchParams.set(
    "preview_url",
    `${normalizedPreviewOrigin}${appBasePath}`,
  );
  url.searchParams.set("framework", "agent-native");
  applyBuilderConnectTrackingParams(url.searchParams, tracking);
  return url.toString();
}

/**
 * The bare URL surfaced to clients as `connectUrl`. The status route appends
 * a short-lived signed connect token when it knows the current owner; this
 * helper stays bare so server-rendered cards can still render without a
 * request-bound owner and the connect route can fall back to Fetch Metadata.
 */
export function getBuilderBrowserConnectUrl(origin: string): string {
  return `${normalizeOrigin(origin)}${getAppBasePath()}/_agent-native/builder/connect`;
}

export function getBuilderBrowserConnectUrlForOwner(
  origin: string,
  ownerEmail: string | null | undefined,
): string {
  const connectUrl = getBuilderBrowserConnectUrl(origin);
  return ownerEmail
    ? appendBuilderConnectToken(connectUrl, ownerEmail)
    : connectUrl;
}

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function readEventHeader(event: H3Event, name: string): string | undefined {
  try {
    return getHeader(event, name) ?? undefined;
  } catch {
    const headers = (
      event as unknown as {
        node?: {
          req?: { headers?: Record<string, string | string[] | undefined> };
        };
      }
    ).node?.req?.headers;
    const value = headers?.[name.toLowerCase()] ?? headers?.[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }
}

function isTrustedBuilderRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
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

function isLoopbackBuilderRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function firstPublicBuilderPreviewOriginFromEnv(): string | null {
  for (const key of [
    "FUSION_ENV_ORIGIN",
    "VITE_FUSION_ENV_ORIGIN",
    "BUILDER_PREVIEW_URL",
    "VITE_BUILDER_PREVIEW_URL",
  ]) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (isLoopbackBuilderRequestHost(url.host)) continue;
      if (!isTrustedBuilderRequestHost(url.host)) continue;
      return url.origin;
    } catch {
      // Ignore malformed environment values.
    }
  }
  return null;
}

/**
 * User-visible Builder connect origin. In Builder/Fusion previews, keep the
 * connect URL on the actual app preview origin so clicking Connect happens in
 * the same deployment that minted the signed connect token.
 */
export function getBuilderBrowserOriginForEvent(event: H3Event): string {
  const headerHost = firstHeaderValue(
    readEventHeader(event, "x-forwarded-host") ||
      readEventHeader(event, "host"),
  );
  if (!isTrustedBuilderRequestHost(headerHost)) return getOrigin(event);
  if (isLoopbackBuilderRequestHost(headerHost)) {
    const publicPreviewOrigin = firstPublicBuilderPreviewOriginFromEnv();
    if (publicPreviewOrigin) return publicPreviewOrigin;
  }

  const rawProto = firstHeaderValue(
    readEventHeader(event, "x-forwarded-proto"),
  );
  const proto =
    rawProto === "http" || rawProto === "https"
      ? rawProto
      : process.env.NODE_ENV === "production"
        ? "https"
        : "http";
  return `${proto}://${headerHost}`;
}

/**
 * Builder's /cli-auth page currently only accepts localhost, *.builder.io,
 * *.agent-native.com, or builder: redirect_url destinations. Preview hosts
 * such as *.builderio.xyz and *.builder.codes are valid app origins for us,
 * but Builder rejects them and falls back to http://localhost:10110/auth.
 * Use a configured public gateway for the callback in those cases while
 * leaving the surfaced connect URL on the user's active preview.
 */
export function getBuilderCliAuthCallbackOriginForEvent(
  event: H3Event,
): string {
  const previewOrigin = getBuilderBrowserOriginForEvent(event);
  if (isBuilderCliAuthAllowedOrigin(previewOrigin)) return previewOrigin;
  const envOrigin = firstBuilderCliAuthCallbackOriginFromEnv();
  if (envOrigin) return envOrigin;
  // The app is being reached via a tunnel (e.g. ngrok) whose origin Builder's
  // /cli-auth does not trust, and no public gateway is configured. Handing
  // Builder the rejected tunnel origin makes it fall back to its own *dead*
  // http://localhost:10110/auth default (ERR_CONNECTION_REFUSED). In local dev
  // the app is also reachable at http://localhost:<PORT> — an origin Builder
  // accepts and a same-machine browser can reach — so use that for the callback
  // instead of a broken redirect. (Production origins are *.agent-native.com,
  // which pass the allow-list above and never reach here.)
  return localBuilderCliAuthCallbackOrigin() ?? previewOrigin;
}

/** App's own localhost origin for the Builder connect callback, in local dev. */
function localBuilderCliAuthCallbackOrigin(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const port = process.env.PORT?.trim();
  if (!port || !/^\d{1,5}$/.test(port)) return null;
  return `http://localhost:${port}`;
}

export function getBuilderBrowserStatus(origin: string): BuilderBrowserStatus {
  const branchProjectId = getConfiguredBuilderBranchProjectId();
  const envManaged = !!process.env.BUILDER_PRIVATE_KEY;
  return {
    configured: !!(
      process.env.BUILDER_PRIVATE_KEY && process.env.BUILDER_PUBLIC_KEY
    ),
    builderEnabled: isBuilderBranchingEnabled(),
    branchProjectIdConfigured: !!branchProjectId,
    branchProjectId: branchProjectId || undefined,
    envManaged,
    credentialSource: envManaged ? "env" : undefined,
    appHost: getBuilderAppHost(),
    apiHost: getBuilderApiHost(),
    connectUrl: getBuilderBrowserConnectUrl(origin),
    publicKeyConfigured: !!process.env.BUILDER_PUBLIC_KEY,
    privateKeyConfigured: !!process.env.BUILDER_PRIVATE_KEY,
    userId: process.env.BUILDER_USER_ID || undefined,
    orgName: process.env.BUILDER_ORG_NAME || undefined,
    orgKind: process.env.BUILDER_ORG_KIND || undefined,
    subscription: process.env.BUILDER_SUBSCRIPTION || undefined,
    subscriptionLevel: process.env.BUILDER_SUBSCRIPTION_LEVEL || undefined,
    subscriptionName: process.env.BUILDER_SUBSCRIPTION_NAME || undefined,
    isEnterprise: parseOptionalEnvBoolean(process.env.BUILDER_IS_ENTERPRISE),
    isFreeAccount: parseOptionalEnvBoolean(process.env.BUILDER_IS_FREE_ACCOUNT),
  };
}

function parseOptionalEnvBoolean(
  value: string | undefined,
): boolean | undefined {
  if (!value) return undefined;
  return /^(1|true)$/i.test(value);
}

export function getBuilderBrowserStatusForEvent(
  event: H3Event,
): BuilderBrowserStatus {
  return getBuilderBrowserStatus(getBuilderBrowserOriginForEvent(event));
}

/**
 * Env vars written by the Builder CLI-auth callback. Single source of truth
 * for the connect/disconnect key set — `getBuilderCallbackEnvVars` and the
 * disconnect handler's scrub loop both derive from this list, so drift
 * (e.g. disconnect silently leaving `BUILDER_USER_ID` behind because
 * someone added a key to one site but not the other) is impossible.
 */
export const BUILDER_ENV_KEYS = [
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "BUILDER_ORG_NAME",
  "BUILDER_ORG_KIND",
  "BUILDER_SUBSCRIPTION",
  "BUILDER_SUBSCRIPTION_LEVEL",
  "BUILDER_SUBSCRIPTION_NAME",
  "BUILDER_IS_ENTERPRISE",
  "BUILDER_IS_FREE_ACCOUNT",
] as const;

export type BuilderEnvKey = (typeof BUILDER_ENV_KEYS)[number];

export function getBuilderCallbackEnvVars(params: {
  privateKey?: string | null;
  publicKey?: string | null;
  userId?: string | null;
  orgName?: string | null;
  orgKind?: string | null;
  subscription?: string | null;
  subscriptionLevel?: string | null;
  subscriptionName?: string | null;
  isEnterprise?: boolean | null;
  isFreeAccount?: boolean | null;
}) {
  const values: Record<BuilderEnvKey, string> = {
    BUILDER_PRIVATE_KEY: params.privateKey?.trim() || "",
    BUILDER_PUBLIC_KEY: params.publicKey?.trim() || "",
    BUILDER_USER_ID: params.userId?.trim() || "",
    BUILDER_ORG_NAME: params.orgName?.trim() || "",
    BUILDER_ORG_KIND: params.orgKind?.trim() || "",
    BUILDER_SUBSCRIPTION: params.subscription?.trim() || "",
    BUILDER_SUBSCRIPTION_LEVEL: params.subscriptionLevel?.trim() || "",
    BUILDER_SUBSCRIPTION_NAME: params.subscriptionName?.trim() || "",
    BUILDER_IS_ENTERPRISE:
      typeof params.isEnterprise === "boolean"
        ? String(params.isEnterprise)
        : "",
    BUILDER_IS_FREE_ACCOUNT:
      typeof params.isFreeAccount === "boolean"
        ? String(params.isFreeAccount)
        : "",
  };
  return BUILDER_ENV_KEYS.map((key) => ({ key, value: values[key] }));
}

export function resolveSafePreviewUrl(
  previewUrl: string | null | undefined,
  event: H3Event,
): string {
  if (previewUrl && isAllowedBrowserReturnUrl(previewUrl)) {
    return previewUrl;
  }
  return getBuilderBrowserOriginForEvent(event);
}

export function resolveBuilderCallbackReturnUrl(options: {
  event: H3Event;
  openerOrigin?: string | null;
  previewUrl?: string | null;
}): string {
  const openerOrigin =
    options.openerOrigin && isAllowedBrowserReturnUrl(options.openerOrigin)
      ? options.openerOrigin
      : null;
  if (openerOrigin) {
    return new URL(getAppBasePath() || "/", openerOrigin).toString();
  }
  return resolveSafePreviewUrl(options.previewUrl, options.event);
}

/**
 * Inline theme-detection script that runs before the body paints. Reads the
 * app's stored theme preference (same `localStorage.theme` key used by the
 * client-side theme manager) and falls back to `prefers-color-scheme`. This
 * way the popup matches whatever theme the user already picked in the app
 * — light, dark, or auto — instead of always rendering in OS-default mode.
 */
const BUILDER_CALLBACK_THEME_SCRIPT = `<script>
(function () {
  try {
    var stored = window.localStorage && window.localStorage.getItem("theme");
    var resolved;
    if (stored === "light" || stored === "dark") {
      resolved = stored;
    } else {
      var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      resolved = mq && mq.matches ? "dark" : "light";
    }
    document.documentElement.classList.add(resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();
</script>`;

/**
 * Brand-aligned CSS for the Builder connect callback / error pages.
 *
 * Uses the same neutral-zinc palette and Inter font as the rest of the
 * framework's templates (see `templates/*\/app/global.css`). Tokens map to
 * the same HSL values the templates set on `:root` / `.dark`, so the popup
 * reads as part of the same app — not a stranded marketing page.
 */
const BUILDER_CALLBACK_BASE_CSS = `
  :root {
    --bg: hsl(0 0% 100%);
    --fg: hsl(220 10% 10%);
    --muted-fg: hsl(220 5% 45%);
    --card: hsl(0 0% 100%);
    --border: hsl(220 10% 90%);
    --primary: hsl(220 10% 15%);
    --primary-fg: hsl(0 0% 100%);
    --primary-hover: hsl(220 10% 25%);
    --success-bg: hsl(143 50% 96%);
    --success-fg: hsl(143 60% 32%);
    --error-fg: hsl(0 75% 45%);
    --error-bg: hsl(0 80% 97%);
    --error-border: hsl(0 80% 92%);
  }
  :root.dark {
    --bg: hsl(220 6% 6%);
    --fg: hsl(0 0% 92%);
    --muted-fg: hsl(220 4% 60%);
    --card: hsl(220 5% 8%);
    --border: hsl(220 4% 14%);
    --primary: hsl(0 0% 92%);
    --primary-fg: hsl(220 6% 6%);
    --primary-hover: hsl(0 0% 75%);
    --success-bg: hsl(143 30% 12%);
    --success-fg: hsl(143 50% 70%);
    --error-fg: hsl(0 80% 75%);
    --error-bg: hsl(0 35% 12%);
    --error-border: hsl(0 30% 20%);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--fg);
    font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    padding: 24px;
  }
  .card {
    width: min(420px, 100%);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px 28px;
    background: var(--card);
    text-align: center;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    margin-bottom: 16px;
  }
  .icon svg { width: 22px; height: 22px; display: block; }
  .icon-success { background: var(--success-bg); color: var(--success-fg); }
  .icon-error { background: var(--error-bg); color: var(--error-fg); }
  h1 {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  p {
    margin: 0 0 4px;
    color: var(--fg);
    font-size: 14px;
  }
  p.muted { color: var(--muted-fg); }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 36px;
    padding: 0 16px;
    margin-top: 20px;
    background: var(--primary);
    color: var(--primary-fg);
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    border: none;
    cursor: pointer;
  }
  .btn:hover { background: var(--primary-hover); }
  pre.error-detail {
    margin: 16px 0 0;
    padding: 10px 12px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 8px;
    color: var(--error-fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
  }
`;

function safeOriginFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function createBuilderBrowserCallbackPage(
  previewUrl: string,
  opts: { parentOrigin?: string } = {},
): string {
  const escapedUrl = JSON.stringify(previewUrl);
  const parentOrigin =
    safeOriginFromUrl(opts.parentOrigin) ?? safeOriginFromUrl(previewUrl);
  // postMessage requires a specific target origin for cross-origin opener
  // delivery; only fall back to "*" when we have no usable origin (the
  // BroadcastChannel path on the success page still works for same-origin
  // openers in that case).
  const escapedTargetOrigin = JSON.stringify(parentOrigin ?? "*");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder connected</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    ${BUILDER_CALLBACK_THEME_SCRIPT}
    <style>${BUILDER_CALLBACK_BASE_CSS}</style>
  </head>
  <body>
    <main class="card" role="status" aria-live="polite">
      <span class="icon icon-success" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </span>
      <h1>Builder connected</h1>
      <p>Browser access is now available to your app.</p>
      <p class="muted">You can close this tab and return to the workspace.</p>
      <a class="btn" href=${escapedUrl}>Open the workspace</a>
    </main>
    <script>
      // Tell the opener tab the connect succeeded. The parent has two ways
      // to learn this:
      //   1. The popup-based connect flow (window.open + 2s polling on
      //      /builder/status) — picks it up via the next poll within ~2s.
      //   2. The link-based "Use Builder" flow (target="_blank" tab) — the
      //      AgentPanel only fetches /builder/status once on mount, so it
      //      stays stuck on "Use Builder" unless we explicitly signal.
      // BroadcastChannel + postMessage cover both cases. Use the same channel
      // name as the error path (createBuilderBrowserCallbackErrorPage) and
      // mirror the parent-side listener in useBuilderStatus / useBuilderConnectUrl.
      try {
        var bc = new BroadcastChannel("builder-connect:" + window.location.host);
        bc.postMessage({ type: "builder-connect-success" });
        bc.close();
      } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "builder-connect-success" },
            ${escapedTargetOrigin},
          );
        }
      } catch (e) {}
      // If we're a popup opened by the app, close ourselves and let the
      // parent tab keep polling for connection status. If close() is
      // blocked (e.g. we're the top-level tab because popups were
      // downgraded), fall back to navigating back to the workspace.
      window.setTimeout(function () {
        try { window.close(); } catch (e) {}
        window.setTimeout(function () {
          if (!window.closed) {
            window.location.replace(${escapedUrl});
          }
        }, 200);
      }, 700);
    </script>
  </body>
</html>`;
}

/**
 * HTML page rendered inside the OAuth popup when the callback handler caught
 * an error persisting the per-user Builder credentials. Without this, the
 * popup would show the success page even though the write failed — leaving
 * the parent window stuck on "Waiting for Builder…" until the 5-minute poll
 * timeout fires (Midhun reported this on 2026-04-28).
 *
 * The page does two things:
 * 1. Shows the user a clear "couldn't save credentials" message with the
 *    underlying error so they can retry or report.
 * 2. `postMessage`s the parent (same-origin opener) so the connect-flow
 *    polling stops immediately rather than waiting for the next /status
 *    poll to surface the SQL `builder-connect-error:<email>` row.
 */
export function createBuilderBrowserCallbackErrorPage(
  message: string,
  opts: {
    title?: string;
    body?: string;
    closeHint?: string;
    parentOrigin?: string;
  } = {},
): string {
  const escapedMessage = JSON.stringify(message);
  const parentOrigin = safeOriginFromUrl(opts.parentOrigin);
  const escapedTargetOrigin = JSON.stringify(parentOrigin ?? "*");
  const title = opts.title ?? "Couldn't save Builder connection";
  const body =
    opts.body ??
    "Builder authorized your account but the server couldn't persist the credentials.";
  const closeHint =
    opts.closeHint ?? "You can close this tab and try again from settings.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>Builder connect failed</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    ${BUILDER_CALLBACK_THEME_SCRIPT}
    <style>${BUILDER_CALLBACK_BASE_CSS}</style>
  </head>
  <body>
    <main class="card" role="alert" aria-live="assertive">
      <span class="icon icon-error" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </span>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(body)}</p>
      <pre class="error-detail" id="msg"></pre>
      <p class="muted" style="margin-top:12px">${escapeHtml(closeHint)}</p>
    </main>
    <script>
      try {
        var msg = ${escapedMessage};
        document.getElementById("msg").textContent = msg;
        // Notify the parent tab immediately so its polling loop stops
        // without waiting for the next /builder/status tick.
        //
        // BroadcastChannel works across same-origin windows regardless of
        // opener access — it is the only reliable channel here because
        // popups opened with window.open(..., "noopener") or links with
        // rel="noopener" have window.opener === null. The legacy
        // window.opener.postMessage path is kept as a belt-and-suspenders
        // fallback for non-BroadcastChannel environments.
        try {
          var bc = new BroadcastChannel("builder-connect:" + window.location.host);
          bc.postMessage({ type: "builder-connect-error", message: msg });
          bc.close();
        } catch (e) {}
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(
              { type: "builder-connect-error", message: msg },
              ${escapedTargetOrigin},
            );
          } catch (e) {}
        }
      } catch (e) {}
    </script>
  </body>
</html>`;
}

export interface RunBuilderAgentArgs {
  prompt: string;
  projectId?: string;
  branchName?: string;
  userEmail?: string;
  userId?: string;
}

export interface RunBuilderAgentResult {
  branchName: string;
  projectId: string;
  url: string;
  status: string;
}

function normalizeBuilderApiString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Builder agent run returned a blank ${fieldName}`);
  }
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`Builder agent run returned a malformed ${fieldName}`);
  }
  return trimmed;
}

function normalizeBuilderBranchUrl(value: unknown): string {
  const urlString = normalizeBuilderApiString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Builder agent run returned a malformed url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Builder agent run returned a malformed url");
  }
  if (
    parsed.hostname !== "builder.io" &&
    !parsed.hostname.endsWith(".builder.io")
  ) {
    throw new Error("Builder agent run returned a non-Builder url");
  }
  return parsed.toString();
}

/**
 * POST a prompt to the Builder agents-run API. The Builder agent runs in a
 * cloud sandbox and writes code to a branch; the returned URL opens that
 * branch in the Visual Editor so the user can watch progress.
 *
 * Spec: https://www.builder.io/c/docs/agents-run-api
 */
export async function runBuilderAgent(
  args: RunBuilderAgentArgs,
): Promise<RunBuilderAgentResult> {
  const { resolveBuilderCredentials } =
    await import("./credential-provider.js");
  const creds = await resolveBuilderCredentials();
  if (!creds.privateKey || !creds.publicKey) {
    throw new Error("Builder keys are not configured");
  }
  if (!args.prompt || !args.prompt.trim()) {
    throw new Error("prompt is required");
  }
  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error(
      "Builder project ID is not configured. Set DISPATCH_BUILDER_PROJECT_ID, BUILDER_BRANCH_PROJECT_ID, or BUILDER_PROJECT_ID.",
    );
  }
  const builderUserId = args.userId || creds.userId || undefined;
  const builderUserEmail = builderUserId ? undefined : args.userEmail;
  if (!builderUserEmail && !builderUserId) {
    throw new Error("userEmail or userId is required");
  }

  const url = new URL("/agents/run", getBuilderApiHost());
  url.searchParams.set("apiKey", creds.publicKey);

  const body: Record<string, unknown> = {
    userMessage: { userPrompt: args.prompt },
    projectId,
  };
  if (args.branchName) body.branchName = args.branchName;
  if (builderUserEmail) body.userEmail = builderUserEmail;
  if (builderUserId) body.userId = builderUserId;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const parsed = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const msg =
      typeof parsed.error === "string"
        ? parsed.error
        : `Builder agent run failed (${response.status})`;
    throw new Error(msg);
  }

  return {
    branchName: normalizeBuilderApiString(parsed.branchName, "branchName"),
    projectId:
      typeof parsed.projectId === "string" && parsed.projectId.trim()
        ? parsed.projectId.trim()
        : projectId,
    url: normalizeBuilderBranchUrl(parsed.url),
    status:
      typeof parsed.status === "string" && parsed.status.trim()
        ? parsed.status.trim()
        : "processing",
  };
}

export async function requestBuilderBrowserConnection(
  args: BrowserConnectionArgs,
): Promise<Record<string, unknown>> {
  const { resolveBuilderCredentials } =
    await import("./credential-provider.js");
  const creds = await resolveBuilderCredentials();
  if (!creds.privateKey || !creds.publicKey) {
    throw new Error("Builder browser access is not configured");
  }

  const sessionId = args.sessionId?.trim();
  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const url = new URL("/codegen/get-browser-connection", getBuilderApiHost());
  url.searchParams.set("apiKey", creds.publicKey);
  if (creds.userId) {
    url.searchParams.set("userId", creds.userId);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      projectId: args.projectId || undefined,
      branchName: args.branchName || undefined,
      proxyOrigin: args.proxyOrigin || undefined,
      proxyDefaultOrigin: args.proxyDefaultOrigin || undefined,
      proxyDst: args.proxyDestination || undefined,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error =
      typeof body.error === "string"
        ? body.error
        : `Builder browser request failed (${response.status})`;
    throw new Error(error);
  }

  return body;
}
