import { useState, useEffect, useCallback, useRef } from "react";

import { trackEvent } from "../analytics.js";
import { agentNativePath } from "../api-path.js";
import { getCallbackOrigin } from "../frame.js";
import { openMcpAppHostLink } from "../mcp-app-host.js";

export interface BuilderStatus {
  configured: boolean;
  builderEnabled: boolean;
  /**
   * True when `BUILDER_PRIVATE_KEY` is set at the deploy level. This is a
   * fallback credential; per-user/org Builder connections are still allowed
   * and take precedence for that request.
   */
  envManaged?: boolean;
  credentialSource?: "user" | "org" | "workspace" | "env";
  connectUrl: string;
  cliAuthUrl?: string;
  appHost: string;
  apiHost: string;
  branchProjectIdConfigured?: boolean;
  branchProjectId?: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  /**
   * Builder space(s) the effective credential can reach, with real display
   * names derived from the Admin API. One entry today (a `bpk-` key is
   * space-scoped); the list shape lets the Sources drill-down show multiple
   * spaces later. Absent/empty when undeducible — fall back to `orgName`.
   */
  spaces?: Array<{ id: string; name: string }>;
  orgKind?: string;
  subscription?: string;
  subscriptionLevel?: string;
  subscriptionName?: string;
  isEnterprise?: boolean;
  isFreeAccount?: boolean;
  /**
   * Set when the OAuth callback ran but failed to persist credentials.
   * Surfaced as a one-shot row by the server so the connect-flow polling
   * can stop with a clear message instead of timing out at 5min.
   */
  connectError?: { message: string; at: number };
  /**
   * Set when the currently effective Builder credential was rejected by
   * Builder's API. Unlike connectError, this describes the old credential pair
   * and should not abort a new reconnect attempt while the popup is open.
   */
  authError?: { message: string; at: number };
}

/**
 * Fetches Builder connection status from the neutral connection-status route.
 * The legacy /_agent-native/builder/status route remains available for older
 * clients.
 * Re-fetches on window focus to detect post-redirect state changes.
 */
