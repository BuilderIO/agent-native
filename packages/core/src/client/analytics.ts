import * as amplitude from "@amplitude/analytics-browser";
import * as Sentry from "@sentry/browser";

import {
  llmConnectionTrackingProperties,
  type LlmConnectionStatus,
} from "../shared/llm-connection.js";
import { agentNativePath } from "./api-path.js";
import type {
  SessionReplayOptions,
  SessionReplayStartResult,
} from "./session-replay.js";
import { scrubUrl } from "./url-scrub.js";
export { scrubUrl } from "./url-scrub.js";
export type {
  SessionReplayOptions,
  SessionReplayStartResult,
  SessionReplayUrlMatcher,
} from "./session-replay.js";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    __AGENT_NATIVE_CONFIG__?: {
      sentryDsn?: string;
      sentryEnvironment?: string;
    };
  }
}

type GetDefaultProps = (
  name: string,
  properties: Record<string, unknown>,
) => Record<string, unknown>;

type PageviewTrackingState = {
  installed: boolean;
  lastPageviewKey: string | null;
};

export type ConfigureTrackingOptions = {
  /**
   * Agent Native first-party analytics public key. This mirrors hosted
   * analytics SDKs where consumers pass the key at setup time instead of
   * relying on build-time environment variables.
   */
  key?: string;
  /** Alias for `key`, matching the replay ingest payload name. */
  publicKey?: string;
  /** First-party analytics track endpoint. */
  endpoint?: string;
  getDefaultProps?: GetDefaultProps;
  sessionReplay?: boolean | SessionReplayOptions;
};

type SentryUser = {
  id?: string;
  email?: string;
  username?: string;
};

type TrackingIdentity = {
  userId?: string;
  userEmail?: string;
  userName?: string;
  orgId?: string | null;
};

let _getDefaultProps: GetDefaultProps | null = null;
let _agentNativeAnalyticsPublicKey: string | null = null;
let _agentNativeAnalyticsEndpoint: string | null = null;
let _amplitudeInitialized = false;
let _sentryInitialized = false;
let _llmConnectionStatus: LlmConnectionStatus | null = null;
let _llmConnectionRefresh: Promise<void> | null = null;
let _llmConnectionRefreshInstalled = false;
let _trackingIdentity: TrackingIdentity | null = null;
let _trackingIdentityResolved = false;
let _trackingSessionRefresh: Promise<void> | null = null;
let _trackingSessionRefreshInstalled = false;
let _sessionReplayOptions: SessionReplayOptions | null = null;
let _sessionReplayIdentitySnapshot: TrackingIdentity | null = null;
let _sessionReplayStartPromise: Promise<SessionReplayStartResult | null> | null =
  null;
// Buffer for setSentryUser calls made before Sentry has initialized.
// `undefined` means "no pending update"; `null` means "pending clear".
let _pendingSentryUser: SentryUser | null | undefined = undefined;
let _pendingSentryOrgId: string | null | undefined = undefined;

const AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT =
  "https://analytics.agent-native.com/track";
const PAGEVIEW_TRACKING_STATE_KEY = Symbol.for(
  "agent-native.client.pageviewTracking",
);

const ANONYMOUS_ID_STORAGE_KEY = "agent-native.anonymous_id";
const SESSION_ID_STORAGE_KEY = "agent-native.session_id";
const SESSION_LAST_ACTIVITY_STORAGE_KEY = "agent-native.session_last_activity";
const LLM_CONNECTION_STORAGE_KEY = "agent-native.llm_connection_status";
const LLM_CONNECTION_CACHE_TTL_MS = 5 * 60 * 1000;
// 30-minute idle timeout matches GA4 / Mixpanel defaults — a tab left open
// overnight starts a new session in the morning rather than stretching one
// session over multiple visits.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// First-touch referral attribution (viral attribution). Captured once on the
// visitor's first page load and persisted across the signup boundary so the
// server-side `signup` event can record where the user came from. First-write
// wins — an existing value is never overwritten.
const FIRST_TOUCH_STORAGE_KEY = "an_attribution";
const FIRST_TOUCH_COOKIE_NAME = "an_ft";
// 30 days, matching the session cookie lifetime — long enough to bridge a
// "land today, sign up next week" path without retaining attribution forever.
const FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS = 2592000;
const FIRST_TOUCH_MAX_FIELD_LENGTH = 120;
// Keep the serialized cookie well under the ~4KB browser cap; we bail rather
// than write a runaway cookie if some field combination blows past this.
const FIRST_TOUCH_MAX_COOKIE_BYTES = 1500;
const FIRST_TOUCH_QUERY_FIELDS = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

let _firstTouchCaptured = false;

export interface FirstTouchAttribution {
  ref?: string;
  via?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing_path?: string;
  landing_referrer?: string;
  landed_at?: string;
}

function generateVisitorId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to Math.random
  }
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private browsing / storage disabled — best-effort
  }
}

