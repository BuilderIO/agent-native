import { useRef, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { AppDefinition, AppConfig } from "@shared/app-registry";
import { getAppUrl } from "@shared/app-registry";

interface AppWebviewProps {
  app: AppDefinition;
  /** Full app config with URL overrides (optional for backward compat) */
  appConfig?: AppConfig;
  isActive: boolean;
}

/**
 * Determine the URL to load for this app.
 * Always connects to the harness (localhost:3334) which proxies to individual
 * app dev servers. If a user has configured a custom production URL in settings,
 * that takes priority.
 */
function resolveUrl(app: AppDefinition, appConfig?: AppConfig): string {
  // If the user configured a custom URL (not the default placeholder), use it
  if (appConfig?.url && !appConfig.url.endsWith(".agentnative.app")) {
    return appConfig.url;
  }

  // If harness is disabled, load the app directly
  if (appConfig?.useCliHarness === false) {
    return appConfig.devUrl || appConfig.url;
  }

  // Default: connect to the harness which serves all apps
  return getAppUrl(app);
}

export default function AppWebview({
  app,
  appConfig,
  isActive,
}: AppWebviewProps) {
  const webviewRef = useRef<ElectronWebviewElement>(null);
  const [error, setError] = useState(false);
  const url = resolveUrl(app, appConfig);

  useEffect(() => {
    if (app.placeholder) return;

    const wv = webviewRef.current;
    if (!wv) return;

    const onReady = () => setError(false);
    const onFailed = (e: Event) => {
      const errorCode = (e as any).errorCode;
      if (errorCode === -3) return;
      setError(true);
    };

    wv.addEventListener("dom-ready", onReady);
    wv.addEventListener("did-fail-load", onFailed);

    return () => {
      wv.removeEventListener("dom-ready", onReady);
      wv.removeEventListener("did-fail-load", onFailed);
    };
  }, [app.placeholder]);

  useEffect(() => {
    if (isActive && error && !app.placeholder) {
      handleRetry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  function handleRetry() {
    setError(false);
    const wv = webviewRef.current;
    if (wv) {
      wv.src = url;
    }
  }

  return (
    <div className={`webview-slot${isActive ? "" : " webview-slot--hidden"}`}>
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
}

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
      <AlertCircle size={40} className="error-icon" />
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
        <RefreshCw size={11} style={{ display: "inline", marginRight: 5 }} />
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