export function useBuilderStatus({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const [status, setStatus] = useState<BuilderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const lastGoodStatusRef = useRef<BuilderStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;
    const keepLastGoodStatus = (message: string) => {
      const lastGoodStatus = lastGoodStatusRef.current;
      setStatus(lastGoodStatus);
      setStale(!!lastGoodStatus);
      setError(message);
    };

    try {
      const res = await fetch(
        agentNativePath("/_agent-native/connection-status/builder"),
      );
      if (!res.ok) {
        keepLastGoodStatus(`Builder status unavailable (${res.status})`);
        return;
      }
      const nextStatus = (await res.json()) as BuilderStatus;
      lastGoodStatusRef.current = nextStatus;
      setStatus(nextStatus);
      setStale(false);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? `Builder status unavailable: ${err.message}`
          : "Builder status unavailable";
      keepLastGoodStatus(message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      setError(null);
      setStale(false);
      lastGoodStatusRef.current = null;
      return;
    }
    setLoading(true);
    fetchStatus();

    function onFocus() {
      fetchStatus();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") fetchStatus();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    // Engine connect/disconnect actions (e.g. the Builder disconnect button)
    // dispatch this event so dependent cards refresh without a full reload.
    window.addEventListener("agent-engine:configured-changed", fetchStatus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(
        "agent-engine:configured-changed",
        fetchStatus,
      );
    };
  }, [enabled, fetchStatus]);

  return { status, loading, error, stale, refetch: fetchStatus };
}

// ─── useBuilderConnectFlow ──────────────────────────────────────────────────
//
// Shared state machine for the "open Builder CLI-auth popup + poll
// /connection-status/builder until credentials land" interaction. Replaces three
// near-duplicate inline implementations: `BuilderCliAuthMethod` in
// OnboardingPanel, `ConnectBuilderCard`, and `BuilderConnectCta` in
// AssistantChat. Each consumer supplies its own popup URL / completion
// behavior; the hook owns the polling + timeout + focus refresh.
//
// `popupUrl` is what we pass to `window.open`. The default
// `/_agent-native/builder/connect` is a server-side 302 to the real
// cli-auth URL — using it keeps the click handler synchronous so popup
// blockers don't downgrade the open to same-tab navigation. Pass an
// explicit `popupUrl` (e.g. the already-computed cli-auth URL) if your
// caller already has it in hand.

export interface BuilderConnectFlowOptions {
  /** Skip server status polling for hosts that own provider routing. */
  enabled?: boolean;
  /** URL to synchronously open on start(). Defaults to the 302 shortcut. */
  popupUrl?: string;
  /** Low-cardinality label for the UI surface that opened Builder connect. */
  trackingSource?: string;
  /** Product flow that needed Builder connect, e.g. connect_llm. */
  trackingFlow?: string;
  /** Invoked after the status poll first sees `configured: true`. */
  onConnected?: (state: { orgName: string | null }) => void | Promise<void>;
}

export interface BuilderConnectStartOptions {
  /** Override the hook-level source for this click. */
  trackingSource?: string;
  /** Override the hook-level flow for this click. */
  trackingFlow?: string;
}

export interface BuilderConnectFlow {
  configured: boolean;
  /** True after at least one successful Builder connection-status response. */
  statusResolved: boolean;
  /**
   * True when the deploy has BUILDER_PRIVATE_KEY set as a fallback. Connect
   * is still available so users can override the fallback with their own
   * Builder account.
   */
  envManaged: boolean;
  /**
   * True when the server has a Builder branch project configured for this
   * request. When false, the card surfaces a waitlist CTA instead of a Send
   * button.
   */
  builderEnabled: boolean;
  orgName: string | null;
  connecting: boolean;
  error: string | null;
  /**
   * True once the first Builder connection-status fetch has completed (successfully
   * or not). Consumers that accept an `initialConfigured` prop (e.g. agent
   * tool-call results rendered with server-side state) should treat
   * `configured`/`orgName` as authoritative only once this flips true —
   * otherwise the hook's starting `false` defaults would cause a flash
   * back to "Connect Builder" on first paint.
   */
  hasFetchedStatus: boolean;
  /** Open the popup and begin polling. Must be called from a user-gesture handler. */
  start: (options?: BuilderConnectStartOptions) => void;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_SUCCESS_STATUS_RETRY_MS = 500;
const CALLBACK_SUCCESS_STATUS_RETRIES = 10;
const BUILDER_CONNECT_PARAM = "_an_connect";
const BUILDER_STATE_PARAM = "_an_state";
const BUILDER_SIGNUP_SOURCE_PARAM = "signupSource";
const BUILDER_AGENT_NATIVE_FLOW_PARAM = "agentNativeFlow";
const BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM = "agentNativeConnectSource";
const BUILDER_AGENT_NATIVE_APP_PARAM = "agentNativeApp";
const BUILDER_AGENT_NATIVE_TEMPLATE_PARAM = "agentNativeTemplate";
const BUILDER_SIGNUP_SOURCE = "agent-native";
const STATUS_CONNECT_URL_TTL_MS = 9 * 60 * 1000;

function cleanTrackingParam(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function inferBuilderConnectTrackingFlow(source: string | undefined): string {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("background_agent")) return "background_agent";
  if (
    normalized.includes("code_required") ||
    normalized.includes("code_access") ||
    normalized.includes("connect_builder_card")
  ) {
    return "background_agent";
  }
  if (normalized.includes("browser")) return "browser_automation";
  if (normalized.includes("voice") || normalized.includes("transcription")) {
    return "voice_transcription";
  }
  if (normalized.includes("upload")) return "file_upload";
  if (normalized.includes("hosting")) return "hosting";
  if (normalized.includes("database")) return "database";
  if (normalized.includes("auth_settings")) return "auth";
  return "connect_llm";
}

function normalizeTrackingSlug(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const unscoped = trimmed.startsWith("@")
    ? (trimmed.split("/").pop() ?? trimmed)
    : trimmed;
  const slug = unscoped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

function inferBuilderConnectTrackingIdentity(options: {
  app?: string;
  template?: string;
}): { app: string | null; template: string | null } {
  const env = (import.meta.env as Record<string, string | undefined>) ?? {};
  const app =
    normalizeTrackingSlug(options.app) ??
    normalizeTrackingSlug(env.VITE_AGENT_NATIVE_APP) ??
    (typeof window !== "undefined"
      ? normalizeTrackingSlug(window.location.hostname.split(".")[0])
      : null);
  const template =
    normalizeTrackingSlug(options.template) ??
    normalizeTrackingSlug(env.VITE_AGENT_NATIVE_TEMPLATE) ??
    normalizeTrackingSlug(env.VITE_APP_TEMPLATE) ??
    (app?.startsWith("agent-native-")
      ? normalizeTrackingSlug(app.slice("agent-native-".length))
      : app && app !== "localhost"
        ? app
        : null);

  return { app, template };
}

function applyBuilderConnectTrackingParams(
  params: URLSearchParams,
  tracking: {
    source?: string | null;
    flow: string;
    app?: string | null;
    template?: string | null;
  },
) {
  params.set(BUILDER_SIGNUP_SOURCE_PARAM, BUILDER_SIGNUP_SOURCE);
  params.set(BUILDER_AGENT_NATIVE_FLOW_PARAM, tracking.flow);
  if (tracking.source) {
    params.set(BUILDER_AGENT_NATIVE_CONNECT_SOURCE_PARAM, tracking.source);
  }
  if (tracking.app) {
    params.set(BUILDER_AGENT_NATIVE_APP_PARAM, tracking.app);
  }
  if (tracking.template) {
    params.set(BUILDER_AGENT_NATIVE_TEMPLATE_PARAM, tracking.template);
  }
}

export function withBuilderConnectTrackingParams(
  url: string,
  options: {
    source?: string;
    flow?: string;
    app?: string;
    template?: string;
  } = {},
): string {
  const source = cleanTrackingParam(options.source);
  const flow =
    cleanTrackingParam(options.flow) ??
    inferBuilderConnectTrackingFlow(source ?? undefined);
  const { app, template } = inferBuilderConnectTrackingIdentity(options);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";

  try {
    const parsed = new URL(url, origin);
    applyBuilderConnectTrackingParams(parsed.searchParams, {
      source,
      flow,
      app,
      template,
    });

    const redirectUrl = parsed.searchParams.get("redirect_url");
    if (redirectUrl) {
      const parsedRedirect = new URL(redirectUrl);
      applyBuilderConnectTrackingParams(parsedRedirect.searchParams, {
        source,
        flow,
        app,
        template,
      });
      parsed.searchParams.set("redirect_url", parsedRedirect.toString());
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function isAgentNativeDesktop() {
  if (typeof navigator === "undefined") return false;
  return /AgentNativeDesktop/i.test(navigator.userAgent || "");
}

function hasSignedConnectToken(url: string | null | undefined): boolean {
  if (!url || typeof window === "undefined") return false;
  try {
    return new URL(url, window.location.origin).searchParams.has(
      BUILDER_CONNECT_PARAM,
    );
  } catch {
    return false;
  }
}

function hasSignedCallbackState(url: string | null | undefined): boolean {
  if (!url || typeof window === "undefined") return false;
  try {
    const parsed = new URL(url, window.location.origin);
    const redirectUrl = parsed.searchParams.get("redirect_url");
    if (!redirectUrl) return false;
    return new URL(redirectUrl).searchParams.has(BUILDER_STATE_PARAM);
  } catch {
    return false;
  }
}

function isFreshSignedConnectUrl(
  url: string | null,
  fetchedAt: number | null,
): url is string {
  return (
    (hasSignedConnectToken(url) || hasSignedCallbackState(url)) &&
    typeof fetchedAt === "number" &&
    Date.now() - fetchedAt < STATUS_CONNECT_URL_TTL_MS
  );
}

function isCurrentConnectError(
  error: { message: string; at: number } | undefined,
  startedAt: number | null,
): error is { message: string; at: number } {
  if (!error?.message) return false;
  if (!startedAt) return true;
  return typeof error.at !== "number" || error.at >= startedAt - 1000;
}

function showBuilderConnectPopupPlaceholder(opened: Window) {
  // Keep opener attached: the Builder callback uses postMessage to notify the
  // settings tab that the popup completed. We still hold the WindowProxy so the
  // parent can navigate the blank popup after refreshing the signed connect URL.
  try {
    opened.document.title = "Opening Builder.io";
    opened.document.body.style.margin = "0";
    opened.document.body.style.background = "#111";
    opened.document.body.style.color = "#ddd";
    opened.document.body.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    opened.document.body.style.display = "flex";
    opened.document.body.style.alignItems = "center";
    opened.document.body.style.justifyContent = "center";
    opened.document.body.style.height = "100vh";
    opened.document.body.textContent = "Opening Builder.io...";
  } catch {
    // Popup may already be cross-origin or browser may block document writes.
  }
}

function navigateBuilderConnectPopup(opened: Window, url: string): boolean {
  try {
    opened.location.href = url;
    return true;
  } catch {
    try {
      opened.close();
    } catch {
      // Ignore close failures.
    }
    return false;
  }
}

function isEmbeddedWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function openBuilderConnectViaMcpHost(url: string): Promise<boolean> {
  const request = openMcpAppHostLink(url);
  if (!request) return false;
  try {
    return await request;
  } catch {
    return false;
  }
}

function notifyAgentEngineConfiguredChanged(source: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-engine:configured-changed", {
      detail: { source },
    }),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTrustedBuilderConnectMessageOrigin(origin: string): boolean {
  if (typeof window !== "undefined" && origin === window.location.origin) {
    return true;
  }
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "builderio.xyz" ||
      hostname.endsWith(".builderio.xyz") ||
      hostname === "builderio.dev" ||
      hostname.endsWith(".builderio.dev") ||
      hostname === "builder.codes" ||
      hostname.endsWith(".builder.codes") ||
      hostname === "agent-native.com" ||
      hostname.endsWith(".agent-native.com")
    );
  } catch {
    return false;
  }
}

export interface OpenBuilderConnectPopupOptions {
  url?: string;
  source?: string;
  flow?: string;
  features?: string;
}

export function openBuilderConnectPopup({
  url,
  source = "builder_connect",
  flow,
  features = "noopener,noreferrer",
}: OpenBuilderConnectPopupOptions = {}): Window | null {
  if (typeof window === "undefined") return null;
  const origin = getCallbackOrigin() || window.location.origin;
  const href =
    url ??
    new URL(agentNativePath("/_agent-native/builder/connect"), origin).href;
  const trackedHref =
    href === "about:blank"
      ? href
      : withBuilderConnectTrackingParams(href, { source, flow });
  const connectUrlKind = url ? "provided" : "default";
  const trackingFlow =
    cleanTrackingParam(flow) ?? inferBuilderConnectTrackingFlow(source);
  trackEvent("builder connect clicked", {
    feature: "builder",
    stage: "client",
    source,
    flow: trackingFlow,
    connect_url_kind: connectUrlKind,
  });
  try {
    const opened = window.open(trackedHref, "_blank", features);
    if (!opened && !/AgentNativeDesktop/i.test(navigator.userAgent || "")) {
      trackEvent("builder connect popup blocked", {
        feature: "builder",
        stage: "client",
        source,
        flow: trackingFlow,
        connect_url_kind: connectUrlKind,
      });
    }
    return opened;
  } catch {
    trackEvent("builder connect failed", {
      feature: "builder",
      stage: "client",
      reason: "popup_open_exception",
      source,
      flow: trackingFlow,
      connect_url_kind: connectUrlKind,
    });
    return null;
  }
}

export function useBuilderConnectFlow(
  opts: BuilderConnectFlowOptions = {},
): BuilderConnectFlow {
  const {
    enabled = true,
    popupUrl,
    trackingSource = "builder_connect_flow",
    trackingFlow,
    onConnected,
  } = opts;
  const [configured, setConfigured] = useState(false);
  const [envManaged, setEnvManaged] = useState(false);
  const [builderEnabled, setBuilderEnabled] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetchedStatus, setHasFetchedStatus] = useState(false);
  const [statusResolved, setStatusResolved] = useState(false);
  const [statusConnectUrl, setStatusConnectUrl] = useState<string | null>(null);
  // When statusConnectUrl was last fetched. The server signs the embedded
  // _an_connect token with a 10-minute TTL; using an older URL fails the
  // cross-origin popup gate. Track freshness so start() can either use a
  // still-good direct URL (desktop) or refresh a new one inside the popup
  // gesture path (browser/editor embeds).
  const statusConnectUrlAtRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectStartedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const notifiedConnectedRef = useRef(false);
  // Keep onConnected in a ref so start() doesn't need to re-create when the
  // caller passes an inline arrow function.
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return null;
    const origin = getCallbackOrigin() || window.location.origin;
    try {
      const r = await fetch(
        new URL(
          agentNativePath("/_agent-native/connection-status/builder"),
          origin,
        ).href,
      );
      if (!r.ok) return null;
      return (await r.json()) as {
        configured: boolean;
        envManaged?: boolean;
        builderEnabled?: boolean;
        orgName?: string | null;
        connectUrl?: string;
        cliAuthUrl?: string;
        credentialSource?: "user" | "org" | "workspace" | "env";
        connectError?: { message: string; at: number };
        authError?: { message: string; at: number };
      };
    } catch {
      return null;
    }
  }, [enabled]);

  // Initial fetch + focus/visibility refresh so if the user completed the
  // flow in another tab (or a downgraded same-tab nav) we notice it. Also
  // listen for `agent-engine:configured-changed` so a Disconnect click in
  // Settings propagates to any connect-CTA cards rendered elsewhere in
  // the app without waiting for the next focus event.
  useEffect(() => {
    if (!enabled) {
      setConfigured(false);
      setEnvManaged(false);
      setBuilderEnabled(false);
      setOrgName(null);
      setConnecting(false);
      setError(null);
      setHasFetchedStatus(false);
      setStatusResolved(false);
      setStatusConnectUrl(null);
      statusConnectUrlAtRef.current = null;
      stopPoll();
      return;
    }
    mountedRef.current = true;
    let cancelled = false;
    const refresh = async () => {
      const s = await fetchStatus();
      if (cancelled || !mountedRef.current) return;
      // Flip `hasFetchedStatus` even when the fetch failed — the caller's
      // "use initial props until the hook has an answer" pattern wants to
      // stop waiting after we've tried, regardless of network outcome.
      setHasFetchedStatus(true);
      if (!s) return;
      setStatusResolved(true);
      setConfigured(!!s.configured);
      setEnvManaged(!!s.envManaged);
      setBuilderEnabled(!!s.builderEnabled);
      const nextConnectUrl = s.cliAuthUrl ?? s.connectUrl ?? null;
      setStatusConnectUrl(nextConnectUrl);
      statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
      const org = s.orgName ?? null;
      setOrgName(org);
      if (s.configured) {
        connectStartedAtRef.current = null;
      }
      if (s.configured && !notifiedConnectedRef.current) {
        notifiedConnectedRef.current = true;
        notifyAgentEngineConfiguredChanged("builder-status");
        try {
          await onConnectedRef.current?.({ orgName: org });
        } catch {
          // The caller's callback is a UI convenience; status is already set.
        }
      } else if (!s.configured) {
        notifiedConnectedRef.current = false;
      }
      // Surface persisted auth-failure messages on idle refreshes, but don't
      // let an old rejected credential abort a new reconnect popup while the
      // user is still choosing a Builder space.
      const activeConnectStartedAt = connectStartedAtRef.current;
      if (isCurrentConnectError(s.connectError, activeConnectStartedAt)) {
        setError(s.connectError.message);
      } else if (!activeConnectStartedAt && s.authError?.message) {
        setError(s.authError.message);
      } else if (s.configured) {
        setError(null);
      }
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("agent-engine:configured-changed", refresh);
      stopPoll();
    };
  }, [enabled, fetchStatus, stopPoll]);

  const start = useCallback(
    (startOptions?: BuilderConnectStartOptions) => {
      if (!enabled) return;
      stopPoll();
      const started = Date.now();
      const clickTrackingSource =
        startOptions?.trackingSource ?? trackingSource;
      const clickTrackingFlow = startOptions?.trackingFlow ?? trackingFlow;
      connectStartedAtRef.current = started;
      setConnecting(true);
      setError(null);

      // Open SYNCHRONOUSLY inside the caller's click handler — any await
      // before window.open lets the user-gesture token expire, which causes
      // popup blockers to block entirely or fall back to same-tab navigation.
      const origin = getCallbackOrigin() || window.location.origin;
      const cachedFreshUrl = isFreshSignedConnectUrl(
        statusConnectUrl,
        statusConnectUrlAtRef.current,
      )
        ? statusConnectUrl
        : null;
      // popupUrl props and statusConnectUrl are signed URLs minted before the
      // click. In web browsers, always refresh inside an about:blank popup so a
      // server/package restart cannot leave the user with a stale signed state.
      // Desktop keeps the direct path because the Electron shell owns the popup.
      const signedPropUrl = hasSignedConnectToken(popupUrl) ? popupUrl : null;
      const signedCliPropUrl = hasSignedCallbackState(popupUrl)
        ? popupUrl
        : null;
      const fallbackUrl = new URL(
        agentNativePath("/_agent-native/builder/connect"),
        origin,
      ).href;
      const directUrl =
        cachedFreshUrl ?? signedCliPropUrl ?? signedPropUrl ?? fallbackUrl;

      if (isAgentNativeDesktop()) {
        const opened = openBuilderConnectPopup({
          url: directUrl,
          source: clickTrackingSource,
          flow: clickTrackingFlow,
        });
        if (!opened) {
          // Agent Native Desktop handles the popup in Electron and reports
          // null to the embedded webview, so null is not a blocker here.
        }
      } else {
        const opened = openBuilderConnectPopup({
          url: "about:blank",
          source: clickTrackingSource,
          flow: clickTrackingFlow,
          features: "width=600,height=700",
        });
        if (!opened) {
          if (!isEmbeddedWindow()) {
            connectStartedAtRef.current = null;
            setConnecting(false);
            setError("Couldn't open Builder. Allow popups and try again.");
            return;
          }

          void (async () => {
            const s = await fetchStatus();
            if (!mountedRef.current) return;
            if (s) {
              setHasFetchedStatus(true);
              setConfigured(!!s.configured);
              setEnvManaged(!!s.envManaged);
              setBuilderEnabled(!!s.builderEnabled);
              const nextConnectUrl = s.cliAuthUrl ?? s.connectUrl ?? null;
              setStatusConnectUrl(nextConnectUrl);
              statusConnectUrlAtRef.current = nextConnectUrl
                ? Date.now()
                : null;
              setOrgName(s.orgName ?? null);
            }

            const hostUrl =
              s?.cliAuthUrl ?? s?.connectUrl ?? cachedFreshUrl ?? directUrl;
            const trackedHostUrl = withBuilderConnectTrackingParams(hostUrl, {
              source: clickTrackingSource,
              flow: clickTrackingFlow,
            });
            const openedByHost =
              await openBuilderConnectViaMcpHost(trackedHostUrl);
            if (!mountedRef.current || openedByHost) return;
            stopPoll();
            connectStartedAtRef.current = null;
            setConnecting(false);
            setError(
              "Couldn't open Builder from this chat host. Open this app in a browser tab and try Connect Builder again.",
            );
          })();
        } else {
          showBuilderConnectPopupPlaceholder(opened);
          void (async () => {
            const s = await fetchStatus();
            if (!mountedRef.current) {
              try {
                opened.close();
              } catch {
                // Ignore close failures.
              }
              return;
            }
            if (s) {
              setHasFetchedStatus(true);
              setConfigured(!!s.configured);
              setEnvManaged(!!s.envManaged);
              setBuilderEnabled(!!s.builderEnabled);
              const nextConnectUrl = s.cliAuthUrl ?? s.connectUrl ?? null;
              setStatusConnectUrl(nextConnectUrl);
              statusConnectUrlAtRef.current = nextConnectUrl
                ? Date.now()
                : null;
              setOrgName(s.orgName ?? null);
            }

            // Prefer the click-time status response, but keep the signed URL
            // already rendered into the CTA as a fallback. This avoids closing
            // the popup when the refresh hits a transient 401/HTML/error
            // response before the status cache has warmed.
            const freshUrl =
              s?.cliAuthUrl ??
              s?.connectUrl ??
              cachedFreshUrl ??
              signedCliPropUrl ??
              signedPropUrl ??
              fallbackUrl;
            if (!freshUrl) {
              try {
                opened.close();
              } catch {
                // Ignore close failures.
              }
              stopPoll();
              connectStartedAtRef.current = null;
              setConnecting(false);
              setError(
                "Couldn't start Builder connect. Refresh this page and try again.",
              );
              return;
            }
            const trackedFreshUrl = withBuilderConnectTrackingParams(freshUrl, {
              source: clickTrackingSource,
              flow: clickTrackingFlow,
            });
            if (!navigateBuilderConnectPopup(opened, trackedFreshUrl)) {
              stopPoll();
              connectStartedAtRef.current = null;
              setConnecting(false);
              setError(
                "Couldn't navigate the Builder popup. Allow popups and try again.",
              );
            }
          })();
        }
      }

      pollRef.current = setInterval(async () => {
        const s = await fetchStatus();
        if (!mountedRef.current) {
          stopPoll();
          return;
        }
        if (s?.configured) {
          stopPoll();
          setConfigured(true);
          setEnvManaged(!!s.envManaged);
          setBuilderEnabled(!!s.builderEnabled);
          const nextConnectUrl = s.cliAuthUrl ?? s.connectUrl ?? null;
          setStatusConnectUrl(nextConnectUrl);
          statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
          const org = s.orgName ?? null;
          setOrgName(org);
          setConnecting(false);
          connectStartedAtRef.current = null;
          notifiedConnectedRef.current = true;
          notifyAgentEngineConfiguredChanged("builder-connect");
          try {
            await onConnectedRef.current?.({ orgName: org });
          } catch {
            // Consumer's callback failed; we've already flipped the UI state
            // to connected. Swallow so we don't re-arm the flow.
          }
        } else if (isCurrentConnectError(s?.connectError, started)) {
          // OAuth callback ran but writeBuilderCredentials threw — surface the
          // real error instead of letting the user wait 5 minutes for timeout.
          stopPoll();
          connectStartedAtRef.current = null;
          setConnecting(false);
          setError(
            `Couldn't save Builder credentials: ${s.connectError.message}. Try again or contact support.`,
          );
        } else if (Date.now() - started > POLL_TIMEOUT_MS) {
          stopPoll();
          connectStartedAtRef.current = null;
          setConnecting(false);
          trackEvent("builder connect failed", {
            feature: "builder",
            stage: "client",
            reason: "timeout",
            source: clickTrackingSource,
            flow:
              cleanTrackingParam(clickTrackingFlow) ??
              inferBuilderConnectTrackingFlow(clickTrackingSource),
          });
          setError(
            "Didn't hear back from Builder in 5 minutes. Allow popups and try again.",
          );
        }
      }, POLL_INTERVAL_MS);
    },
    [
      enabled,
      fetchStatus,
      popupUrl,
      statusConnectUrl,
      stopPoll,
      trackingFlow,
      trackingSource,
    ],
  );

  // Popup-side fast path: the callback page broadcasts a message so we stop
  // polling immediately rather than waiting for the next 2s tick.
  //
  // We listen on BroadcastChannel (same-origin, works with noopener popups)
  // AND on window.message (legacy path for environments without BC or for
  // popups that still have opener access). Both paths are safe to have open
  // simultaneously \u2014 the first one to fire wins and the error is deduplicated
  // by the stopPoll() call which is idempotent.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    const handleError = (message: string) => {
      stopPoll();
      connectStartedAtRef.current = null;
      setConnecting(false);
      setError(`Couldn't save Builder credentials: ${message}.`);
    };
    const handleSuccess = async () => {
      let s: Awaited<ReturnType<typeof fetchStatus>> = null;
      for (let i = 0; i < CALLBACK_SUCCESS_STATUS_RETRIES; i += 1) {
        s = await fetchStatus();
        if (!mountedRef.current) return;
        if (
          s?.configured ||
          isCurrentConnectError(s?.connectError, connectStartedAtRef.current)
        ) {
          break;
        }
        if (i < CALLBACK_SUCCESS_STATUS_RETRIES - 1) {
          await delay(CALLBACK_SUCCESS_STATUS_RETRY_MS);
        }
      }
      if (!mountedRef.current) return;
      if (!s?.configured) {
        const connectError = isCurrentConnectError(
          s?.connectError,
          connectStartedAtRef.current,
        )
          ? s?.connectError
          : null;
        setHasFetchedStatus(true);
        if (s) {
          setConfigured(false);
          setEnvManaged(!!s.envManaged);
          setBuilderEnabled(!!s.builderEnabled);
          const nextConnectUrl = s.cliAuthUrl ?? s.connectUrl ?? null;
          setStatusConnectUrl(nextConnectUrl);
          statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
          setOrgName(s.orgName ?? null);
        }
        if (connectError) {
          stopPoll();
          connectStartedAtRef.current = null;
          setConnecting(false);
          setError(
            `Couldn't save Builder credentials: ${connectError.message}. Try again or contact support.`,
          );
        }
        return;
      }
      stopPoll();
      setHasFetchedStatus(true);
      setConfigured(true);
      setEnvManaged(!!s.envManaged);
      setBuilderEnabled(!!s.builderEnabled);
      const nextConnectUrl = s.cliAuthUrl ?? s.connectUrl ?? null;
      setStatusConnectUrl(nextConnectUrl);
      statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
      const org = s.orgName ?? null;
      setOrgName(org);
      setConnecting(false);
      connectStartedAtRef.current = null;
      notifiedConnectedRef.current = true;
      notifyAgentEngineConfiguredChanged("builder-connect-message");
      try {
        await onConnectedRef.current?.({ orgName: org });
      } catch {
        // The caller's callback is a UI convenience; status is already set.
      }
    };

    try {
      channel = new BroadcastChannel(`builder-connect:${window.location.host}`);
      channel.onmessage = (e: MessageEvent) => {
        const data = e.data as { type?: string; message?: string } | undefined;
        if (data?.type === "builder-connect-success") {
          void handleSuccess();
          return;
        }
        if (data?.type === "builder-connect-error") {
          if (typeof data.message !== "string" || !data.message) return;
          handleError(data.message);
        }
      };
    } catch {
      // BroadcastChannel not available (rare) \u2014 fall through to postMessage.
    }

    const handler = (e: MessageEvent) => {
      if (!isTrustedBuilderConnectMessageOrigin(e.origin)) return;
      const data = e.data as { type?: string; message?: string } | undefined;
      if (data?.type === "builder-connect-success") {
        void handleSuccess();
        return;
      }
      if (data?.type === "builder-connect-error") {
        if (typeof data.message !== "string" || !data.message) return;
        handleError(data.message);
      }
    };
    window.addEventListener("message", handler);

    return () => {
      channel?.close();
      window.removeEventListener("message", handler);
    };
  }, [fetchStatus, stopPoll]);

  return {
    configured,
    statusResolved,
    envManaged,
    builderEnabled,
    orgName,
    connecting,
    error,
    hasFetchedStatus,
    start,
  };
}
