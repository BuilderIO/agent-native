import * as amplitude from "@amplitude/analytics-browser";
import * as Sentry from "@sentry/browser";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
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

let _getDefaultProps: GetDefaultProps | null = null;
let _amplitudeInitialized = false;
let _sentryInitialized = false;

const AGENT_NATIVE_ANALYTICS_DEFAULT_ENDPOINT =
  "https://analytics.agent-native.com/track";
const PAGEVIEW_TRACKING_STATE_KEY = Symbol.for(
  "agent-native.client.pageviewTracking",
);

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

function ensureSentry(): void {
  if (_sentryInitialized) return;
  const dsn = (import.meta.env as Record<string, string | undefined>)
    ?.VITE_SENTRY_CLIENT_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    beforeSend(event) {
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
  _sentryInitialized = true;
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