function readCachedLlmConnectionStatus(): LlmConnectionStatus | null {
  if (typeof window === "undefined") return null;
  const raw = safeStorageGet(LLM_CONNECTION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LlmConnectionStatus & {
      cachedAt?: number;
    };
    if (
      typeof parsed.cachedAt !== "number" ||
      Date.now() - parsed.cachedAt > LLM_CONNECTION_CACHE_TTL_MS
    ) {
      return null;
    }
    return {
      configured: parsed.configured,
      engine: parsed.engine,
      model: parsed.model,
      source: parsed.source,
      envVar: parsed.envVar,
    };
  } catch {
    return null;
  }
}

function cacheLlmConnectionStatus(status: LlmConnectionStatus): void {
  if (typeof window === "undefined") return;
  safeStorageSet(
    LLM_CONNECTION_STORAGE_KEY,
    JSON.stringify({ ...status, cachedAt: Date.now() }),
  );
}

function normalizeAgentEngineStatus(data: unknown): LlmConnectionStatus {
  const value = data as Record<string, unknown> | null;
  if (!value || value.configured !== true) {
    return { configured: false };
  }
  return {
    configured: true,
    engine: typeof value.engine === "string" ? value.engine : null,
    model: typeof value.model === "string" ? value.model : null,
    source: typeof value.source === "string" ? value.source : null,
    envVar: typeof value.envVar === "string" ? value.envVar : null,
  };
}

function refreshLlmConnectionStatus(): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return Promise.resolve();
  }
  if (_llmConnectionRefresh) return _llmConnectionRefresh;
  let request: Promise<Response>;
  try {
    request = fetch(agentNativePath("/_agent-native/agent-engine/status"));
  } catch {
    return Promise.resolve();
  }
  _llmConnectionRefresh = request
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      _llmConnectionStatus = normalizeAgentEngineStatus(data);
      cacheLlmConnectionStatus(_llmConnectionStatus);
    })
    .catch(() => {
      if (!_llmConnectionStatus) {
        _llmConnectionStatus = readCachedLlmConnectionStatus();
      }
    })
    .finally(() => {
      _llmConnectionRefresh = null;
    });
  return _llmConnectionRefresh;
}

function installLlmConnectionRefresh(): void {
  if (typeof window === "undefined" || _llmConnectionRefreshInstalled) return;
  _llmConnectionRefreshInstalled = true;
  _llmConnectionStatus = readCachedLlmConnectionStatus();
  void refreshLlmConnectionStatus();
  window.addEventListener("focus", () => {
    void refreshLlmConnectionStatus();
  });
  window.addEventListener("agent-engine:configured-changed", () => {
    void refreshLlmConnectionStatus();
  });
}

function readTrackingString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stopSessionReplayForAuthClear(
  previousIdentity: TrackingIdentity | null,
): void {
  if (!_sessionReplayOptions?.requireSignedInUser) {
    _sessionReplayIdentitySnapshot = null;
    return;
  }
  if (!previousIdentity?.userEmail) return;
  _sessionReplayIdentitySnapshot = previousIdentity;
  void import("./session-replay.js")
    .then((mod) => mod.stopSessionReplay("auth-cleared"))
    .catch(() => {
      // Auth clearing should never fail because replay cleanup failed.
    })
    .finally(() => {
      if (_sessionReplayIdentitySnapshot === previousIdentity) {
        _sessionReplayIdentitySnapshot = null;
      }
    });
}

function clearTrackingIdentity(): void {
  const previousIdentity = _trackingIdentity;
  stopSessionReplayForAuthClear(previousIdentity);
  _trackingIdentity = null;
}

function setTrackingIdentityFromSession(data: unknown): void {
  const session = data as Record<string, unknown> | null;
  if (!session || typeof session !== "object" || session.error) {
    clearTrackingIdentity();
    return;
  }
  const email = readTrackingString(session.email);
  const authUserId = readTrackingString(session.userId);
  const userId = email || authUserId;
  if (!userId) {
    clearTrackingIdentity();
    return;
  }
  const userName = readTrackingString(session.name);
  _trackingIdentity = {
    userId,
    ...(email ? { userEmail: email } : {}),
    ...(userName ? { userName } : {}),
    orgId: readTrackingString(session.orgId) ?? null,
  };
}

function refreshTrackingAuthSession(): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    _trackingIdentityResolved = true;
    return Promise.resolve();
  }
  if (_trackingSessionRefresh) return _trackingSessionRefresh;
  _trackingSessionRefresh = fetch(
    agentNativePath("/_agent-native/auth/session"),
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      setTrackingIdentityFromSession(data);
    })
    .catch(() => {
      clearTrackingIdentity();
    })
    .finally(() => {
      _trackingIdentityResolved = true;
      _trackingSessionRefresh = null;
    });
  return _trackingSessionRefresh;
}

