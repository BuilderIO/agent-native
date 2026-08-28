import {
  APP_CHAT_SIDEBAR_STATE_EVENT,
  APP_CHAT_SIDEBAR_STATE_MESSAGE,
} from "@agent-native/core/client/hooks";
import {
  BETA_OPT_OUT_DURATION_MS,
  BETA_OPT_OUT_QUERY_PARAM,
  buildSurfaceVisibilityScript,
} from "@agent-native/core/shared";
import {
  DESKTOP_DEFAULT_APPS,
  getTemplate,
  type AppDefinition,
  type AppConfig,
} from "@shared/app-registry";
import {
  IconRefresh,
  IconCopy,
  IconCheck,
  IconTerminal2,
  IconWorld,
  IconPlugOff,
  IconCircleCheck,
  IconCircleX,
  IconLoader2,
} from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
} from "react";

import {
  withDesktopEnvironmentLane,
  type DesktopEnvironmentLane,
} from "../../../shared/environment-lane.js";
import { buildContentDirectoryPickerBridgeScript } from "../lib/content-directory-picker-bridge.js";
import { buildGuestThemeScript, type RendererTheme } from "../lib/theme.js";
import DesktopIdentityGate from "./DesktopIdentityGate.js";
import { shouldReloadActiveWebview } from "./webview-refresh.js";

const IS_DEV = window.location.protocol !== "file:";
const DEV_APP_LOAD_TIMEOUT_MS = 60_000;
const APP_LOAD_TIMEOUT_MS = 15_000;
export const APP_WEBVIEW_PREFERENCES =
  "contextIsolation=true,nodeIntegration=false,sandbox=true,backgroundThrottling=true";

// The hosted environment switcher redirects authenticated Builder employees
// from production to beta in a normal browser. Electron child sessions are
// minted against the configured production origin, so keep first-party
// production webviews on that same origin unless a beta URL was explicitly
// supplied. The query is consumed by the hosted app and removed from history.
type WebviewTitleUpdatedEvent = Event & { title?: string };
type WebviewLoadFailedEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
};
type WebviewConsoleMessageEvent = Event & { message?: string };
type WebviewIpcMessageEvent = Event & {
  channel?: string;
  args?: unknown[];
};

export type GuestChatCommandEvent =
  | "agent-panel:toggle"
  | "agent-panel:open"
  | "agent-panel:close";

export function resolveGuestChatCommand(
  command: unknown,
): GuestChatCommandEvent | null {
  if (command === "toggle") return "agent-panel:toggle";
  if (command === "open") return "agent-panel:open";
  if (command === "close") return "agent-panel:close";
  return null;
}

export type AppWebviewAuthState =
  | "unknown"
  | "authenticated"
  | "unauthenticated";

export function resolveAppWebviewAuthState(
  rawUrl: string | undefined,
): AppWebviewAuthState {
  if (!rawUrl) return "unknown";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "unknown";
    }
    const lastSegment = parsed.pathname
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.toLowerCase();
    if (
      lastSegment === "sign-in" ||
      lastSegment === "login" ||
      lastSegment === "signup"
    ) {
      return "unauthenticated";
    }
    return "authenticated";
  } catch {
    return "unknown";
  }
}

export function buildGuestAuthStateProbeScript(): string {
  return `(() => {
    const frameworkPath = "/_agent-native/auth/session";
    const config = window.__AGENT_NATIVE_CONFIG__;
    const normalizeBasePath = (value) => {
      if (typeof value !== "string" || !value || value === "/") return "";
      return "/" + value.replace(/^\\/+|\\/+$/g, "");
    };
    const pathname = window.location.pathname || "/";
    const markerIndex = pathname.indexOf("/_agent-native");
    let basePath = markerIndex > 0 ? pathname.slice(0, markerIndex) : "";
    if (!basePath && typeof config?.appUrl === "string") {
      try {
        const configuredPath = normalizeBasePath(
          new URL(config.appUrl, window.location.origin).pathname,
        );
        if (
          configuredPath &&
          (pathname === configuredPath || pathname.startsWith(configuredPath + "/"))
        ) {
          basePath = configuredPath;
        }
      } catch {
        basePath = "";
      }
    }
    if (!basePath && config?.workspaceRuntime === true) {
      const firstSegment = pathname.split("/").find(Boolean);
      if (
        firstSegment &&
        !["_agent-native", "api", "sign-in", "login", "signup"].includes(
          firstSegment,
        )
      ) {
        basePath = "/" + firstSegment;
      }
    }
    const guestPath =
      typeof window.__anPath === "function"
        ? window.__anPath(frameworkPath)
        : basePath + frameworkPath;
    const sessionUrl = new URL(guestPath, window.location.origin);
    return fetch(sessionUrl.toString(), {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const bodyText = await response.text();
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return {
          authenticated: null,
          invalidJson: true,
          status: response.status,
          url: response.url,
        };
      }
      const record = body && typeof body === "object" ? body : null;
      const hasSession = Boolean(
        record &&
          !Object.prototype.hasOwnProperty.call(record, "error") &&
          (record.email || record.user || record.session),
      );
      return {
        authenticated: hasSession,
        status: response.status,
        url: response.url,
      };
    });
  })()`;
}

export function resolveAppWebviewAuthStateFromProbe(
  result: unknown,
  fallbackState: AppWebviewAuthState,
): AppWebviewAuthState {
  // A missing probe result is a failed read, not evidence that the route is
  // authenticated. The fallback is reserved for a known-unsupported 404.
  if (!result || typeof result !== "object") return "unknown";
  const probe = result as {
    authenticated?: unknown;
    invalidJson?: unknown;
    status?: unknown;
    url?: unknown;
  };
  if (probe.status === 401 || probe.status === 403) {
    return "unauthenticated";
  }
  if (probe.status === 404) return fallbackState;
  if (
    typeof probe.status === "number" &&
    (probe.status < 200 || probe.status >= 300)
  ) {
    return "unknown";
  }
  if (probe.invalidJson === true) return "unknown";
  if (probe.authenticated === true) return "authenticated";
  if (probe.authenticated === false) return "unauthenticated";
  const responseUrl =
    typeof probe.url === "string"
      ? resolveAppWebviewAuthState(probe.url)
      : "unknown";
  return responseUrl === "unknown" ? "unknown" : responseUrl;
}

async function readAppWebviewAuthState(
  webview: ElectronWebviewElement,
): Promise<AppWebviewAuthState> {
  let currentUrl = "";
  try {
    currentUrl = webview.getURL() || webview.src || "";
  } catch {
    currentUrl = webview.src || "";
  }
  const fallbackState = resolveAppWebviewAuthState(currentUrl || undefined);
  try {
    const result = await webview.executeJavaScript(
      buildGuestAuthStateProbeScript(),
      false,
    );
    return resolveAppWebviewAuthStateFromProbe(result, fallbackState);
  } catch {
    return "unknown";
  }
}

export function isDesktopIdentityGateEligible(
  app: Pick<AppDefinition, "id">,
  appConfig?: Pick<AppConfig, "isBuiltIn" | "mode" | "url" | "workspaceSso">,
  sourceUrl?: string,
): boolean {
  if (sourceUrl?.trim() || appConfig?.mode === "dev") return false;

  const canonical = DESKTOP_DEFAULT_APPS.find(
    (candidate) => candidate.id === app.id,
  );
  const productionOrigin = (url: string | undefined): string | null => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? parsed.origin : null;
      // coercion-ok: an invalid app URL is an ineligible SSO origin.
    } catch {
      return null;
    }
  };

  // A built-in id must retain its canonical production origin. Otherwise a
  // local or edited URL could inherit first-party SSO trust in the renderer.
  if (canonical && appConfig?.isBuiltIn === true) {
    if (productionOrigin(appConfig.url) !== productionOrigin(canonical.url)) {
      return false;
    }
  }

  if (appConfig?.workspaceSso === true) {
    return productionOrigin(appConfig.url) !== null;
  }
  if (appConfig && appConfig.isBuiltIn !== true) return false;
  return canonical !== undefined;
}

