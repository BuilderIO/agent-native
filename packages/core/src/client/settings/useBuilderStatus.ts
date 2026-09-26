import { useState, useEffect, useCallback, useRef } from "react";

import { applyBuilderUtmTrackingParams } from "../../shared/builder-link-tracking.js";
import { trackEvent } from "../analytics.js";
import { agentNativePath } from "../api-path.js";
import { getCallbackOrigin } from "../frame.js";
import { openMcpAppHostLink } from "../mcp-app-host.js";
import { oauthPopupWaitingUrl } from "../oauth-popup.js";
import { scheduleAfterPaint } from "../use-after-paint.js";
import { usePollLoop } from "../use-poll-loop.js";

export interface BuilderStatus {
  configured: boolean;
  builderEnabled: boolean;
  agentNativeProvisioningEnabled?: boolean;
  agentNativeProvisioningToken?: string;
  envManaged?: boolean;
  credentialSource?: "user" | "org" | "workspace" | "env";
  canDisconnect?: boolean;
  connectUrl: string;
  appHost: string;
  apiHost: string;
  branchProjectIdConfigured?: boolean;
  branchProjectId?: string;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  userId?: string;
  orgName?: string;
  spaces?: Array<{ id: string; name: string }>;
  orgKind?: string;
  subscription?: string;
  subscriptionLevel?: string;
  subscriptionName?: string;
  isEnterprise?: boolean;
  isFreeAccount?: boolean;
  connectError?: { message: string; at: number; code?: string };
  authError?: { message: string; at: number };
}

export function hasBuilderOAuthCredential(
  status: Pick<BuilderStatus, "configured" | "envManaged"> & {
    credentialSource?: BuilderStatus["credentialSource"] | null;
  },
): boolean {
  return (
    status.configured &&
    status.credentialSource !== "env" &&
    (!status.envManaged || status.credentialSource != null)
  );
}

export function useBuilderStatus({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const [status, setStatus] = useState<BuilderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const lastGoodStatusRef = useRef<BuilderStatus | null>(null);
  const requestGenerationRef = useRef(0);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return;
    const requestGeneration = ++requestGenerationRef.current;
    const isCurrentRequest = () =>
      requestGeneration === requestGenerationRef.current;
    const keepLastGoodStatus = (message: string) => {
      if (!isCurrentRequest()) return;
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
      if (!isCurrentRequest()) return;
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
      if (isCurrentRequest()) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      requestGenerationRef.current += 1;
      setStatus(null);
      setLoading(false);
      setError(null);
      setStale(false);
      lastGoodStatusRef.current = null;
      return;
    }
    setLoading(true);
    let initialFetchRan = false;
    const cancelInitialFetch = scheduleAfterPaint(() => {
      initialFetchRan = true;
      void fetchStatus();
    });
    const refreshNow = () => {
      if (!initialFetchRan) {
        initialFetchRan = true;
        cancelInitialFetch();
      }
      void fetchStatus();
    };

    function onFocus() {
      refreshNow();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") refreshNow();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("agent-engine:configured-changed", refreshNow);
    return () => {
      requestGenerationRef.current += 1;
      cancelInitialFetch();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("agent-engine:configured-changed", refreshNow);
    };
  }, [enabled, fetchStatus]);

  return { status, loading, error, stale, refetch: fetchStatus };
}


export interface BuilderConnectFlowOptions {
  enabled?: boolean;
  popupUrl?: string;
  provisionAccount?: boolean;
  trackingSource?: string;
  trackingFlow?: string;
  onConnected?: (state: { orgName: string | null }) => void | Promise<void>;
}

export interface BuilderConnectStartOptions {
  trackingSource?: string;
  trackingFlow?: string;
  provisionAccount?: boolean;
}

export interface BuilderConnectFlow {
  configured: boolean;
  statusResolved: boolean;
  statusReadSettledCount: number;
  envManaged: boolean;
  credentialSource?: BuilderStatus["credentialSource"] | null;
  canDisconnect?: boolean;
  agentNativeProvisioningEnabled: boolean;
  codeChangeConfigured: boolean;
  builderEnabled: boolean;
  orgName: string | null;
  connecting: boolean;
  error: string | null;
  accountExists: boolean;
  hasFetchedStatus: boolean;
  start: (options?: BuilderConnectStartOptions) => void;
  cancel: () => void;
  retry: () => boolean;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
export const POPUP_CLOSED_CONFIRMATION_GRACE_MS = 20_000;
const POPUP_LOAD_TIMEOUT_MS = 20_000;
const STATUS_FETCH_ABORT_MS = 10_000;
const BUILDER_STATUS_UNAVAILABLE_MESSAGE =
  "Couldn't reach Builder to check your account. Retrying.";
const CALLBACK_SUCCESS_STATUS_RETRY_MS = 500;
const CALLBACK_SUCCESS_STATUS_RETRIES = 10;
const BUILDER_CONNECT_PARAM = "_an_connect";
const BUILDER_CONNECT_MODE_PARAM = "_an_mode";
const BUILDER_AGENT_NATIVE_PROVISION_MODE = "agent-native";
const BUILDER_PROVISIONING_TOKEN_PARAM = "_an_provision";
const BUILDER_CONNECT_ATTEMPT_PARAM = "_an_connect_attempt";
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