function installTrackingAuthSessionRefresh(): void {
  if (typeof window === "undefined" || _trackingSessionRefreshInstalled) return;
  _trackingSessionRefreshInstalled = true;
  void refreshTrackingAuthSession();
  window.addEventListener("focus", () => {
    void refreshTrackingAuthSession();
  });
}

function applyTrackingIdentity(
  properties: Record<string, unknown>,
  identity: TrackingIdentity | null = _trackingIdentity,
): Record<string, unknown> {
  if (!identity) return properties;
  let next = properties;
  const assign = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && next[key] === undefined) {
      if (next === properties) next = { ...properties };
      next[key] = value;
    }
  };
  assign("userId", identity.userId);
  assign("userEmail", identity.userEmail);
  assign("userName", identity.userName);
  assign("orgId", identity.orgId);
  return next;
}

function getOrCreateAnonymousId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  let id = safeStorageGet(ANONYMOUS_ID_STORAGE_KEY);
  if (!id) {
    id = generateVisitorId();
    safeStorageSet(ANONYMOUS_ID_STORAGE_KEY, id);
  }
  return id;
}

export function getAnalyticsAnonymousId(): string | undefined {
  return getOrCreateAnonymousId();
}

function getOrCreateSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const now = Date.now();
  const lastActivityRaw = safeStorageGet(SESSION_LAST_ACTIVITY_STORAGE_KEY);
  const lastActivity = lastActivityRaw
    ? Number.parseInt(lastActivityRaw, 10)
    : 0;
  let id = safeStorageGet(SESSION_ID_STORAGE_KEY);
  const expired =
    !lastActivity ||
    Number.isNaN(lastActivity) ||
    now - lastActivity > SESSION_IDLE_TIMEOUT_MS;
  if (!id || expired) {
    id = generateVisitorId();
    safeStorageSet(SESSION_ID_STORAGE_KEY, id);
  }
  safeStorageSet(SESSION_LAST_ACTIVITY_STORAGE_KEY, String(now));
  return id;
}

export function getAnalyticsSessionId(): string | undefined {
  return getOrCreateSessionId();
}

function truncateFirstTouchField(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, FIRST_TOUCH_MAX_FIELD_LENGTH);
}

/**
 * Extract just the host of a referrer URL — never the full URL or query
 * string (those can carry tokens). Returns "" when there's no usable host or
 * the referrer is same-origin (a same-site navigation isn't a referral).
 */
function scrubReferrerHost(referrer: string | undefined): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    const host = url.host;
    if (!host) return "";
    if (
      typeof window !== "undefined" &&
      host.toLowerCase() === window.location.host.toLowerCase()
    ) {
      return "";
    }
    return truncateFirstTouchField(host);
  } catch {
    return "";
  }
}

function buildFirstTouchAttribution(): FirstTouchAttribution {
  const attribution: FirstTouchAttribution = {};
  let params: URLSearchParams | null = null;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    params = null;
  }
  if (params) {
    for (const field of FIRST_TOUCH_QUERY_FIELDS) {
      const value = truncateFirstTouchField(params.get(field));
      if (value) attribution[field] = value;
    }
  }
  const landingPath = truncateFirstTouchField(window.location.pathname);
  if (landingPath) attribution.landing_path = landingPath;
  const landingReferrer =
    typeof document !== "undefined" ? scrubReferrerHost(document.referrer) : "";
  if (landingReferrer) attribution.landing_referrer = landingReferrer;
  attribution.landed_at = new Date().toISOString();
  return attribution;
}

function readFirstTouchCookie(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (const part of cookies) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const name = part.slice(0, eq).trim();
      if (name === FIRST_TOUCH_COOKIE_NAME) {
        return part.slice(eq + 1).trim();
      }
    }
  } catch {
    // document.cookie can throw in sandboxed iframes — best-effort.
  }
  return null;
}

