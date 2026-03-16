import { useRef, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { AppDefinition } from "@shared/app-registry";
import { getAppUrl } from "@shared/app-registry";

interface AppWebviewProps {
  app: AppDefinition;
  isActive: boolean;
}

export default function AppWebview({ app, isActive }: AppWebviewProps) {
  const webviewRef = useRef<ElectronWebviewElement>(null);
  const [error, setError] = useState(false);

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
      wv.src = getAppUrl(app);
    }
  }

  return (
    <div className={`webview-slot${isActive ? "" : " webview-slot--hidden"}`}>
      {app.placeholder && <PlaceholderScreen app={app} />}

      {!app.placeholder && error && (
        <ErrorScreen app={app} onRetry={handleRetry} />
      )}

      {!app.placeholder && (
        <webview
          ref={webviewRef}
          src={getAppUrl(app)}
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
  onRetry,
}: {
  app: AppDefinition;
  onRetry: () => void;
}) {
  return (
    <div className="error-overlay">
      <AlertCircle size={40} className="error-icon" />
      <p className="error-title">Could not connect to {app.name}</p>
      <p className="error-hint">
        Make sure the dev server is running on port {app.devPort}.
        <br />
        Run:{" "}
        <code>
          pnpm --filter {app.id} exec vite --port {app.devPort}
        </code>
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