export function shouldUseDesktopIdentityGate(input: {
  eligible: boolean;
  active: boolean;
  enabled: boolean | null;
}): boolean {
  return input.eligible && input.active && input.enabled !== false;
}

export function shouldSuppressDesktopSignInPrompt(
  app: Pick<AppDefinition, "id">,
  appConfig: Pick<
    AppConfig,
    "id" | "isBuiltIn" | "mode" | "url" | "workspaceSso"
  >,
  identityAvailable: boolean,
): boolean {
  return identityAvailable && isDesktopIdentityGateEligible(app, appConfig);
}

export function isDesktopIdentityGateUnauthenticated(
  status: DesktopIdentityStatus | "checking" | undefined,
): boolean {
  return status === "sign-in-required" || status === "failed";
}

export function isDesktopIdentityAuthenticated(
  status: DesktopIdentityStatus | "checking" | undefined,
): boolean {
  return status === "signed-in";
}

export function resolveDesktopIdentityStatusForChat(
  status: DesktopIdentityStatus | "checking",
  sessionReady: boolean,
): DesktopIdentityStatus | "checking" {
  return (status === "signed-in" || status === "idle") && !sessionReady
    ? "checking"
    : status;
}

export function resolveDesktopIdentityLazySyncStatus(
  status: DesktopIdentityStatus,
  synchronized: boolean,
): DesktopIdentityStatus {
  // Lazy child fan-out is best-effort. It must not demote a verified
  // workspace session; the child app owns its fallback login surface.
  if (status === "signed-in") return "signed-in";
  return synchronized ? status : "failed";
}

export function shouldDeferDesktopAppWebviewLoad(input: {
  eligible: boolean;
  enabled: boolean | null;
  sessionReady: boolean;
  status: DesktopIdentityStatus | "checking";
}): boolean {
  return (
    input.eligible &&
    input.enabled !== false &&
    (!input.sessionReady || input.status !== "signed-in")
  );
}

/**
 * Whether reactivating a tab must hide its guest page behind the identity
 * loading gate again.
 *
 * Returning to an app used to re-gate unconditionally, so a page that was
 * already loaded and verified vanished behind "Loading …" on every switch —
 * the whole reason coming back to a tab read as a full reload. A page is only
 * re-gated when there is nothing usable on screen to preserve.
 */
export function shouldClearDesktopIdentitySessionOnActivation(input: {
  hasLoadedGuestPage: boolean;
  sessionReady: boolean;
  rememberedStatus?: DesktopIdentityStatus | null;
}): boolean {
  // A page loaded under a session the shell has since watched end is not
  // "usable to preserve": sign-out reloads every app webview including the
  // hidden ones, so preserving it reveals that app's own signed-out page with
  // no gate over it until the status round trip lands.
  if (isDesktopIdentitySignedOutStatus(input.rememberedStatus ?? null)) {
    return true;
  }
  return !(input.hasLoadedGuestPage && input.sessionReady);
}

/**
 * Whether a status the shell already observed means a loaded guest page can no
 * longer be treated as signed in. Sign-out publishes "sign-in-required", so
 * that and a hard "failed" are the only statuses that invalidate a loaded page.
 * "idle" is excluded deliberately — that is workspace SSO switched off, where
 * there is no session to gate and re-gating would stall every tab switch.
 */
export function isDesktopIdentitySignedOutStatus(
  status: DesktopIdentityStatus | null,
): boolean {
  return status === "sign-in-required" || status === "failed";
}

const DESKTOP_IDENTITY_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
const DESKTOP_IDENTITY_STATUS_POLL_INTERVAL_MS = 750;
const DESKTOP_IDENTITY_STATUS_POLL_ATTEMPTS = 40;
let rememberedDesktopIdentityStatus: DesktopIdentityStatus | null = null;
let rememberedDesktopIdentityStatusAt = 0;

export function rememberDesktopIdentityStatus(
  status: DesktopIdentityStatus,
  observedAt = Date.now(),
): void {
  rememberedDesktopIdentityStatus = status;
  rememberedDesktopIdentityStatusAt = observedAt;
}

export function invalidateRememberedDesktopIdentityStatus(): void {
  rememberedDesktopIdentityStatus = null;
  rememberedDesktopIdentityStatusAt = 0;
}

export function shouldReuseRememberedDesktopIdentitySession(
  status: DesktopIdentityStatus | null,
  nextStatus?: DesktopIdentityStatus,
  statusVerifiedAt = Date.now(),
  now = Date.now(),
): boolean {
  return (
    nextStatus === undefined &&
    status === "signed-in" &&
    now - statusVerifiedAt < DESKTOP_IDENTITY_STATUS_CACHE_TTL_MS
  );
}

interface AppWebviewProps {
  app: AppDefinition;
  /** Full app config with URL overrides (optional for backward compat) */
  appConfig?: AppConfig;
  isActive: boolean;
  /**
   * Set when the host hides this guest while it is still the active tab, e.g.
   * behind a full-surface overlay. An Electron guest never observes CSS
   * hiding, so the host has to say so or the page keeps polling underneath.
   */
  surfaceHidden?: boolean;
  /** Resolved shell theme to apply inside the guest document. */
  theme: RendererTheme;
  /** Only same-origin app surfaces should inherit the shell theme. */
  syncTheme?: boolean;
  /** Explicit browser target for the chat-first with-chrome surface. */
  sourceUrl?: string;
  /** Changes when the same URL should be opened again. */
  urlOpenNonce?: number;
  /** Safe app-relative path to load inside this app's origin. */
  urlPath?: string;
  /** When true, apply an explicit open request without resetting a live webview. */
  urlOpenSoft?: boolean;
  /** Query parameters to merge into the resolved app URL. */
  urlParams?: Record<string, string | null | undefined>;
  /** Optional explicit Electron partition for preview or other isolated flows. */
  partitionKey?: string;
  /** Increment to trigger a webview reload (Cmd+R) */
  refreshKey?: number;
  /** Emits the guest page's document title so the shell tab can stay current. */
  onTitleChange?: (title: string) => void;
  /** Emits the guest page's coarse session state for host-owned UI. */
  onAuthStateChange?: (state: AppWebviewAuthState) => void;
  /** Emits terminal main-frame failures so host-owned overlays can recover. */
  onMainFrameLoadFailure?: (details: {
    errorCode?: number;
    errorDescription: string;
  }) => void;
  /** Emits the native desktop identity state for sibling host surfaces. */
  onDesktopIdentityStatusChange?: (
    status: DesktopIdentityStatus | "checking",
  ) => void;
  /** Emits the guest webContents id for tab-scoped main-process actions. */
  onWebContentsIdChange?: (webContentsId: number | undefined) => void;
  onAppsChanged?: (apps: AppConfig[]) => void;
}

export interface AppWebviewHandle {
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): void;
  stopFindInPage(
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ): void;
  focus(): void;
  getUrl(): string | undefined;
  goBack(): void;
  goForward(): void;
  reload(): void;
  toggleAgentSidebar(): void;
}

/**
 * Determine the URL to load for this app.
 *
 * Production mode (default): load the production URL (e.g. https://mail.agent-native.com).
 * Dev mode: load the app's local dev URL directly. The Electron shell owns
 * chat now, so installed apps no longer need the local dev frame as a wrapper.
 */
let rememberedEnvironmentLane: DesktopEnvironmentLane = "production";

/**
 * Cache the resolved lane at module scope, the same way the identity status is
 * cached: `resolveAppWebviewUrl` is a pure helper called from several places
 * that have no access to component state.
 */
export function rememberDesktopEnvironmentLane(
  lane: DesktopEnvironmentLane,
): boolean {
  if (rememberedEnvironmentLane === lane) return false;
  rememberedEnvironmentLane = lane;
  return true;
}