function writeFirstTouchCookie(encodedValue: string): void {
  if (typeof document === "undefined") return;
  // Non-sensitive, written by client JS, so no HttpOnly. SameSite=Lax keeps it
  // on top-level navigations (which is how share links arrive) without leaking
  // it to cross-site subresource requests.
  const cookie =
    `${FIRST_TOUCH_COOKIE_NAME}=${encodedValue}; path=/; ` +
    `max-age=${FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  if (cookie.length > FIRST_TOUCH_MAX_COOKIE_BYTES) return;
  try {
    document.cookie = cookie;
  } catch {
    // best-effort
  }
}

/**
 * Capture the visitor's first-touch referral attribution exactly once. Reads
 * the current URL query params + landing info and, IF no attribution is
 * already stored (first-write-wins), persists it to both `localStorage`
 * (`an_attribution`) and the first-party `an_ft` cookie. Fully defensive and
 * SSR-safe — any failure is swallowed so it can never break app boot.
 */
function captureFirstTouchAttribution(): void {
  if (_firstTouchCaptured) return;
  _firstTouchCaptured = true;
  if (typeof window === "undefined") return;
  try {
    const existing = safeStorageGet(FIRST_TOUCH_STORAGE_KEY);
    if (existing) {
      // Already captured in a prior visit. Backfill the cookie if it expired
      // or was cleared so the signup boundary still sees first-touch data, but
      // never overwrite the stored value itself (first-write-wins).
      if (!readFirstTouchCookie()) {
        try {
          writeFirstTouchCookie(encodeURIComponent(existing));
        } catch {
          // ignore
        }
      }
      return;
    }
    const attribution = buildFirstTouchAttribution();
    const json = JSON.stringify(attribution);
    safeStorageSet(FIRST_TOUCH_STORAGE_KEY, json);
    writeFirstTouchCookie(encodeURIComponent(json));
  } catch {
    // Attribution is best-effort telemetry; never let it break boot.
  }
}

/**
 * Return the parsed first-touch referral attribution captured for this
 * visitor, or `null` when none is stored. Reads from `localStorage`
 * (`an_attribution`). SSR-safe and defensive.
 */
export function getFirstTouchAttribution(): FirstTouchAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = safeStorageGet(FIRST_TOUCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as FirstTouchAttribution;
  } catch {
    return null;
  }
}

function isLocalAnalyticsHostname(hostname: string | undefined): boolean {
  const h = (hostname || "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local")
  );
}

function ensureAmplitude(): boolean {
  if (_amplitudeInitialized) return true;
  const key = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_AMPLITUDE_API_KEY;
  if (!key) return false;
  amplitude.init(key, { autocapture: true });
  _amplitudeInitialized = true;
  return true;
}

function hasOnlySourcelessFrames(value: {
  stacktrace?: {
    frames?: Array<{
      filename?: unknown;
      abs_path?: unknown;
      function?: unknown;
    }>;
  };
}): boolean {
  const frames = value.stacktrace?.frames ?? [];
  return (
    frames.length === 0 ||
    frames.every((frame) => {
      const filename = String(frame.filename ?? frame.abs_path ?? "")
        .trim()
        .toLowerCase();
      const functionName = String(frame.function ?? "").trim();
      return (
        !functionName &&
        (!filename || filename === "undefined" || filename === "<anonymous>")
      );
    })
  );
}

function isAgentNativeDocsUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "www.agent-native.com" ||
      parsed.hostname === "agent-native.com"
    );
  } catch {
    return false;
  }
}

function shouldDropBrowserSentryNoise(event: Sentry.Event): boolean {
  const exceptionValues = event.exception?.values ?? [];
  const requestUrl = event.request?.url?.toLowerCase() ?? "";
  const isDocsPage = isAgentNativeDocsUrl(requestUrl);
  // AgentAutoContinueSignal is a control-flow sentinel thrown to bubble
  // out of the SSE stream parser when the agent run needs to be
  // auto-continued. It's caught by the chat adapter and is never a real
  // error. Drop it unconditionally — capturing it as a Sentry exception
  // pollutes the issue list with sentinels that have no actionable stack.
  if (
    exceptionValues.some((value) => value.type === "AgentAutoContinueSignal")
  ) {
    return true;
  }
  // Browser-side access control rejections usually mean a tab outlived the
  // session or hit a protected route while signed out. The server Sentry setup
  // already drops these bare auth errors; mirror that here for client-captured
  // route/query failures.
  if (
    exceptionValues.some((value) => {
      const exceptionType = String(value.type ?? "")
        .trim()
        .toLowerCase();
      const exceptionValue = String(value.value ?? "")
        .trim()
        .toLowerCase();
      return (
        exceptionType === "unauthorizederror" ||
        exceptionType === "unauthenticatederror" ||
        exceptionValue === "unauthorized" ||
        exceptionValue === "unauthenticated"
      );
    })
  ) {
    return true;
  }
  // Safari occasionally reports a source-less global `EmptyRanges` reference
  // error while browsing public pages. There is no script URL or function to
  // map back to our bundle, so keep the filter narrow and only drop it when
  // every frame is missing/undefined.
  if (
    exceptionValues.some((value) => {
      const exceptionType = String(value.type ?? "")
        .trim()
        .toLowerCase();
      const exceptionValue = String(value.value ?? "")
        .trim()
        .toLowerCase();
      if (
        exceptionType !== "referenceerror" ||
        !exceptionValue.includes("emptyranges")
      ) {
        return false;
      }
      return hasOnlySourcelessFrames(value);
    })
  ) {
    return true;
  }
  if (
    isDocsPage &&
    exceptionValues.some((value) => {
      const exceptionValue = String(value.value ?? "").toLowerCase();
      return exceptionValue.includes(
        "window.webkit.messagehandlers.scrolleventhandler.postmessage",
      );
    })
  ) {
    return true;
  }
  if (
    isDocsPage &&
    exceptionValues.some((value) => {
      const exceptionType = String(value.type ?? "")
        .trim()
        .toLowerCase();
      const exceptionValue = String(value.value ?? "")
        .trim()
        .toLowerCase();
      return (
        exceptionType === "rangeerror" &&
        exceptionValue.includes("maximum call stack") &&
        hasOnlySourcelessFrames(value)
      );
    })
  ) {
    return true;
  }
  // Exact user/navigation aborts are expected browser behavior. Keep other
  // AbortError shapes visible unless they match this common non-bug message.
  if (
    exceptionValues.some((value) => {
      const exceptionType = String(value.type ?? "")
        .trim()
        .toLowerCase();
      const exceptionValue = String(value.value ?? "")
        .trim()
        .toLowerCase();
      return (
        exceptionValue === "the user aborted a request." ||
        exceptionValue === "signal is aborted without reason" ||
        exceptionValue === "aborterror: the user aborted a request." ||
        exceptionValue === "aborterror: signal is aborted without reason" ||
        (exceptionType === "aborterror" &&
          (exceptionValue.includes("the user aborted a request") ||
            exceptionValue.includes("signal is aborted without reason")))
      );
    })
  ) {
    return true;
  }
  const exceptionText = exceptionValues
    .map((value) => `${value.type ?? ""} ${value.value ?? ""}`)
    .join(" ")
    .toLowerCase();
  const breadcrumbText = (event.breadcrumbs ?? [])
    .map((crumb) => {
      const data = crumb.data as Record<string, unknown> | undefined;
      return [
        crumb.category,
        crumb.message,
        typeof data?.url === "string" ? data.url : "",
      ].join(" ");
    })
    .join(" ")
    .toLowerCase();
  const combined = `${exceptionText} ${requestUrl} ${breadcrumbText}`;
  return (
    combined.includes("api2.amplitude.com") &&
    (combined.includes("failed to fetch") ||
      combined.includes("networkerror") ||
      combined.includes("load failed"))
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function resolveClientSentryDsnFromKeyProject(
  env: Record<string, string | undefined>,
): string | undefined {
  const key = firstNonEmpty(env.VITE_SENTRY_CLIENT_KEY);
  const projectId = firstNonEmpty(env.VITE_SENTRY_PROJECT_ID);
  const host = firstNonEmpty(env.VITE_SENTRY_INGEST_HOST);
  if (!key || !projectId || !host) return undefined;
  return `https://${key}@${host}/${projectId}`;
}

