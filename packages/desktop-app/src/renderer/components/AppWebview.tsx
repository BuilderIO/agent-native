import {
  forwardRef,
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
} from "react";
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
import type { AppDefinition, AppConfig } from "@shared/app-registry";
import {
  getAppUrl,
  FRAME_PORT,
  getTemplate,
  getDesktopTemplateGatewayAppUrl,
  getTemplateGatewayUrl,
  isDefaultDesktopTemplateDevTarget,
} from "@shared/app-registry";

const IS_DEV = window.location.protocol !== "file:";

type WebviewTitleUpdatedEvent = Event & { title?: string };
type WebviewLoadFailedEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
};
type WebviewConsoleMessageEvent = Event & { message?: string };

interface AppWebviewProps {
  app: AppDefinition;
  /** Full app config with URL overrides (optional for backward compat) */
  appConfig?: AppConfig;
  isActive: boolean;
  /** Changes when the same URL should be opened again. */
  urlOpenNonce?: number;
  /** Safe app-relative path to load inside this app's origin. */
  urlPath?: string;
  /** When true, apply an explicit open request without resetting a live webview. */
  urlOpenSoft?: boolean;
  /** Query parameters to merge into the resolved app URL. */
  urlParams?: Record<string, string | null | undefined>;
  /** Increment to trigger a webview reload (Cmd+R) */
  refreshKey?: number;
  /** Emits the guest page's document title so the shell tab can stay current. */
  onTitleChange?: (title: string) => void;
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
  getUrl(): string | undefined;
  goBack(): void;
  goForward(): void;
  toggleAgentSidebar(): void;
}

/**
 * Determine the URL to load for this app.
 *
 * Production mode (default): load the production URL (e.g. https://mail.agent-native.com).
 * Dev mode: honor an explicit lazy gateway override or devUrl/port override;
 * otherwise first-party templates fall back to the local dev frame.
 */
function resolveUrl(app: AppDefinition, appConfig?: AppConfig): string {
  if (appConfig?.mode === "dev") {
    const template = getTemplate(appConfig.id);
    if (template) {
      const customTemplateDevUrl = !isDefaultDesktopTemplateDevTarget(appConfig)
        ? (appConfig.devUrl?.trim() ??
          (appConfig.devPort ? `http://localhost:${appConfig.devPort}` : ""))
        : "";

      // First-party templates must load through the frame so the Chat | CLI |
      // Workspace panel lives outside the hot-reloaded app iframe. Custom
      // template targets still use the frame as the top-level page; the frame
      // loads the custom URL inside its app iframe.
      return getFramedAppUrl(app, customTemplateDevUrl);
    }

    // Non-template dev URLs can still load directly.
    if (appConfig.devUrl?.trim()) return appConfig.devUrl.trim();
    if (appConfig.devPort) return `http://localhost:${appConfig.devPort}`;
    if (appConfig.url) return appConfig.url;
    return getAppUrl(app);
  }

  // Production mode (default): use the production URL
  if (appConfig?.url) {
    return appConfig.url;
  }

  const template = getTemplate(app.id);
  if (template?.prodUrl) {
    return template.prodUrl;
  }

  // Fallback for custom apps with no production URL.
  return getAppUrl(app);
}

function getFramedAppUrl(app: AppDefinition, devUrl?: string): string {
  const frameUrl = new URL(getAppUrl(app));
  const trimmedDevUrl = devUrl?.trim();
  if (trimmedDevUrl) frameUrl.searchParams.set("devUrl", trimmedDevUrl);
  return frameUrl.toString();
}

function rendererEnvValue(name: string): string | undefined {
  const viteEnv = (
    typeof import.meta !== "undefined"
      ? (
          import.meta as unknown as {
            env?: Record<string, string | undefined>;
          }
        ).env
      : undefined
  )?.[name];
  if (viteEnv) return viteEnv;
  const globalProcess = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  return globalProcess?.env?.[name];
}