export function resolveAppWebviewUrl(
  app: AppDefinition,
  appConfig?: AppConfig,
): string {
  if (appConfig?.mode === "dev") {
    if (appConfig.devUrl?.trim()) return appConfig.devUrl.trim();
    if (appConfig.devPort || app.devPort) {
      return `http://localhost:${appConfig.devPort || app.devPort}`;
    }
    if (appConfig.url) return appConfig.url;
    return "about:blank";
  }

  // Production mode (default): use the production URL, on the lane the shell
  // resolved. Loading the lane directly is what keeps the hosted page from
  // redirecting a Builder account to beta after its session resolves.
  if (appConfig?.url) {
    return withDesktopEnvironmentLane(appConfig.url, rememberedEnvironmentLane);
  }

  const template = getTemplate(app.id);
  if (template?.prodUrl) {
    return withDesktopEnvironmentLane(
      template.prodUrl,
      rememberedEnvironmentLane,
    );
  }

  // Keep incomplete custom entries on a stable blank document instead of
  // silently routing them through the retired local dev frame.
  return "about:blank";
}

function isFirstPartyProductionOrigin(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname.toLowerCase().startsWith("beta.")) return false;
    return DESKTOP_DEFAULT_APPS.some((candidate) => {
      try {
        // Normalize to production explicitly. `resolveAppWebviewUrl` follows
        // the active lane, so while the shell is on beta a real production
        // URL would match nothing here and silently lose its opt-out.
        return (
          new URL(
            withDesktopEnvironmentLane(
              resolveAppWebviewUrl(candidate),
              "production",
            ),
          ).origin === parsed.origin
        );
      } catch {
        // coercion-ok: an invalid configured app URL is not a trusted first-party origin.
        return false;
      }
    });
  } catch {
    // coercion-ok: an invalid requested URL cannot be a trusted first-party origin.
    return false;
  }
}

export function withDesktopEnvironmentOptOut(rawUrl: string): string {
  if (!isFirstPartyProductionOrigin(rawUrl)) return rawUrl;
  try {
    const target = new URL(rawUrl);
    target.searchParams.set(
      BETA_OPT_OUT_QUERY_PARAM,
      String(Date.now() + BETA_OPT_OUT_DURATION_MS),
    );
    return target.toString();
  } catch {
    return rawUrl;
  }
}

function useStableDesktopEnvironmentOptOut(rawUrl: string): string {
  const cachedUrlRef = useRef<{ rawUrl: string; resolvedUrl: string } | null>(
    null,
  );
  if (!cachedUrlRef.current || cachedUrlRef.current.rawUrl !== rawUrl) {
    cachedUrlRef.current = {
      rawUrl,
      resolvedUrl: withDesktopEnvironmentOptOut(rawUrl),
    };
  }
  return cachedUrlRef.current.resolvedUrl;
}