function getClientSentryDsn(): string | undefined {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  return (
    env.VITE_SENTRY_CLIENT_DSN ||
    env.VITE_SENTRY_DSN ||
    window.__AGENT_NATIVE_CONFIG__?.sentryDsn ||
    resolveClientSentryDsnFromKeyProject(env)
  );
}

function ensureSentry(): void {
  if (_sentryInitialized) return;
  const dsn = getClientSentryDsn();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment:
      window.__AGENT_NATIVE_CONFIG__?.sentryEnvironment ||
      (import.meta.env as Record<string, string | undefined>)?.MODE ||
      "production",
    beforeSend(event) {
      if (shouldDropBrowserSentryNoise(event)) {
        return null;
      }
      // Strip sensitive query params from the request URL. React Router
      // history can include share tokens, ?signin=1, password reset codes,
      // public-share password params (audit F-07), etc.
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      // Clean the same params from breadcrumb URLs (Sentry captures
      // history.pushState breadcrumbs by default).
      if (Array.isArray(event.breadcrumbs)) {
        for (const crumb of event.breadcrumbs) {
          if (crumb && typeof crumb === "object" && "data" in crumb) {
            const data = crumb.data as Record<string, unknown> | undefined;
            if (data && typeof data.url === "string") {
              data.url = scrubUrl(data.url);
            }
            if (data && typeof data.from === "string") {
              data.from = scrubUrl(data.from);
            }
            if (data && typeof data.to === "string") {
              data.to = scrubUrl(data.to);
            }
          }
        }
      }
      return event;
    },
  });
  Sentry.setTag("runtime", "browser");
  _sentryInitialized = true;
  // Flush any user/tag that was set before init.
  if (_pendingSentryUser !== undefined) {
    Sentry.setUser(_pendingSentryUser);
    _pendingSentryUser = undefined;
  }
  if (_pendingSentryOrgId !== undefined) {
    Sentry.setTag("orgId", _pendingSentryOrgId);
    _pendingSentryOrgId = undefined;
  }
}

/**
 * Attach the current user to Sentry events from the browser. Pass `null` to
 * clear (e.g. on logout). If Sentry isn't initialized yet, the value is
 * buffered and applied once `ensureSentry()` runs.
 *
 * Pass `orgId` to also tag events with the active organization ID — useful
 * for filtering Sentry by tenant.
 */