    applyBuilderUtmTrackingParams(parsed.searchParams, { content: source });

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

function isFreshSignedConnectUrl(
  url: string | null,
  fetchedAt: number | null,
): url is string {
  return (
    hasSignedConnectToken(url) &&
    typeof fetchedAt === "number" &&
    Date.now() - fetchedAt < STATUS_CONNECT_URL_TTL_MS
  );
}

function createBuilderConnectAttemptId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCurrentConnectError(
  error: { message: string; at: number } | undefined,
  startedAt: number | null,
): error is { message: string; at: number } {
  if (!error?.message) return false;
  if (!startedAt) return true;
  return typeof error.at !== "number" || error.at >= startedAt - 1000;
}

function isCodeChangeConfigured(
  status:
    | Pick<BuilderStatus, "privateKeyConfigured" | "publicKeyConfigured">
    | null
    | undefined,
): boolean {
  return !!status?.privateKeyConfigured && !!status?.publicKeyConfigured;
}

function showBuilderConnectPopupPlaceholder(opened: Window) {
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

function waitForBuilderConnectPopupLoad(
  opened: Window,
  shouldCancel: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let cancellationTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onLoad = () => finish(true);
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (cancellationTimer !== null) clearInterval(cancellationTimer);
      if (timeoutId !== null) clearTimeout(timeoutId);
      try {
        opened.removeEventListener("load", onLoad);
      } catch {
        // coercion-ok: cleanup is best effort after a popup becomes unavailable.
        // Ignore a popup that became unavailable before cleanup.
      }
      resolve(ready);
    };
    try {
      if (shouldCancel()) {
        finish(false);
        return;
      }
      cancellationTimer = setInterval(() => {
        if (shouldCancel()) finish(false);
      }, POLL_INTERVAL_MS);
      timeoutId = setTimeout(() => finish(false), POPUP_LOAD_TIMEOUT_MS);
      opened.addEventListener("load", onLoad);
    } catch {
      finish(false);
    }
  });
}