function withUrlParams(
  rawUrl: string,
  params?: Record<string, string | null | undefined>,
): string {
  if (!params) return rawUrl;
  try {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function withUrlPath(rawUrl: string, path?: string): string {
  if (!path) return rawUrl;
  try {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.startsWith("/\\")
    ) {
      return rawUrl;
    }
    if (/[\u0000-\u001f\u007f]/.test(path)) return rawUrl;
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return rawUrl;
    const base = new URL(rawUrl);
    const target = new URL(path, "http://agent-native.invalid");
    base.pathname = target.pathname;
    base.search = target.search;
    base.hash = target.hash;
    return base.toString();
  } catch {
    return rawUrl;
  }
}

function isAgentNativeOpenPath(path: string | undefined): path is string {
  if (!path) return false;
  try {
    const target = new URL(path, "http://agent-native.invalid");
    return target.pathname === "/_agent-native/open";
  } catch {
    return false;
  }
}

function canSoftOpenWebview(
  wv: ElectronWebviewElement,
  targetUrl: string,
): boolean {
  try {
    const currentUrl = wv.getURL();
    if (!currentUrl || currentUrl === "about:blank") return false;
    return new URL(currentUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

export function resolveAppWebviewPartition(input: {
  appId: string;
  sourceUrl?: string;
  partitionKey?: string;
}): string {
  const explicitPartition = input.partitionKey?.trim();
  if (explicitPartition) return explicitPartition;
  return input.sourceUrl?.trim()
    ? "persist:chat-first-browser"
    : `persist:app-${input.appId}`;
}

function buildSoftOpenScript(path: string): string {
  return `(() => fetch(${JSON.stringify(path)}, { credentials: "same-origin", redirect: "manual", cache: "no-store" }).then(() => true, () => false))()`;
}

function buildGuestLifecycleScript(
  eventName: "agent-native:app-background" | "agent-native:app-foreground",
): string {
  const encodedEventName = JSON.stringify(eventName);
  return `(() => {
    const eventName = ${encodedEventName};
    window.dispatchEvent(new Event(eventName));
    for (const iframe of document.querySelectorAll("iframe")) {
      iframe.contentWindow?.postMessage({ type: eventName }, "*");
    }
  })()`;
}

export function buildGuestAppChatSidebarStateScript(open: boolean): string {
  const encodedEventName = JSON.stringify(APP_CHAT_SIDEBAR_STATE_EVENT);
  const encodedMessage = JSON.stringify({
    type: APP_CHAT_SIDEBAR_STATE_MESSAGE,
    data: { open, hosted: true },
  });
  return `(() => {
    const message = ${encodedMessage};
    window.dispatchEvent(new CustomEvent(${encodedEventName}, { detail: message.data }));
    for (const iframe of document.querySelectorAll("iframe")) {
      iframe.contentWindow?.postMessage(message, "*");
    }
  })()`;
}

const AppWebview = forwardRef<AppWebviewHandle, AppWebviewProps>(
  (
    {
      app,
      appConfig,
      isActive,
      surfaceHidden = false,
      theme,
      syncTheme = true,
      sourceUrl,
      urlOpenNonce,
      urlPath,
      urlOpenSoft,
      urlParams,
      partitionKey,
      refreshKey = 0,
      onTitleChange,
      onAuthStateChange,
      onMainFrameLoadFailure,
      onDesktopIdentityStatusChange,
      onWebContentsIdChange,
      onAppsChanged,
    }: AppWebviewProps,
    ref,
  ) => {
    const webviewRef = useRef<ElectronWebviewElement>(null);
    const [error, setError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [slowLoad, setSlowLoad] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const hasLoadedGuestPageRef = useRef(false);
    const loadFailureRef = useRef(false);
    const rawUrl = sourceUrl?.trim()
      ? withUrlParams(sourceUrl.trim(), urlParams)
      : withUrlParams(
          withUrlPath(resolveAppWebviewUrl(app, appConfig), urlPath),
          {
            ...(appConfig?.mode === "dev" && appConfig.localPath
              ? { _agentNativeDesktopCode: "1" }
              : {}),
            ...urlParams,
          },
        );
    const url = useStableDesktopEnvironmentOptOut(rawUrl);
    const isDevMode = !sourceUrl && appConfig?.mode === "dev";
    const desktopIdentityGateEligible = isDesktopIdentityGateEligible(
      app,
      appConfig,
      sourceUrl,
    );
    const [desktopIdentityStatus, setDesktopIdentityStatus] = useState<
      DesktopIdentityStatus | "checking"
    >("idle");
    const [desktopIdentityEnabled, setDesktopIdentityEnabled] = useState<
      boolean | null
    >(() => (desktopIdentityGateEligible ? null : false));
    const [desktopIdentitySessionReady, setDesktopIdentitySessionReady] =
      useState(() => !desktopIdentityGateEligible);
    const desktopIdentitySessionReadyRef = useRef(!desktopIdentityGateEligible);
    const updateDesktopIdentitySessionReady = useCallback((ready: boolean) => {
      desktopIdentitySessionReadyRef.current = ready;
      setDesktopIdentitySessionReady(ready);
    }, []);
    const completeDesktopIdentitySignIn = useCallback(async () => {
      const identity = window.electronAPI?.identity;
      if (!identity) return false;
      try {
        if (!(await identity.signIn())) return false;
        if (!(await identity.ensureAppSession(app.id))) return false;
        rememberDesktopIdentityStatus("signed-in");
        setDesktopIdentityEnabled(true);
        updateDesktopIdentitySessionReady(true);
        setDesktopIdentityStatus("signed-in");
        return true;
      } catch (error) {
        console.warn("[desktop-identity] inline sign-in failed", {
          appId: app.id,
          reason: error instanceof Error ? error.message : "unknown error",
        });
        return false;
      }
    }, [app.id, updateDesktopIdentitySessionReady]);
    const desktopIdentityGateActive = shouldUseDesktopIdentityGate({
      eligible: desktopIdentityGateEligible,
      active: isActive,
      enabled: desktopIdentityEnabled,
    });
    const desktopIdentityRepairRef = useRef<Promise<boolean> | null>(null);
    const repairDesktopIdentitySession = useCallback(() => {
      if (
        !isActive ||
        !desktopIdentityGateEligible ||
        desktopIdentityEnabled !== true ||
        desktopIdentityStatus !== "signed-in"
      ) {
        return Promise.resolve(false);
      }
      const existingRepair = desktopIdentityRepairRef.current;
      if (existingRepair) return existingRepair;
      const identity = window.electronAPI?.identity;
      if (!identity) return Promise.resolve(false);
      const repair = identity
        .ensureAppSession(app.id)
        .catch((error) => {
          console.warn("[desktop-identity] app session repair failed", {
            appId: app.id,
            reason: error instanceof Error ? error.message : "unknown error",
          });
          return false;
        })
        .finally(() => {
          if (desktopIdentityRepairRef.current === repair) {
            desktopIdentityRepairRef.current = null;
          }
        });
      desktopIdentityRepairRef.current = repair;
      return repair;
    }, [
      app.id,
      desktopIdentityEnabled,
      desktopIdentityGateEligible,
      desktopIdentityStatus,
      isActive,
    ]);
    const deferDesktopWebviewLoad = shouldDeferDesktopAppWebviewLoad({
      eligible: desktopIdentityGateEligible,
      enabled: desktopIdentityEnabled,
      sessionReady: desktopIdentitySessionReady,
      status: desktopIdentityStatus,
    });
    const optimizeDepRecoveryRef = useRef(false);
    const prevUrlRef = useRef(url);
    const prevUrlOpenNonceRef = useRef(urlOpenNonce);
    const prevDesktopWebviewDeferredRef = useRef(deferDesktopWebviewLoad);
    const prevIsActiveRef = useRef(isActive);
    const onTitleChangeRef = useRef(onTitleChange);
    const onAuthStateChangeRef = useRef(onAuthStateChange);
    const onMainFrameLoadFailureRef = useRef(onMainFrameLoadFailure);
    const onDesktopIdentityStatusChangeRef = useRef(
      onDesktopIdentityStatusChange,
    );
    const onWebContentsIdChangeRef = useRef(onWebContentsIdChange);
    const perAppChatOpenRef = useRef(false);
    const authProbeSequenceRef = useRef(0);
    const lastGuestChatSidebarSyncRef = useRef<string | null>(null);
    const guestScriptInFlightRef = useRef(new Map<string, Promise<unknown>>());

    const executeGuestScript = useCallback(
      (key: string, script: string): Promise<unknown> => {
        const wv = webviewRef.current;
        if (!wv || app.placeholder) return Promise.resolve(undefined);

        const inFlight = guestScriptInFlightRef.current.get(key);
        if (inFlight) return inFlight;

        let request: Promise<unknown>;
        try {
          request = wv.executeJavaScript(script, false).catch((error) => {
            console.debug("[desktop-webview] guest script failed", {
              appId: app.id,
              key,
              reason: error instanceof Error ? error.message : error,
            });
            return undefined;
          });
        } catch (error) {
          console.debug("[desktop-webview] guest script failed", {
            appId: app.id,
            key,
            reason: error instanceof Error ? error.message : error,
          });
          return Promise.resolve(undefined);
        }
        guestScriptInFlightRef.current.set(key, request);
        void request.then(() => {
          if (guestScriptInFlightRef.current.get(key) === request) {
            guestScriptInFlightRef.current.delete(key);
          }
        });
        return request;
      },
      [app.id, app.placeholder],
    );

    const applyGuestTheme = useCallback(() => {
      const wv = webviewRef.current;
      if (!syncTheme || !wv || app.placeholder) return;
      void executeGuestScript(
        `guest-theme:${theme}`,
        buildGuestThemeScript(theme),
      );
    }, [app.placeholder, executeGuestScript, syncTheme, theme]);

    // A <webview> guest never sees its own element hidden: display:none on the
    // element or any ancestor leaves document.visibilityState "visible" and
    // fires no visibilitychange. Without this the framework's polling and event
    // stream keep running at foreground cadence in every backgrounded tab, and
    // preloaded tabs would each hold one open forever.
    const guestVisible = isActive && !surfaceHidden;
    const applyGuestSurfaceVisibility = useCallback(() => {
      const wv = webviewRef.current;
      if (!wv || app.placeholder) return;
      void executeGuestScript(
        `guest-surface-visibility:${guestVisible ? "visible" : "hidden"}`,
        buildSurfaceVisibilityScript(!guestVisible),
      );
    }, [app.placeholder, executeGuestScript, guestVisible]);

    const syncGuestAppChatSidebar = useCallback(
      (force = false) => {
        const wv = webviewRef.current;
        if (!wv || app.placeholder) return;
        let currentUrl = "";
        try {
          currentUrl = wv.getURL() || wv.src;
        } catch {
          currentUrl = wv.src;
        }
        const open = perAppChatOpenRef.current;
        const stateKey = `${currentUrl}:${open ? "open" : "closed"}`;
        if (!force && lastGuestChatSidebarSyncRef.current === stateKey) return;
        lastGuestChatSidebarSyncRef.current = stateKey;
        void executeGuestScript(
          `guest-chat-sidebar:${stateKey}`,
          buildGuestAppChatSidebarStateScript(open),
        );
      },
      [app.placeholder, executeGuestScript],
    );

    useEffect(() => {
      onTitleChangeRef.current = onTitleChange;
    }, [onTitleChange]);

    useEffect(() => {
      onAuthStateChangeRef.current = onAuthStateChange;
    }, [onAuthStateChange]);

    useEffect(() => {
      onMainFrameLoadFailureRef.current = onMainFrameLoadFailure;
    }, [onMainFrameLoadFailure]);

    useEffect(() => {
      onDesktopIdentityStatusChangeRef.current = onDesktopIdentityStatusChange;
    }, [onDesktopIdentityStatusChange]);

    useEffect(() => {
      onWebContentsIdChangeRef.current = onWebContentsIdChange;
    }, [onWebContentsIdChange]);

    useEffect(() => () => onWebContentsIdChangeRef.current?.(undefined), []);

    useEffect(() => {
      onDesktopIdentityStatusChangeRef.current?.(
        resolveDesktopIdentityStatusForChat(
          desktopIdentityStatus,
          desktopIdentitySessionReady,
        ),
      );
    }, [desktopIdentitySessionReady, desktopIdentityStatus]);

    useEffect(() => {
      const identity = window.electronAPI?.identity;
      if (!identity || !desktopIdentityGateEligible) {
        setDesktopIdentityEnabled(false);
        setDesktopIdentityStatus("idle");
        updateDesktopIdentitySessionReady(true);
        return;
      }
      if (!isActive) {
        if (hasLoadedGuestPageRef.current) return;
        const rememberedSignedIn = shouldReuseRememberedDesktopIdentitySession(
          rememberedDesktopIdentityStatus,
          undefined,
          rememberedDesktopIdentityStatusAt,
        );
        setDesktopIdentityEnabled(null);
        setDesktopIdentityStatus(rememberedSignedIn ? "signed-in" : "idle");
        updateDesktopIdentitySessionReady(false);
        return;
      }
      let active = true;
      let statusRequest = 0;
      const rememberedSignedIn = shouldReuseRememberedDesktopIdentitySession(
        rememberedDesktopIdentityStatus,
        undefined,
        rememberedDesktopIdentityStatusAt,
      );
      const preserveLoadedSession =
        hasLoadedGuestPageRef.current &&
        desktopIdentitySessionReadyRef.current &&
        !isDesktopIdentitySignedOutStatus(rememberedDesktopIdentityStatus);
      setDesktopIdentityEnabled(rememberedSignedIn ? true : null);
      setDesktopIdentityStatus(
        rememberedSignedIn || preserveLoadedSession ? "signed-in" : "idle",
      );
      // Reactivating a tab whose guest page is already loaded and verified must
      // not hide it behind the loading gate again — the recheck below is cheap
      // and runs fine underneath a usable page. Clearing this on every
      // activation is what made returning to a tab look like a full reload.
      // Same rule applyStatus already uses when a child-session event repeats.
      if (
        shouldClearDesktopIdentitySessionOnActivation({
          hasLoadedGuestPage: hasLoadedGuestPageRef.current,
          sessionReady: desktopIdentitySessionReadyRef.current,
          rememberedStatus: rememberedDesktopIdentityStatus,
        })
      ) {
        updateDesktopIdentitySessionReady(false);
      }

      const applyStatus = async (
        status: DesktopIdentityStatus,
        request: number,
        fromRememberedSession = false,
      ) => {
        if (!active || request !== statusRequest) return;
        if (!fromRememberedSession) rememberDesktopIdentityStatus(status);
        setDesktopIdentityStatus(status);
        if (status === "signed-in") {
          // A child-session event can repeat this check after the guest has
          // loaded. Keep the verified page usable while the broker confirms
          // the same session; only gate the initial load or a real transition.
          const preserveLoadedSession =
            hasLoadedGuestPageRef.current &&
            desktopIdentitySessionReadyRef.current;
          if (!preserveLoadedSession) {
            updateDesktopIdentitySessionReady(false);
          }
          let synchronized: boolean | null;
          try {
            synchronized = await identity.ensureAppSession(app.id);
          } catch (error) {
            console.warn("[desktop-identity] lazy app synchronization failed", {
              appId: app.id,
              reason: error instanceof Error ? error.message : "unknown error",
            });
            synchronized = null;
          }
          if (!active || request !== statusRequest) return;
          if (
            (preserveLoadedSession || fromRememberedSession) &&
            synchronized !== true
          ) {
            // A failed lazy sync can mean the broker is in the middle of
            // sign-out while its public status is still signed-in. Do not
            // keep reusing this renderer cache during that ceremony. Keep the
            // current verified tab usable until the broker publishes its
            // authoritative sign-out status or the next activation rechecks.
            invalidateRememberedDesktopIdentityStatus();
          }
          updateDesktopIdentitySessionReady(true);
          setDesktopIdentityStatus(
            resolveDesktopIdentityLazySyncStatus(status, synchronized === true),
          );
          return;
        }
        updateDesktopIdentitySessionReady(status !== "signing-in");
      };

      const applySettingAndStatus = async (
        nextStatus?: DesktopIdentityStatus,
      ) => {
        const request = ++statusRequest;
        const reuseRememberedSession =
          shouldReuseRememberedDesktopIdentitySession(
            rememberedDesktopIdentityStatus,
            nextStatus,
            rememberedDesktopIdentityStatusAt,
          );
        try {
          const settings = await identity.getSettings();
          if (!active || request !== statusRequest) return;
          if (!settings.ssoEnabled) {
            rememberDesktopIdentityStatus("idle");
            setDesktopIdentityEnabled(false);
            setDesktopIdentityStatus("idle");
            updateDesktopIdentitySessionReady(true);
            return;
          }
          setDesktopIdentityEnabled(true);
          const needsRemoteStatus =
            nextStatus === undefined &&
            !reuseRememberedSession &&
            !preserveLoadedSession;
          if (needsRemoteStatus) {
            setDesktopIdentityStatus("checking");
            updateDesktopIdentitySessionReady(false);
          }
          const status =
            nextStatus ??
            (reuseRememberedSession ? "signed-in" : await identity.getStatus());
          await applyStatus(status, request, reuseRememberedSession);
        } catch {
          // An older or unavailable preload must fail closed to the legacy
          // app-owned login surface rather than strand the WebView behind SSO.
          if (active && request === statusRequest) {
            if (preserveLoadedSession) {
              setDesktopIdentityEnabled(true);
              setDesktopIdentityStatus("signed-in");
              updateDesktopIdentitySessionReady(true);
              return;
            }
            if (
              shouldReuseRememberedDesktopIdentitySession(
                rememberedDesktopIdentityStatus,
                undefined,
                rememberedDesktopIdentityStatusAt,
              )
            ) {
              setDesktopIdentityEnabled(true);
              await applyStatus("signed-in", request, true);
              return;
            }
            setDesktopIdentityEnabled(false);
            setDesktopIdentityStatus("idle");
            updateDesktopIdentitySessionReady(true);
          }
        }
      };

      void Promise.resolve().then(() => applySettingAndStatus());
      const unsubscribe = identity.onStatusChange((status) => {
        void applySettingAndStatus(status);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    }, [
      app.id,
      desktopIdentityGateEligible,
      isActive,
      updateDesktopIdentitySessionReady,
    ]);

    useEffect(() => {
      const identity = window.electronAPI?.identity;
      if (
        !identity ||
        !desktopIdentityGateEligible ||
        !isActive ||
        desktopIdentityStatus !== "signing-in"
      ) {
        return;
      }

      let active = true;
      let attempts = 0;
      let pending = false;
      const reconcile = async () => {
        if (!active || pending) return;
        pending = true;
        attempts += 1;
        try {
          const status = await identity.getStatus();
          if (!active) return;
          if (status === "signed-in") {
            const synchronized = await identity.ensureAppSession(app.id);
            if (active && synchronized) {
              rememberDesktopIdentityStatus("signed-in");
              setDesktopIdentityEnabled(true);
              updateDesktopIdentitySessionReady(true);
              setDesktopIdentityStatus("signed-in");
              return;
            }
          } else {
            updateDesktopIdentitySessionReady(true);
            setDesktopIdentityStatus(status);
            return;
          }

          if (attempts >= DESKTOP_IDENTITY_STATUS_POLL_ATTEMPTS) {
            setDesktopIdentityStatus("failed");
          }
        } catch {
          if (attempts >= DESKTOP_IDENTITY_STATUS_POLL_ATTEMPTS) {
            setDesktopIdentityStatus("failed");
          }
        } finally {
          pending = false;
        }
      };

      void reconcile();
      const timer = window.setInterval(
        () => void reconcile(),
        DESKTOP_IDENTITY_STATUS_POLL_INTERVAL_MS,
      );
      return () => {
        active = false;
        window.clearInterval(timer);
      };
    }, [
      app.id,
      desktopIdentityGateEligible,
      desktopIdentityStatus,
      isActive,
      updateDesktopIdentitySessionReady,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        findInPage(text, options) {
          const wv = webviewRef.current;
          if (!wv || !text.trim()) return;
          wv.findInPage(text, options);
        },
        stopFindInPage(action = "clearSelection") {
          webviewRef.current?.stopFindInPage(action);
        },
        focus() {
          webviewRef.current?.focus();
        },
        getUrl() {
          const wv = webviewRef.current;
          if (!wv || app.placeholder) return undefined;
          const currentUrl = wv.getURL();
          if (currentUrl && currentUrl !== "about:blank") return currentUrl;
          return wv.src || url;
        },
        goBack() {
          const wv = webviewRef.current;
          if (wv?.canGoBack()) wv.goBack();
        },
        goForward() {
          const wv = webviewRef.current;
          if (wv?.canGoForward()) wv.goForward();
        },
        reload() {
          const wv = webviewRef.current;
          if (!wv || app.placeholder) return;
          try {
            wv.reloadIgnoringCache();
          } catch {
            wv.reload();
          }
        },
        toggleAgentSidebar() {
          const wv = webviewRef.current;
          if (!wv || app.placeholder) return;
          void executeGuestScript(
            "toggle-agent-sidebar",
            `window.dispatchEvent(new Event("agent-panel:toggle"));`,
          );
        },
      }),
      [app.placeholder, executeGuestScript, url],
    );

    useEffect(() => {
      const wasActive = prevIsActiveRef.current;
      prevIsActiveRef.current = isActive;
      if (wasActive === isActive || app.placeholder) return;
      const wv = webviewRef.current;
      if (!wv) return;
      const eventName = isActive
        ? "agent-native:app-foreground"
        : "agent-native:app-background";
      void executeGuestScript(
        `guest-lifecycle:${eventName}`,
        buildGuestLifecycleScript(eventName),
      );
    }, [app.placeholder, executeGuestScript, isActive]);

    function reportActiveWebview() {
      const wv = webviewRef.current;
      if (!wv) return;

      let webContentsId: number | undefined;
      try {
        webContentsId = wv.getWebContentsId();
      } catch {
        webContentsId = undefined;
      }
      onWebContentsIdChangeRef.current?.(webContentsId);
      if (!isActive || !window.electronAPI?.setActiveWebview) return;

      window.electronAPI.setActiveWebview({
        appId: app.id,
        webContentsId,
        hostBounds: (() => {
          const rect = wv.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return undefined;
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        })(),
      });
    }

    useEffect(() => {
      if (app.placeholder) return;

      const wv = webviewRef.current;
      if (!wv) return;

      const recoverOutdatedOptimizeDep = () => {
        if (!IS_DEV || optimizeDepRecoveryRef.current) return;
        optimizeDepRecoveryRef.current = true;
        loadFailureRef.current = false;
        setError(false);
        setTimeout(() => {
          try {
            wv.reloadIgnoringCache();
          } catch {
            wv.reload();
          }
        }, 120);
      };
      const titleTimers = new Set<ReturnType<typeof setTimeout>>();
      let disposed = false;
      const emitTitle = (candidate?: unknown) => {
        const title = typeof candidate === "string" ? candidate.trim() : "";
        if (title) onTitleChangeRef.current?.(title);
      };
      const emitCurrentTitle = (candidate?: string) => {
        if (disposed) return;
        emitTitle(candidate);
        emitTitle(wv.getTitle());
        void executeGuestScript(
          `document-title:${wv.getURL() || wv.src}`,
          "document.title",
        ).then((title) => {
          if (!disposed) emitTitle(title);
        });
      };
      const emitCurrentTitleSoon = (candidate?: string) => {
        emitCurrentTitle(candidate);
        const timer = setTimeout(() => {
          titleTimers.delete(timer);
          emitCurrentTitle();
        }, 200);
        titleTimers.add(timer);
      };
      const emitAuthState = () => {
        if (disposed) return;
        const sequence = ++authProbeSequenceRef.current;
        onAuthStateChangeRef.current?.("unknown");
        void readAppWebviewAuthState(wv).then((state) => {
          if (disposed || sequence !== authProbeSequenceRef.current) return;
          const repair =
            state === "unauthenticated"
              ? repairDesktopIdentitySession()
              : Promise.resolve(false);
          void repair.then((repaired) => {
            if (disposed || sequence !== authProbeSequenceRef.current) return;
            onAuthStateChangeRef.current?.(repaired ? "authenticated" : state);
          });
        });
      };

      onAuthStateChangeRef.current?.("unknown");

      const onReady = () => {
        // Chromium can emit dom-ready for its internal error document after
        // did-fail-load. That event is not a successful app load.
        if (loadFailureRef.current) return;
        if (deferDesktopWebviewLoad) {
          let currentUrl = "";
          try {
            currentUrl = wv.getURL() || wv.src;
          } catch {
            // coercion-ok: Electron can expose the element src before Chromium attaches the contents.
            currentUrl = wv.src;
          }
          if (!currentUrl || currentUrl === "about:blank") return;
        }
        applyGuestTheme();
        applyGuestSurfaceVisibility();
        syncGuestAppChatSidebar(true);
        if (app.id === "content") {
          void executeGuestScript(
            "content-directory-picker-bridge",
            buildContentDirectoryPickerBridgeScript(),
          );
        }
        setError(false);
        setIsLoading(false);
        setSlowLoad(false);
        hasLoadedGuestPageRef.current = true;
        optimizeDepRecoveryRef.current = false;
        reportActiveWebview();
        emitCurrentTitleSoon();
        emitAuthState();
      };
      const onTitleUpdated = (e: Event) => {
        const title = String(
          (e as WebviewTitleUpdatedEvent).title ?? "",
        ).trim();
        emitCurrentTitle(title);
      };
      const onNavigation = () => {
        applyGuestTheme();
        applyGuestSurfaceVisibility();
        syncGuestAppChatSidebar(true);
        emitCurrentTitleSoon();
        emitAuthState();
      };
      const onFailed = (e: Event) => {
        const details = e as WebviewLoadFailedEvent;
        const errorCode = details.errorCode;
        const description = String(details.errorDescription || "");
        if (errorCode === -3) return;
        // Sub-resource failures (favicon, HMR websocket, etc.) should not
        // trigger the error overlay — only main-frame load failures matter.
        if (details.isMainFrame === false) return;
        if (
          IS_DEV &&
          (errorCode === 504 || description.includes("Outdated Optimize Dep"))
        ) {
          recoverOutdatedOptimizeDep();
          return;
        }
        loadFailureRef.current = true;
        authProbeSequenceRef.current += 1;
        setError(true);
        setIsLoading(false);
        onMainFrameLoadFailureRef.current?.({
          errorCode,
          errorDescription: description,
        });
      };
      const onConsoleMessage = (e: Event) => {
        const message = String((e as WebviewConsoleMessageEvent).message || "");
        if (message.includes("Outdated Optimize Dep")) {
          recoverOutdatedOptimizeDep();
        }
      };
      const onIpcMessage = (event: Event) => {
        const details = event as WebviewIpcMessageEvent;
        if (details.channel !== "agent-native:chat-command") return;
        const eventName = resolveGuestChatCommand(details.args?.[0]);
        if (eventName) window.dispatchEvent(new Event(eventName));
      };

      const onEnterFullscreen = () => setIsFullscreen(true);
      const onLeaveFullscreen = () => setIsFullscreen(false);

      wv.addEventListener("dom-ready", onReady);
      wv.addEventListener("page-title-updated", onTitleUpdated);
      wv.addEventListener("did-navigate", onNavigation);
      wv.addEventListener("did-navigate-in-page", onNavigation);
      wv.addEventListener("did-fail-load", onFailed);
      wv.addEventListener("console-message", onConsoleMessage);
      wv.addEventListener("ipc-message", onIpcMessage);
      wv.addEventListener("enter-html-full-screen", onEnterFullscreen);
      wv.addEventListener("leave-html-full-screen", onLeaveFullscreen);

      return () => {
        disposed = true;
        for (const timer of titleTimers) clearTimeout(timer);
        wv.removeEventListener("dom-ready", onReady);
        wv.removeEventListener("page-title-updated", onTitleUpdated);
        wv.removeEventListener("did-navigate", onNavigation);
        wv.removeEventListener("did-navigate-in-page", onNavigation);
        wv.removeEventListener("did-fail-load", onFailed);
        wv.removeEventListener("console-message", onConsoleMessage);
        wv.removeEventListener("ipc-message", onIpcMessage);
        wv.removeEventListener("enter-html-full-screen", onEnterFullscreen);
        wv.removeEventListener("leave-html-full-screen", onLeaveFullscreen);
      };
    }, [
      app.id,
      app.placeholder,
      isActive,
      applyGuestTheme,
      applyGuestSurfaceVisibility,
      executeGuestScript,
      repairDesktopIdentitySession,
      syncGuestAppChatSidebar,
      deferDesktopWebviewLoad,
    ]);

    useEffect(() => {
      applyGuestTheme();
    }, [applyGuestTheme]);

    useEffect(() => {
      applyGuestSurfaceVisibility();
    }, [applyGuestSurfaceVisibility]);

    useEffect(() => {
      const handleChatState = (event: Event) => {
        const open = (event as CustomEvent<{ open?: unknown }>).detail?.open;
        if (typeof open !== "boolean") return;
        perAppChatOpenRef.current = open;
        syncGuestAppChatSidebar(true);
      };

      window.addEventListener(APP_CHAT_SIDEBAR_STATE_EVENT, handleChatState);
      perAppChatOpenRef.current =
        document.querySelector(
          '[data-agent-sidebar-per-app-chat="true"][data-agent-sidebar-state="open"]',
        ) !== null;
      syncGuestAppChatSidebar();

      return () =>
        window.removeEventListener(
          APP_CHAT_SIDEBAR_STATE_EVENT,
          handleChatState,
        );
    }, [syncGuestAppChatSidebar]);

    useEffect(() => {
      syncGuestAppChatSidebar();
    }, [isActive, syncGuestAppChatSidebar, url]);

    useEffect(() => {
      if (!isActive || app.placeholder) return;
      const wv = webviewRef.current;
      if (!wv) return;
      let currentUrl = "";
      try {
        currentUrl = wv.getURL() || "";
      } catch {
        currentUrl = "";
      }
      onAuthStateChangeRef.current?.("unknown");
      const sequence = ++authProbeSequenceRef.current;
      let active = true;
      if (!currentUrl) {
        return () => {
          active = false;
        };
      }
      void readAppWebviewAuthState(wv).then((state) => {
        if (!active || sequence !== authProbeSequenceRef.current) return;
        const repair =
          state === "unauthenticated"
            ? repairDesktopIdentitySession()
            : Promise.resolve(false);
        void repair.then((repaired) => {
          if (!active || sequence !== authProbeSequenceRef.current) return;
          onAuthStateChangeRef.current?.(repaired ? "authenticated" : state);
        });
      });
      return () => {
        active = false;
      };
    }, [
      app.placeholder,
      desktopIdentitySessionReady,
      desktopIdentityStatus,
      isActive,
      repairDesktopIdentitySession,
      url,
    ]);

    // Cmd+R — reload the active webview when refreshKey increments
    const prevRefreshKey = useRef(refreshKey);
    useEffect(() => {
      const previousRefreshKey = prevRefreshKey.current;
      if (
        !shouldReloadActiveWebview({
          previousRefreshKey,
          refreshKey,
          isActive,
          isPlaceholder: app.placeholder ?? false,
        })
      ) {
        return;
      }

      // Keep a refresh pending while this webview is hidden. The shell sends
      // one shared key to all mounted apps, so an inactive app must consume it
      // only when it can actually apply the reload.
      prevRefreshKey.current = refreshKey;

      const wv = webviewRef.current;
      if (wv) {
        try {
          wv.reloadIgnoringCache();
        } catch {
          wv.reload();
        }
      }
    }, [refreshKey, isActive, app.placeholder]);

    // React does not update an imperatively-created <webview>'s src for us.
    // Keep mode toggles, edited prod URLs, and custom dev URLs in sync.
    useEffect(() => {
      const wv = webviewRef.current;
      if (!wv || app.placeholder) {
        return;
      }
      const wasDeferred = prevDesktopWebviewDeferredRef.current;
      prevDesktopWebviewDeferredRef.current = deferDesktopWebviewLoad;
      if (deferDesktopWebviewLoad) return;
      const urlChanged = prevUrlRef.current !== url;
      const openNonceChanged = prevUrlOpenNonceRef.current !== urlOpenNonce;
      if (
        wasDeferred &&
        hasLoadedGuestPageRef.current &&
        !urlChanged &&
        !openNonceChanged
      ) {
        return;
      }
      if (!wasDeferred && !urlChanged && !openNonceChanged) return;

      prevUrlRef.current = url;
      prevUrlOpenNonceRef.current = urlOpenNonce;
      optimizeDepRecoveryRef.current = false;
      loadFailureRef.current = false;
      setError(false);

      if (
        urlOpenSoft &&
        openNonceChanged &&
        isAgentNativeOpenPath(urlPath) &&
        canSoftOpenWebview(wv, url)
      ) {
        void executeGuestScript(
          `soft-open:${urlPath}`,
          buildSoftOpenScript(urlPath),
        )
          .then((ok) => {
            if (ok !== false) return;
            setIsLoading(true);
            setSlowLoad(false);
            wv.setAttribute("src", url);
          })
          .catch(() => {
            setIsLoading(true);
            setSlowLoad(false);
            wv.setAttribute("src", url);
          });
        return;
      }

      setIsLoading(true);
      setSlowLoad(false);
      wv.setAttribute("src", url);
    }, [
      url,
      urlOpenNonce,
      urlOpenSoft,
      urlPath,
      app.placeholder,
      deferDesktopWebviewLoad,
      executeGuestScript,
    ]);

    // If the webview hasn't fired dom-ready within a few seconds, surface
    // a "still loading" hint. If it's still not ready after a bit longer,
    // assume the dev server isn't running and show the error screen.
    useEffect(() => {
      if (app.placeholder || error || !isLoading || deferDesktopWebviewLoad) {
        return;
      }
      const slowT = setTimeout(() => setSlowLoad(true), 2500);
      const failT = setTimeout(
        () => {
          if (isLoading) {
            // Deliberately not `loadFailureRef`: Chromium never reported a
            // failure here, we only stopped waiting. The navigation is still in
            // flight, so a later dom-ready is the real app arriving rather than
            // the error document that flag exists to suppress — latching it
            // would strand the user on this screen with the app loaded and
            // hidden behind it.
            authProbeSequenceRef.current += 1;
            setError(true);
            setIsLoading(false);
            onMainFrameLoadFailureRef.current?.({
              errorDescription: "Timed out while loading the app.",
            });
          }
        },
        isDevMode ? DEV_APP_LOAD_TIMEOUT_MS : APP_LOAD_TIMEOUT_MS,
      );
      return () => {
        clearTimeout(slowT);
        clearTimeout(failT);
      };
    }, [
      app.placeholder,
      deferDesktopWebviewLoad,
      error,
      isDevMode,
      isLoading,
      url,
    ]);

    // Auto-focus the webview when it becomes active so keyboard events
    // (e.g. Tab to cycle mail filters) go to the app, not the shell.
    useEffect(() => {
      if (isActive && !app.placeholder && !error) {
        const wv = webviewRef.current;
        if (wv) {
          // Focus once after the slot becomes visible. Repeated focus calls
          // trigger focus-aware data refreshes in embedded apps.
          const frame = requestAnimationFrame(() => {
            if (document.activeElement !== wv) wv.focus();
          });
          return () => cancelAnimationFrame(frame);
        }
      }
    }, [isActive, app.placeholder, error]);

    useEffect(() => {
      reportActiveWebview();
    }, [isActive, url]);

    useEffect(() => {
      if (!isActive || app.placeholder) return;
      const wv = webviewRef.current;
      if (!wv) return;
      let frame = 0;
      const reportOnFrame = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(reportActiveWebview);
      };
      const observer = new ResizeObserver(reportOnFrame);
      observer.observe(wv);
      window.addEventListener("resize", reportOnFrame);
      window.visualViewport?.addEventListener("resize", reportOnFrame);
      window.visualViewport?.addEventListener("scroll", reportOnFrame);
      reportOnFrame();
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", reportOnFrame);
        window.visualViewport?.removeEventListener("resize", reportOnFrame);
        window.visualViewport?.removeEventListener("scroll", reportOnFrame);
        let webContentsId: number | undefined;
        try {
          webContentsId = wv.getWebContentsId();
        } catch {
          webContentsId = undefined;
        }
        window.electronAPI?.setActiveWebview?.({
          appId: app.id,
          webContentsId,
          active: false,
        });
      };
    }, [app.id, app.placeholder, isActive, url]);

    function handleRetry() {
      loadFailureRef.current = false;
      setError(false);
      setIsLoading(true);
      setSlowLoad(false);
      const wv = webviewRef.current;
      if (wv) {
        try {
          wv.reloadIgnoringCache();
        } catch {
          wv.src = url;
        }
      }
    }

    async function handleSwitchToProd() {
      if (!appConfig?.id) return;
      try {
        const updated = await window.electronAPI?.appConfig?.update(
          appConfig.id,
          {
            mode: "prod",
          },
        );
        if (updated) onAppsChanged?.(updated);
      } catch {
        /* ignore */
      }
    }

    return (
      <div
        className={`webview-slot${isActive ? " webview-slot--active" : " webview-slot--hidden"}${isFullscreen ? " webview-slot--fullscreen" : ""}`}
      >
        {app.placeholder && <PlaceholderScreen app={app} />}

        {!app.placeholder && !error && isLoading && (
          <LoadingScreen app={app} slow={slowLoad} isDev={isDevMode} />
        )}

        {!app.placeholder && error && (
          <ErrorScreen
            app={app}
            appConfig={appConfig}
            url={url}
            isDev={isDevMode}
            onRetry={handleRetry}
            onSwitchToProd={
              appConfig?.url && isDevMode ? handleSwitchToProd : undefined
            }
          />
        )}

        {!app.placeholder && (
          <div
            ref={(container) => {
              if (!container) return;
              if (container.querySelector("webview")) return;
              const wv = document.createElement(
                "webview",
              ) as ElectronWebviewElement;
              wv.className = "app-webview";
              wv.setAttribute("allowpopups", "");
              const preloadPath =
                app.id === "plan" || app.id === "content" || app.id === "design"
                  ? window.electronAPI?.webviewPreloadPath ||
                    window.electronAPI?.webviewChatPreloadPath
                  : window.electronAPI?.webviewChatPreloadPath;
              if (preloadPath) {
                wv.setAttribute("preload", preloadPath);
              }
              wv.setAttribute("webpreferences", APP_WEBVIEW_PREFERENCES);
              wv.setAttribute(
                "partition",
                resolveAppWebviewPartition({
                  appId: app.id,
                  sourceUrl,
                  partitionKey,
                }),
              );
              wv.setAttribute(
                "src",
                deferDesktopWebviewLoad ? "about:blank" : url,
              );
              container.appendChild(wv);
              webviewRef.current = wv;
            }}
            style={{
              flex: "1 1 auto",
              display:
                error ||
                (desktopIdentityGateActive && !desktopIdentitySessionReady)
                  ? "none"
                  : "flex",
              flexDirection: "column",
            }}
          />
        )}

        {isActive &&
          desktopIdentityGateActive &&
          !desktopIdentitySessionReady &&
          (desktopIdentityStatus === "idle" ||
            desktopIdentityStatus === "signed-in") && (
            <LoadingScreen app={app} slow={false} isDev={isDevMode} />
          )}

        {desktopIdentityGateActive && (
          <DesktopIdentityGate
            appName={app.name}
            status={desktopIdentityStatus}
            onSignIn={completeDesktopIdentitySignIn}
            onAuthenticate={(request) =>
              window.electronAPI?.identity?.authenticate(request) ??
              Promise.resolve({
                ok: false,
                error: "The desktop identity surface is unavailable.",
              })
            }
            onMagicLink={(request) =>
              window.electronAPI?.identity?.requestMagicLink(request) ??
              Promise.resolve({
                ok: false,
                error: "The desktop identity surface is unavailable.",
              })
            }
          />
        )}
      </div>
    );
  },
);

export default AppWebview;

function LoadingScreen({
  app,
  slow,
  isDev,
}: {
  app: AppDefinition;
  slow: boolean;
  isDev: boolean;
}) {
  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <p className="loading-title">Loading {app.name}…</p>
      {slow && (
        <p className="loading-hint">
          {isDev ? "Still connecting to the dev server…" : "Still loading…"}
        </p>
      )}
    </div>
  );
}

type PortStatus = "checking" | "up" | "down";

function useUrlCheck(url: string | undefined, enabled: boolean): PortStatus {
  const [status, setStatus] = useState<PortStatus>("checking");

  useEffect(() => {
    if (!enabled || !url) {
      setStatus("checking");
      return;
    }
    const targetUrl = url;
    let cancelled = false;
    async function check() {
      try {
        await fetch(targetUrl, {
          mode: "no-cors",
          signal: AbortSignal.timeout(2000),
        });
        if (!cancelled) setStatus("up");
      } catch {
        if (!cancelled) setStatus("down");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  return status;
}

function StatusIcon({ status }: { status: PortStatus }) {
  if (status === "checking") {
    return (
      <IconLoader2
        size={14}
        className="error-status-icon error-status-icon--checking"
      />
    );
  }
  if (status === "up") {
    return (
      <IconCircleCheck
        size={14}
        className="error-status-icon error-status-icon--up"
      />
    );
  }
  return (
    <IconCircleX
      size={14}
      className="error-status-icon error-status-icon--down"
    />
  );
}

function ErrorScreen({
  app,
  appConfig,
  url,
  isDev,
  onRetry,
  onSwitchToProd,
}: {
  app: AppDefinition;
  appConfig?: AppConfig;
  url: string;
  isDev: boolean;
  onRetry: () => void;
  onSwitchToProd?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const devCommand = appConfig?.devCommand?.trim();
  const devPort = appConfig?.devPort ?? app.devPort;
  const devServerStatus = useUrlCheck(isDev ? url : undefined, isDev);

  async function copyCommand(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="error-overlay">
      <IconPlugOff size={36} className="error-icon" />
      <p className="error-title">
        {isDev ? `Can't connect to ${app.name}` : `${app.name} isn't loading`}
      </p>
      <p className="error-hint">
        {isDev ? (
          <>
            Tried loading from <span className="error-url">{url}</span>
          </>
        ) : (
          <>
            Couldn't reach <span className="error-url">{url}</span>
          </>
        )}
      </p>

      {isDev && (
        <div className="error-commands">
          <p className="error-checklist-title">To fix this, make sure:</p>
          <ul className="error-checklist">
            <li className={`error-checklist-item--${devServerStatus}`}>
              <StatusIcon status={devServerStatus} />
              {`${app.name} dev server${devPort ? ` (port ${devPort})` : ""}`}
            </li>
          </ul>
          {devCommand && (
            <CommandRow
              label={`Start ${app.name}`}
              command={devCommand}
              copied={copied}
              onCopy={() => copyCommand(devCommand)}
            />
          )}
        </div>
      )}

      <div className="error-actions">
        <button className="retry-button" onClick={onRetry}>
          <IconRefresh size={12} style={{ marginRight: 5 }} />
          Retry
        </button>
        {onSwitchToProd && (
          <button
            className="retry-button retry-button--prod"
            onClick={onSwitchToProd}
          >
            <IconWorld size={12} style={{ marginRight: 5 }} />
            Switch to Production
          </button>
        )}
      </div>
    </div>
  );
}

function CommandRow({
  label,
  command,
  copied,
  onCopy,
}: {
  label: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="command-row">
      <div className="command-row__label">
        <IconTerminal2 size={12} style={{ marginRight: 6, opacity: 0.6 }} />
        {label}
      </div>
      <div className="command-row__code">
        <code>{command}</code>
        <button
          className="command-copy"
          onClick={onCopy}
          title="Copy command"
          aria-label="Copy command"
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
      </div>
    </div>
  );
}

function PlaceholderScreen({ app }: { app: AppDefinition }) {
  return (
    <div className="placeholder-overlay">
      <div className="placeholder-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 21V9" />
        </svg>
      </div>
      <p className="placeholder-title">{app.name}</p>
      <p className="placeholder-subtitle">{app.description} — coming soon</p>
    </div>
  );
}
