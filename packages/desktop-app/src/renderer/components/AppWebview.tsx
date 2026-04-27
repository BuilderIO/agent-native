import {
  forwardRef,
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
} from "react";
import {
  IconAlertCircle,
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
import { getAppUrl, FRAME_PORT } from "@shared/app-registry";

const IS_DEV = window.location.protocol !== "file:";

interface AppWebviewProps {
  app: AppDefinition;
  /** Full app config with URL overrides (optional for backward compat) */
  appConfig?: AppConfig;
  isActive: boolean;
  /** Increment to trigger a webview reload (Cmd+R) */
  refreshKey?: number;
}

export interface AppWebviewHandle {
  findInPage(
    text: string,
    options?: { findNext?: boolean; forward?: boolean },
  ): void;
  stopFindInPage(
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ): void;
}

/**
 * Determine the URL to load for this app.
 *
 * Production mode (default): load the production URL (e.g. https://mail.agent-native.com).
 * Dev mode: load through the local dev frame (chat+CLI sidebar + app iframe).
 */
function resolveUrl(app: AppDefinition, appConfig?: AppConfig): string {
  if (appConfig?.mode === "dev") {
    // Dev mode: load through the local dev frame
    return getAppUrl(app);
  }

  // Production mode (default): use the production URL
  if (appConfig?.url) {
    return appConfig.url;
  }

  // Fallback for apps with no production URL (e.g. starter)
  return getAppUrl(app);
}

const AppWebview = forwardRef<AppWebviewHandle, AppWebviewProps>(
  ({ app, appConfig, isActive, refreshKey = 0 }: AppWebviewProps, ref) => {
    const webviewRef = useRef<ElectronWebviewElement>(null);
    const [error, setError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [slowLoad, setSlowLoad] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const url = resolveUrl(app, appConfig);
    const isDevMode = appConfig?.mode === "dev";
    const optimizeDepRecoveryRef = useRef(false);

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
      }),
      [],
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

    // React 19 sets custom element props as DOM properties, but Electron's
    // <webview> requires `allowpopups` as an HTML attribute. Set it
    // imperatively so setWindowOpenHandler fires on window.open / target=_blank.
    useEffect(() => {
      const wv = webviewRef.current;
      if (wv && !wv.hasAttribute("allowpopups")) {
        wv.setAttribute("allowpopups", "");
      }
    }, []);

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

      const onReady = () => {
        setError(false);
        setIsLoading(false);
        setSlowLoad(false);
        optimizeDepRecoveryRef.current = false;
        reportActiveWebview();
      };
      const onFailed = (e: Event) => {
        const details = e as any;
        const errorCode = details.errorCode;
        const description = String(details.errorDescription || "");
        if (errorCode === -3) return;
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
        const message = String((e as any).message || "");
        if (message.includes("Outdated Optimize Dep")) {
          recoverOutdatedOptimizeDep();
        }
      };

      const onEnterFullscreen = () => setIsFullscreen(true);
      const onLeaveFullscreen = () => setIsFullscreen(false);

      wv.addEventListener("dom-ready", onReady);
      wv.addEventListener("did-fail-load", onFailed);
      wv.addEventListener("console-message", onConsoleMessage);
      wv.addEventListener("enter-html-full-screen", onEnterFullscreen);
      wv.addEventListener("leave-html-full-screen", onLeaveFullscreen);

      return () => {
        wv.removeEventListener("dom-ready", onReady);
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
        await window.electronAPI?.appConfig?.update(appConfig.id, {
          mode: "prod",
        });
        // Reload will happen when parent re-renders with new appConfig.
      } catch {
        /* ignore */
      }
    }

    return (
      <div
        className={`webview-slot${isActive ? "" : " webview-slot--hidden"}${isFullscreen ? " webview-slot--fullscreen" : ""}`}
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
          <webview
            ref={webviewRef}
            src={url}
            className="app-webview"
            style={error ? { visibility: "hidden" } : undefined}
            webpreferences="contextIsolation=false"
            partition={`persist:app-${app.id}`}
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
      <div className="loading-spinner" style={{ borderTopColor: app.color }} />
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
  const [status, setStatus] = useState<PortStatus>("checking");

  useEffect(() => {
    if (!enabled || !port) {
      setStatus("checking");
      return;
    }
    let cancelled = false;
    async function check() {
      try {
        await fetch(`http://localhost:${port}`, {
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
  }, [port, enabled]);

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
  const devServerStatus = usePortCheck(devPort, isDev);
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
              {app.name} dev server{devPort ? ` (port ${devPort})` : ""}
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
      <div
        className="placeholder-icon"
        style={{ color: app.color, opacity: 0.3 }}
      >
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
