/**
 * AgentPanel — unified agent component with chat, CLI, and workspace modes.
 *
 * A self-contained panel with no layout opinions — drop it into a sidebar,
 * popover, dialog, full page, or any container. It fills its parent via
 * flex and min-h-0.
 *
 * Features:
 * - Chat mode: assistant-ui powered chat with tool calls
 * - CLI mode: embedded xterm.js terminal (dev mode only)
 * - Toggle between modes via header buttons
 *
 * Usage:
 *   // In a sidebar
 *   <div style={{ width: 380 }}><AgentPanel /></div>
 *
 *   // In a popover
 *   <Popover><AgentPanel suggestions={[...]} /></Popover>
 *
 *   // Full page
 *   <AgentPanel className="h-screen" />
 */

import ReactDOM from "react-dom";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
  startTransition,
} from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";
import {
  IconMessage,
  IconTerminal2,
  IconSettings,
  IconLayoutSidebarRightCollapse,
  IconLayoutGrid,
  IconCheck,
  IconPlus,
  IconFolder,
  IconX,
  IconClockHour3,
  IconDotsVertical,
  IconHistory,
  IconTrash,
  IconArrowsMaximize,
  IconArrowsMinimize,
} from "@tabler/icons-react";
import { FeedbackButton } from "./FeedbackButton.js";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
import type { AssistantChatProps } from "./AssistantChat.js";
import { useDevMode } from "./use-dev-mode.js";
import { useScreenRefreshKey } from "./use-db-sync.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { cn } from "./utils.js";
import { agentNativePath } from "./api-path.js";
import { getFrameOrigin, isTrustedFrameMessage } from "./frame.js";

// Lazy-load AgentTerminal to avoid bundling xterm.js when not needed
const AgentTerminal = lazy(() =>
  import("./terminal/index.js").then((m) => ({ default: m.AgentTerminal })),
);

function parentFrameTargetOrigin(): string {
  return getFrameOrigin() ?? window.location.origin;
}

// Lazy-load ResourcesPanel to avoid bundling when not needed
const ResourcesPanel = lazy(() =>
  import("./resources/ResourcesPanel.js").then((m) => ({
    default: m.ResourcesPanel,
  })),
);

// Lazy-load SettingsPanel to avoid bundling when not needed
const SettingsPanel = lazy(() =>
  import("./settings/index.js").then((m) => ({
    default: m.SettingsPanel,
  })),
);

// Lazy-load OnboardingPanel — only pulled in when onboarding is active.
const OnboardingPanel = lazy(() =>
  import("./onboarding/OnboardingPanel.js").then((m) => ({
    default: m.OnboardingPanel,
  })),
);

// Lazy-load SetupButton — the header entry-point that re-opens the
// onboarding panel after the user has dismissed it.
const SetupButton = lazy(() =>
  import("./onboarding/SetupButton.js").then((m) => ({
    default: m.SetupButton,
  })),
);

// Setup/onboarding widget is hidden until the UX is improved.
// Flip to `true` to restore the SetupButton in the header and the
// OnboardingPanel above the chat.
const SHOW_ONBOARDING = false;

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "claude";
const EXEC_MODE_KEY = "agent-native-exec-mode";
type ExecMode = "build" | "plan";
type PanelMode = "chat" | "cli" | "resources" | "settings";
const AGENT_PANEL_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const AGENT_PANEL_ROOT_STYLE = {
  fontFamily: AGENT_PANEL_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
} satisfies React.CSSProperties;
const AGENT_PANEL_HEADER_CLASS =
  "relative z-[240] flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border";
const AGENT_PANEL_HEADER_STYLE = {
  paddingLeft: 8,
  paddingRight: 8,
} satisfies React.CSSProperties;
const AGENT_PANEL_CONTROL_STYLE = {
  fontSize: 12,
  lineHeight: 1,
} satisfies React.CSSProperties;
const ACTIVATE_KEYS = new Set(["Enter", " "]);

interface AvailableCli {
  command: string;
  label: string;
  available: boolean;
}