function templateGatewayOverridesDevUrls(): boolean {
  const value =
    rendererEnvValue("VITE_AGENT_NATIVE_USE_TEMPLATE_GATEWAY") ||
    rendererEnvValue("AGENT_NATIVE_USE_TEMPLATE_GATEWAY");
  return value === "1" || value === "true";
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

function buildSoftOpenScript(path: string): string {
  return `(() => fetch(${JSON.stringify(path)}, { credentials: "same-origin", redirect: "manual", cache: "no-store" }).then(() => true, () => false))()`;
}

const AppWebview = forwardRef<AppWebviewHandle, AppWebviewProps>(
  (
    {
      app,
      appConfig,
      isActive,
      urlOpenNonce,
      urlPath,
      urlOpenSoft,
      urlParams,
      refreshKey = 0,
      onTitleChange,
      onAppsChanged,
    }: AppWebviewProps,
    ref,
  ) => {
    const webviewRef = useRef<ElectronWebviewElement>(null);
    const [error, setError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [slowLoad, setSlowLoad] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const url = withUrlParams(
      withUrlPath(resolveUrl(app, appConfig), urlPath),
      urlParams,
    );
    const isDevMode = appConfig?.mode === "dev";
    const optimizeDepRecoveryRef = useRef(false);
    const prevUrlRef = useRef(url);
    const prevUrlOpenNonceRef = useRef(urlOpenNonce);
    const onTitleChangeRef = useRef(onTitleChange);

    useEffect(() => {
      onTitleChangeRef.current = onTitleChange;
    }, [onTitleChange]);

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
      });
    }

    useEffect(() => {
      if (app.placeholder) return;

      const wv = webviewRef.current;
      if (!wv) return;

      const recoverOutdatedOptimizeDep = () => {
        if (!IS_DEV || optimizeDepRecoveryRef.current) return;
        optimizeDepRecoveryRef.current = true;
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

      const onReady = () => {
        setError(false);
        setIsLoading(false);
        setSlowLoad(false);
        optimizeDepRecoveryRef.current = false;
        reportActiveWebview();
        emitCurrentTitleSoon();
      };
      const onTitleUpdated = (e: Event) => {
        const title = String(
          (e as WebviewTitleUpdatedEvent).title ?? "",
        ).trim();
        emitCurrentTitle(title);
      };
      const onNavigation = () => emitCurrentTitleSoon();
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
        setError(true);
        setIsLoading(false);
      };
      const onConsoleMessage = (e: Event) => {
        const message = String((e as WebviewConsoleMessageEvent).message || "");
        if (message.includes("Outdated Optimize Dep")) {
          recoverOutdatedOptimizeDep();
        }
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
        wv.removeEventListener("enter-html-full-screen", onEnterFullscreen);
        wv.removeEventListener("leave-html-full-screen", onLeaveFullscreen);
      };
    }, [app.placeholder, isActive, app.id]);

    // Cmd+R — reload the active webview when refreshKey increments
    const prevRefreshKey = useRef(refreshKey);
    useEffect(() => {
      if (refreshKey > 0 && refreshKey !== prevRefreshKey.current) {
        prevRefreshKey.current = refreshKey;
        const wv = webviewRef.current;
        if (wv && isActive && !app.placeholder) {
          try {
            wv.reloadIgnoringCache();
          } catch {
            wv.reload();
          }
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
          // Try focusing immediately, then retry — the webview needs a
          // moment after becoming visible (visibility: hidden → visible)
          // and the sidebar click may have stolen focus.
          wv.focus();
          const t1 = setTimeout(() => wv.focus(), 80);
          const t2 = setTimeout(() => wv.focus(), 250);
          return () => {
            clearTimeout(t1);
            clearTimeout(t2);
          };
        }
      }
    }, [isActive, app.placeholder, error]);

    useEffect(() => {
      reportActiveWebview();
    }, [isActive, url]);

    function handleRetry() {
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
        onClick={() => {
          // Re-focus the webview when clicking the content area so
          // keyboard shortcuts (Tab, etc.) route into the app.
          if (isActive && !app.placeholder && !error) {
            webviewRef.current?.focus();
          }
        }}
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
              if (app.id === "plan" && window.electronAPI?.webviewPreloadPath) {
                wv.setAttribute(
                  "preload",
                  window.electronAPI.webviewPreloadPath,
                );
              }
              wv.setAttribute(
                "webpreferences",
                "contextIsolation=true,nodeIntegration=false,sandbox=true,backgroundThrottling=false",
              );
              wv.setAttribute("partition", `persist:app-${app.id}`);
              wv.setAttribute("src", url);
              container.appendChild(wv);
              webviewRef.current = wv;
            }}
            style={{
              flex: "1 1 auto",
              display: "flex",
              flexDirection: "column",
              ...(error ? { visibility: "hidden" as const } : {}),
            }}
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

function usePortCheck(port: number | undefined, enabled: boolean): PortStatus {
  const url = port ? `http://localhost:${port}` : undefined;
  return useUrlCheck(url, enabled);
}

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
  const gatewayUrl = getTemplateGatewayUrl();
  const gatewayAppUrl =
    isDev &&
    (gatewayUrl ||
      templateGatewayOverridesDevUrls() ||
      (appConfig && isDefaultDesktopTemplateDevTarget(appConfig)))
      ? getDesktopTemplateGatewayAppUrl(app.id)
      : null;
  const devStatusUrl =
    gatewayAppUrl ?? (devPort ? `http://localhost:${devPort}` : undefined);
  const devServerStatus = useUrlCheck(devStatusUrl, isDev);
  const frameStatus = usePortCheck(FRAME_PORT, isDev);

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
              {gatewayAppUrl
                ? `${app.name} via template gateway`
                : `${app.name} dev server${devPort ? ` (port ${devPort})` : ""}`}
            </li>
            <li className={`error-checklist-item--${frameStatus}`}>
              <StatusIcon status={frameStatus} />
              Frame (port {FRAME_PORT})
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
