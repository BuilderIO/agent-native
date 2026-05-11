import * as amplitude from "@amplitude/analytics-browser";
import * as Sentry from "@sentry/browser";

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

type SentryUser = {
  id?: string;
  email?: string;
  username?: string;
};

let _getDefaultProps: GetDefaultProps | null = null;
let _amplitudeInitialized = false;
let _sentryInitialized = false;
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
// 30-minute idle timeout matches GA4 / Mixpanel defaults — a tab left open
// overnight starts a new session in the morning rather than stretching one
// session over multiple visits.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

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

function getOrCreateAnonymousId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  let id = safeStorageGet(ANONYMOUS_ID_STORAGE_KEY);
  if (!id) {
    id = generateVisitorId();
    safeStorageSet(ANONYMOUS_ID_STORAGE_KEY, id);
  }
  return id;
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

/**
 * Query parameters that may carry sensitive values in the URL bar. Browser
 * Sentry collects `event.request.url` automatically; without scrubbing,
 * share tokens, password params (F-07), email-confirm tokens, etc. land in
 * Sentry events and become a recon vector for anyone with project access.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  "password",
  "p",
  "token",
  "state",
  "code",
  "share",
  "share_token",
]);

function scrubUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return url;
  try {
    // Parse using a base origin so relative URLs still work.
    const u = new URL(url, "http://placeholder.local");
    let mutated = false;
    for (const key of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        u.searchParams.set(key, "<redacted>");
        mutated = true;
      }
    }
    if (!mutated) return url;
    // If the original URL was relative, return only the path/query/fragment.
    if (u.origin === "http://placeholder.local") {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return url;
  }
}

function shouldDropBrowserSentryNoise(event: Sentry.Event): boolean {
  const exceptionValues = event.exception?.values ?? [];
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
  const exceptionText = exceptionValues
    .map((value) => `${value.type ?? ""} ${value.value ?? ""}`)
    .join(" ")
    .toLowerCase();
  const requestUrl = event.request?.url?.toLowerCase() ?? "";
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

function getClientSentryDsn(): string | undefined {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  return (
    env.VITE_SENTRY_CLIENT_DSN ||
    env.VITE_SENTRY_DSN ||
    window.__AGENT_NATIVE_CONFIG__?.sentryDsn
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

export function configureTracking(options: {
  getDefaultProps?: GetDefaultProps;
}): void {
  if (options.getDefaultProps) {
    _getDefaultProps = options.getDefaultProps;
  }
  if (typeof window !== "undefined") {
    ensureSentry();
    ensureAmplitude();
    installPageviewTracking();
  }
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
  if (props.template === undefined) {
    const template = inferTemplateName(props);
    if (template) {
      return { ...props, template };
    }
  }
  return props;
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

  const publicKey = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  if (!publicKey) return;

  const endpoint =
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