function useAvailableClis() {
  const [clis, setClis] = useState<AvailableCli[]>([]);
  useEffect(() => {
    // Try to fetch available CLIs — endpoint is provided by the terminal plugin.
    // Returns 404 gracefully when the plugin isn't loaded.
    fetch(agentNativePath("/_agent-native/available-clis"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClis(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);
  return clis;
}

function useCliSelection(keyPrefix: string) {
  const cliKey = `${CLI_STORAGE_KEY}${keyPrefix}`;
  const [selected, setSelected] = useState(CLI_DEFAULT);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(cliKey);
      if (saved) setSelected(saved);
    } catch {}
  }, [cliKey]);
  const select = (cmd: string) => {
    setSelected(cmd);
    try {
      localStorage.setItem(cliKey, cmd);
    } catch {}
  };
  return [selected, select] as const;
}

// Detect dev mode at build time (Vite replaces this)
const IS_DEV: boolean = import.meta.env?.DEV === true;

// ─── Settings panel components moved to ./settings/ ────────────────────────

function IconTooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="bottom"
            sideOffset={8}
            className="z-[230] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-md"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-popover" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// AgentSettingsPopover and AgentsSection moved to ./settings/

// ─── AgentPanel ─────────────────────────────────────────────────────────────

export interface AgentPanelProps extends Omit<
  AssistantChatProps,
  "onSwitchToCli"
> {
  /** Initial mode. Default: "chat" */
  defaultMode?: "chat" | "cli";
  /** CSS class for the outer container */
  className?: string;
  /** Called when the user clicks the collapse button. If provided, a collapse button appears in the header. */
  onCollapse?: () => void;
  /** Whether the panel is currently in fullscreen (Claude-style centered) mode. */
  isFullscreen?: boolean;
  /** Called when the user clicks the maximize/minimize button. If provided, the button appears next to the collapse button. */
  onToggleFullscreen?: () => void;
  /** URL of the app being developed (shown as "Open app in new tab" in settings). Set by frame. */
  devAppUrl?: string;
  /** Namespace for localStorage keys — used to isolate chat state per app in the frame. */
  storageKey?: string;
  /** Optional notice rendered below the main header while Chat mode is active. */
  chatNotice?: React.ReactNode;
}

function useClientOnly() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function AgentPanelInner({
  defaultMode = "chat",
  className,
  apiUrl,
  emptyStateText,
  suggestions,
  showHeader = true,
  onCollapse,
  isFullscreen,
  onToggleFullscreen,
  devAppUrl,
  storageKey,
  chatNotice,
}: AgentPanelProps) {
  const mounted = useClientOnly();
  const keyPrefix = storageKey ? `:${storageKey}` : "";
  const execModeKey = `${EXEC_MODE_KEY}${keyPrefix}`;
  const panelModeKey = `agent-native-panel-mode${keyPrefix}`;
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad/.test(navigator.userAgent),
    [],
  );
  const closeTabHint = isMac ? "\u2303W" : "Alt+W";
  const closeAllTabsHint = isMac ? "\u2303\u2325W" : "Ctrl+Alt+W";

  const [execMode, setExecMode] = useState<ExecMode>(() => {
    try {
      const saved = localStorage.getItem(execModeKey);
      if (saved === "build" || saved === "plan") return saved;
    } catch {}
    return "build";
  });

  const switchExecMode = useCallback(
    (next: ExecMode) => {
      setExecMode(next);
      try {
        localStorage.setItem(execModeKey, next);
      } catch {}
      window.dispatchEvent(
        new CustomEvent("agent-panel:exec-mode-change", {
          detail: { mode: next },
        }),
      );
    },
    [execModeKey],
  );

  const [mode, setMode] = useState<PanelMode>(() => {
    try {
      const saved = localStorage.getItem(panelModeKey);
      if (
        saved === "chat" ||
        saved === "cli" ||
        saved === "resources" ||
        saved === "settings"
      )
        return saved;
    } catch {}
    return defaultMode;
  });
  useEffect(() => {
    try {
      localStorage.setItem(panelModeKey, mode);
    } catch {}
  }, [mode, panelModeKey]);
  const switchMode = useCallback((m: PanelMode) => {
    startTransition(() => setMode(m));
  }, []);
  const activateOnKeyDown = useCallback(
    (activate: () => void) => (event: React.KeyboardEvent) => {
      if (!ACTIVATE_KEYS.has(event.key)) return;
      event.preventDefault();
      activate();
    },
    [],
  );

  // Listen for mode changes from the frame parent (via AgentSidebar)
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode) switchMode(detail.mode);
    }
    window.addEventListener("agent-panel:set-mode", handler);
    return () => window.removeEventListener("agent-panel:set-mode", handler);
  }, [switchMode]);

  // Open settings tab when requested (replaces the old popover open event)
  useEffect(() => {
    function handleOpenSettings() {
      switchMode("settings");
    }
    window.addEventListener("agent-panel:open-settings", handleOpenSettings);
    return () =>
      window.removeEventListener(
        "agent-panel:open-settings",
        handleOpenSettings,
      );
  }, [switchMode]);

  // CLI terminal tabs (ephemeral — not persisted to SQL)
  const [cliTabs, setCliTabs] = useState<string[]>(["cli-1"]);
  const [activeCliTab, setActiveCliTab] = useState("cli-1");
  const cliCounter = useRef(1);

  const addCliTab = useCallback(() => {
    const id = `cli-${++cliCounter.current}`;
    setCliTabs((prev) => [...prev, id]);
    setActiveCliTab(id);
  }, []);

  const closeCliTab = useCallback(
    (id: string) => {
      setCliTabs((prev) => {
        if (prev.length <= 1) {
          // Last tab — replace with a new one (acts as "clear")
          const newId = `cli-${++cliCounter.current}`;
          setActiveCliTab(newId);
          return [newId];
        }
        const next = prev.filter((t) => t !== id);
        if (id === activeCliTab) {
          const idx = prev.indexOf(id);
          setActiveCliTab(next[Math.min(idx, next.length - 1)]);
        }
        return next;
      });
    },
    [activeCliTab],
  );

  const closeOtherCliTabs = useCallback((id: string) => {
    setCliTabs([id]);
    setActiveCliTab(id);
  }, []);

  const closeAllCliTabs = useCallback(() => {
    const id = `cli-${++cliCounter.current}`;
    setCliTabs([id]);
    setActiveCliTab(id);
  }, []);

  // Tab close shortcuts. Avoid Cmd+W (browser/OS) and (on Windows) Ctrl+W.
  //   Mac:           Ctrl+W → close tab,  Ctrl+Alt+W → close all
  //   Windows/Linux: Alt+W  → close tab,  Ctrl+Alt+W → close all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "w" || e.metaKey || e.shiftKey) return;
      const isCloseAll = e.ctrlKey && e.altKey;
      const isCloseOne = isMac
        ? e.ctrlKey && !e.altKey
        : e.altKey && !e.ctrlKey;
      if (!isCloseAll && !isCloseOne) return;
      e.preventDefault();
      if (mode === "chat") {
        window.dispatchEvent(
          new CustomEvent(
            isCloseAll
              ? "agent-chat:close-all-tabs"
              : "agent-chat:close-current-tab",
          ),
        );
      } else if (mode === "cli") {
        if (isCloseAll) closeAllCliTabs();
        else if (activeCliTab) closeCliTab(activeCliTab);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mode, activeCliTab, closeCliTab, closeAllCliTabs, isMac]);

  const availableClis = useAvailableClis();
  const [selectedCli, selectCli] = useCliSelection(keyPrefix);
  const selectedLabel =
    availableClis.find((c) => c.command === selectedCli)?.label || selectedCli;
  const { isDevMode, canToggle, setDevMode } = useDevMode(apiUrl);

  // Notify frame when dev mode changes — use both a local CustomEvent (for
  // when AgentPanel is rendered directly in the frame) AND postMessage (for
  // when AgentPanel is inside the iframe and needs to cross the boundary).
  const prevIsDevMode = useRef(isDevMode);
  useEffect(() => {
    if (prevIsDevMode.current !== isDevMode) {
      prevIsDevMode.current = isDevMode;
      window.dispatchEvent(
        new CustomEvent("agent-panel:dev-mode-change", {
          detail: { isDevMode },
        }),
      );
      // Cross iframe boundary to the frame parent
      if (window.parent !== window) {
        window.parent.postMessage(
          { type: "agentNative.devModeChange", data: { isDevMode } },
          parentFrameTargetOrigin(),
        );
      }
    }
  }, [isDevMode]);

  const isLocalhost =
    mounted &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1");
  const showDevToggle = canToggle && isLocalhost;

  const renderModeButtons = useCallback(
    (activeMode: PanelMode) => (
      <TooltipProvider delayDuration={200}>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => switchMode("chat")}
                aria-label="Chat mode"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
                  activeMode === "chat"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={AGENT_PANEL_CONTROL_STYLE}
              >
                <IconMessage size={14} />
                Chat
              </button>
            </TooltipTrigger>
            <TooltipContent>Chat mode</TooltipContent>
          </Tooltip>
          {isDevMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => switchMode("cli")}
                  aria-label="CLI terminal mode"
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
                    activeMode === "cli"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                  style={AGENT_PANEL_CONTROL_STYLE}
                >
                  <IconTerminal2 size={14} />
                  CLI
                </button>
              </TooltipTrigger>
              <TooltipContent>CLI terminal mode</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => switchMode("resources")}
                aria-label="Workspace files, agents, skills, and tasks"
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
                  activeMode === "resources"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={AGENT_PANEL_CONTROL_STYLE}
              >
                <IconLayoutGrid size={14} />
                Workspace
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Workspace files, agents, skills, and tasks
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => switchMode("settings")}
                aria-label="Setup and configuration"
                className={cn(
                  "flex items-center justify-center rounded-md px-1.5 py-1",
                  activeMode === "settings"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <IconSettings size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Setup and configuration</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    ),
    [isDevMode],
  );

  const renderHeaderActions = useCallback(
    () => (
      <div className="flex shrink-0 items-center gap-1.5">
        {SHOW_ONBOARDING && isDevMode && (
          <Suspense fallback={null}>
            <SetupButton />
          </Suspense>
        )}
        <FeedbackButton variant="icon" side="bottom" align="end" />
        {onToggleFullscreen && (
          <IconTooltip
            content={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            <button
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              {isFullscreen ? (
                <IconArrowsMinimize size={14} />
              ) : (
                <IconArrowsMaximize size={14} />
              )}
            </button>
          </IconTooltip>
        )}
        {onCollapse && (
          <IconTooltip content="Collapse sidebar">
            <button
              onClick={onCollapse}
              aria-label="Collapse sidebar"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconLayoutSidebarRightCollapse size={14} />
            </button>
          </IconTooltip>
        )}
      </div>
    ),
    [onCollapse, isDevMode, onToggleFullscreen, isFullscreen],
  );

  const [tabMenuOpen, setTabMenuOpen] = useState<string | null>(null);
  const [cliPickerOpen, setCliPickerOpen] = useState(false);
  const cliPickerBtnRef = useRef<HTMLButtonElement>(null);

  // Ref callback: scroll the active tab into view in the overflow container.
  // Uses getBoundingClientRect for reliable positioning regardless of offsetParent.
  const activeTabRefCb = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    // Use rAF so layout is settled after React commit
    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const tabRect = el.getBoundingClientRect();
      if (tabRect.left < containerRect.left) {
        container.scrollLeft += tabRect.left - containerRect.left;
      } else if (tabRect.right > containerRect.right) {
        container.scrollLeft += tabRect.right - containerRect.right;
      }
    });
  }, []);

  const renderChatHeader = useCallback(
    ({
      tabs,
      activeTabId,
      setActiveTabId,
      addTab,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      showHistory,
      toggleHistory,
    }: MultiTabAssistantChatHeaderProps) => (
      <div className="flex flex-col shrink-0">
        {/* Top bar: mode buttons + actions */}
        <div
          className={AGENT_PANEL_HEADER_CLASS}
          style={AGENT_PANEL_HEADER_STYLE}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {renderModeButtons(mode)}
          </div>
          <div className="flex items-center gap-0.5">
            {renderHeaderActions()}
          </div>
        </div>
        {mode === "chat" && chatNotice ? (
          <div className="border-b border-border">{chatNotice}</div>
        ) : null}
        {/* Tab bar: always visible for chat and CLI */}
        {(mode === "chat" || mode === "cli") &&
          (() => {
            // Compute parent/child tab groups for the sub-tab bar
            const activeTab = tabs.find((t) => t.id === activeTabId);
            // The "focus parent" is the parent thread for the active context
            const focusParentId = activeTab?.parentThreadId || activeTabId;
            const childTabs = tabs.filter(
              (t) => t.parentThreadId === focusParentId,
            );
            const hasSubTabs = childTabs.length > 0;
            // Main row: only show top-level (non-child) tabs
            const mainTabs = tabs.filter((t) => !t.parentThreadId);

            return (
              <>
                <div className="flex items-center px-2 py-1 border-b border-border gap-0.5">
                  <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none flex-1">
                    {mode === "chat"
                      ? mainTabs.map((tab) => {
                          // Highlight the parent tab if a child is active
                          const isActive =
                            tab.id === activeTabId ||
                            (tab.id === focusParentId &&
                              activeTab?.parentThreadId === tab.id);
                          return (
                            <div
                              key={tab.id}
                              role="button"
                              tabIndex={0}
                              ref={isActive ? activeTabRefCb : undefined}
                              onClick={() => setActiveTabId(tab.id)}
                              onKeyDown={activateOnKeyDown(() =>
                                setActiveTabId(tab.id),
                              )}
                              className={cn(
                                "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer max-w-[150px]",
                                isActive
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              <span className="truncate pr-1">{tab.label}</span>
                              {tab.status === "running" && (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                              )}
                              <button
                                type="button"
                                aria-label="Close tab"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeTab(tab.id);
                                }}
                                className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: 28,
                                  paddingRight: 6,
                                  borderRadius: "0 6px 6px 0",
                                  background:
                                    "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                                }}
                              >
                                <IconX size={10} />
                              </button>
                            </div>
                          );
                        })
                      : cliTabs.map((id, i) => (
                          <div
                            key={id}
                            role="button"
                            tabIndex={0}
                            ref={
                              id === activeCliTab ? activeTabRefCb : undefined
                            }
                            onClick={() => setActiveCliTab(id)}
                            onKeyDown={activateOnKeyDown(() =>
                              setActiveCliTab(id),
                            )}
                            className={cn(
                              "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer",
                              id === activeCliTab
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            <span>Terminal {i + 1}</span>
                            <button
                              type="button"
                              aria-label="Close tab"
                              onClick={(e) => {
                                e.stopPropagation();
                                closeCliTab(id);
                              }}
                              className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: 28,
                                paddingRight: 6,
                                borderRadius: "0 6px 6px 0",
                                background:
                                  "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                              }}
                            >
                              <IconX size={10} />
                            </button>
                          </div>
                        ))}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                    {mode === "chat" && (
                      <>
                        <IconTooltip content="New chat">
                          <button
                            onClick={addTab}
                            aria-label="New chat"
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                          >
                            <IconPlus size={14} />
                          </button>
                        </IconTooltip>
                        {toggleHistory && (
                          <IconTooltip content="Chat history">
                            <button
                              onClick={toggleHistory}
                              aria-label="Chat history"
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                                showHistory && "bg-accent text-foreground",
                              )}
                            >
                              <IconHistory size={14} />
                            </button>
                          </IconTooltip>
                        )}
                        <div className="relative">
                          <IconTooltip content="Tab options">
                            <button
                              onClick={() =>
                                setTabMenuOpen(
                                  tabMenuOpen === "__chat_global"
                                    ? null
                                    : "__chat_global",
                                )
                              }
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                                tabMenuOpen === "__chat_global" &&
                                  "bg-accent text-foreground",
                              )}
                              aria-label="Chat tab options"
                            >
                              <IconDotsVertical size={14} />
                            </button>
                          </IconTooltip>
                          {tabMenuOpen === "__chat_global" && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setTabMenuOpen(null)}
                              />
                              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-border bg-popover py-1 shadow-lg">
                                <button
                                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                  onClick={() => {
                                    closeTab(activeTabId);
                                    setTabMenuOpen(null);
                                  }}
                                >
                                  Close Tab
                                  <kbd className="text-[10px] text-muted-foreground">
                                    {closeTabHint}
                                  </kbd>
                                </button>
                                <button
                                  className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                  onClick={() => {
                                    closeOtherTabs(activeTabId);
                                    setTabMenuOpen(null);
                                  }}
                                >
                                  Close Other Tabs
                                </button>
                                <button
                                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                  onClick={() => {
                                    closeAllTabs();
                                    setTabMenuOpen(null);
                                  }}
                                >
                                  Close All Tabs
                                  <kbd className="text-[10px] text-muted-foreground">
                                    {closeAllTabsHint}
                                  </kbd>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                    {mode === "cli" && (
                      <>
                        <IconTooltip content="New terminal">
                          <button
                            onClick={addCliTab}
                            aria-label="New terminal"
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                          >
                            <IconPlus size={14} />
                          </button>
                        </IconTooltip>
                        {availableClis.length > 0 && (
                          <div className="relative">
                            <IconTooltip content={`CLI: ${selectedLabel}`}>
                              <button
                                ref={cliPickerBtnRef}
                                onClick={() => setCliPickerOpen(!cliPickerOpen)}
                                aria-label={`Select CLI, currently ${selectedLabel}`}
                                className={cn(
                                  "flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                                  cliPickerOpen && "bg-accent text-foreground",
                                )}
                              >
                                <IconSettings size={14} />
                              </button>
                            </IconTooltip>
                            {cliPickerOpen &&
                              ReactDOM.createPortal(
                                <>
                                  <div
                                    className="fixed inset-0 z-[9980]"
                                    onClick={() => setCliPickerOpen(false)}
                                  />
                                  <div
                                    className="fixed z-[9990] w-48 rounded-md border border-border bg-popover py-1 shadow-lg"
                                    style={(() => {
                                      const r =
                                        cliPickerBtnRef.current?.getBoundingClientRect();
                                      if (!r) return { top: 0, right: 0 };
                                      return {
                                        top: r.bottom + 4,
                                        right: window.innerWidth - r.right,
                                      };
                                    })()}
                                  >
                                    {availableClis.map((cli) => (
                                      <button
                                        key={cli.command}
                                        className={cn(
                                          "flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent",
                                          cli.command === selectedCli
                                            ? "text-foreground font-medium"
                                            : "text-muted-foreground",
                                        )}
                                        onClick={() => {
                                          selectCli(cli.command);
                                          setCliPickerOpen(false);
                                        }}
                                      >
                                        {cli.command === selectedCli && (
                                          <IconCheck
                                            size={12}
                                            className="shrink-0"
                                          />
                                        )}
                                        <span
                                          className={
                                            cli.command !== selectedCli
                                              ? "ml-5"
                                              : ""
                                          }
                                        >
                                          {cli.label}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </>,
                                document.body,
                              )}
                          </div>
                        )}
                        <div className="relative">
                          <IconTooltip content="Tab options">
                            <button
                              onClick={() =>
                                setTabMenuOpen(
                                  tabMenuOpen === "__cli_global"
                                    ? null
                                    : "__cli_global",
                                )
                              }
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                                tabMenuOpen === "__cli_global" &&
                                  "bg-accent text-foreground",
                              )}
                              aria-label="Terminal tab options"
                            >
                              <IconDotsVertical size={14} />
                            </button>
                          </IconTooltip>
                          {tabMenuOpen === "__cli_global" && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setTabMenuOpen(null)}
                              />
                              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-border bg-popover py-1 shadow-lg">
                                <button
                                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                  onClick={() => {
                                    closeCliTab(activeCliTab);
                                    setTabMenuOpen(null);
                                  }}
                                >
                                  Close Tab
                                  <kbd className="text-[10px] text-muted-foreground">
                                    {closeTabHint}
                                  </kbd>
                                </button>
                                <button
                                  className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                  onClick={() => {
                                    closeOtherCliTabs(activeCliTab);
                                    setTabMenuOpen(null);
                                  }}
                                >
                                  Close Other Tabs
                                </button>
                                <button
                                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                                  onClick={() => {
                                    closeAllCliTabs();
                                    setTabMenuOpen(null);
                                  }}
                                >
                                  Close All Tabs
                                  <kbd className="text-[10px] text-muted-foreground">
                                    {closeAllTabsHint}
                                  </kbd>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {/* Sub-agent tab row — shown when the active context has children */}
                {mode === "chat" && hasSubTabs && (
                  <div className="flex items-center px-2 py-0.5 border-b border-border gap-0.5 bg-muted/30">
                    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none flex-1">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveTabId(focusParentId)}
                        onKeyDown={activateOnKeyDown(() =>
                          setActiveTabId(focusParentId),
                        )}
                        className={cn(
                          "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium cursor-pointer",
                          activeTabId === focusParentId
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        Main
                      </div>
                      {childTabs.map((tab) => (
                        <div
                          key={tab.id}
                          role="button"
                          tabIndex={0}
                          ref={
                            tab.id === activeTabId ? activeTabRefCb : undefined
                          }
                          onClick={() => setActiveTabId(tab.id)}
                          onKeyDown={activateOnKeyDown(() =>
                            setActiveTabId(tab.id),
                          )}
                          className={cn(
                            "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium cursor-pointer max-w-[140px]",
                            tab.id === activeTabId
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <span className="truncate pr-1">
                            {tab.subAgentName || tab.label}
                          </span>
                          {tab.status === "running" && (
                            <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                          )}
                          <button
                            type="button"
                            aria-label="Close tab"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(tab.id);
                            }}
                            className="agent-tab-close flex items-center justify-end text-muted-foreground hover:text-foreground"
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: 24,
                              paddingRight: 4,
                              borderRadius: "0 6px 6px 0",
                              background:
                                "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                            }}
                          >
                            <IconX size={8} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
      </div>
    ),
    [
      mode,
      renderHeaderActions,
      renderModeButtons,
      chatNotice,
      cliTabs,
      activeCliTab,
      addCliTab,
      closeCliTab,
      closeOtherCliTabs,
      closeAllCliTabs,
      tabMenuOpen,
      availableClis,
      selectedCli,
      selectedLabel,
      selectCli,
      cliPickerOpen,
      closeTabHint,
      closeAllTabsHint,
    ],
  );

  return (
    <div
      className={cn(
        "agent-panel-root flex flex-1 flex-col min-h-0 h-full text-[13px] leading-[1.2] antialiased",
        className,
      )}
      style={AGENT_PANEL_ROOT_STYLE}
      data-agent-fullscreen={isFullscreen ? "true" : undefined}
    >
      {/* Tailwind group-hover/tab doesn't work in core package — inject directly.
          Fullscreen rules center the message stream and composer to a Claude-style
          column while leaving the header bar at full width so the action buttons
          stay pinned to the top corners. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".agent-tab-close{opacity:0}.agent-tab:hover .agent-tab-close{opacity:1}" +
            `[data-agent-fullscreen='true'] .agent-thread-content,` +
            `[data-agent-fullscreen='true'] .agent-composer-area{` +
            `max-width:${FULLSCREEN_CONTENT_MAX_PX}px;` +
            `margin-left:auto;margin-right:auto;width:100%;}`,
        }}
      />
      {/* Framework onboarding — appears above the chat/cli/settings tabs
          so it's visible regardless of which tab the user is on. The panel
          hides itself once all required steps are done or the user
          dismisses it. Gated by SHOW_ONBOARDING until the UX is improved. */}
      {SHOW_ONBOARDING && mounted && isDevMode && (
        <Suspense fallback={null}>
          <OnboardingPanel />
        </Suspense>
      )}

      {/* Chat view — always mounted to preserve state.
          Header (with tabs + mode buttons) is always visible.
          Chat content is hidden when CLI or resources mode is active.
          The wrapper collapses (no flex-1) when another mode is active
          so it only takes the height of its header. */}
      <div
        className={cn(
          "flex flex-col min-h-0",
          mode === "chat" ? "flex-1" : "shrink-0",
        )}
      >
        {mounted && (
          <MultiTabAssistantChat
            apiUrl={apiUrl}
            showHeader={false}
            renderHeader={showHeader ? renderChatHeader : undefined}
            renderOverlay={undefined}
            contentHidden={mode !== "chat"}
            emptyStateText={emptyStateText}
            suggestions={suggestions}
            onSwitchToCli={() => switchMode("cli")}
            execMode={isDevMode ? execMode : undefined}
            onExecModeChange={isDevMode ? switchExecMode : undefined}
            storageKey={storageKey}
          />
        )}
      </div>

      {/* CLI terminals — dev mode: real terminal, prod mode: prompt to use dev */}
      {isDevMode
        ? mode === "cli" &&
          cliTabs.map((id) => (
            <div
              key={id}
              className="min-h-0 relative flex-1"
              style={{
                display: id === activeCliTab ? undefined : "none",
              }}
            >
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Loading terminal...
                  </div>
                }
              >
                <AgentTerminal
                  command={selectedCli}
                  hideInFrame={false}
                  className="h-full"
                  style={{ background: "transparent" }}
                />
              </Suspense>
            </div>
          ))
        : mode === "cli" && (
            <div className="flex flex-1 flex-col items-center justify-center min-h-0 px-6 gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <IconTerminal2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-center max-w-[260px]">
                <p className="text-sm font-medium text-foreground mb-1">
                  CLI requires dev mode
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Run this app locally with{" "}
                  <code className="bg-muted px-1 py-0.5 rounded text-[10px]">
                    pnpm dev
                  </code>{" "}
                  or use{" "}
                  <span className="font-medium text-foreground">
                    Builder.io
                  </span>{" "}
                  to access the CLI terminal.
                </p>
              </div>
            </div>
          )}

      {/* Resources view */}
      {mode === "resources" && (
        <div className="flex-1 min-h-0">
          <Suspense
            fallback={
              <div className="flex h-full flex-col min-h-0">
                <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                    <div className="h-5 w-14 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              </div>
            }
          >
            <ResourcesPanel />
          </Suspense>
        </div>
      )}

      {/* Settings / Setup view */}
      {mode === "settings" && (
        <div className="flex flex-col flex-1 min-h-0">
          <Suspense
            fallback={
              <div className="p-3 space-y-2">
                <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
                <div className="h-10 w-full rounded-lg bg-muted animate-pulse" />
              </div>
            }
          >
            <SettingsPanel
              isDevMode={isDevMode}
              onToggleDevMode={() => setDevMode(!isDevMode)}
              showDevToggle={showDevToggle}
              devAppUrl={devAppUrl}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

// ─── Resize handle ──────────────────────────────────────────────────────────

const SIDEBAR_STORAGE_KEY = "agent-native-sidebar-width";
const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";
const SIDEBAR_FULLSCREEN_KEY = "agent-native-sidebar-fullscreen";
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 700;
/** Max width of the centered chat column in fullscreen mode (Claude-style). */
const FULLSCREEN_CONTENT_MAX_PX = 760;

function ResizeHandle({
  position,
  onDrag,
}: {
  position: "left" | "right";
  onDrag: (delta: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const GRAB_ZONE = 5; // px on each side of the border

  // All drag logic runs via document-level listeners so the 1px-wide
  // element doesn't need to capture pointer events itself.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cursorActive = false;

    function onMouseDown(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const dist = Math.abs(e.clientX - (rect.left + rect.width / 2));
      if (dist > GRAB_ZONE) return;
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    function onMouseMove(e: MouseEvent) {
      if (dragging.current) {
        const delta = e.clientX - lastX.current;
        lastX.current = e.clientX;
        onDragRef.current(position === "left" ? delta : -delta);
        return;
      }
      // Hover cursor
      const rect = el!.getBoundingClientRect();
      const dist = Math.abs(e.clientX - (rect.left + rect.width / 2));
      const near = dist <= GRAB_ZONE;
      if (near && !cursorActive) {
        cursorActive = true;
        document.body.style.cursor = "col-resize";
      } else if (!near && cursorActive) {
        cursorActive = false;
        document.body.style.cursor = "";
      }
    }

    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (cursorActive) document.body.style.cursor = "";
    };
  }, [position]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative z-20 shrink-0 w-px touch-none select-none transition-colors",
        "bg-border hover:bg-accent active:bg-accent",
      )}
      style={{ cursor: "col-resize" }}
    />
  );
}

/**
 * Remounts its children whenever the framework's `refresh-screen` tool is
 * invoked. Used inside AgentSidebar so the main content area re-fetches
 * without disturbing the chat sidebar's in-flight state.
 *
 * Two mechanisms work together here:
 *
 *  1. Before the remount, every react-query cache entry is marked stale
 *     via `invalidateQueries({ refetchType: "none" })`. This does NOT
 *     trigger a refetch on its own, so active queries elsewhere (chat
 *     sidebar, left nav) keep their current data — they'll refetch only
 *     on their next natural trigger.
 *  2. The React `key` then bumps, unmounting and remounting the subtree.
 *     On remount, child components re-subscribe to their queries, see
 *     the data is stale, and refetch — regardless of configured
 *     `staleTime`. This is what makes the dashboard pick up the agent's
 *     edits even when the query uses `staleTime: 30_000` or similar.
 */
/**
 * Syncs the current URL (pathname + search + hash) to application_state
 * under `__url__`, and processes one-shot URL-update commands the agent
 * writes to `__set_url__`. Lives inside AgentSidebar so every framework
 * template gets URL visibility + URL-write capability for its agent
 * without per-template wiring.
 *
 * Two directions:
 *   UI → state  — on route change, write `{ pathname, search, hash,
 *                 searchParams }` to `__url__`. The production agent reads
 *                 this and includes it in the auto-injected `<current-url>`
 *                 block, so the agent always knows what page the user is
 *                 on, including filter/search params like `?f_date=2026-01`.
 *
 *   state → UI  — the framework's `set-search-params` / `set-url-path`
 *                 tools write a command to `__set_url__`. This hook reads
 *                 the command, applies it via react-router, then deletes
 *                 the key. The UI reacts in one tick, no page reload.
 */
function URLSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Outbound: write the current URL to app-state whenever it changes.
  React.useEffect(() => {
    const searchParams: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(location.search).entries()) {
      searchParams[k] = v;
    }
    const body = {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      searchParams,
    };
    fetch(agentNativePath("/_agent-native/application-state/__url__"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, [location.pathname, location.search, location.hash]);

  // Inbound: poll for URL-update commands from the agent. We piggyback on
  // the same 2-second cadence useDbSync uses so there's no extra timer.
  const { data: command } = useQuery({
    queryKey: ["__set_url__"],
    queryFn: async () => {
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/application-state/__set_url__"),
        );
        if (!res.ok || res.status === 204) return null;
        const text = await res.text();
        if (!text) return null;
        const data = JSON.parse(text);
        return data ? { ...data, _ts: Date.now() } : null;
      } catch {
        return null;
      }
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
    retry: false,
  });

  React.useEffect(() => {
    if (!command) return;
    // Delete the one-shot command before applying so duplicate events
    // don't cause repeated navigation.
    fetch(agentNativePath("/_agent-native/application-state/__set_url__"), {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
    const cmd = command as {
      pathname?: string;
      searchParams?: Record<string, string | null>;
      mergeSearchParams?: boolean;
      hash?: string;
    };
    try {
      const current = new URL(window.location.href);
      const nextPath = cmd.pathname ?? current.pathname;
      const nextSearch =
        cmd.mergeSearchParams !== false
          ? new URLSearchParams(current.search)
          : new URLSearchParams();
      if (cmd.searchParams) {
        for (const [k, v] of Object.entries(cmd.searchParams)) {
          if (v === null || v === "") nextSearch.delete(k);
          else nextSearch.set(k, v);
        }
      }
      const nextHash = cmd.hash ?? current.hash;
      const qs = nextSearch.toString();
      const url = nextPath + (qs ? `?${qs}` : "") + (nextHash || "");
      // Skip the navigation if the URL is already at the target state —
      // avoids needless react-router work and any revalidation side-effects
      // that come with it.
      // Mark that the agent just wrote the URL so consumers (e.g. a
      // dashboard restoring saved filter defaults) can skip any auto-
      // restore that would clobber the agent's change. Set this BEFORE
      // the same-URL short-circuit — a no-op nav is still an explicit
      // "agent authored this state" signal that consumers depend on.
      try {
        sessionStorage.setItem("__agentUrlAppliedAt__", String(Date.now()));
      } catch {
        // sessionStorage unavailable — not fatal.
      }
      const currentUrl =
        current.pathname + (current.search || "") + (current.hash || "");
      if (url === currentUrl) {
        queryClient.setQueryData(["__set_url__"], null);
        return;
      }
      // Replace rather than push so repeated agent URL updates don't
      // clutter the history stack and can't trigger extra remounts from
      // router navigation lifecycle.
      navigate(url, { replace: true });
    } catch {
      // Malformed command — ignore.
    }
    queryClient.setQueryData(["__set_url__"], null);
  }, [command, navigate, queryClient]);

  return null;
}
function ScreenRefreshBoundary({ children }: { children: React.ReactNode }) {
  const key = useScreenRefreshKey();
  const queryClient = useQueryClient();
  const lastKeyRef = React.useRef(key);
  if (key !== lastKeyRef.current) {
    lastKeyRef.current = key;
    // Mark every cached query stale without kicking off a refetch. The
    // subtree-level refetches happen naturally when the new tree mounts
    // below and child components re-subscribe.
    queryClient.invalidateQueries({ refetchType: "none" });
  }
  return <React.Fragment key={key}>{children}</React.Fragment>;
}

class AgentPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[agent-native] Agent panel crashed", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="max-w-[260px] space-y-1">
          <p className="text-sm font-medium text-foreground">
            Agent panel hit an internal UI error.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The app is still usable. Reset the panel to reload the chat UI.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          Reset agent panel
        </button>
      </div>
    );
  }
}

export function AgentPanel(props: AgentPanelProps) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <AgentPanelErrorBoundary onReset={() => setResetKey((key) => key + 1)}>
      <AgentPanelInner key={resetKey} {...props} />
    </AgentPanelErrorBoundary>
  );
}

// ─── AgentSidebar — wraps content with a toggleable agent panel ─────────────

export interface AgentSidebarProps {
  children: React.ReactNode;
  /** Placeholder text for the empty chat state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Initial sidebar width in pixels. Mount-only; user resize and a saved
   *  localStorage value override this. Default: 380 */
  defaultSidebarWidth?: number;
  /** @deprecated Use `defaultSidebarWidth` — this prop is mount-only. */
  sidebarWidth?: number;
  /** Which side the sidebar appears on. Default: "right" */
  position?: "left" | "right";
  /** Whether the sidebar starts open. Default: false */
  defaultOpen?: boolean;
  /** Animate the mobile overlay in a sheet-style slide transition. */
  animateMobile?: boolean;
}

/**
 * Wraps app content with a toggleable agent sidebar.
 * Use AgentToggleButton in your header to open/close it.
 */
export function AgentSidebar({
  children,
  emptyStateText = "How can I help you?",
  suggestions,
  defaultSidebarWidth,
  sidebarWidth,
  position = "right",
  defaultOpen = false,
  animateMobile = false,
}: AgentSidebarProps) {
  const initialWidth = defaultSidebarWidth ?? sidebarWidth ?? 380;
  const [open, setOpen] = useState(() => {
    // On mobile viewports the sidebar would cover most of the screen, so
    // always start closed regardless of any persisted desktop preference.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      return false;
    }
    try {
      const saved = localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (saved !== null) return saved === "true";
    } catch {}
    return defaultOpen;
  });
  const [presentationMode, setPresentationMode] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const [fullscreen, setFullscreen] = useState(() => {
    // Force-disable on mobile: a Claude-style centered column makes no sense
    // when the sidebar already covers most of the viewport.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      return false;
    }
    try {
      return localStorage.getItem(SIDEBAR_FULLSCREEN_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Track mobile viewport so we can switch to overlay mode.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) setWidth(n);
      }
    } catch {}
  }, []);

  const setOpenPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setOpen((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        try {
          localStorage.setItem(SIDEBAR_OPEN_KEY, String(value));
        } catch {}
        return value;
      });
    },
    [],
  );

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_FULLSCREEN_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // Track whether the frame is controlling the sidebar (code mode = frame active).
  // Default to true when inside an iframe — assume the frame sidebar is active
  // until told otherwise. This prevents both sidebars flashing after hot reloads.
  const [frameCodeMode, setFrameCodeMode] = useState(
    () => typeof window !== "undefined" && window.parent !== window,
  );

  useEffect(() => {
    const toggleHandler = () => {
      if (frameCodeMode && window.parent !== window) {
        // Forward toggle to frame parent — the frame sidebar handles it
        window.parent.postMessage(
          { type: "agentNative.toggleSidebar" },
          parentFrameTargetOrigin(),
        );
      } else {
        setOpenPersisted((prev) => !prev);
      }
    };
    const openHandler = () => {
      if (frameCodeMode && window.parent !== window) {
        window.parent.postMessage(
          { type: "agentNative.toggleSidebar", data: { open: true } },
          parentFrameTargetOrigin(),
        );
      } else {
        setOpenPersisted(true);
      }
    };
    window.addEventListener("agent-panel:toggle", toggleHandler);
    window.addEventListener("agent-panel:open", openHandler);
    return () => {
      window.removeEventListener("agent-panel:toggle", toggleHandler);
      window.removeEventListener("agent-panel:open", openHandler);
    };
  }, [setOpenPersisted, frameCodeMode]);

  // Listen for sidebar mode commands from the frame parent.
  // When frame is in "code" mode, hide the app sidebar.
  // When frame is in "app" mode, show the app sidebar, sync width and panel mode.
  useEffect(() => {
    if (window.parent === window) return; // Not in an iframe

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "agentNative.sidebarMode") return;
      if (event.source !== window.parent || !isTrustedFrameMessage(event))
        return;
      const {
        mode,
        appMode,
        width: frameWidth,
        open: frameOpen,
      } = event.data.data || {};
      if (mode === "code") {
        // Frame is showing its own sidebar — hide the app's
        setFrameCodeMode(true);
        setOpenPersisted(false);
      } else if (mode === "app") {
        // Frame deferred to the app — show and sync width + mode
        setFrameCodeMode(false);
        if (frameOpen !== false) {
          setOpenPersisted(true);
        }
        if (
          frameWidth &&
          frameWidth >= SIDEBAR_MIN &&
          frameWidth <= SIDEBAR_MAX
        ) {
          setWidth(frameWidth);
        }
        // Sync the panel mode from frame tab selection
        if (
          appMode === "cli" ||
          appMode === "resources" ||
          appMode === "chat"
        ) {
          window.dispatchEvent(
            new CustomEvent("agent-panel:set-mode", {
              detail: { mode: appMode },
            }),
          );
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setOpenPersisted]);

  // Cmd+I / Ctrl+I to focus the agent chat. If the user has selected text,
  // capture it into application_state under `pending-selection-context` so
  // the agent's next turn includes it as immediate context to act on.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        let selectionText = "";
        try {
          selectionText = window.getSelection()?.toString().trim() ?? "";
        } catch {}
        if (selectionText) {
          fetch(
            agentNativePath(
              "/_agent-native/application-state/pending-selection-context",
            ),
            {
              method: "PUT",
              keepalive: true,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: selectionText,
                capturedAt: Date.now(),
              }),
            },
          ).catch(() => {});
          window.dispatchEvent(
            new CustomEvent("agent-panel:selection-attached", {
              detail: { text: selectionText, length: selectionText.length },
            }),
          );
        }
        focusAgentChat();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Hide sidebar during presentation mode
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "agentNative.presentationMode") return;
      if (event.source !== window.parent || !isTrustedFrameMessage(event))
        return;
      setPresentationMode(event.data.data?.active === true);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleDrag = useCallback((delta: number) => {
    setWidth((prev) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, prev + delta));
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const isLeft = position === "left";
  // Fullscreen only applies on desktop — on mobile the existing overlay is
  // already viewport-covering, so the maximize button is hidden and the
  // mounted state ignores any persisted value.
  const effectiveFullscreen = fullscreen && !isMobile;
  // On desktop the resize handle is also the visual divider. Avoid painting a
  // second panel border next to it.
  const showResizeHandle = !isMobile && !effectiveFullscreen && open;

  // On mobile the sidebar floats as a fixed overlay so the content below isn't
  // squashed. On desktop it participates in the flex layout as before, except
  // in fullscreen mode where it overlays the entire viewport (Claude-style).
  let panelStyle: React.CSSProperties;
  if (isMobile) {
    panelStyle = {
      ...AGENT_PANEL_ROOT_STYLE,
      position: "fixed",
      top: 0,
      [isLeft ? "left" : "right"]: 0,
      height: "100%",
      width,
      maxWidth: "85vw",
      maxHeight: "100vh",
      zIndex: 40,
      background: "hsl(var(--background))",
      borderLeft: isLeft ? "none" : "1px solid hsl(var(--border))",
      borderRight: isLeft ? "1px solid hsl(var(--border))" : "none",
      display: animateMobile || open ? "flex" : "none",
      transform: animateMobile
        ? open
          ? "translateX(0)"
          : `translateX(${isLeft ? "-" : ""}calc(100% + 1px))`
        : undefined,
      pointerEvents: animateMobile && !open ? "none" : undefined,
      willChange: animateMobile ? "transform" : undefined,
    };
  } else if (effectiveFullscreen) {
    panelStyle = {
      ...AGENT_PANEL_ROOT_STYLE,
      position: "fixed",
      inset: 0,
      width: "100%",
      maxHeight: "100vh",
      zIndex: 40,
      background: "hsl(var(--background))",
      display: open ? "flex" : "none",
    };
  } else {
    panelStyle = {
      ...AGENT_PANEL_ROOT_STYLE,
      width,
      maxHeight: "100vh",
      borderLeft:
        isLeft || showResizeHandle ? "none" : "1px solid hsl(var(--border))",
      borderRight:
        !isLeft || showResizeHandle ? "none" : "1px solid hsl(var(--border))",
      display: open ? "flex" : "none",
    };
  }

  // Always render the sidebar panel (even when closed) so MultiTabAssistantChat
  // stays mounted and can receive messages (e.g. from voice dictation) while
  // the sidebar is visually hidden. When the user opens the sidebar they'll see
  // any in-progress or completed conversations.
  const sidebar = (
    <>
      {showResizeHandle && !isLeft && (
        <ResizeHandle position={position} onDrag={handleDrag} />
      )}
      <div
        className={cn(
          "agent-sidebar-panel flex shrink-0 flex-col overflow-hidden text-[13px] leading-[1.2] antialiased",
          animateMobile &&
            isMobile &&
            "shadow-2xl transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        )}
        style={panelStyle}
        inert={isMobile && !open ? true : undefined}
        aria-hidden={isMobile && !open ? true : undefined}
      >
        <AgentPanel
          emptyStateText={emptyStateText}
          suggestions={suggestions}
          onCollapse={() => setOpenPersisted(false)}
          isFullscreen={effectiveFullscreen}
          onToggleFullscreen={isMobile ? undefined : toggleFullscreen}
        />
      </div>
      {showResizeHandle && isLeft && (
        <ResizeHandle position={position} onDrag={handleDrag} />
      )}
    </>
  );

  return (
    <div className="flex min-w-0 flex-1 h-screen overflow-hidden">
      {/* Mobile backdrop — tapping it closes the sidebar */}
      {isMobile && !presentationMode && (animateMobile || open) && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            animateMobile &&
              "transition-opacity duration-200 motion-reduce:transition-none",
            animateMobile && !open && "pointer-events-none opacity-0",
            animateMobile && open && "opacity-100",
          )}
          onClick={() => setOpenPersisted(false)}
        />
      )}
      {/* URLSync writes the current URL to application-state so the agent
          sees what page/filters the user is on, and applies URL-update
          commands the agent writes via `set-search-params` / `set-url`. */}
      <URLSync />
      {isLeft && !presentationMode ? sidebar : null}
      <div className="flex flex-1 flex-col overflow-auto min-w-0">
        {/* Screen-refresh key: the agent's `refresh-screen` tool bumps this
            counter, remounting only the main content subtree so it re-fetches
            its data. The sidebar above stays mounted, preserving chat state. */}
        <ScreenRefreshBoundary>{children}</ScreenRefreshBoundary>
      </div>
      {!isLeft && !presentationMode ? sidebar : null}
    </div>
  );
}

/**
 * Focus the agent chat composer input.
 * Opens the sidebar if closed, then focuses the text input.
 */
export function focusAgentChat() {
  window.dispatchEvent(new Event("agent-panel:open"));
  // Wait for sidebar to render, then focus the composer
  requestAnimationFrame(() => {
    const panel = document.querySelector(".agent-sidebar-panel");
    if (!panel) return;
    const prosemirror = panel.querySelector(
      ".ProseMirror",
    ) as HTMLElement | null;
    if (prosemirror) {
      prosemirror.focus();
      return;
    }
    const textarea = panel.querySelector("textarea") as HTMLElement | null;
    if (textarea) textarea.focus();
  });
}

/**
 * Button to toggle the agent sidebar. Place this in your app's header/toolbar.
 * Dispatches a custom event that AgentSidebar listens for.
 */
export function AgentToggleButton({ className }: { className?: string }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
      className={cn(
        "ml-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
        className,
      )}
      title="Toggle agent"
    >
      <IconMessage size={16} />
    </button>
  );
}