export function setSentryUser(
  user: SentryUser | null,
  orgId?: string | null,
): void {
  let shouldRetryReplay = false;
  if (user) {
    const userId = user.email || user.id;
    if (userId) {
      _trackingIdentity = {
        userId,
        ...(user.email ? { userEmail: user.email } : {}),
        ...(user.username ? { userName: user.username } : {}),
        orgId: orgId ?? null,
      };
    } else {
      clearTrackingIdentity();
    }
    shouldRetryReplay = Boolean(user.email);
  } else {
    clearTrackingIdentity();
  }
  _trackingIdentityResolved = true;
  if (shouldRetryReplay && _sessionReplayOptions?.requireSignedInUser) {
    void startConfiguredSessionReplay(_sessionReplayOptions);
  }
  if (_sentryInitialized) {
    Sentry.setUser(user);
    if (orgId !== undefined) {
      Sentry.setTag("orgId", orgId ?? null);
    }
    return;
  }
  _pendingSentryUser = user;
  if (orgId !== undefined) {
    _pendingSentryOrgId = orgId ?? null;
  }
}

export interface ClientCaptureContext {
  /** Searchable Sentry tags (low-cardinality strings only). */
  tags?: Record<string, string | undefined>;
  /**
   * High-cardinality / structured payload — not searchable but visible in
   * the Sentry event detail (file sizes, request URLs, response body
   * tails, etc.).
   */
  extra?: Record<string, unknown>;
  /**
   * Grouped contexts shown as separate cards in the Sentry event UI.
   */
  contexts?: Record<string, Record<string, unknown>>;
}

/**
 * Capture an exception to Sentry from browser code without forcing the
 * caller to depend on `@sentry/browser` directly.
 *
 * Templates can route a thrown Error through here on a known failure path
 * (chunk-upload 500, thumbnail upload, etc.) to attach searchable tags and
 * structured extra context. No-ops gracefully when Sentry isn't
 * initialized — never throws back into the caller, so a Sentry hiccup
 * can't mask the original error.
 */
export function captureClientException(
  error: unknown,
  context: ClientCaptureContext = {},
): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    ensureSentry();
    return Sentry.withScope((scope) => {
      if (context.tags) {
        for (const [k, v] of Object.entries(context.tags)) {
          if (typeof v === "string") scope.setTag(k, v);
        }
      }
      if (context.extra) {
        for (const [k, v] of Object.entries(context.extra)) {
          if (v !== undefined) scope.setExtra(k, v);
        }
      }
      if (context.contexts) {
        for (const [k, v] of Object.entries(context.contexts)) {
          scope.setContext(k, v);
        }
      }
      return Sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}

/**
 * Public browser-side error capture utility, mirroring `trackEvent()`:
 * templates can call `captureError(err, { tags, extra, contexts })` without
 * depending on Sentry directly. Sentry receives the event when a browser DSN
 * is configured; otherwise this is a quiet no-op.
 */
export function captureError(
  error: unknown,
  context: ClientCaptureContext = {},
): string | undefined {
  return captureClientException(error, context);
}

function getPageviewTrackingState(): PageviewTrackingState {
  const g = globalThis as typeof globalThis & {
    [PAGEVIEW_TRACKING_STATE_KEY]?: PageviewTrackingState;
  };
  if (!g[PAGEVIEW_TRACKING_STATE_KEY]) {
    g[PAGEVIEW_TRACKING_STATE_KEY] = {
      installed: false,
      lastPageviewKey: null,
    };
  }
  return g[PAGEVIEW_TRACKING_STATE_KEY];
}

export function configureTracking(options: ConfigureTrackingOptions): void {
  const publicKey = options.key || options.publicKey;
  if (publicKey) {
    _agentNativeAnalyticsPublicKey = publicKey;
  }
  if (options.endpoint) {
    _agentNativeAnalyticsEndpoint = options.endpoint;
  }
  if (options.getDefaultProps) {
    _getDefaultProps = options.getDefaultProps;
  }
  if (typeof window !== "undefined") {
    ensureSentry();
    ensureAmplitude();
    captureFirstTouchAttribution();
    installLlmConnectionRefresh();
    installTrackingAuthSessionRefresh();
    installPageviewTracking();
    maybeInstallSessionReplay(options.sessionReplay, {
      endpoint: options.endpoint,
      publicKey,
    });
  }
}

function sessionReplayEnabledFromEnv(): boolean {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  const value =
    env.VITE_AGENT_NATIVE_SESSION_REPLAY_ENABLED ||
    env.VITE_SESSION_REPLAY_ENABLED;
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

function sessionReplayRequiresSignedInUserFromEnv(): boolean | undefined {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  const value =
    env.VITE_AGENT_NATIVE_SESSION_REPLAY_REQUIRE_AUTH ||
    env.VITE_SESSION_REPLAY_REQUIRE_AUTH;
  const normalized = (value ?? "").trim();
  if (!normalized) return undefined;
  if (/^(1|true|yes|on)$/i.test(normalized)) return true;
  if (/^(0|false|no|off)$/i.test(normalized)) return false;
  return undefined;
}

function configuredSessionReplayOptions(
  config: boolean | SessionReplayOptions | undefined,
  tracking: { endpoint?: string; publicKey?: string } = {},
): SessionReplayOptions | null {
  const publicKey = tracking.publicKey || _agentNativeAnalyticsPublicKey;
  const trackingEndpoint = tracking.endpoint || _agentNativeAnalyticsEndpoint;
  const endpoint = trackingEndpoint
    ? replayEndpointFromTrackingEndpoint(trackingEndpoint)
    : undefined;
  const withTrackingDefaults = (
    options: SessionReplayOptions,
  ): SessionReplayOptions => {
    const extraProperties = replayExtraPropertiesWithDefaults(
      options.extraProperties,
    );
    return {
      ...(publicKey && !options.publicKey ? { publicKey } : {}),
      ...(endpoint && !options.endpoint ? { endpoint } : {}),
      ...options,
      requireSignedInUser:
        options.requireSignedInUser ??
        sessionReplayRequiresSignedInUserFromEnv() ??
        true,
      ...(extraProperties ? { extraProperties } : {}),
    };
  };

  if (config === false) return null;
  if (config === true) return withTrackingDefaults({});
  if (config && typeof config === "object") {
    if (config.enabled === false) return null;
    return withTrackingDefaults(config);
  }
  return sessionReplayEnabledFromEnv() ? withTrackingDefaults({}) : null;
}

function replayExtraPropertiesWithDefaults(
  source: SessionReplayOptions["extraProperties"],
): SessionReplayOptions["extraProperties"] {
  return () => {
    const rawProps =
      typeof source === "function"
        ? source()
        : source && typeof source === "object"
          ? source
          : {};
    const props = rawProps && typeof rawProps === "object" ? rawProps : {};
    const withDefaults = _getDefaultProps?.("session_replay", props) ?? props;
    return applyTrackingIdentity(
      withDefaults,
      _trackingIdentity ?? _sessionReplayIdentitySnapshot,
    );
  };
}

function replayEndpointFromTrackingEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.pathname.endsWith("/api/analytics/track")) {
      url.pathname = url.pathname.replace(
        /\/api\/analytics\/track$/,
        "/api/analytics/replay",
      );
      return url.toString();
    }
    if (url.pathname.endsWith("/track")) {
      url.pathname = url.pathname.replace(/\/track$/, "/api/analytics/replay");
      return url.toString();
    }
  } catch {
    // Fall through to relative-path handling below.
  }
  if (value.endsWith("/api/analytics/track")) {
    return value.replace(/\/api\/analytics\/track$/, "/api/analytics/replay");
  }
  if (value.endsWith("/track")) {
    return value.replace(/\/track$/, "/api/analytics/replay");
  }
  return undefined;
}