export function isPopupClosed(popup: Window | null): boolean {
  if (!popup) return false;
  try {
    return popup.closed === true;
  } catch {
    // coercion-ok: `.closed` is readable cross-origin in every supported
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
    provisionAccount = false,
    trackingSource = "builder_connect_flow",
    trackingFlow,
    onConnected,
  } = opts;
  const [configured, setConfigured] = useState(false);
  const [codeChangeConfigured, setCodeChangeConfigured] = useState(false);
  const [envManaged, setEnvManaged] = useState(false);
  const [credentialSource, setCredentialSource] = useState<
    BuilderStatus["credentialSource"] | null
  >(null);
  const [canDisconnect, setCanDisconnect] = useState(false);
  const [agentNativeProvisioningEnabled, setAgentNativeProvisioningEnabled] =
    useState(false);
  const [agentNativeProvisioningToken, setAgentNativeProvisioningToken] =
    useState<string | null>(null);
  const [builderEnabled, setBuilderEnabled] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [hasFetchedStatus, setHasFetchedStatus] = useState(false);
  const [statusResolved, setStatusResolved] = useState(false);
  const [statusReadSettledCount, setStatusReadSettledCount] = useState(0);
  const [statusConnectUrl, setStatusConnectUrl] = useState<string | null>(null);
  const statusConnectUrlAtRef = useRef<number | null>(null);
  const connectStartedAtRef = useRef<number | null>(null);
  const connectAttemptIdRef = useRef<string | null>(null);
  const cancelledConnectAttemptIdRef = useRef<string | null>(null);
  const activePopupRef = useRef<Window | null>(null);
  const popupClosedAtRef = useRef<number | null>(null);
  const callbackSuccessStartedAtRef = useRef<number | null>(null);
  const callbackSuccessInFlightAtRef = useRef<number | null>(null);
  const callbackSuccessCancelRef = useRef<{
    started: number;
    cancel: () => void;
  } | null>(null);
  const callbackSuccessRequestControllerRef = useRef<{
    started: number;
    controller: AbortController;
  } | null>(null);
  const retryStatusRef = useRef<() => boolean>(() => false);
  const statusUnavailableRef = useRef(false);
  const mountedRef = useRef(true);
  const notifiedConnectedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const activeTrackingRef = useRef<{ source: string; flow?: string }>({
    source: trackingSource,
    flow: trackingFlow,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktopBridge = (
      window as Window & {
        agentNativeDesktop?: {
          oauth?: {
            onSystemBrowserReturned?: (
              callback: (attemptId: string | null) => void,
            ) => () => void;
            onPopupClosed: (
              callback: (attemptId: string | null) => void,
            ) => () => void;
          };
        };
      }
    ).agentNativeDesktop;
    const removeSystemBrowserReturn =
      desktopBridge?.oauth?.onSystemBrowserReturned?.((attemptId) => {
        if (!attemptId || attemptId !== connectAttemptIdRef.current) return;
        retryStatusRef.current();
      });
    const removePopupClosed = desktopBridge?.oauth?.onPopupClosed(
      (attemptId) => {
        if (!attemptId || attemptId !== connectAttemptIdRef.current) return;
        const started = connectStartedAtRef.current;
        if (
          started !== null &&
          callbackSuccessStartedAtRef.current === started
        ) {
          popupClosedAtRef.current ??= Date.now();
          return;
        }
        popupClosedAtRef.current ??= Date.now();
        if (callbackSuccessCancelRef.current?.started === started) {
          callbackSuccessCancelRef.current.cancel();
        }
        if (callbackSuccessRequestControllerRef.current?.started === started) {
          callbackSuccessRequestControllerRef.current.controller.abort();
        }
      },
    );
    return () => {
      removeSystemBrowserReturn?.();
      removePopupClosed?.();
    };
  }, []);

  const fetchStatus = useCallback(
    async (signal?: AbortSignal, connectAttemptId?: string) => {
      if (!enabled) return null;
      const origin = getCallbackOrigin() || window.location.origin;
      const ownController =
        !signal && typeof AbortController !== "undefined"
          ? new AbortController()
          : null;
      const timeoutId = ownController
        ? setTimeout(() => ownController.abort(), STATUS_FETCH_ABORT_MS)
        : null;
      try {
        const statusUrl = new URL(
          agentNativePath("/_agent-native/connection-status/builder"),
          origin,
        );
        if (connectAttemptId) {
          statusUrl.searchParams.set(
            BUILDER_CONNECT_ATTEMPT_PARAM,
            connectAttemptId,
          );
        }
        const r = await fetch(statusUrl.href, {
          signal: signal ?? ownController?.signal,
        });
        if (!r.ok) return null;
        return (await r.json()) as Pick<
          BuilderStatus,
          | "configured"
          | "agentNativeProvisioningEnabled"
          | "agentNativeProvisioningToken"
          | "envManaged"
          | "canDisconnect"
          | "builderEnabled"
          | "orgName"
          | "connectUrl"
          | "credentialSource"
          | "connectError"
          | "authError"
          | "privateKeyConfigured"
          | "publicKeyConfigured"
        >;
      } catch {
        // coercion-ok: null means "status unknown this tick" and callers hold
        return null;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setConfigured(false);
      setCodeChangeConfigured(false);
      setEnvManaged(false);
      setCredentialSource(null);
      setCanDisconnect(false);
      setAgentNativeProvisioningEnabled(false);
      setAgentNativeProvisioningToken(null);
      setBuilderEnabled(false);
      setOrgName(null);
      setConnecting(false);
      setError(null);
      setAccountExists(false);
      setHasFetchedStatus(false);
      setStatusResolved(false);
      setStatusReadSettledCount(0);
      setStatusConnectUrl(null);
      statusConnectUrlAtRef.current = null;
      connectAttemptIdRef.current = null;
      retryStatusRef.current = () => false;
      return;
    }
    mountedRef.current = true;
    let cancelled = false;
    let refreshGeneration = 0;
    const refresh = async () => {
      const generation = ++refreshGeneration;
      const isCurrentRefresh = () => generation === refreshGeneration;
      const s = await fetchStatus();
      if (cancelled || !mountedRef.current || !isCurrentRefresh()) return;
      setHasFetchedStatus(true);
      setStatusReadSettledCount((count) => count + 1);
      if (!s) {
        statusUnavailableRef.current = true;
        setError(BUILDER_STATUS_UNAVAILABLE_MESSAGE);
        return;
      }
      if (statusUnavailableRef.current) {
        statusUnavailableRef.current = false;
        setError(null);
      }
      setStatusResolved(true);
      setConfigured(!!s.configured);
      setCodeChangeConfigured(isCodeChangeConfigured(s));
      setEnvManaged(!!s.envManaged);
      setCredentialSource(s.credentialSource ?? null);
      setCanDisconnect(!!s.canDisconnect);
      setAgentNativeProvisioningEnabled(!!s.agentNativeProvisioningEnabled);
      setAgentNativeProvisioningToken(s.agentNativeProvisioningToken ?? null);
      setAccountExists(s.connectError?.code === "account_exists");
      setBuilderEnabled(!!s.builderEnabled);
      const nextConnectUrl = s.connectUrl ?? null;
      setStatusConnectUrl(nextConnectUrl);
      statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
      const org = s.orgName ?? null;
      setOrgName(org);
      const hasOAuthCredential = hasBuilderOAuthCredential(s);
      if (hasOAuthCredential) {
        connectStartedAtRef.current = null;
        setConnecting(false);
      }
      if (hasOAuthCredential && !notifiedConnectedRef.current) {
        notifiedConnectedRef.current = true;
        notifyAgentEngineConfiguredChanged("builder-status");
        try {
          await onConnectedRef.current?.({ orgName: org });
        } catch {
          // The caller's callback is a UI convenience; status is already set.
        }
      } else if (!hasOAuthCredential) {
        notifiedConnectedRef.current = false;
      }
      const activeConnectStartedAt = connectStartedAtRef.current;
      if (isCurrentConnectError(s.connectError, activeConnectStartedAt)) {
        setError(s.connectError.message);
      } else if (!activeConnectStartedAt && s.authError?.message) {
        setError(s.authError.message);
      } else if (s.configured) {
        setError(null);
      }
    };
    retryStatusRef.current = () => {
      void refresh();
      return true;
    };
    let initialRefreshRan = false;
    const cancelInitialRefresh = scheduleAfterPaint(() => {
      initialRefreshRan = true;
      void refresh();
    });
    const refreshNow = () => {
      if (!initialRefreshRan) {
        initialRefreshRan = true;
        cancelInitialRefresh();
      }
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshNow();
    };
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("agent-engine:configured-changed", refreshNow);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      cancelInitialRefresh();
      retryStatusRef.current = () => false;
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("agent-engine:configured-changed", refreshNow);
    };
  }, [enabled, fetchStatus]);

  const retry = useCallback(() => retryStatusRef.current(), []);
  const cancel = useCallback(() => {
    const started = connectStartedAtRef.current;
    if (started === null) return;
    const attemptId = connectAttemptIdRef.current;
    cancelledConnectAttemptIdRef.current = attemptId;
    popupClosedAtRef.current ??= Date.now();
    if (callbackSuccessCancelRef.current?.started === started)
      callbackSuccessCancelRef.current.cancel();
    if (callbackSuccessRequestControllerRef.current?.started === started)
      callbackSuccessRequestControllerRef.current.controller.abort();
    try {
      activePopupRef.current?.close();
    } catch {
      // coercion-ok: cancellation state is already recorded.
      // The bounded cancellation path still applies if the browser refuses.
    }
    if (typeof window !== "undefined" && attemptId) {
      try {
        (
          window as Window & {
            agentNativeDesktop?: {
              oauth?: { cancelPopup?: (id: string) => void };
            };
          }
        ).agentNativeDesktop?.oauth?.cancelPopup?.(attemptId);
      } catch {
        // coercion-ok: cancellation state is already recorded.
        // The bounded cancellation path still applies if the desktop bridge is unavailable.
      }
    }
  }, []);

  const start = useCallback(
    (startOptions?: BuilderConnectStartOptions) => {
      if (!enabled) return;
      const started = Date.now();
      const connectAttemptId = createBuilderConnectAttemptId();
      const clickTrackingSource =
        startOptions?.trackingSource ?? trackingSource;
      const clickTrackingFlow = startOptions?.trackingFlow ?? trackingFlow;
      const provisionAccountForStart =
        startOptions?.provisionAccount ?? provisionAccount;
      callbackSuccessCancelRef.current?.cancel();
      callbackSuccessRequestControllerRef.current?.controller.abort();
      connectStartedAtRef.current = started;
      connectAttemptIdRef.current = connectAttemptId;
      cancelledConnectAttemptIdRef.current = null;
      callbackSuccessStartedAtRef.current = null;
      callbackSuccessInFlightAtRef.current = null;
      callbackSuccessCancelRef.current = null;
      callbackSuccessRequestControllerRef.current = null;
      activePopupRef.current = null;
      popupClosedAtRef.current = null;
      activeTrackingRef.current = {
        source: clickTrackingSource,
        flow: clickTrackingFlow,
      };
      setConnecting(true);
      setError(null);
      if (provisionAccountForStart) setAccountExists(false);

      const origin = getCallbackOrigin() || window.location.origin;
      const cachedFreshUrl = isFreshSignedConnectUrl(
        statusConnectUrl,
        statusConnectUrlAtRef.current,
      )
        ? statusConnectUrl
        : null;
      // cannot race the refreshed signed URL navigation. Embedded hosts use
      const signedPropUrl = hasSignedConnectToken(popupUrl) ? popupUrl : null;
      const fallbackUrl = new URL(
        agentNativePath("/_agent-native/builder/connect"),
        origin,
      ).href;
      const withProvisionMode = (
        url: string,
        provisioningEnabled = agentNativeProvisioningEnabled,
        provisioningToken = agentNativeProvisioningToken,
      ): string => {
        const connectUrl = new URL(url, origin);
        connectUrl.searchParams.set(
          BUILDER_CONNECT_ATTEMPT_PARAM,
          connectAttemptId,
        );
        if (
          !provisionAccountForStart ||
          !provisioningEnabled ||
          !provisioningToken
        ) {
          return connectUrl.toString();
        }
        connectUrl.searchParams.set(
          BUILDER_CONNECT_MODE_PARAM,
          BUILDER_AGENT_NATIVE_PROVISION_MODE,
        );
        connectUrl.searchParams.set(
          BUILDER_PROVISIONING_TOKEN_PARAM,
          provisioningToken,
        );
        return connectUrl.toString();
      };
      const directUrl = withProvisionMode(
        cachedFreshUrl ?? signedPropUrl ?? fallbackUrl,
      );

      if (isAgentNativeDesktop()) {
        const opened = openBuilderConnectPopup({
          url: directUrl,
          source: clickTrackingSource,
          flow: clickTrackingFlow,
        });
        if (opened) activePopupRef.current = opened;
        if (!opened) {
          // Agent-Native Desktop handles the popup in Electron and reports
          // null to the embedded webview, so null is not a blocker here.
        }
      } else {
        const embeddedWindow = isEmbeddedWindow();
        const opened = openBuilderConnectPopup({
          url: embeddedWindow ? oauthPopupWaitingUrl() : "about:blank",
          source: clickTrackingSource,
          flow: clickTrackingFlow,
          features: "width=600,height=700",
        });
        if (opened) activePopupRef.current = opened;
        if (!opened) {
          if (!embeddedWindow) {
            connectStartedAtRef.current = null;
            setConnecting(false);
            setError("Couldn't open Builder. Allow popups and try again.");
            return;
          }

          void (async () => {
            const s = await fetchStatus(undefined, connectAttemptId);
            if (
              !mountedRef.current ||
              connectAttemptIdRef.current !== connectAttemptId ||
              cancelledConnectAttemptIdRef.current === connectAttemptId
            ) {
              return;
            }
            if (s) {
              setHasFetchedStatus(true);
              setStatusResolved(true);
              setConfigured(!!s.configured);
              setCodeChangeConfigured(isCodeChangeConfigured(s));
              setEnvManaged(!!s.envManaged);
              setCredentialSource(s.credentialSource ?? null);
              setCanDisconnect(!!s.canDisconnect);
              setAgentNativeProvisioningEnabled(
                !!s.agentNativeProvisioningEnabled,
              );
              setAgentNativeProvisioningToken(
                s.agentNativeProvisioningToken ?? null,
              );
              setAccountExists(s.connectError?.code === "account_exists");
              setBuilderEnabled(!!s.builderEnabled);
              const nextConnectUrl = s.connectUrl ?? null;
              setStatusConnectUrl(nextConnectUrl);
              statusConnectUrlAtRef.current = nextConnectUrl
                ? Date.now()
                : null;
              setOrgName(s.orgName ?? null);
            }

            const hostUrl = withProvisionMode(
              s?.connectUrl ?? cachedFreshUrl ?? directUrl,
              !!s?.agentNativeProvisioningEnabled,
              s?.agentNativeProvisioningToken ?? null,
            );
            const trackedHostUrl = withBuilderConnectTrackingParams(hostUrl, {
              source: clickTrackingSource,
              flow: clickTrackingFlow,
            });
            const openedByHost =
              await openBuilderConnectViaMcpHost(trackedHostUrl);
            if (!mountedRef.current || openedByHost) return;
            connectStartedAtRef.current = null;
            setConnecting(false);
            setError(
              "Couldn't open Builder from this chat host. Open this app in a browser tab and try Connect Builder (free tier available) again.",
            );
          })();
        } else {
          const isCurrentConnectAttempt = () =>
            mountedRef.current &&
            connectAttemptIdRef.current === connectAttemptId &&
            connectStartedAtRef.current === started &&
            cancelledConnectAttemptIdRef.current !== connectAttemptId;
          const popupReady = embeddedWindow
            ? waitForBuilderConnectPopupLoad(
                opened,
                () => !isCurrentConnectAttempt() || isPopupClosed(opened),
              )
            : Promise.resolve(true);
          showBuilderConnectPopupPlaceholder(opened);
          void (async () => {
            const s = await fetchStatus(undefined, connectAttemptId);
            if (!isCurrentConnectAttempt()) {
              try {
                opened.close();
              } catch {
                // coercion-ok: closing a popup from a superseded attempt is
                // best effort.
              }
              return;
            }
            if (s) {
              setHasFetchedStatus(true);
              setStatusResolved(true);
              setConfigured(!!s.configured);
              setCodeChangeConfigured(isCodeChangeConfigured(s));
              setEnvManaged(!!s.envManaged);
              setCredentialSource(s.credentialSource ?? null);
              setCanDisconnect(!!s.canDisconnect);
              setAgentNativeProvisioningEnabled(
                !!s.agentNativeProvisioningEnabled,
              );
              setAgentNativeProvisioningToken(
                s.agentNativeProvisioningToken ?? null,
              );
              setAccountExists(s.connectError?.code === "account_exists");
              setBuilderEnabled(!!s.builderEnabled);
              const nextConnectUrl = s.connectUrl ?? null;
              setStatusConnectUrl(nextConnectUrl);
              statusConnectUrlAtRef.current = nextConnectUrl
                ? Date.now()
                : null;
              setOrgName(s.orgName ?? null);
            }

            const freshUrl = withProvisionMode(
              s?.connectUrl ?? cachedFreshUrl ?? signedPropUrl ?? fallbackUrl,
              !!s?.agentNativeProvisioningEnabled,
              s?.agentNativeProvisioningToken ?? null,
            );
            if (!freshUrl) {
              try {
                opened.close();
              } catch {
                // Ignore close failures.
              }
              connectStartedAtRef.current = null;
              setConnecting(false);
              setError(
                "Couldn't start Builder connect. Refresh this page and try again.",
              );
              return;
            }
            const popupLoaded = await popupReady;
            if (!isCurrentConnectAttempt()) {
              try {
                opened.close();
              } catch {
                // coercion-ok: closing a popup from a superseded attempt is
                // best effort.
              }
              return;
            }
            if (!popupLoaded) {
              try {
                opened.close();
              } catch {
                // coercion-ok: closing a failed popup is best effort.
                // Ignore close failures.
              }
              connectStartedAtRef.current = null;
              setConnecting(false);
              setError(
                "Couldn't navigate the Builder popup. Allow popups and try again.",
              );
              return;
            }
            const trackedFreshUrl = withBuilderConnectTrackingParams(freshUrl, {
              source: clickTrackingSource,
              flow: clickTrackingFlow,
            });
            if (!navigateBuilderConnectPopup(opened, trackedFreshUrl)) {
              connectStartedAtRef.current = null;
              setConnecting(false);
              setError(
                "Couldn't navigate the Builder popup. Allow popups and try again.",
              );
            }
          })();
        }
      }
    },
    [
      enabled,
      fetchStatus,
      agentNativeProvisioningEnabled,
      agentNativeProvisioningToken,
      provisionAccount,
      popupUrl,
      statusConnectUrl,
      trackingFlow,
      trackingSource,
    ],
  );

  usePollLoop(
    async (signal) => {
      const started = connectStartedAtRef.current;
      if (started == null) return;
      const s = await fetchStatus(
        signal,
        connectAttemptIdRef.current ?? undefined,
      );
      if (!mountedRef.current || connectStartedAtRef.current !== started) {
        return;
      }
      const orgName = s?.orgName ?? null;
      if (s) {
        if (statusUnavailableRef.current) {
          statusUnavailableRef.current = false;
          setError(null);
        }
        setHasFetchedStatus(true);
        setStatusResolved(true);
        setConfigured(!!s.configured);
        setCodeChangeConfigured(isCodeChangeConfigured(s));
        setEnvManaged(!!s.envManaged);
        setCredentialSource(s.credentialSource ?? null);
        setCanDisconnect(!!s.canDisconnect);
        setAgentNativeProvisioningEnabled(!!s.agentNativeProvisioningEnabled);
        setAgentNativeProvisioningToken(s.agentNativeProvisioningToken ?? null);
        setAccountExists(s.connectError?.code === "account_exists");
        setBuilderEnabled(!!s.builderEnabled);
        const nextConnectUrl = s.connectUrl ?? null;
        setStatusConnectUrl(nextConnectUrl);
        statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
        setOrgName(orgName);
      }
      if (s && hasBuilderOAuthCredential(s)) {
        setAccountExists(false);
        setConnecting(false);
        connectStartedAtRef.current = null;
        notifiedConnectedRef.current = true;
        notifyAgentEngineConfiguredChanged("builder-connect");
        try {
          await onConnectedRef.current?.({ orgName });
        } catch {
          // coercion-ok: the connection itself succeeded and the UI state is
          // already flipped; re-arming the flow on a consumer callback failure
          // would reconnect an account that is connected.
        }
      } else if (isCurrentConnectError(s?.connectError, started)) {
        connectStartedAtRef.current = null;
        setConnecting(false);
        setAccountExists(s.connectError.code === "account_exists");
        setError(
          s.connectError.code === "account_exists"
            ? null
            : `Couldn't save Builder credentials: ${s.connectError.message}. Try again or contact support.`,
        );
      } else if (
        (isPopupClosed(activePopupRef.current) ||
          popupClosedAtRef.current !== null) &&
        callbackSuccessInFlightAtRef.current !== started
      ) {
        popupClosedAtRef.current ??= Date.now();
        if (
          Date.now() - popupClosedAtRef.current >
          POPUP_CLOSED_CONFIRMATION_GRACE_MS
        ) {
          connectStartedAtRef.current = null;
          setConnecting(false);
          const { source, flow } = activeTrackingRef.current;
          trackEvent("builder connect failed", {
            feature: "builder",
            stage: "client",
            reason: "popup_closed_without_status",
            source,
            flow:
              cleanTrackingParam(flow) ??
              inferBuilderConnectTrackingFlow(source),
          });
          setError(
            "Didn't finish connecting to Builder.io. Try again, or use your own keys.",
          );
        }
      } else if (Date.now() - started > POLL_TIMEOUT_MS) {
        connectStartedAtRef.current = null;
        setConnecting(false);
        const { source, flow } = activeTrackingRef.current;
        trackEvent("builder connect failed", {
          feature: "builder",
          stage: "client",
          reason: "timeout",
          source,
          flow:
            cleanTrackingParam(flow) ?? inferBuilderConnectTrackingFlow(source),
        });
        setError(
          "Didn't hear back from Builder in 5 minutes. Allow popups and try again.",
        );
      }
    },
    {
      intervalMs: POLL_INTERVAL_MS,
      leading: false,
      enabled: enabled && connecting,
    },
  );

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    const isCurrentConnectAttempt = (attemptId: string | undefined): boolean =>
      typeof attemptId === "string" &&
      attemptId === connectAttemptIdRef.current &&
      connectStartedAtRef.current !== null;
    const handleError = (
      message: string,
      code: string | undefined,
      attemptId: string | undefined,
    ) => {
      if (!isCurrentConnectAttempt(attemptId)) return;
      connectStartedAtRef.current = null;
      setConnecting(false);
      setAccountExists(code === "account_exists");
      setError(
        code === "account_exists"
          ? null
          : `Couldn't save Builder credentials: ${message}.`,
      );
    };
    const handleSuccess = async (attemptId: string | undefined) => {
      if (!isCurrentConnectAttempt(attemptId)) return;
      const started = connectStartedAtRef.current;
      if (started == null || callbackSuccessStartedAtRef.current === started) {
        return;
      }
      callbackSuccessStartedAtRef.current = started;
      callbackSuccessInFlightAtRef.current = started;
      popupClosedAtRef.current = null;
      let s: Awaited<ReturnType<typeof fetchStatus>> = null;
      let cancelled = false;
      let resolveCancelled: (value: null) => void = () => {};
      const cancelledPromise = new Promise<null>((resolve) => {
        resolveCancelled = resolve;
      });
      const cancelConfirmation = () => {
        if (cancelled) return;
        cancelled = true;
        resolveCancelled(null);
      };
      callbackSuccessCancelRef.current = {
        started,
        cancel: cancelConfirmation,
      };
      try {
        for (let i = 0; i < CALLBACK_SUCCESS_STATUS_RETRIES; i += 1) {
          const controller =
            typeof AbortController !== "undefined"
              ? new AbortController()
              : null;
          if (controller) {
            callbackSuccessRequestControllerRef.current = {
              started,
              controller,
            };
          }
          const timeoutId = controller
            ? setTimeout(() => controller.abort(), STATUS_FETCH_ABORT_MS)
            : null;
          try {
            s = await Promise.race([
              fetchStatus(
                controller?.signal,
                connectAttemptIdRef.current ?? undefined,
              ),
              cancelledPromise,
            ]);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (
              callbackSuccessRequestControllerRef.current?.controller ===
              controller
            ) {
              callbackSuccessRequestControllerRef.current = null;
            }
          }
          if (
            cancelled ||
            !mountedRef.current ||
            connectStartedAtRef.current !== started
          ) {
            return;
          }
          if (
            (s && hasBuilderOAuthCredential(s)) ||
            isCurrentConnectError(s?.connectError, started)
          ) {
            break;
          }
          if (i < CALLBACK_SUCCESS_STATUS_RETRIES - 1) {
            await Promise.race([
              delay(CALLBACK_SUCCESS_STATUS_RETRY_MS),
              cancelledPromise,
            ]);
            if (cancelled) return;
          }
        }
      } finally {
        if (callbackSuccessCancelRef.current?.started === started) {
          callbackSuccessCancelRef.current = null;
        }
        if (callbackSuccessRequestControllerRef.current?.started === started) {
          callbackSuccessRequestControllerRef.current.controller.abort();
          callbackSuccessRequestControllerRef.current = null;
        }
        if (callbackSuccessInFlightAtRef.current === started) {
          callbackSuccessInFlightAtRef.current = null;
          if (
            popupClosedAtRef.current !== null &&
            (!s || !hasBuilderOAuthCredential(s))
          ) {
            popupClosedAtRef.current = Date.now();
          }
        }
      }
      if (!mountedRef.current || connectStartedAtRef.current !== started) {
        return;
      }
      if (!s) return;
      if (!hasBuilderOAuthCredential(s)) {
        const connectError = isCurrentConnectError(s?.connectError, started)
          ? s?.connectError
          : null;
        setHasFetchedStatus(true);
        if (s) {
          setStatusResolved(true);
          setConfigured(!!s.configured);
          setCodeChangeConfigured(isCodeChangeConfigured(s));
          setEnvManaged(!!s.envManaged);
          setCredentialSource(s.credentialSource ?? null);
          setCanDisconnect(!!s.canDisconnect);
          setAgentNativeProvisioningEnabled(!!s.agentNativeProvisioningEnabled);
          setAgentNativeProvisioningToken(
            s.agentNativeProvisioningToken ?? null,
          );
          setAccountExists(s.connectError?.code === "account_exists");
          setBuilderEnabled(!!s.builderEnabled);
          const nextConnectUrl = s.connectUrl ?? null;
          setStatusConnectUrl(nextConnectUrl);
          statusConnectUrlAtRef.current = nextConnectUrl ? Date.now() : null;
          setOrgName(s.orgName ?? null);
        }
        if (connectError) {
          connectStartedAtRef.current = null;
          setConnecting(false);
          setAccountExists(connectError.code === "account_exists");
          setError(
            connectError.code === "account_exists"
              ? null
              : `Couldn't save Builder credentials: ${connectError.message}. Try again or contact support.`,
          );
        }
        return;
      }
      setHasFetchedStatus(true);
      setStatusResolved(true);
      setConfigured(true);
      setCodeChangeConfigured(isCodeChangeConfigured(s));
      setEnvManaged(!!s.envManaged);
      setCredentialSource(s.credentialSource ?? null);
      setCanDisconnect(!!s.canDisconnect);
      setAgentNativeProvisioningEnabled(!!s.agentNativeProvisioningEnabled);
      setAgentNativeProvisioningToken(s.agentNativeProvisioningToken ?? null);
      setAccountExists(false);
      setBuilderEnabled(!!s.builderEnabled);
      const nextConnectUrl = s.connectUrl ?? null;
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
        const data = e.data as
          | {
              type?: string;
              message?: string;
              code?: string;
              attemptId?: string;
            }
          | undefined;
        if (data?.type === "builder-connect-success") {
          void handleSuccess(data.attemptId);
          return;
        }
        if (data?.type === "builder-connect-error") {
          if (typeof data.message !== "string" || !data.message) return;
          handleError(data.message, data.code, data.attemptId);
        }
      };
    } catch {
      // BroadcastChannel not available (rare) \u2014 fall through to postMessage.
    }

    const handler = (e: MessageEvent) => {
      if (!isTrustedBuilderConnectMessageOrigin(e.origin)) return;
      const data = e.data as
        | {
            type?: string;
            message?: string;
            code?: string;
            attemptId?: string;
          }
        | undefined;
      if (data?.type === "builder-connect-success") {
        void handleSuccess(data.attemptId);
        return;
      }
      if (data?.type === "builder-connect-error") {
        if (typeof data.message !== "string" || !data.message) return;
        handleError(data.message, data.code, data.attemptId);
      }
    };
    window.addEventListener("message", handler);

    return () => {
      channel?.close();
      window.removeEventListener("message", handler);
    };
  }, [fetchStatus]);

  return {
    configured,
    codeChangeConfigured,
    statusResolved,
    statusReadSettledCount,
    envManaged,
    credentialSource,
    canDisconnect,
    agentNativeProvisioningEnabled,
    builderEnabled,
    orgName,
    connecting,
    error,
    accountExists,
    hasFetchedStatus,
    start,
    cancel,
    retry,
  };
}
