import { useRef, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { AppDefinition } from "@shared/app-registry";
import { getAppUrl } from "@shared/app-registry";

type LoadStatus = "loading" | "ready" | "error";

interface AppWebviewProps {
  app: AppDefinition;
  isActive: boolean;
}

export default function AppWebview({ app, isActive }: AppWebviewProps) {
  const webviewRef = useRef<ElectronWebviewElement>(null);
  const [status, setStatus] = useState<LoadStatus>(
    app.placeholder ? "ready" : "loading",
  );

  useEffect(() => {
    if (app.placeholder) return;

    const wv = webviewRef.current;
    if (!wv) return;

    const onFinished = () => setStatus("ready");
    const onFailed = (e: Event) => {
      // Error code -3 = "aborted" — happens on redirects, not a real error
      const errorCode = (e as CustomEvent<{ errorCode: number }>).detail
        ?.errorCode;
      if (errorCode !== undefined && errorCode === -3) return;
      setStatus("error");
    };
    const onStarted = () => setStatus("loading");

    wv.addEventListener("did-finish-load", onFinished);
    wv.addEventListener("did-fail-load", onFailed);
    wv.addEventListener("did-start-loading", onStarted);

    return () => {
      wv.removeEventListener("did-finish-load", onFinished);
      wv.removeEventListener("did-fail-load", onFailed);
      wv.removeEventListener("did-start-loading", onStarted);
    };
  }, [app.placeholder]);

  // When this tab is re-activated after an error, retry loading
  useEffect(() => {
    if (isActive && status === "error" && !app.placeholder) {
      handleRetry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  function handleRetry() {
    setStatus("loading");
    const wv = webviewRef.current;
    if (wv) {
      wv.src = getAppUrl(app);
    }
  }

  return (
    <div className={`webview-slot${isActive ? "" : " webview-slot--hidden"}`}>
      {/* Placeholder: app not yet implemented */}
      {app.placeholder && <PlaceholderScreen app={app} />}

      {/* Loading state */}
      {!app.placeholder && status === "loading" && (
        <LoadingScreen appName={app.name} appColor={app.color} />
      )}

      {/* Error state */}
      {!app.placeholder && status === "error" && (
        <ErrorScreen app={app} onRetry={handleRetry} />
      )}

      {/* The actual webview — always rendered (but invisible when loading/error overlay is shown) */}
      {!app.placeholder && (
        <webview
          ref={webviewRef}
          src={getAppUrl(app)}
          style={{
            // Keep webview mounted but visually hidden behind overlays until ready
            opacity: status === "ready" ? 1 : 0,
            pointerEvents: status === "ready" ? "auto" : "none",
            transition: "opacity 0.2s ease",
            flex: 1,
            width: "100%",
            height: "100%",
            display: "block",
          }}
          allowpopups=""
          webpreferences="contextIsolation=false"
        />
      )}
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────

function LoadingScreen({
  appName,
  appColor,
}: {
  appName: string;
  appColor: string;
}) {
  return (
    <div className="loading-overlay">
      <div
        className="spinner"
        style={{ "--app-color": appColor } as React.CSSProperties}
      />
      <span className="loading-label">Starting {appName}…</span>
    </div>
  );
}

// ─── Error screen ─────────────────────────────────────────────────────────────

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

// ─── Placeholder screen ───────────────────────────────────────────────────────

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
