import {
  forwardRef,
  useRef,
  useEffect,
  useState,
  useImperativeHandle,
} from "react";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import type { AppDefinition, AppConfig } from "@shared/app-registry";
import { getAppUrl } from "@shared/app-registry";

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
    const url = resolveUrl(app, appConfig);
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
      };
      const onConsoleMessage = (e: Event) => {
        const message = String((e as any).message || "");
        if (message.includes("Outdated Optimize Dep")) {
          recoverOutdatedOptimizeDep();
        }
      };

      wv.addEventListener("dom-ready", onReady);
      wv.addEventListener("did-fail-load", onFailed);
      wv.addEventListener("console-message", onConsoleMessage);

      return () => {
        wv.removeEventListener("dom-ready", onReady);
        wv.removeEventListener("did-fail-load", onFailed);
        wv.removeEventListener("console-message", onConsoleMessage);
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

    useEffect(() => {
      if (isActive && error && !app.placeholder) {
        handleRetry();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive]);

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
      const wv = webviewRef.current;
      if (wv) {
        wv.src = url;
      }
    }

    return (
      <div
        className={`webview-slot${isActive ? "" : " webview-slot--hidden"}`}
        onClick={() => {
          // Re-focus the webview when clicking the content area so
          // keyboard shortcuts (Tab, etc.) route into the app.
          if (isActive && !app.placeholder && !error) {
            webviewRef.current?.focus();
          }
        }}
      >
        {app.placeholder && <PlaceholderScreen app={app} />}

        {!app.placeholder && error && (
          <ErrorScreen
            app={app}
            appConfig={appConfig}
            url={url}
            onRetry={handleRetry}
          />
        )}

        {!app.placeholder && (
          <webview
            ref={webviewRef}
            src={url}
            className="app-webview"
            allowpopups=""
            webpreferences="contextIsolation=false"
          />
        )}
      </div>
    );
  },
);

export default AppWebview;

function ErrorScreen({
  app,
  appConfig,
  url,
  onRetry,
}: {
  app: AppDefinition;
  appConfig?: AppConfig;
  url: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-overlay">
      <IconAlertCircle size={40} className="error-icon" />
      <p className="error-title">Could not connect to {app.name}</p>
      <p className="error-hint">
        {appConfig?.devCommand ? (
          <>
            Run: <code>{appConfig.devCommand}</code>
          </>
        ) : (
          <>
            Make sure the app is running at <code>{url}</code>
          </>
        )}
      </p>
      <button className="retry-button" onClick={onRetry}>
        <IconRefresh size={11} style={{ display: "inline", marginRight: 5 }} />
        Retry
      </button>
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