function maybeInstallSessionReplay(
  config: boolean | SessionReplayOptions | undefined,
  tracking?: { endpoint?: string; publicKey?: string },
): void {
  if (typeof window === "undefined") return;
  const options = configuredSessionReplayOptions(config, tracking);
  if (!options) return;
  _sessionReplayOptions = options;
  void startConfiguredSessionReplay(options);
}

async function waitForSessionReplayAuthIfRequired(
  options: SessionReplayOptions,
): Promise<boolean> {
  if (!options.requireSignedInUser) return true;
  if (_trackingIdentity?.userEmail) return true;
  try {
    if (_trackingSessionRefresh) {
      await _trackingSessionRefresh;
    } else if (!_trackingIdentityResolved) {
      await refreshTrackingAuthSession();
    }
  } catch {
    // best-effort; missing identity below keeps replay off
  }
  return !!_trackingIdentity?.userEmail;
}

async function startConfiguredSessionReplay(
  options: SessionReplayOptions,
): Promise<SessionReplayStartResult | null> {
  if (_sessionReplayStartPromise) return _sessionReplayStartPromise;
  _sessionReplayStartPromise = (async () => {
    if (!(await waitForSessionReplayAuthIfRequired(options))) {
      return { started: false, reason: "missing-user-id" as const };
    }
    const mod = await import("./session-replay.js");
    return mod.startSessionReplay(options);
  })()
    .catch(() => ({ started: false, reason: "import-failed" as const }))
    .finally(() => {
      _sessionReplayStartPromise = null;
    });
  return _sessionReplayStartPromise;
}

export async function startSessionReplay(
  options: SessionReplayOptions = {},
): Promise<SessionReplayStartResult> {
  const configured = configuredSessionReplayOptions(options) ?? options;
  if (!(await waitForSessionReplayAuthIfRequired(configured))) {
    return { started: false, reason: "missing-user-id" };
  }
  const mod = await import("./session-replay.js");
  return mod.startSessionReplay(configured);
}

export async function maybeStartSessionReplay(
  options: SessionReplayOptions = {},
): Promise<SessionReplayStartResult> {
  const configured = configuredSessionReplayOptions(options) ?? options;
  if (!(await waitForSessionReplayAuthIfRequired(configured))) {
    return { started: false, reason: "missing-user-id" };
  }
  const mod = await import("./session-replay.js");
  return mod.maybeStartSessionReplay(configured);
}

