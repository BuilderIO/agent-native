import { useState, useEffect, useRef, useCallback } from "react";
import {
  IconRefresh,
  IconSettings,
  IconShare,
  IconExternalLink,
} from "@tabler/icons-react";
import { useTerminal } from "./hooks/useTerminal";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  loadSettings,
  saveSettings,
  type LaunchSettings,
} from "./lib/settings";

const APP_PORT = Number(
  new URLSearchParams(location.search).get("appPort") || "8080"
);
// Single-port mode: app is proxied through /app/ on the same origin.
// Explicit: VITE_SINGLE_PORT env var or ?singlePort=1 query param.
// Auto-detect fallback: if no explicit signal and we're not on the app's own port.
const SINGLE_PORT =
  import.meta.env.VITE_SINGLE_PORT === "1" ||
  new URLSearchParams(location.search).get("singlePort") === "1" ||
  (import.meta.env.VITE_SINGLE_PORT !== "0" &&
    !new URLSearchParams(location.search).has("appPort") &&
    location.port !== "8080");
const APP_URL = SINGLE_PORT ? "/app/" : `http://localhost:${APP_PORT}`;

export function App() {
  const [settings, setSettings] = useState<LaunchSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  const [appName, setAppName] = useState("Agent Native");

  const { termRef, iframeRef, connected, setupStatus, connect, restart, fit } = useTerminal({
    appPort: APP_PORT,
  });

  // Connect on mount + fetch app info
  useEffect(() => {
    connect(settings);
    fetch("/api/app-info")
      .then((r) => r.json())
      .then((info) => { if (info.name) setAppName(info.name); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save settings on change
  const updateSettings = useCallback(
    (s: LaunchSettings) => {
      setSettings(s);
      saveSettings(s);
    },
    []
  );

  // Close popovers on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
      if (restartRef.current && !restartRef.current.contains(e.target as Node)) {
        setShowRestartConfirm(false);
      }
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Resizable panes — persist width in localStorage
  const [termWidth, setTermWidth] = useState<number | null>(() => {
    const saved = localStorage.getItem("harness:termWidth");
    return saved ? Number(saved) : null;
  });
  const isResizing = useRef(false);

  const onMouseDown = useCallback(() => {
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    if (iframeRef.current) iframeRef.current.style.pointerEvents = "none";
  }, [iframeRef]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const w = Math.max(200, Math.min(e.clientX, window.innerWidth - 200));
      setTermWidth(w);
      fit();
    };
    const onMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (iframeRef.current) iframeRef.current.style.pointerEvents = "";
        fit();
        if (termWidth !== null) {
          localStorage.setItem("harness:termWidth", String(termWidth));
        }
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [fit, iframeRef, termWidth]);

  // Resize terminal on window resize
  useEffect(() => {
    const handler = () => fit();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [fit]);

  const copyUrl = () => {
    const url = SINGLE_PORT
      ? `${location.origin}/app/`
      : `http://localhost:${APP_PORT}`;
    navigator.clipboard.writeText(url);
    setShowShareMenu(false);
  };

  return (
    <div className="flex h-screen bg-[#1e1e1e]">
      {/* Terminal pane */}
      <div
        className="flex flex-col min-h-0"
        style={{ width: termWidth ?? "36%", flexShrink: 0 }}
      >
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 h-10 shrink-0">
          <span className="text-[13px] font-medium text-white/90">
            {appName}
          </span>
          <span className="flex-1" />

          {/* Restart */}
          <div ref={restartRef} className="relative">
            <button
              onClick={() => setShowRestartConfirm((v) => !v)}
              className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
              title="Restart Claude Code"
            >
              <IconRefresh size={14} stroke={1.5} />
            </button>
            {showRestartConfirm && (
              <div className="absolute top-8 right-0 bg-[#2a2a2a] border border-white/10 rounded-lg p-3 z-50 min-w-[200px] shadow-2xl">
                <p className="text-xs text-white/70 mb-2">
                  Restart Claude Code? This will end the current session.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowRestartConfirm(false)}
                    className="px-2 py-1 text-[11px] text-white/50 hover:text-white/80 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowRestartConfirm(false);
                      restart(settings);
                    }}
                    className="px-2 py-1 text-[11px] bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
                  >
                    Restart
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Settings */}
          <div ref={settingsRef} className="relative">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
              title="Settings"
            >
              <IconSettings size={14} stroke={1.5} />
            </button>
            {showSettings && (
              <SettingsPanel
                settings={settings}
                onChange={updateSettings}
                appPort={APP_PORT}
                iframeRef={iframeRef}
                connected={connected}
              />
            )}
          </div>

          {/* Share */}
          <div ref={shareRef} className="relative">
            <button
              onClick={() => setShowShareMenu((v) => !v)}
              className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
              title="Share"
            >
              <IconShare size={14} stroke={1.5} />
            </button>
            {showShareMenu && (
              <div className="absolute top-8 right-0 bg-[#2a2a2a] border border-white/10 rounded-lg p-3 z-50 min-w-[260px] shadow-2xl">
                <h3 className="text-[13px] font-semibold text-white/90 mb-2">
                  Share
                </h3>
                <button
                  onClick={copyUrl}
                  className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-xs text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors"
                >
                  <IconExternalLink size={13} stroke={1.5} />
                  Copy local URL
                </button>
                <div className="border-t border-white/10 my-2" />
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Need sharing, collaboration, or remote access? Use the{" "}
                  <a
                    href="https://www.builder.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300"
                  >
                    Builder harness
                  </a>{" "}
                  for real-time multiplayer, cloud deployment, and shareable links.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div className="flex-1 min-h-0 relative">
          <div ref={termRef} className="w-full h-full p-1" />

          {/* Setup overlay — shown when Claude CLI needs to be installed */}
          {(setupStatus.status === 'installing' || setupStatus.status === 'not-found' || setupStatus.status === 'failed') && (
            <div className="absolute inset-0 bg-[#1e1e1e]/95 flex items-center justify-center z-10">
              <div className="text-center max-w-sm px-6">
                {setupStatus.status === 'installing' ? (
                  <>
                    <div className="w-8 h-8 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
                    <h3 className="text-sm font-medium text-white/90 mb-2">
                      Installing Claude Code
                    </h3>
                    <p className="text-xs text-white/50 leading-relaxed">
                      Running <code className="bg-white/10 px-1.5 py-0.5 rounded text-[11px]">npm install -g @anthropic-ai/claude-code</code>
                    </p>
                    <p className="text-[11px] text-white/30 mt-3">This may take a minute...</p>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                      <span className="text-red-400 text-lg">!</span>
                    </div>
                    <h3 className="text-sm font-medium text-white/90 mb-2">
                      Claude Code Not Found
                    </h3>
                    <p className="text-xs text-white/50 leading-relaxed mb-4">
                      {setupStatus.message}
                    </p>
                    <p className="text-xs text-white/40 leading-relaxed">
                      Install manually:
                    </p>
                    <code className="block bg-white/10 px-3 py-2 rounded text-[11px] text-white/70 mt-2">
                      npm install -g @anthropic-ai/claude-code
                    </code>
                    <button
                      onClick={() => {
                        restart(settings);
                      }}
                      className="mt-4 px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1 cursor-col-resize flex items-center justify-center hover:bg-blue-500/30 transition-colors"
      >
        <div className="w-px h-8 bg-white/10 rounded-full" />
      </div>

      {/* Preview pane — full height */}
      <div className="flex-1 flex flex-col min-h-0 p-2 pl-0">
        <div className="flex-1 rounded-xl overflow-hidden bg-black">
          <iframe
            ref={iframeRef}
            src={APP_URL}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-presentation"
            allow="fullscreen"
          />
        </div>
      </div>
    </div>
  );
}
