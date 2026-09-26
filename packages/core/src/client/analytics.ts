import type * as amplitude from "@amplitude/analytics-browser";
import type * as Sentry from "@sentry/browser";

import { recordTrackingEvent } from "../observability/tracing.js";
import {
  AGENT_NATIVE_LIFECYCLE_EVENTS,
  canonicalTrackingEvent,
  legacyLifecycleEvent,
  normalizeTrackingDimension,
  withCanonicalTrackingProperties,
  type AgentNativeLifecycleEventName,
} from "../shared/analytics-events.js";
import {
  ANALYTICS_CLIENT_PLATFORM_PROPERTY,
  type AnalyticsClientPlatform,
} from "../shared/analytics-platform.js";
import {
  llmConnectionTrackingProperties,
  type LlmConnectionStatus,
} from "../shared/llm-connection.js";
import { isQaTestEmail } from "../shared/qa-test-email.js";
import { isSyntheticTrafficValue } from "../shared/test-traffic.js";
import { toPostHogExceptionProperties } from "../tracking/posthog-exception.js";
import { getAnalyticsClientPlatform } from "./analytics-platform.js";
import {
  getOrCreateAnalyticsAnonymousId,
  getOrCreateAnalyticsSessionId,
} from "./analytics-session.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import { clientBuildId } from "./build-compatibility.js";
import { scheduleAfterPaint } from "./use-after-paint.js";
export {
  clearAnalyticsSessionId,
  setAnalyticsSessionId,
} from "./analytics-session.js";
import {
  fetchAgentEngineStatus,
  fetchAuthSessionStatus,
} from "./client-status-requests.js";
import {
  installErrorCapture,
  type CapturedExceptionEvent,
} from "./error-capture.js";
import { isDynamicImportFailureMessage } from "./route-chunk-recovery.js";
import type {
  SessionReplayOptions,
  SessionReplayStartResult,
} from "./session-replay.js";
import { scrubUrl } from "./url-scrub.js";
export { scrubUrl } from "./url-scrub.js";
export {
  addErrorBreadcrumb,
  captureException,
  captureMessage,
  isErrorCaptureInstalled,
  type CaptureExceptionContext,
  type CapturedExceptionEvent,
  type ExceptionBreadcrumb,
  type ExceptionLevel,
} from "./error-capture.js";
export type {
  SessionReplayConsoleOptions,
  SessionReplayNetworkOptions,
  SessionReplayOptions,
  SessionReplayStartResult,
  SessionReplayUrlMatcher,
} from "./session-replay.js";
export {
  getSessionReplayContext,
  getSessionReplayUrl,
} from "./session-replay-context.js";
export type {
  SessionReplayContext,
  SessionReplayLinkOptions,
} from "./session-replay-context.js";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    __AGENT_NATIVE_GA_GTAG__?: (...args: any[]) => void;
    __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: string;
    __AGENT_NATIVE_CONFIG__?: {
      appHomePath?: string;
      appUrl?: string;
      workspaceGatewayUrl?: string;
      workspaceOAuthOrigin?: string;
      workspaceRuntime?: boolean;
      workspaceAppMountPaths?: string[];
      sentryDsn?: string;
      sentryEnvironment?: string;
      deploymentEnvironment?: string;
      posthogKey?: string;
      posthogHost?: string;
      posthogErrorTracking?: boolean;
      agentNativeAnalyticsPublicKey?: string;
      agentNativeAnalyticsEndpoint?: string;
      realtime?: { transport?: string; gatewayBaseUrl?: string };
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

type AppEntryTrackingState = {
  entryKey?: string | null;
  entryKeys?: Set<string>;
};

type AgentChatTrackingState = {
  seen: Map<string, number>;
};

export type ErrorCaptureConfigOptions = {
  release?: string;
  environment?: string;
  captureGlobalErrors?: boolean;
  captureUnhandledRejections?: boolean;
  maxBreadcrumbs?: number;
};

export type ConfigureTrackingOptions = {
  clientPlatform?: AnalyticsClientPlatform;
  key?: string;
  publicKey?: string;
  endpoint?: string;
  getDefaultProps?: GetDefaultProps;
  contentCapture?: boolean;
  contentCaptureForPath?: (pathname: string) => boolean;
  llmConnectionStatus?: boolean;
  authSessionRefresh?: boolean;
  pageviewTracking?: boolean;
  sessionReplay?: boolean | SessionReplayOptions;
  errorCapture?: boolean | ErrorCaptureConfigOptions;
};

export type TrackingIdentityUser = {
  id?: string;
  email?: string;
  username?: string;
};

type TrackingIdentity = {
  userId?: string;
  authUserId?: string;
  userEmail?: string;
  userName?: string;
  orgId?: string | null;
};

let _getDefaultProps: GetDefaultProps | null = null;
let _configuredAnalyticsClientPlatform: AnalyticsClientPlatform | null = null;
let _agentNativeAnalyticsPublicKey: string | null = null;
let _agentNativeAnalyticsEndpoint: string | null = null;
let _amplitudeInitialized = false;
let _amplitudeModule: typeof amplitude | null = null;
let _amplitudeLoadPromise: Promise<typeof amplitude | null> | null = null;
let _amplitudeApiKey: string | null = null;
let _pendingAmplitudeEvents: Array<[string, Record<string, unknown>]> = [];
let _sentryInitialized = false;
let _sentryModule: typeof Sentry | null = null;
let _sentryLoadPromise: Promise<typeof Sentry | null> | null = null;
let _pendingSentryCaptures: Array<{
  error: unknown;
  context: ClientCaptureContext;
}> = [];
let _llmConnectionStatus: LlmConnectionStatus | null = null;
let _llmConnectionRefresh: Promise<void> | null = null;
let _llmConnectionRefreshInstalled = false;
let _llmConnectionBootRefresh: Promise<void> | null = null;
let _trackingIdentity: TrackingIdentity | null = null;
let _trackingIdentityResolved = false;
let _trackingSessionRefresh: Promise<void> | null = null;
let _trackingSessionRefreshInstalled = false;
let _sessionReplayOptions: SessionReplayOptions | null = null;
let _sessionReplayIdentitySnapshot: TrackingIdentity | null = null;
let _sessionReplayStartPromise: Promise<SessionReplayStartResult | null> | null =
  null;
let _errorCaptureInstalled = false;
let _errorCaptureDisposer: (() => void) | null = null;
let _sessionReplayModuleForCapture:
  | typeof import("./session-replay.js")
  | null = null;
let _trackingContentCaptureEnabled = true;
let _contentCaptureForPath: ((pathname: string) => boolean) | null = null;
let _pendingSentryUser: TrackingIdentityUser | null | undefined = undefined;
let _pendingSentryOrgId: string | null | undefined = undefined;

const AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT =
  "https://analytics.agent-native.com/track";
export const AGENT_NATIVE_EXCEPTION_EVENT_NAME = "$exception";
const PAGEVIEW_TRACKING_STATE_KEY = Symbol.for(
  "agent-native.client.pageviewTracking",
);
const APP_ENTRY_TRACKING_STATE_KEY = Symbol.for(
  "agent-native.client.appEntryTracking",
);
const AGENT_CHAT_TRACKING_STATE_KEY = Symbol.for(
  "agent-native.client.agentChatTracking",
);
const AGENT_CHAT_LIFECYCLE_DEDUPE_TTL_MS = 10 * 60 * 1_000;
const MAX_AGENT_CHAT_LIFECYCLE_DEDUPE_KEYS = 1_000;

const LLM_CONNECTION_STORAGE_KEY = "agent-native.llm_connection_status";
const LLM_CONNECTION_CACHE_TTL_MS = 5 * 60 * 1000;

const FIRST_TOUCH_STORAGE_KEY = "an_attribution";
const FIRST_TOUCH_COOKIE_NAME = "an_ft";
const APP_ENTRY_STORAGE_KEY = "agent-native.app_entry";
const APP_LAST_ENTRY_STORAGE_KEY_PREFIX = "agent-native.app_last_entry";
const MAX_APP_ENTRY_KEYS = 100;
const RETURN_USAGE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS = 2592000;
const FIRST_TOUCH_MAX_FIELD_LENGTH = 120;
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
  _llmConnectionRefresh = fetchAgentEngineStatus()
    .then((result) => {
      if (result.state === "available") {
        _llmConnectionStatus = normalizeAgentEngineStatus(result.value);
        cacheLlmConnectionStatus(_llmConnectionStatus);
      } else if (!_llmConnectionStatus) {
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
  _llmConnectionBootRefresh = new Promise<void>((resolve) => {
    scheduleAfterPaint(() => {
      void Promise.race([
        refreshLlmConnectionStatus(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
      ]).finally(resolve);
    });
  });
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

function isQaTrackingIdentity(identity: TrackingIdentity | null): boolean {
  return Boolean(
    identity &&
    (isQaTestEmail(identity.userId) || isQaTestEmail(identity.userEmail)),
  );
}

function isQaTrackingUser(user: TrackingIdentityUser | null): boolean {
  return Boolean(user && (isQaTestEmail(user.id) || isQaTestEmail(user.email)));
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
  const canonicalAuthUserId = readTrackingString(session.authUserId);
  const authUserId = readTrackingString(session.userId);
  const userId = email || canonicalAuthUserId || authUserId;
  if (!userId) {
    clearTrackingIdentity();
    return;
  }
  const userName = readTrackingString(session.name);
  _trackingIdentity = {
    userId,
    ...(canonicalAuthUserId ? { authUserId: canonicalAuthUserId } : {}),
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
  _trackingSessionRefresh = fetchAuthSessionStatus()
    .then((result) => {
      if (result.state === "available") {
        setTrackingIdentityFromSession(result.value);
      }
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
  let next = { ...properties };
  delete next.auth_user_id;
  delete next.authUserId;
  if (!identity) return next;
  const assign = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && next[key] === undefined) {
      next[key] = value;
    }
  };
  assign("userId", identity.userId);
  assign("userEmail", identity.userEmail);
  assign("userName", identity.userName);
  assign("orgId", identity.orgId);
  return next;
}

function getTrackingUserId(): string | undefined {
  return _trackingIdentity?.userId;
}

function getTrackingAuthUserId(): string | undefined {
  return _trackingIdentity?.authUserId;
}

export function getAnalyticsIdentityKey(): string | undefined {
  return getTrackingUserId() || getOrCreateAnonymousId();
}

function getOrCreateAnonymousId(): string | undefined {
  return getOrCreateAnalyticsAnonymousId();
}

export function getAnalyticsAnonymousId(): string | undefined {
  return getOrCreateAnonymousId();
}

function getOrCreateSessionId(): string | undefined {
  return getOrCreateAnalyticsSessionId();
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

function isSyntheticBrowserTraffic(): boolean {
  return (
    typeof window !== "undefined" &&
    isSyntheticTrafficValue(window.__AGENT_NATIVE_SYNTHETIC_TRAFFIC__)
  );
}

function ensureAmplitude(): boolean {
  if (isSyntheticBrowserTraffic()) return false;
  if (_amplitudeInitialized) return true;
  const key = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_AMPLITUDE_API_KEY;
  if (!key) return false;
  _amplitudeApiKey = key;
  if (_amplitudeLoadPromise) return false;

  _amplitudeLoadPromise = import("@amplitude/analytics-browser")
    .then((module) => {
      module.init(key, { autocapture: false });
      _amplitudeModule = module;
      _amplitudeInitialized = true;
      for (const [name, properties] of _pendingAmplitudeEvents) {
        module.track(name, properties);
      }
      _pendingAmplitudeEvents = [];
      return module;
    })
    .catch(() => {
      _pendingAmplitudeEvents = [];
      return null;
    })
    .finally(() => {
      _amplitudeLoadPromise = null;
    });
  return false;
}

function hasBrowserTrackingDestination(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return Boolean(
    _agentNativeAnalyticsPublicKey ||
    window.__AGENT_NATIVE_CONFIG__?.agentNativeAnalyticsPublicKey ||
    env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY ||
    env.VITE_AMPLITUDE_API_KEY,
  );
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

function isSessionReplayUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /^\/sessions\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function shouldDropBrowserSentryNoise(event: Sentry.Event): boolean {
  const exceptionValues = event.exception?.values ?? [];
  const taggedUrl =
    typeof event.tags?.url === "string" ? event.tags.url : undefined;
  const requestUrl = (event.request?.url ?? taggedUrl ?? "").toLowerCase();
  const isDocsPage = isAgentNativeDocsUrl(requestUrl);
  if (
    exceptionValues.some((value) =>
      isDynamicImportFailureMessage(
        `${value.type ?? ""}: ${value.value ?? ""}`,
      ),
    )
  ) {
    return true;
  }

  if (
    event.tags?.context === "agent-native-chat" &&
    event.tags?.errorCode === "run_timeout" &&
    event.tags?.reconnectTimedOut === "false" &&
    event.tags?.reconnectTerminalReason === "run_timeout"
  ) {
    return true;
  }
  if (
    isSessionReplayUrl(requestUrl) &&
    exceptionValues.some((value) => {
      const exceptionValue = String(value.value ?? "")
        .trim()
        .toLowerCase();
      return (
        exceptionValue.includes("notallowederror: play() failed") &&
        exceptionValue.includes("user didn't interact with the document first")
      );
    })
  ) {
    return true;
  }
  if (
    exceptionValues.some((value) => value.type === "AgentAutoContinueSignal")
  ) {
    return true;
  }
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

function resolveClientDeploymentEnvironment(): string {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  return (
    window.__AGENT_NATIVE_CONFIG__?.deploymentEnvironment ||
    injectedAgentNativeConfig().deployment?.environment ||
    env.VITE_AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT ||
    env.VITE_SENTRY_ENVIRONMENT ||
    window.__AGENT_NATIVE_CONFIG__?.sentryEnvironment ||
    env.MODE ||
    "production"
  );
}

function resolveClientRelease(): string {
  return `agent-native-client@${clientBuildId() || "development"}`;
}

function captureWithSentry(
  module: typeof Sentry,
  error: unknown,
  context: ClientCaptureContext,
): string | undefined {
  return module.withScope((scope) => {
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
    return module.captureException(error);
  });
}

function ensureSentry(loadWithoutDsn = false): void {
  if (isSyntheticBrowserTraffic()) return;
  if (_sentryInitialized || _sentryLoadPromise) return;
  const dsn = getClientSentryDsn();
  if (!dsn && !loadWithoutDsn) return;
  _sentryLoadPromise = import("@sentry/browser")
    .then((module) => {
      _sentryModule = module;
      if (!dsn) {
        for (const pending of _pendingSentryCaptures) {
          captureWithSentry(module, pending.error, pending.context);
        }
        _pendingSentryCaptures = [];
        return module;
      }
      module.init({
        dsn,
        environment: resolveClientDeploymentEnvironment(),
        release: resolveClientRelease(),
        beforeSend(event) {
          if (isSyntheticBrowserTraffic()) return null;
          event.tags = {
            ...event.tags,
            deployment_environment: resolveClientDeploymentEnvironment(),
          };
          if (shouldDropBrowserSentryNoise(event)) {
            return null;
          }
          if (event.request?.url) {
            event.request.url = scrubUrl(event.request.url);
          }
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
      module.setTag("runtime", "browser");
      module.setTag(
        "deployment_environment",
        resolveClientDeploymentEnvironment(),
      );
      _sentryInitialized = true;
      if (_pendingSentryUser !== undefined) {
        module.setUser(_pendingSentryUser);
        _pendingSentryUser = undefined;
      }
      if (_pendingSentryOrgId !== undefined) {
        module.setTag("orgId", _pendingSentryOrgId);
        _pendingSentryOrgId = undefined;
      }
      for (const pending of _pendingSentryCaptures) {
        captureWithSentry(module, pending.error, pending.context);
      }
      _pendingSentryCaptures = [];
      return module;
    })
    .catch(() => null)
    .finally(() => {
      _sentryLoadPromise = null;
    });
}

export function setSentryUser(
  user: TrackingIdentityUser | null,
  orgId?: string | null,
): void {
  const previousIdentity = _trackingIdentity;
  const suppressTracking = isQaTrackingUser(user);
  let shouldRetryReplay = false;
  if (user) {
    const userId = user.email || user.id;
    if (userId) {
      const authUserId =
        user.email && user.email === _trackingIdentity?.userEmail
          ? _trackingIdentity.authUserId
          : undefined;
      _trackingIdentity = {
        userId,
        ...(authUserId ? { authUserId } : {}),
        ...(user.email ? { userEmail: user.email } : {}),
        ...(user.username ? { userName: user.username } : {}),
        orgId: orgId ?? null,
      };
    } else {
      clearTrackingIdentity();
    }
    shouldRetryReplay = Boolean(user.email) && !suppressTracking;
  } else {
    clearTrackingIdentity();
  }
  if (suppressTracking) {
    _pendingSentryCaptures = [];
    stopSessionReplayForAuthClear(previousIdentity);
  }
  _trackingIdentityResolved = true;
  if (
    shouldRetryReplay &&
    _trackingContentCaptureEnabled &&
    _sessionReplayOptions?.requireSignedInUser
  ) {
    void startConfiguredSessionReplay(_sessionReplayOptions);
  }
  if (_sentryInitialized && _sentryModule) {
    _sentryModule.setUser(suppressTracking ? null : user);
    if (orgId !== undefined) {
      _sentryModule.setTag("orgId", orgId ?? null);
    }
    return;
  }
  _pendingSentryUser = suppressTracking ? null : user;
  if (orgId !== undefined) {
    _pendingSentryOrgId = orgId ?? null;
  }
}

export function setTrackingIdentity(
  user: TrackingIdentityUser | null,
  orgId?: string | null,
): void {
  setSentryUser(user, orgId);
}

export interface ClientCaptureContext {
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
}

export function captureClientException(
  error: unknown,
  context: ClientCaptureContext = {},
): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (isSyntheticBrowserTraffic()) return undefined;
  if (isQaTrackingIdentity(_trackingIdentity)) return undefined;
  try {
    ensureSentry(true);
    if (_sentryModule) return captureWithSentry(_sentryModule, error, context);
    if (_pendingSentryCaptures.length < 50) {
      _pendingSentryCaptures.push({ error, context });
    }
    return undefined;
  } catch {
    return undefined;
  }
}

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

function getAppEntryTrackingState(): AppEntryTrackingState {
  const g = globalThis as typeof globalThis & {
    [APP_ENTRY_TRACKING_STATE_KEY]?: AppEntryTrackingState;
  };
  if (!g[APP_ENTRY_TRACKING_STATE_KEY]) {
    g[APP_ENTRY_TRACKING_STATE_KEY] = { entryKeys: new Set() };
  } else if (!g[APP_ENTRY_TRACKING_STATE_KEY].entryKeys) {
    const entryKey = g[APP_ENTRY_TRACKING_STATE_KEY].entryKey;
    g[APP_ENTRY_TRACKING_STATE_KEY].entryKeys = entryKey
      ? new Set([entryKey])
      : new Set();
  }
  return g[APP_ENTRY_TRACKING_STATE_KEY];
}

function getAgentChatTrackingState(): AgentChatTrackingState {
  const g = globalThis as typeof globalThis & {
    [AGENT_CHAT_TRACKING_STATE_KEY]?: AgentChatTrackingState;
  };
  if (!g[AGENT_CHAT_TRACKING_STATE_KEY]) {
    g[AGENT_CHAT_TRACKING_STATE_KEY] = { seen: new Map() };
  }
  return g[AGENT_CHAT_TRACKING_STATE_KEY];
}

export type AgentChatLifecycleEvent = {
  phase: "surface-mounted" | "run-observed" | "run-stopped";
  surface?: string;
  threadId?: string;
  runId?: string;
  tabId?: string;
};

export function trackAgentChatLifecycle(input: AgentChatLifecycleEvent): void {
  if (typeof window === "undefined") return;
  if (isSyntheticBrowserTraffic()) return;
  const surface = input.surface?.trim() || "app";
  const dedupeKey = [
    input.phase,
    surface,
    input.threadId ?? "",
    input.runId ?? "",
    input.tabId ?? "",
  ].join(":");
  const state = getAgentChatTrackingState();
  const now = Date.now();
  for (const [key, seenAt] of state.seen) {
    if (now - seenAt >= AGENT_CHAT_LIFECYCLE_DEDUPE_TTL_MS) {
      state.seen.delete(key);
    }
  }
  if (state.seen.has(dedupeKey)) return;
  state.seen.set(dedupeKey, now);
  while (state.seen.size > MAX_AGENT_CHAT_LIFECYCLE_DEDUPE_KEYS) {
    const oldestKey = state.seen.keys().next().value;
    if (oldestKey === undefined) break;
    state.seen.delete(oldestKey);
  }

  void (async () => {
    const replayResult =
      _sessionReplayOptions && _trackingContentCaptureEnabled
        ? await startConfiguredSessionReplay(_sessionReplayOptions)
        : null;
    const properties = {
      phase: input.phase,
      chat_surface: surface,
      ...(input.threadId ? { thread_id: input.threadId } : {}),
      ...(input.runId ? { run_id: input.runId } : {}),
      ...(input.tabId ? { chat_tab_id: input.tabId } : {}),
      replay_status: replayResult?.started
        ? "active"
        : (replayResult?.reason ?? "not-configured"),
    };
    trackEvent("agent_chat_lifecycle", properties);
    if (!isQaTrackingIdentity(_trackingIdentity)) {
      _sessionReplayModuleForCapture?.emitSessionReplayAgentChatEvent?.({
        phase: input.phase,
        surface,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.tabId ? { tabId: input.tabId } : {}),
      });
    }
  })();
}

export function configureTracking(options: ConfigureTrackingOptions): void {
  if (isSyntheticBrowserTraffic()) {
    _trackingContentCaptureEnabled = false;
    return;
  }
  if (options.clientPlatform) {
    _configuredAnalyticsClientPlatform = options.clientPlatform;
  }
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
  _contentCaptureForPath = options.contentCaptureForPath ?? null;
  _trackingContentCaptureEnabled =
    _contentCaptureForPath && typeof window !== "undefined"
      ? _contentCaptureForPath(window.location.pathname)
      : options.contentCapture !== false;
  if (typeof window !== "undefined") {
    ensureSentry();
    ensureAmplitude();
    captureFirstTouchAttribution();
    if (options.llmConnectionStatus !== false) {
      installLlmConnectionRefresh();
    }
    if (options.authSessionRefresh !== false) {
      installTrackingAuthSessionRefresh();
    }
    if (options.pageviewTracking !== false) {
      installPageviewTracking();
    }
    maybeInstallSessionReplay(
      options.sessionReplay,
      {
        endpoint: options.endpoint,
        publicKey,
      },
      _trackingContentCaptureEnabled,
    );
    maybeInstallErrorCapture(options.errorCapture);
  }
}

export function setTrackingContentCaptureEnabled(enabled: boolean): void {
  if (_trackingContentCaptureEnabled === enabled) return;
  _trackingContentCaptureEnabled = enabled;
  if (enabled) {
    if (_sessionReplayOptions) {
      void startConfiguredSessionReplay(_sessionReplayOptions);
    }
  } else {
    void stopSessionReplay("content-capture-disabled");
  }
}

function syncTrackingContentCaptureForLocation(): void {
  if (!_contentCaptureForPath) return;
  setTrackingContentCaptureEnabled(
    _contentCaptureForPath(window.location.pathname),
  );
}

function loadSessionReplayModuleForCapture(): void {
  if (_sessionReplayModuleForCapture) return;
  import("./session-replay.js")
    .then((mod) => {
      _sessionReplayModuleForCapture = mod;
    })
    .catch(() => {
      // Session linkage is best-effort; capture still works without it.
    });
}

function errorCaptureSessionContext(): {
  sessionId?: string;
  anonymousId?: string;
  replayId?: string;
} {
  return {
    sessionId: getOrCreateSessionId(),
    anonymousId: getOrCreateAnonymousId(),
    replayId:
      _sessionReplayModuleForCapture?.getSessionReplayId?.() ?? undefined,
  };
}

function exceptionEventProperties(
  event: CapturedExceptionEvent,
): Record<string, unknown> {
  return {
    exceptionType: event.type,
    exceptionMessage: event.message,
    ...(event.stack ? { exceptionStack: event.stack } : {}),
    handled: event.handled,
    level: event.level,
    occurredAt: event.occurredAt,
    ...(event.url ? { errorUrl: event.url } : {}),
    ...(event.release ? { release: event.release } : {}),
    ...(event.environment ? { environment: event.environment } : {}),
    ...(event.sessionReplayId
      ? { sessionReplayId: event.sessionReplayId }
      : {}),
    ...(event.breadcrumbs?.length ? { breadcrumbs: event.breadcrumbs } : {}),
    ...(event.tags ? { exceptionTags: event.tags } : {}),
    ...(event.extra ? { exceptionExtra: event.extra } : {}),
  };
}

function amplitudeEventProperties(
  name: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (name !== AGENT_NATIVE_EXCEPTION_EVENT_NAME) return properties;
  const {
    exceptionTags: _exceptionTags,
    exceptionExtra: _exceptionExtra,
    ...stableProperties
  } = properties;
  return stableProperties;
}

function posthogErrorConfig(): { key: string; host: string } | undefined {
  const shell = window.__AGENT_NATIVE_CONFIG__;
  if (shell?.posthogErrorTracking === false) return undefined;
  const env = import.meta.env as Record<string, string | undefined>;
  if (env?.VITE_POSTHOG_ERROR_TRACKING?.trim().toLowerCase() === "false") {
    return undefined;
  }
  const key = shell?.posthogKey || env?.VITE_POSTHOG_KEY;
  if (!key) return undefined;
  const host = (
    shell?.posthogHost ||
    env?.VITE_POSTHOG_HOST ||
    "https://us.i.posthog.com"
  ).replace(/\/+$/, "");
  return { key, host };
}

function sendPostHogExceptionEvent(event: CapturedExceptionEvent): void {
  if (isSyntheticBrowserTraffic()) return;
  const config = posthogErrorConfig();
  if (!config) return;

  try {
    const session = errorCaptureSessionContext();
    const body = JSON.stringify({
      api_key: config.key,
      event: AGENT_NATIVE_EXCEPTION_EVENT_NAME,
      properties: {
        distinct_id: getTrackingUserId() || session.anonymousId || "anonymous",
        ...toPostHogExceptionProperties({
          type: event.type,
          value: event.message,
          stack: event.stack,
          handled: event.handled,
          level: event.level,
        }),
        $current_url: event.url,
        $session_id: session.sessionId,
        ...(session.replayId ? { $replay_id: session.replayId } : {}),
        ...(event.release ? { release: event.release } : {}),
        ...(event.environment ? { environment: event.environment } : {}),
        ...(event.tags ? { exceptionTags: event.tags } : {}),
        source: "browser",
      },
      timestamp: event.occurredAt,
    });
    const endpoint = `${config.host}/i/v0/e/`;

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
    // coercion-ok: throwing would replace the page's real error
  } catch {
    // Error reporting must never mask the original failure.
  }
}

function sendExceptionEvent(event: CapturedExceptionEvent): void {
  if (isSyntheticBrowserTraffic()) return;
  if (isQaTrackingIdentity(_trackingIdentity)) return;
  trackEvent(
    AGENT_NATIVE_EXCEPTION_EVENT_NAME,
    exceptionEventProperties(event),
  );
  sendPostHogExceptionEvent(event);
}

function emitExceptionToReplay(event: CapturedExceptionEvent): void {
  if (isSyntheticBrowserTraffic()) return;
  if (isQaTrackingIdentity(_trackingIdentity)) return;
  _sessionReplayModuleForCapture?.emitSessionReplayException?.({
    type: event.type,
    message: event.message,
    level: event.level,
    ...(event.stack ? { stack: event.stack } : {}),
    ...(event.url ? { url: event.url } : {}),
  });
}

function errorCaptureAutoEnabled(): boolean {
  const publicKey =
    _agentNativeAnalyticsPublicKey ||
    window.__AGENT_NATIVE_CONFIG__?.agentNativeAnalyticsPublicKey ||
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  return !!publicKey || !!posthogErrorConfig();
}

function maybeInstallErrorCapture(
  config: boolean | ErrorCaptureConfigOptions | undefined,
): void {
  if (typeof window === "undefined") return;
  if (config === false) {
    _errorCaptureDisposer?.();
    _errorCaptureDisposer = null;
    _errorCaptureInstalled = false;
    return;
  }
  if (_errorCaptureInstalled && config === undefined) return;
  const enabled = config === undefined ? errorCaptureAutoEnabled() : true;
  if (!enabled) return;
  const options = typeof config === "object" ? config : {};
  loadSessionReplayModuleForCapture();
  _errorCaptureDisposer = installErrorCapture({
    send: sendExceptionEvent,
    getSessionContext: errorCaptureSessionContext,
    emitReplayEvent: emitExceptionToReplay,
    environment: options.environment || resolveClientDeploymentEnvironment(),
    ...(options.release ? { release: options.release } : {}),
    ...(options.captureGlobalErrors !== undefined
      ? { captureGlobalErrors: options.captureGlobalErrors }
      : {}),
    ...(options.captureUnhandledRejections !== undefined
      ? { captureUnhandledRejections: options.captureUnhandledRejections }
      : {}),
    ...(options.maxBreadcrumbs !== undefined
      ? { maxBreadcrumbs: options.maxBreadcrumbs }
      : {}),
  });
  _errorCaptureInstalled = true;
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
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  const publicKey =
    tracking.publicKey ||
    _agentNativeAnalyticsPublicKey ||
    env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  const trackingEndpoint =
    tracking.endpoint ||
    _agentNativeAnalyticsEndpoint ||
    env.VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT ||
    (publicKey ? AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT : undefined);
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
      onRecordingStarted: (recordingAttemptId) => {
        try {
          trackEvent("session_replay_started", {
            recording_attempt_id: recordingAttemptId,
          });
        } catch {
          // coercion-ok: keep capture running if optional telemetry fails.
        }
        options.onRecordingStarted?.(recordingAttemptId);
      },
      onUploadRejected: options.onUploadRejected,
      onUploadRejectedWithAttemptId: (details, recordingAttemptId) => {
        try {
          trackEvent("session replay upload rejected", {
            recording_attempt_id: recordingAttemptId,
            status: details.status,
            restart_attempted: details.restartAttempted,
            restart_succeeded: details.restartSucceeded,
            ...(details.failureReason
              ? { failure_reason: details.failureReason }
              : {}),
            ...(details.retryAfterSeconds !== undefined
              ? { retry_after_seconds: details.retryAfterSeconds }
              : {}),
            ...(details.restartReason
              ? { restart_reason: details.restartReason }
              : {}),
          });
        } finally {
          options.onUploadRejectedWithAttemptId?.(details, recordingAttemptId);
        }
      },
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
  const autoEnabledByAnalyticsKey =
    !!publicKey &&
    (typeof window === "undefined" ||
      !isLocalAnalyticsHostname(window.location.hostname));
  return sessionReplayEnabledFromEnv() || autoEnabledByAnalyticsKey
    ? withTrackingDefaults({})
    : null;
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
    const identity = _trackingIdentity ?? _sessionReplayIdentitySnapshot;
    return applyTrackingIdentity(
      withDefaults,
      isQaTrackingIdentity(identity) ? null : identity,
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
  start = true,
): void {
  if (typeof window === "undefined") return;
  const options = configuredSessionReplayOptions(config, tracking);
  _sessionReplayOptions = options;
  if (!options || !start) return;
  void startConfiguredSessionReplay(options);
}

async function waitForSessionReplayAuthIfRequired(
  options: SessionReplayOptions,
): Promise<boolean> {
  if (isQaTrackingIdentity(_trackingIdentity)) return false;
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
  return (
    !!_trackingIdentity?.userEmail && !isQaTrackingIdentity(_trackingIdentity)
  );
}

async function startConfiguredSessionReplay(
  options: SessionReplayOptions,
): Promise<SessionReplayStartResult | null> {
  if (isSyntheticBrowserTraffic()) {
    return { started: false, reason: "disabled" };
  }
  if (_sessionReplayStartPromise) return _sessionReplayStartPromise;
  _sessionReplayStartPromise = (async () => {
    if (!_trackingContentCaptureEnabled) {
      return { started: false, reason: "disabled" as const };
    }
    if (!(await waitForSessionReplayAuthIfRequired(options))) {
      return { started: false, reason: "missing-user-id" as const };
    }
    if (!_trackingContentCaptureEnabled) {
      return { started: false, reason: "disabled" as const };
    }
    const mod = await import("./session-replay.js");
    _sessionReplayModuleForCapture = mod;
    if (!_trackingContentCaptureEnabled) {
      return { started: false, reason: "disabled" as const };
    }
    return mod.startSessionReplay({
      ...options,
      shouldStart: () =>
        _trackingContentCaptureEnabled &&
        !isQaTrackingIdentity(_trackingIdentity) &&
        (options.shouldStart?.() ?? true),
    });
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
  if (isSyntheticBrowserTraffic()) {
    return { started: false, reason: "disabled" };
  }
  if (!_trackingContentCaptureEnabled) {
    return { started: false, reason: "disabled" };
  }
  const configured = configuredSessionReplayOptions(options) ?? options;
  if (!(await waitForSessionReplayAuthIfRequired(configured))) {
    return { started: false, reason: "missing-user-id" };
  }
  const mod = await import("./session-replay.js");
  _sessionReplayModuleForCapture = mod;
  return mod.startSessionReplay({
    ...configured,
    shouldStart: () =>
      _trackingContentCaptureEnabled &&
      !isQaTrackingIdentity(_trackingIdentity) &&
      (configured.shouldStart?.() ?? true),
  });
}

export async function maybeStartSessionReplay(
  options: SessionReplayOptions = {},
): Promise<SessionReplayStartResult> {
  if (isSyntheticBrowserTraffic()) {
    return { started: false, reason: "disabled" };
  }
  if (!_trackingContentCaptureEnabled) {
    return { started: false, reason: "disabled" };
  }
  const configured = configuredSessionReplayOptions(options) ?? options;
  if (!(await waitForSessionReplayAuthIfRequired(configured))) {
    return { started: false, reason: "missing-user-id" };
  }
  const mod = await import("./session-replay.js");
  return mod.maybeStartSessionReplay({
    ...configured,
    shouldStart: () =>
      _trackingContentCaptureEnabled &&
      !isQaTrackingIdentity(_trackingIdentity) &&
      (configured.shouldStart?.() ?? true),
  });
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
  if (name === "session_replay_started") {
    return params?.recording_attempt_id === undefined
      ? {}
      : { recording_attempt_id: params.recording_attempt_id };
  }
  if (
    name === "session replay upload rejected" ||
    name === "session_replay_upload_rejected"
  ) {
    const allowed = [
      "recording_attempt_id",
      "status",
      "restart_attempted",
      "restart_succeeded",
      "failure_reason",
      "retry_after_seconds",
      "restart_reason",
    ];
    return Object.fromEntries(
      Object.entries(params ?? {}).filter(([key]) => allowed.includes(key)),
    );
  }
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
  enriched.deployment_environment = resolveClientDeploymentEnvironment();
  for (const [key, value] of Object.entries(llmProps)) {
    if (enriched[key] === undefined) enriched[key] = value;
  }
  const replayProps = sessionReplayTrackingProperties();
  for (const [key, value] of Object.entries(replayProps)) {
    if (enriched[key] === undefined) enriched[key] = value;
  }
  const sessionId = hasBrowserTrackingDestination()
    ? getOrCreateSessionId()
    : undefined;
  const standard = withCanonicalTrackingProperties({
    ...enriched,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  const withIdentity = applyTrackingIdentity(standard);
  const identity = _trackingIdentity;
  return {
    ...withIdentity,
    ...(getTrackingUserId() ? { user_id: getTrackingUserId() } : {}),
    ...(identity?.userEmail ? { user_email: identity.userEmail } : {}),
    ...(identity?.orgId ? { workspace_id: identity.orgId } : {}),
    [ANALYTICS_CLIENT_PLATFORM_PROPERTY]: getAnalyticsClientPlatform(
      _configuredAnalyticsClientPlatform ?? undefined,
    ),
  };
}

function sessionReplayTrackingProperties(): Record<string, unknown> {
  const module = _sessionReplayModuleForCapture;
  if (!module) return {};
  const context = module.getSessionReplayContext?.();
  if (!context?.active) return {};
  const occurredAt = new Date().toISOString();
  return {
    sessionReplayId: context.replayId,
    sessionReplayStartedAt: context.startedAt,
    sessionReplayAt: occurredAt,
    ...(module.getSessionReplayUrl
      ? {
          sessionReplayUrl: module.getSessionReplayUrl({ at: occurredAt }),
        }
      : {}),
  };
}

function pageviewKey(): string {
  return window.location.href;
}

function pageviewProperties(reason: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    url: !_trackingContentCaptureEnabled
      ? window.location.origin + window.location.pathname
      : scrubUrl(window.location.href),
    path: window.location.pathname,
    hostname: window.location.hostname,
    navigation_type: reason,
  };
  if (_trackingContentCaptureEnabled && window.location.search) {
    properties.search = scrubUrl(window.location.search);
  }
  if (_trackingContentCaptureEnabled && typeof document !== "undefined") {
    if (document.referrer) {
      properties.referrer = scrubUrl(document.referrer);
    }
    if (document.title) {
      properties.title = document.title;
    }
  }
  return properties;
}

function readAppEntryKeys(): string[] {
  const stored = safeStorageGet(APP_ENTRY_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((value): value is string => typeof value === "string")
        .slice(-MAX_APP_ENTRY_KEYS);
    }
    // coercion-ok: invalid JSON is treated as the legacy single entry marker.
  } catch {
    // Migrate the previous single-key value below.
  }
  return [stored];
}

function rememberAppEntryKey(entryKey: string): boolean {
  const state = getAppEntryTrackingState();
  const keys = new Set(state.entryKeys ?? []);
  for (const storedKey of readAppEntryKeys()) keys.add(storedKey);
  if (keys.has(entryKey)) {
    state.entryKeys = new Set([...keys].slice(-MAX_APP_ENTRY_KEYS));
    state.entryKey = entryKey;
    return false;
  }

  keys.add(entryKey);
  const boundedKeys = [...keys].slice(-MAX_APP_ENTRY_KEYS);
  state.entryKeys = new Set(boundedKeys);
  state.entryKey = entryKey;
  safeStorageSet(APP_ENTRY_STORAGE_KEY, JSON.stringify(boundedKeys));
  return true;
}

function rememberLastAppEntry(appName: string, now: number): number | null {
  const key = `${APP_LAST_ENTRY_STORAGE_KEY_PREFIX}:${appName}`;
  const stored = safeStorageGet(key);
  const previous = stored ? Number(stored) : NaN;
  safeStorageSet(key, String(now));
  return Number.isFinite(previous) ? previous : null;
}

let _appEntryAuthRetry: Promise<void> | null = null;

function waitForTrackingIdentityBeforeAppEntry(): boolean {
  const pending = _trackingSessionRefresh;
  if (!pending || _trackingIdentityResolved) return false;
  if (!_appEntryAuthRetry) {
    _appEntryAuthRetry = pending
      .catch(() => {})
      .then(() => {
        _appEntryAuthRetry = null;
        emitAppEntered();
      });
  }
  return true;
}

function emitAppEntered(): void {
  if (typeof window === "undefined" || !_getDefaultProps) return;
  if (waitForTrackingIdentityBeforeAppEntry()) return;
  const properties = resolveProps(AGENT_NATIVE_LIFECYCLE_EVENTS.appEntered, {
    entry_path: window.location.pathname,
  });
  const appName = normalizeTrackingDimension(
    properties.app_name ?? properties.app,
  );
  const sessionId =
    typeof properties.session_id === "string"
      ? properties.session_id
      : undefined;
  if (!appName) return;
  const entryKey = sessionId ? `${appName}:${sessionId}` : appName;
  if (!rememberAppEntryKey(entryKey)) return;
  const now = Date.now();
  const previousEntryAt = rememberLastAppEntry(appName, now);
  const attribution = getFirstTouchAttribution();
  trackEvent(AGENT_NATIVE_LIFECYCLE_EVENTS.appEntered, {
    app_name: appName,
    entry_path: window.location.pathname,
    ...(attribution?.ref ? { source: attribution.ref } : {}),
    ...(attribution?.landing_referrer
      ? { referrer: attribution.landing_referrer }
      : {}),
  });
  if (previousEntryAt !== null) {
    const daysSinceLast = Math.floor((now - previousEntryAt) / 86_400_000);
    if (now - previousEntryAt >= RETURN_USAGE_THRESHOLD_MS) {
      trackEvent(AGENT_NATIVE_LIFECYCLE_EVENTS.returnUsage, {
        app_name: appName,
        days_since_last: daysSinceLast,
      });
    }
  }
}

function emitPageview(reason: string): void {
  if (typeof window === "undefined") return;
  if (isLocalAnalyticsHostname(window.location.hostname)) return;
  const state = getPageviewTrackingState();
  const key = pageviewKey();
  if (state.lastPageviewKey === key) return;
  state.lastPageviewKey = key;
  trackEvent("pageview", pageviewProperties(reason));
  emitAppEntered();
}

function schedulePageview(reason: string): void {
  if (!_trackingContentCaptureEnabled) {
    void stopSessionReplay("local-plan-privacy");
  }
  const run = () => emitPageview(reason);
  const deferredBootRefresh =
    _llmConnectionBootRefresh && !_llmConnectionStatus
      ? _llmConnectionBootRefresh
      : null;
  const pendingStartupContext: Array<Promise<void>> = [];
  if (_llmConnectionRefresh && !_llmConnectionStatus) {
    pendingStartupContext.push(_llmConnectionRefresh);
  }
  if (_trackingSessionRefresh && !_trackingIdentityResolved) {
    pendingStartupContext.push(_trackingSessionRefresh);
  }
  if (deferredBootRefresh !== null) {
    if (pendingStartupContext.length > 0) {
      const timeout = new Promise<void>((resolve) =>
        window.setTimeout(resolve, 250),
      );
      void Promise.all([
        deferredBootRefresh,
        Promise.race([Promise.allSettled(pendingStartupContext), timeout]),
      ]).finally(run);
      return;
    }
    void deferredBootRefresh.finally(run);
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

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    syncTrackingContentCaptureForLocation();
    schedulePageview("pushState");
    return result;
  };

  window.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    syncTrackingContentCaptureForLocation();
    schedulePageview("replaceState");
    return result;
  };

  window.addEventListener("popstate", () => {
    syncTrackingContentCaptureForLocation();
    schedulePageview("popstate");
  });
}

function sendAgentNativeAnalytics(
  name: string,
  properties: Record<string, unknown>,
): void {
  if (isSyntheticBrowserTraffic()) return;
  if (isLocalAnalyticsHostname(window.location.hostname)) return;

  const publicKey =
    _agentNativeAnalyticsPublicKey ||
    window.__AGENT_NATIVE_CONFIG__?.agentNativeAnalyticsPublicKey ||
    (import.meta.env as Record<string, string | undefined>)
      ?.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  if (!publicKey) return;

  const endpoint =
    _agentNativeAnalyticsEndpoint ||
    window.__AGENT_NATIVE_CONFIG__?.agentNativeAnalyticsEndpoint ||
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

function emitBrowserTrackingEvent(
  name: string,
  props: Record<string, unknown>,
  options: {
    gtagProperties?: Record<string, unknown>;
    sendGtag?: boolean;
  } = {},
): void {
  const { gtagProperties = props, sendGtag = true } = options;
  const amplitudeProps = amplitudeEventProperties(name, props);
  if (sendGtag) {
    const gtag = window.__AGENT_NATIVE_GA_GTAG__ ?? window.gtag;
    gtag?.("event", name.replace(/\s+/g, "_"), gtagProperties);
  }
  if (ensureAmplitude()) {
    _amplitudeModule?.track(name, amplitudeProps);
  } else if (_amplitudeApiKey) {
    if (_pendingAmplitudeEvents.length < 100) {
      _pendingAmplitudeEvents.push([name, amplitudeProps]);
    }
  }
  const authUserId = getTrackingAuthUserId();
  sendAgentNativeAnalytics(
    name,
    authUserId ? { ...props, auth_user_id: authUserId } : props,
  );
}

export function trackEvent(
  name: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (isSyntheticBrowserTraffic()) return;
  if (isQaTrackingIdentity(_trackingIdentity)) return;
  ensureSentry();
  const props = resolveProps(name, params);
  const canonical = canonicalTrackingEvent(name, props);
  const gtagNameMatchesCanonical =
    canonical !== null && name.replace(/\s+/g, "_") === canonical.name;
  emitBrowserTrackingEvent(name, props, {
    gtagProperties: gtagNameMatchesCanonical ? canonical.properties : props,
  });
  if (canonical) {
    emitBrowserTrackingEvent(canonical.name, canonical.properties, {
      sendGtag: !gtagNameMatchesCanonical,
    });
  }
  void recordTrackingEvent(name, props, "client");
  const lifecycle = legacyLifecycleEvent(name, props);
  if (lifecycle) trackEvent(lifecycle.name, lifecycle.properties);
}

export function trackAnonymousEvent(
  name: string,
  properties: Record<string, unknown>,
): void {
  if (
    typeof window === "undefined" ||
    isSyntheticBrowserTraffic() ||
    isQaTrackingIdentity(_trackingIdentity)
  ) {
    return;
  }
  sendAgentNativeAnalytics(name, properties);
}

export function trackLifecycleEvent(
  name: AgentNativeLifecycleEventName,
  params?: Record<string, unknown>,
): void {
  trackEvent(name, params);
}

export function trackSessionStatus(signedIn: boolean): void {
  trackEvent("session status", { signed_in: signedIn });
}