export async function stopSessionReplay(reason = "manual"): Promise<void> {
  const mod = await import("./session-replay.js");
  await mod.stopSessionReplay(reason);
}

function inferTemplateName(properties: Record<string, unknown>): string | null {
  const envTemplate =
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_AGENT_NATIVE_TEMPLATE ||
    (import.meta.env as Record<string, string | undefined>)?.VITE_APP_TEMPLATE;
  if (envTemplate) return envTemplate;

  const app = typeof properties.app === "string" ? properties.app.trim() : "";
  if (!app || app === "localhost") return null;
  if (app.startsWith("agent-native-")) {
    return app.slice("agent-native-".length);
  }
  return app;
}

function resolveProps(
  name: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof window === "undefined") return { ...params };
  const base: Record<string, unknown> = {
    url: window.location.origin + window.location.pathname,
    app: window.location.hostname.split(".")[0] || "localhost",
    ...params,
  };
  const props = _getDefaultProps ? _getDefaultProps(name, base) : base;
  let withTemplate = props;
  if (withTemplate.template === undefined) {
    const template = inferTemplateName(props);
    if (template) {
      withTemplate = { ...props, template };
    }
  }
  const llmProps = llmConnectionTrackingProperties(_llmConnectionStatus);
  const enriched = { ...withTemplate };
  for (const [key, value] of Object.entries(llmProps)) {
    if (enriched[key] === undefined) enriched[key] = value;
  }
  return applyTrackingIdentity(enriched);
}

function pageviewKey(): string {
  return window.location.href;
}

function pageviewProperties(reason: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    url: scrubUrl(window.location.href),
    path: window.location.pathname,
    hostname: window.location.hostname,
    navigation_type: reason,
  };
  if (window.location.search) {
    properties.search = scrubUrl(window.location.search);
  }
  if (typeof document !== "undefined") {
    if (document.referrer) {
      properties.referrer = scrubUrl(document.referrer);
    }
    if (document.title) {
      properties.title = document.title;
    }
  }
  return properties;
}

function emitPageview(reason: string): void {
  if (isLocalAnalyticsHostname(window.location.hostname)) return;
  const state = getPageviewTrackingState();
  const key = pageviewKey();
  if (state.lastPageviewKey === key) return;
  state.lastPageviewKey = key;
  trackEvent("pageview", pageviewProperties(reason));
}

function schedulePageview(reason: string): void {
  const run = () => emitPageview(reason);
  const pendingStartupContext: Array<Promise<void>> = [];
  if (_llmConnectionRefresh && !_llmConnectionStatus) {
    pendingStartupContext.push(_llmConnectionRefresh);
  }
  if (_trackingSessionRefresh && !_trackingIdentityResolved) {
    pendingStartupContext.push(_trackingSessionRefresh);
  }
  if (pendingStartupContext.length > 0) {
    const timeout = new Promise<void>((resolve) =>
      window.setTimeout(resolve, 250),
    );
    Promise.race([Promise.allSettled(pendingStartupContext), timeout]).finally(
      run,
    );
    return;
  }
  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
    return;
  }
  window.setTimeout(run, 0);
}

function installPageviewTracking(): void {
  const state = getPageviewTrackingState();
  if (state.installed) return;
  state.installed = true;

  schedulePageview("load");

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    schedulePageview("pushState");
    return result;
  };

  window.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    schedulePageview("replaceState");
    return result;
  };

  window.addEventListener("popstate", () => schedulePageview("popstate"));
}

function sendAgentNativeAnalytics(
  name: string,
  properties: Record<string, unknown>,
): void {
  if (isLocalAnalyticsHostname(window.location.hostname)) return;

  const publicKey =
    _agentNativeAnalyticsPublicKey ||
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  if (!publicKey) return;

  const endpoint =
    _agentNativeAnalyticsEndpoint ||
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT ||
    AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT;
  const userId =
    typeof properties.userId === "string" ? properties.userId : undefined;
  const body = JSON.stringify({
    publicKey,
    event: name,
    properties,
    userId,
    anonymousId: getOrCreateAnonymousId(),
    sessionId: getOrCreateSessionId(),
    timestamp: new Date().toISOString(),
  });

  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(endpoint, body);
      if (sent) return;
    }
    fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  } catch {
    // best-effort
  }
}

export function trackEvent(
  name: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  ensureSentry();
  const props = resolveProps(name, params);
  window.gtag?.("event", name.replace(/\s+/g, "_"), props);
  if (ensureAmplitude()) {
    amplitude.track(name, props);
  }
  sendAgentNativeAnalytics(name, props);
}

export function trackSessionStatus(signedIn: boolean): void {
  trackEvent("session status", { signed_in: signedIn });
}
