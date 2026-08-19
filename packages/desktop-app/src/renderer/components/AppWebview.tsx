import {
  APP_CHAT_SIDEBAR_STATE_EVENT,
  APP_CHAT_SIDEBAR_STATE_MESSAGE,
} from "@agent-native/core/client/hooks";
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

import { buildContentDirectoryPickerBridgeScript } from "../lib/content-directory-picker-bridge.js";
import { buildGuestThemeScript, type RendererTheme } from "../lib/theme.js";
import DesktopIdentityGate from "./DesktopIdentityGate.js";
import { shouldReloadActiveWebview } from "./webview-refresh.js";

const IS_DEV = window.location.protocol !== "file:";
export const APP_WEBVIEW_PREFERENCES =
  "contextIsolation=true,nodeIntegration=false,sandbox=true,backgroundThrottling=true";

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

export function resolveDesktopIdentityLazySyncStatus(
  status: DesktopIdentityStatus,
  synchronized: boolean,
): DesktopIdentityStatus {
  // Lazy child fan-out is best-effort. It must not demote a verified
  // workspace session; the child app owns its fallback login surface.
  if (status === "signed-in") return "signed-in";
  return synchronized ? status : "failed";
}

const DESKTOP_IDENTITY_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
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
  /** Emits the native desktop identity state for sibling host surfaces. */
  onDesktopIdentityStatusChange?: (
    status: DesktopIdentityStatus | "checking",
  ) => void;
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

  // Production mode (default): use the production URL
  if (appConfig?.url) {
    return appConfig.url;
  }

  const template = getTemplate(app.id);
  if (template?.prodUrl) {
    return template.prodUrl;
  }

  // Keep incomplete custom entries on a stable blank document instead of
  // silently routing them through the retired local dev frame.
  return "about:blank";
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
      onDesktopIdentityStatusChange,
      onAppsChanged,
    }: AppWebviewProps,
    ref,
  ) => {
    const webviewRef = useRef<ElectronWebviewElement>(null);
    const [error, setError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [slowLoad, setSlowLoad] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const loadFailureRef = useRef(false);
    const url = sourceUrl?.trim()
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
    >(() => (desktopIdentityGateEligible && isActive ? null : false));
    const [desktopIdentitySessionReady, setDesktopIdentitySessionReady] =
      useState(() => !desktopIdentityGateEligible || !isActive);
    const desktopIdentityGateActive =
      desktopIdentityGateEligible &&
      isActive &&
      desktopIdentityEnabled === true;
    const optimizeDepRecoveryRef = useRef(false);
    const prevUrlRef = useRef(url);
    const prevUrlOpenNonceRef = useRef(urlOpenNonce);
    const prevIsActiveRef = useRef(isActive);
    const onTitleChangeRef = useRef(onTitleChange);
    const onAuthStateChangeRef = useRef(onAuthStateChange);
    const onDesktopIdentityStatusChangeRef = useRef(
      onDesktopIdentityStatusChange,
    );
    const perAppChatOpenRef = useRef(false);

    const applyGuestTheme = useCallback(() => {
      const wv = webviewRef.current;
      if (!syncTheme || !wv || app.placeholder) return;
      try {
        void wv
          .executeJavaScript(buildGuestThemeScript(theme), false)
          .catch(() => {});
        // coercion-ok: Theme sync is best-effort until the imperatively-created webview is attached.
      } catch {
        // The imperatively-created webview can exist before Chromium attaches it.
      }
    }, [app.placeholder, syncTheme, theme]);

    const syncGuestAppChatSidebar = useCallback(() => {
      const wv = webviewRef.current;
      if (!wv || app.placeholder) return;
      try {
        void wv
          .executeJavaScript(
            buildGuestAppChatSidebarStateScript(perAppChatOpenRef.current),
            false,
          )
          .catch(() => {});
        // coercion-ok: Guest chrome sync is best-effort until Chromium attaches the webview.
      } catch {
        // The imperatively-created webview can exist before Chromium attaches it.
      }
    }, [app.placeholder]);

    useEffect(() => {
      onTitleChangeRef.current = onTitleChange;
    }, [onTitleChange]);

    useEffect(() => {
      onAuthStateChangeRef.current = onAuthStateChange;
    }, [onAuthStateChange]);

    useEffect(() => {
      onDesktopIdentityStatusChangeRef.current = onDesktopIdentityStatusChange;
    }, [onDesktopIdentityStatusChange]);

    useEffect(() => {
      onDesktopIdentityStatusChangeRef.current?.(desktopIdentityStatus);
    }, [desktopIdentityStatus]);

    useEffect(() => {
      const identity = window.electronAPI?.identity;
      if (!identity || !desktopIdentityGateEligible || !isActive) {
        const rememberedSignedIn = shouldReuseRememberedDesktopIdentitySession(
          rememberedDesktopIdentityStatus,
          undefined,
          rememberedDesktopIdentityStatusAt,
        );
        setDesktopIdentityEnabled(false);
        setDesktopIdentityStatus(rememberedSignedIn ? "signed-in" : "idle");
        setDesktopIdentitySessionReady(true);
        return;
      }
      let active = true;
      let statusRequest = 0;
      const rememberedSignedIn = shouldReuseRememberedDesktopIdentitySession(
        rememberedDesktopIdentityStatus,
        undefined,
        rememberedDesktopIdentityStatusAt,
      );
      setDesktopIdentityEnabled(rememberedSignedIn ? true : null);
      setDesktopIdentityStatus(rememberedSignedIn ? "signed-in" : "idle");
      setDesktopIdentitySessionReady(false);

      const applyStatus = async (
        status: DesktopIdentityStatus,
        request: number,
        fromRememberedSession = false,
      ) => {
        if (!active || request !== statusRequest) return;
        if (!fromRememberedSession) rememberDesktopIdentityStatus(status);
        setDesktopIdentityStatus(status);
        if (status === "signed-in") {
          setDesktopIdentitySessionReady(false);
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
          if (fromRememberedSession && synchronized !== true) {
            // A failed lazy sync can mean the broker is in the middle of
            // sign-out while its public status is still signed-in. Do not
            // keep reusing this renderer cache during that ceremony. Keep the
            // current verified tab usable until the broker publishes its
            // authoritative sign-out status or the next activation rechecks.
            invalidateRememberedDesktopIdentityStatus();
          }
          setDesktopIdentitySessionReady(true);
          setDesktopIdentityStatus(
            resolveDesktopIdentityLazySyncStatus(status, synchronized === true),
          );
          return;
        }
        setDesktopIdentitySessionReady(status !== "signing-in");
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
            setDesktopIdentitySessionReady(true);
            return;
          }
          setDesktopIdentityEnabled(true);
          const needsRemoteStatus =
            nextStatus === undefined && !reuseRememberedSession;
          if (needsRemoteStatus) {
            setDesktopIdentityStatus("checking");
            setDesktopIdentitySessionReady(false);
          }
          const status =
            nextStatus ??
            (reuseRememberedSession ? "signed-in" : await identity.getStatus());
          await applyStatus(status, request, reuseRememberedSession);
        } catch {
          // An older or unavailable preload must fail closed to the legacy
          // app-owned login surface rather than strand the WebView behind SSO.
          if (active && request === statusRequest) {
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
            setDesktopIdentitySessionReady(true);
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
    }, [app.id, desktopIdentityGateEligible, isActive]);

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
          void wv
            .executeJavaScript(
              `window.dispatchEvent(new Event("agent-panel:toggle"));`,
              false,
            )
            .catch(() => {});
        },
      }),
      [app.placeholder, url],
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
      void wv
        .executeJavaScript(buildGuestLifecycleScript(eventName), false)
        .catch(() => {});
    }, [app.placeholder, isActive]);

    function reportActiveWebview() {
      if (!isActive || !window.electronAPI?.setActiveWebview) return;
      const wv = webviewRef.current;
      if (!wv) return;

      let webContentsId: number | undefined;
      try {
        webContentsId = wv.getWebContentsId();
      } catch {
        webContentsId = undefined;
      }

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
        const title = String(candidate ?? "").trim();
        if (title) onTitleChangeRef.current?.(title);
      };
      const emitCurrentTitle = (candidate?: string) => {
        if (disposed) return;
        emitTitle(candidate);
        emitTitle(wv.getTitle());
        void wv
          .executeJavaScript("document.title", false)
          .then((title) => {
            if (!disposed) emitTitle(title);
          })
          .catch(() => {});
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
        let currentUrl: string | undefined;
        try {
          currentUrl = wv.getURL() || wv.src;
        } catch {
          currentUrl = wv.src;
        }
        onAuthStateChangeRef.current?.(
          resolveAppWebviewAuthState(currentUrl || undefined),
        );
      };

      onAuthStateChangeRef.current?.("unknown");

      const onReady = () => {
        // Chromium can emit dom-ready for its internal error document after
        // did-fail-load. That event is not a successful app load.
        if (loadFailureRef.current) return;
        applyGuestTheme();
        syncGuestAppChatSidebar();
        if (app.id === "content") {
          void wv
            .executeJavaScript(buildContentDirectoryPickerBridgeScript(), false)
            .catch(() => {});
        }
        setError(false);
        setIsLoading(false);
        setSlowLoad(false);
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
        syncGuestAppChatSidebar();
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
        setError(true);
        setIsLoading(false);
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
      wv.addEventListener("did-stop-loading", onNavigation);
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
        wv.removeEventListener("did-stop-loading", onNavigation);
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
      syncGuestAppChatSidebar,
    ]);

    useEffect(() => {
      applyGuestTheme();
    }, [applyGuestTheme]);

    useEffect(() => {
      const handleChatState = (event: Event) => {
        const open = (event as CustomEvent<{ open?: unknown }>).detail?.open;
        if (typeof open !== "boolean") return;
        perAppChatOpenRef.current = open;
        syncGuestAppChatSidebar();
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
      let currentUrl: string | undefined;
      try {
        currentUrl = wv.getURL() || wv.src;
      } catch {
        currentUrl = wv.src;
      }
      onAuthStateChangeRef.current?.(
        resolveAppWebviewAuthState(currentUrl || undefined),
      );
    }, [app.placeholder, isActive, url]);

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
      const urlChanged = prevUrlRef.current !== url;
      const openNonceChanged = prevUrlOpenNonceRef.current !== urlOpenNonce;
      if (!urlChanged && !openNonceChanged) return;

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
        void wv
          .executeJavaScript(buildSoftOpenScript(urlPath), false)
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
    }, [url, urlOpenNonce, urlOpenSoft, urlPath, app.placeholder]);

    // If the webview hasn't fired dom-ready within a few seconds, surface
    // a "still loading" hint. If it's still not ready after a bit longer,
    // assume the dev server isn't running and show the error screen.
    useEffect(() => {
      if (app.placeholder || error || !isLoading) return;
      const slowT = setTimeout(() => setSlowLoad(true), 2500);
      const failT = setTimeout(() => {
        if (isLoading) {
          loadFailureRef.current = true;
          setError(true);
          setIsLoading(false);
        }
      }, 8000);
      return () => {
        clearTimeout(slowT);
        clearTimeout(failT);
      };
    }, [app.placeholder, error, isLoading, url]);

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
              wv.setAttribute("src", url);
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
            onSignIn={() =>
              window.electronAPI?.identity?.signIn() ?? Promise.resolve(false)
            }
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
    check();
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
