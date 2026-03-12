import { useState, useEffect, useRef, useCallback } from "react";
import { IconRefresh, IconSettings } from "@tabler/icons-react";
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

export function App() {
  const [settings, setSettings] = useState<LaunchSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLDivElement>(null);

  const { termRef, iframeRef, connected, connect, restart, fit } = useTerminal({
    appPort: APP_PORT,
  });

  // Connect on mount
  useEffect(() => {
    connect(settings);
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
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
      if (
        restartRef.current &&
        !restartRef.current.contains(e.target as Node)
      ) {
        setShowRestartConfirm(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Resizable panes
  const [termWidth, setTermWidth] = useState<number | null>(null);
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
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [fit, iframeRef]);

  // Resize terminal on window resize
  useEffect(() => {
    const handler = () => fit();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [fit]);

  return (
    <div className="flex h-screen bg-black">
      {/* Terminal pane */}
      <div
        className="flex flex-col"
        style={{ width: termWidth ?? "50%", flexShrink: 0 }}
      >
        {/* Header */}
        <div className="relative flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border-b border-white/10 text-xs text-white/50">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-white/70">Claude Code</span>
          <span className="flex-1" />

          {/* Restart */}
          <div ref={restartRef} className="relative">
            <button
              onClick={() => setShowRestartConfirm((v) => !v)}
              className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
              title="Restart Claude Code"
            >
              <IconRefresh size={15} stroke={1.5} />
            </button>
            {showRestartConfirm && (
              <div className="absolute top-8 right-0 bg-[#0a0a0a] border border-white/10 rounded-lg p-3 z-50 min-w-[200px] shadow-2xl">
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
          <div ref={settingsRef}>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
              title="Launch settings"
            >
              <IconSettings size={15} stroke={1.5} />
            </button>
            {showSettings && (
              <SettingsPanel settings={settings} onChange={updateSettings} />
            )}
          </div>
        </div>

        {/* Terminal */}
        <div ref={termRef} className="flex-1 min-h-0 p-1" />

        {/* Status bar */}
        <div className="flex justify-between px-3 py-1 bg-[#0a0a0a] border-t border-white/10 text-[11px]">
          <span className={connected ? "text-green-500" : "text-red-500"}>
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1.5 bg-white/5 cursor-col-resize flex items-center justify-center hover:bg-blue-500/40 transition-colors"
      >
        <div className="w-0.5 h-8 bg-white/15 rounded-full" />
      </div>

      {/* App pane */}
      <div className="flex-1 flex flex-col">
        <iframe
          ref={iframeRef}
          src={`http://localhost:${APP_PORT}`}
          className="flex-1 border-none w-full h-full"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    </div>
  );
}
