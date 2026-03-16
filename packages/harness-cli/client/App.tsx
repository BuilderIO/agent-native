import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  IconSettings,
  IconTerminal2,
  IconDeviceDesktop,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react";
import { useTerminal } from "./hooks/useTerminal";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  loadSettings,
  saveSettings,
  type LaunchSettings,
} from "./lib/settings";
import { useHarnessConfig, useHarnessConfigs } from "./lib/config";

function Tooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="relative group/tip">
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 rounded bg-[#111] border border-white/10 text-[11px] text-white/80 whitespace-nowrap opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity z-50">
        {label}
      </div>
    </div>
  );
}

const APP_CONFIG: Array<{ name: string; appPort: number; wsPort: number }> =
  import.meta.env.VITE_APP_CONFIG || [
    { name: "default", appPort: 8081, wsPort: 3341 },
  ];

/** Read ?app= query param to auto-select an app (used by electron shell) */
function getInitialApp(configFallback: string): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const appParam = params.get("app");
    if (appParam && APP_CONFIG.find((a) => a.name === appParam)) {
      return appParam;
    }
  } catch {}
  return configFallback;
}

export function App() {
  const config = useHarnessConfig();
  const { configs, switchHarness } = useHarnessConfigs();

  const [settings, setSettings] = useState<LaunchSettings>(() =>
    loadSettings(config),
  );
  const [showSettings, setShowSettings] = useState(false);

  const [activeApp, setActiveApp] = useState(() => {
    const saved = loadSettings(config).activeApp;
    const fallback =
      APP_CONFIG.find((a) => a.name === saved)?.name ||
      APP_CONFIG[0]?.name ||
      "default";
    return getInitialApp(fallback);
  });

  const [mobileTab, setMobileTab] = useState<"agent" | "interact">("interact");
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activeAppConfig = APP_CONFIG.find((a) => a.name === activeApp);
  const appUrl = activeAppConfig
    ? `http://localhost:${activeAppConfig.appPort}`
    : `http://localhost:8081`;

  const { termRef, iframeRef, connected, setupStatus, connect, restart, fit } =
    useTerminal();

  // On first mount, connect
  useEffect(() => {
    connect(settings, activeApp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When harness config changes (user switched CLI), reload settings and restart
  const prevCommand = useRef(config.command);
  useEffect(() => {
    if (prevCommand.current !== config.command) {
      prevCommand.current = config.command;
      const newSettings = loadSettings(config);
      setSettings(newSettings);
      restart(newSettings, activeApp);
    }
  }, [config, activeApp, restart]);

  const updateSettings = useCallback(
    (s: LaunchSettings) => {
      setSettings(s);
      saveSettings(config, s);
    },
    [config],
  );

  const switchApp = useCallback(
    (name: string) => {
      if (name === activeApp) return;
      setActiveApp(name);
      updateSettings({ ...settings, activeApp: name });
      // Reset iframe to root when switching apps
      if (iframeRef.current) {
        const appConfig = APP_CONFIG.find((a) => a.name === name);
        if (appConfig) {
          iframeRef.current.src = `http://localhost:${appConfig.appPort}`;
        }
      }
      restart(settings, name);
    },
    [activeApp, settings, updateSettings, restart, iframeRef],
  );

  const dismissPopovers = useCallback(() => {
    setShowSettings(false);
  }, []);

  // Desktop resize
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
        if (termWidth !== null)
          localStorage.setItem("harness:termWidth", String(termWidth));
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [fit, iframeRef, termWidth]);

  useEffect(() => {
    const handler = () => {
      setIsMobile(window.innerWidth < 768);
      fit();
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [fit]);

  const showPopoverBackdrop = showSettings;

  // Terminal header — lives inside the terminal pane only
  const terminalHeader = (
    <div className="flex items-center gap-2 px-3 h-10 shrink-0">
      <span className="text-[13px] font-medium text-white/90">{activeApp}</span>
      <span className="flex-1" />

      <a
        href="https://docs.google.com/forms/d/e/1FAIpQLSfI7sc2egh0vLBgzOy5tEEZF0e4PdXsQRNsZhX_yR2vx0m8ig/viewform?usp=publish-editor"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
      >
        feedback
      </a>

      <div className="relative">
        <Tooltip label="Settings">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            <IconSettings size={14} stroke={1.5} />
          </button>
        </Tooltip>
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            onRestart={() => restart(settings, activeApp)}
            appUrl={appUrl}
            iframeRef={iframeRef}
            connected={connected}
            apps={APP_CONFIG}
            activeApp={activeApp}
            onSwitchApp={switchApp}
            harnesses={configs}
            onSwitchHarness={switchHarness}
          />
        )}
      </div>

      <Tooltip label={isFullscreen ? "Show terminal" : "Fullscreen preview"}>
        <button
          onClick={() => setIsFullscreen((v) => !v)}
          className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
        >
          {isFullscreen ? (
            <IconMinimize size={14} stroke={1.5} />
          ) : (
            <IconMaximize size={14} stroke={1.5} />
          )}
        </button>
      </Tooltip>
    </div>
  );

  // Setup overlay
  const setupOverlay = (setupStatus.status === "installing" ||
    setupStatus.status === "not-found" ||
    setupStatus.status === "failed") && (
    <div className="absolute inset-0 bg-[#1e1e1e]/95 flex items-center justify-center z-10">
      <div className="text-center max-w-sm px-6">
        {setupStatus.status === "installing" ? (
          <>
            <div className="w-8 h-8 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
            <h3 className="text-sm font-medium text-white/90 mb-2">
              Installing {config.name}
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              Running{" "}
              <code className="bg-white/10 px-1.5 py-0.5 rounded text-[11px]">
                npx --yes {config.installPackage}
              </code>
            </p>
            <p className="text-[11px] text-white/30 mt-3">
              This may take a minute...
            </p>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-400 text-lg">!</span>
            </div>
            <h3 className="text-sm font-medium text-white/90 mb-2">
              {config.name} Not Found
            </h3>
            <p className="text-xs text-white/50 leading-relaxed mb-4">
              {setupStatus.message}
            </p>
            <p className="text-xs text-white/40 leading-relaxed">
              Install manually:
            </p>
            <code className="block bg-white/10 px-3 py-2 rounded text-[11px] text-white/70 mt-2">
              npx --yes {config.installPackage}
            </code>
            <button
              onClick={() => restart(settings, activeApp)}
              className="mt-4 px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded transition-colors"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={`h-screen bg-[#1e1e1e] ${isMobile ? "flex flex-col" : "flex"}`}
    >
      {/* Backdrop — dismisses popovers when clicking anywhere, including over iframe */}
      {showPopoverBackdrop && (
        <div className="fixed inset-0 z-40" onClick={dismissPopovers} />
      )}

      {/* Terminal pane — hidden when fullscreen */}
      {!isFullscreen && (
        <>
          <div
            className={
              isMobile
                ? `flex flex-col ${mobileTab === "agent" ? "flex-1 min-h-0" : "absolute inset-0 invisible"}`
                : "flex flex-col min-h-0"
            }
            style={
              isMobile
                ? undefined
                : { width: termWidth ?? "36%", flexShrink: 0 }
            }
          >
            {terminalHeader}

            {/* Terminal */}
            <div className="flex-1 min-h-0 relative">
              <div ref={termRef} className="w-full h-full py-1 pl-3 pr-1" />
              {setupOverlay}
            </div>
          </div>

          {/* Drag handle — desktop only */}
          {!isMobile && (
            <div
              onMouseDown={onMouseDown}
              className="w-1 cursor-col-resize flex items-center justify-center hover:bg-blue-500/30 transition-colors"
            >
              <div className="w-px h-8 bg-white/10 rounded-full" />
            </div>
          )}
        </>
      )}

      {/* Preview pane — goes fullscreen (fixed inset-0) or inline */}
      <div
        className={
          isFullscreen && !isMobile
            ? "fixed inset-0 z-50 bg-black"
            : isMobile
              ? `flex flex-col ${mobileTab === "interact" ? "flex-1 min-h-0" : "absolute inset-0 invisible"}`
              : "flex-1 flex flex-col min-h-0 p-2 pl-0"
        }
      >
        <div
          className={`flex-1 overflow-hidden bg-black ${isFullscreen ? "" : isMobile ? "" : "rounded-xl"}`}
        >
          <iframe
            ref={iframeRef}
            src={appUrl}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation allow-downloads"
            allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; geolocation; display-capture"
          />
        </div>

        {/* Floating back-to-agent button — bottom left, fullscreen only */}
        {isFullscreen && !isMobile && (
          <button
            onClick={() => setIsFullscreen(false)}
            className="fixed bottom-4 left-4 z-[51] flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 backdrop-blur-sm border border-white/10 text-white/60 hover:text-white hover:bg-black/90 transition-all text-xs font-medium shadow-lg"
          >
            <IconTerminal2 size={14} stroke={1.5} />
            Agent
          </button>
        )}
      </div>

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <div className="flex shrink-0 border-t border-white/10 bg-[#111]">
          <button
            onClick={() => {
              setMobileTab("agent");
              requestAnimationFrame(() => fit());
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-colors ${
              mobileTab === "agent"
                ? "text-blue-400 bg-blue-500/10"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <IconTerminal2 size={16} stroke={1.5} />
            Agent
          </button>
          <button
            onClick={() => setMobileTab("interact")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-colors ${
              mobileTab === "interact"
                ? "text-blue-400 bg-blue-500/10"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <IconDeviceDesktop size={16} stroke={1.5} />
            Interact
          </button>
        </div>
      )}
    </div>
  );
}
