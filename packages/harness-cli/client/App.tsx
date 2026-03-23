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
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  TerminalTab,
  type TerminalTabHandle,
  type SetupStatus,
} from "./components/TerminalTab";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  loadSettings,
  saveSettings,
  type LaunchSettings,
} from "./lib/settings";
import { useHarnessConfig, useHarnessConfigs } from "./lib/config";
import {
  AssistantChat,
  type AssistantChatHandle,
} from "@agent-native/core/client";

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

interface Tab {
  id: string;
  label: string;
  completed: boolean;
}

let nextTabId = 0;
function createTab(): Tab {
  const id = String(nextTabId++);
  return { id, label: id, completed: false };
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

  // Agent UI mode: when "agent-ui" harness is selected, show chat instead of terminal
  const isAgentUi = config.command === "agent-ui";

  // Tab management
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabRefs = useRef<Map<string, TerminalTabHandle>>(new Map());
  const chatRefs = useRef<Map<string, AssistantChatHandle>>(new Map());

  // Track active tab's connection state
  const [activeConnected, setActiveConnected] = useState(false);
  const [activeSetupStatus, setActiveSetupStatus] = useState<SetupStatus>({
    status: "none",
    message: "",
  });

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const activeAppConfig = APP_CONFIG.find((a) => a.name === activeApp);
  const appUrl = activeAppConfig
    ? `http://localhost:${activeAppConfig.appPort}`
    : `http://localhost:8081`;

  // Set cookie so the harness API proxy knows which app to route to
  useEffect(() => {
    document.cookie = `active_app=${activeApp}; path=/; SameSite=Lax`;
  }, [activeApp]);

  // When harness config changes (user switched CLI), reload settings and restart active tab
  const prevCommand = useRef(config.command);
  useEffect(() => {
    if (prevCommand.current !== config.command) {
      prevCommand.current = config.command;
      const newSettings = loadSettings(config);
      setSettings(newSettings);
      const handle = tabRefs.current.get(activeTabId);
      handle?.restart(newSettings, activeApp);
    }
  }, [config, activeApp, activeTabId]);

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
      // Restart active tab with new app
      const handle = tabRefs.current.get(activeTabId);
      handle?.restart(settings, name);
    },
    [activeApp, settings, updateSettings, activeTabId],
  );

  const pendingTabMessages = useRef<Map<string, string>>(new Map());

  const dismissPopovers = useCallback(() => {
    setShowSettings(false);
  }, []);

  // Listen for builder.submitChat at App level — route to active tab or create new tab
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from the iframe (same origin)
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "builder.submitChat") return;
      const message = event.data.data?.message as string;
      if (!message) return;

      const currentTabId = activeTabIdRef.current;

      if (isAgentUi) {
        // Agent-UI mode: route through AssistantChat refs
        const chatRef = chatRefs.current.get(currentTabId);
        const running = chatRef?.isRunning() ?? false;
        if (!running && chatRef) {
          chatRef.sendMessage(message);
        } else {
          const tab = createTab();
          pendingTabMessages.current.set(tab.id, message);
          setTabs((prev) => [...prev, tab]);
          setActiveTabId(tab.id);
        }
      } else {
        // Terminal mode: route through TerminalTab refs
        const activeHandle = tabRefs.current.get(currentTabId);
        const isRunning = activeHandle?.isAgentRunning() ?? false;
        if (!isRunning && activeHandle?.getConnected()) {
          activeHandle.sendChatMessage(message);
        } else {
          const tab = createTab();
          pendingTabMessages.current.set(tab.id, message);
          setTabs((prev) => [...prev, tab]);
          setActiveTabId(tab.id);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isAgentUi]); // stable — uses refs instead of state

  // Agent-UI: listen for chatRunning completion events to mark tabs completed
  useEffect(() => {
    if (!isAgentUi) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      // Match tabId to our tab ids
      const { isRunning, tabId } = detail;
      if (!tabId) return;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          if (isRunning === false) return { ...t, completed: true };
          if (isRunning === true) return { ...t, completed: false };
          return t;
        }),
      );
    };
    window.addEventListener("builder.fusion.chatRunning", handler);
    return () =>
      window.removeEventListener("builder.fusion.chatRunning", handler);
  }, [isAgentUi]);

  // Process pending messages for agent-ui tabs when refs mount
  useEffect(() => {
    if (!isAgentUi) return;
    for (const [tabId, message] of pendingTabMessages.current) {
      const ref = chatRefs.current.get(tabId);
      if (ref) {
        pendingTabMessages.current.delete(tabId);
        setTimeout(() => ref.sendMessage(message), 50);
      }
    }
  }, [tabs, isAgentUi]);

  // Tab actions
  const addTab = useCallback(() => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev; // Can't close last tab
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        // If closing the active tab, switch to adjacent
        if (tabId === activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
        }
        return next;
      });
      tabRefs.current.delete(tabId);
    },
    [activeTabId],
  );

  const fit = useCallback(() => {
    const handle = tabRefs.current.get(activeTabId);
    handle?.fit();
  }, [activeTabId]);

  // Re-fit terminal when sidebar is expanded (xterm needs correct dimensions)
  useEffect(() => {
    if (!isFullscreen) {
      requestAnimationFrame(() => fit());
    }
  }, [isFullscreen, fit]);

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
  }, []);

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
  }, [fit, termWidth]);

  useEffect(() => {
    const handler = () => {
      setIsMobile(window.innerWidth < 768);
      fit();
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [fit]);

  const showPopoverBackdrop = showSettings;
  const showTabs = tabs.length > 1;

  // Terminal header
  const terminalHeader = (
    <div className="flex items-center gap-1.5 px-3 h-10 shrink-0 min-w-0">
      <span className="text-[13px] font-medium text-white/90 shrink-0">
        {activeApp.charAt(0).toUpperCase() + activeApp.slice(1)}
      </span>

      {/* Tabs — shown when there are 2+ tabs */}
      {showTabs && (
        <div className="flex items-center gap-0.5 ml-1.5 min-w-0 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group/tab flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors shrink-0 ${
                tab.id === activeTabId
                  ? "bg-white/10 text-white/90"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              <span>{tab.label}</span>
              {tab.completed && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              )}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={`rounded p-px transition-colors ${
                  tab.id === activeTabId
                    ? "text-white/30 hover:text-white/70 hover:bg-white/10"
                    : "text-transparent group-hover/tab:text-white/30 hover:!text-white/70 hover:!bg-white/10"
                }`}
              >
                <IconX size={10} stroke={2} />
              </span>
            </button>
          ))}
        </div>
      )}

      <span className="flex-1 min-w-0" />

      <a
        href="https://docs.google.com/forms/d/e/1FAIpQLSfI7sc2egh0vLBgzOy5tEEZF0e4PdXsQRNsZhX_yR2vx0m8ig/viewform?usp=publish-editor"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-white/50 hover:text-white/80 transition-colors leading-none shrink-0"
      >
        feedback
      </a>

      <Tooltip label="New tab">
        <button
          onClick={addTab}
          className="p-1 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors shrink-0"
        >
          <IconPlus size={14} stroke={1.5} />
        </button>
      </Tooltip>

      <div className="relative shrink-0">
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
            onRestart={() => {
              const handle = tabRefs.current.get(activeTabId);
              handle?.restart(settings, activeApp);
            }}
            appUrl={appUrl}
            iframeRef={iframeRef}
            connected={activeConnected}
            apps={APP_CONFIG}
            activeApp={activeApp}
            onSwitchApp={switchApp}
            harnesses={configs}
            onSwitchHarness={switchHarness}
          />
        )}
      </div>
    </div>
  );

  // Setup overlay — for active tab
  const setupOverlay = (activeSetupStatus.status === "installing" ||
    activeSetupStatus.status === "not-found" ||
    activeSetupStatus.status === "failed") && (
    <div className="absolute inset-0 bg-black/95 flex items-center justify-center z-10">
      <div className="text-center max-w-sm px-6">
        {activeSetupStatus.status === "installing" ? (
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
              {activeSetupStatus.message}
            </p>
            <p className="text-xs text-white/40 leading-relaxed">
              Install manually:
            </p>
            <code className="block bg-white/10 px-3 py-2 rounded text-[11px] text-white/70 mt-2">
              npx --yes {config.installPackage}
            </code>
            <button
              onClick={() => {
                const handle = tabRefs.current.get(activeTabId);
                handle?.restart(settings, activeApp);
              }}
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
      className={`h-screen bg-[#111] ${isMobile ? "flex flex-col" : "flex"}`}
    >
      {/* Backdrop — dismisses popovers when clicking anywhere, including over iframe */}
      {showPopoverBackdrop && (
        <div className="fixed inset-0 z-40" onClick={dismissPopovers} />
      )}

      {/* Terminal pane — hidden when fullscreen but kept mounted to preserve state */}
      <div
        className={
          isFullscreen && !isMobile
            ? "hidden"
            : isMobile
              ? `flex flex-col ${mobileTab === "agent" ? "flex-1 min-h-0" : "absolute inset-0 invisible"}`
              : "flex flex-col min-h-0 border-r border-white/[0.06]"
        }
        style={
          isMobile || (isFullscreen && !isMobile)
            ? undefined
            : { width: termWidth ?? "36%", flexShrink: 0 }
        }
      >
        {terminalHeader}

        {/* Terminal tabs or Chat view */}
        <div className="flex-1 min-h-0 relative">
          {!isAgentUi ? (
            <>
              {tabs.map((tab) => (
                <TerminalTab
                  key={tab.id}
                  ref={(handle) => {
                    if (handle) {
                      tabRefs.current.set(tab.id, handle);
                    } else {
                      tabRefs.current.delete(tab.id);
                    }
                  }}
                  active={tab.id === activeTabId}
                  config={config}
                  settings={settings}
                  appName={activeApp}
                  iframeRef={iframeRef}
                  onConnectedChange={(connected) => {
                    if (tab.id === activeTabId) setActiveConnected(connected);
                    // Process pending messages when a new tab connects
                    if (connected) {
                      const pending = pendingTabMessages.current.get(tab.id);
                      if (pending) {
                        pendingTabMessages.current.delete(tab.id);
                        // Small delay to let the PTY initialise
                        setTimeout(() => {
                          tabRefs.current.get(tab.id)?.sendChatMessage(pending);
                        }, 300);
                      }
                    }
                  }}
                  onSetupStatusChange={
                    tab.id === activeTabId ? setActiveSetupStatus : undefined
                  }
                  onAgentRunningChange={(running) => {
                    if (!running) {
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.id === tab.id ? { ...t, completed: true } : t,
                        ),
                      );
                    } else {
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.id === tab.id ? { ...t, completed: false } : t,
                        ),
                      );
                    }
                  }}
                />
              ))}
              {setupOverlay}
            </>
          ) : (
            <>
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="absolute inset-0 flex flex-col"
                  style={{
                    display: tab.id === activeTabId ? "flex" : "none",
                  }}
                >
                  <AssistantChat
                    ref={(handle) => {
                      if (handle) {
                        chatRefs.current.set(tab.id, handle);
                      } else {
                        chatRefs.current.delete(tab.id);
                      }
                    }}
                    tabId={tab.id}
                    showHeader={false}
                    emptyStateText="Chat with the agent"
                  />
                </div>
              ))}
            </>
          )}
        </div>

        {/* Sidebar collapse button */}
        {!isMobile && (
          <div className="shrink-0 px-3 py-2">
            <Tooltip label="Collapse sidebar">
              <button
                onClick={() => setIsFullscreen(true)}
                className="p-1.5 rounded text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
              >
                <IconLayoutSidebarLeftCollapse size={18} stroke={1.5} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Drag handle — desktop only */}
      {!isMobile && !isFullscreen && (
        <div
          onMouseDown={onMouseDown}
          className="w-1 cursor-col-resize flex items-center justify-center hover:bg-blue-500/30 transition-colors"
        >
          <div className="w-px h-8 bg-white/10 rounded-full" />
        </div>
      )}

      {/* Preview pane — goes fullscreen (fixed inset-0) or inline */}
      <div
        className={
          isFullscreen && !isMobile
            ? "fixed inset-0 z-50 bg-[#111] flex flex-col"
            : isMobile
              ? `flex flex-col ${mobileTab === "interact" ? "flex-1 min-h-0" : "absolute inset-0 invisible"}`
              : "flex-1 flex flex-col min-h-0"
        }
      >
        <div className="flex-1 overflow-hidden bg-[#111]">
          <iframe
            ref={iframeRef}
            src={appUrl}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation allow-downloads"
            allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; geolocation; display-capture"
            onLoad={() => {
              iframeRef.current?.contentWindow?.postMessage(
                {
                  type: "builder.harnessOrigin",
                  origin: window.location.origin,
                },
                "*",
              );
            }}
          />
        </div>

        {/* Floating expand-sidebar button — bottom left, fullscreen only */}
        {isFullscreen && !isMobile && (
          <button
            onClick={() => setIsFullscreen(false)}
            className="fixed bottom-4 left-4 z-[51] p-2 rounded-lg bg-black/70 backdrop-blur-sm border border-white/10 text-white/40 hover:text-white hover:bg-black/90 transition-all shadow-lg"
          >
            <IconLayoutSidebarLeftExpand size={18} stroke={1.5} />
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
