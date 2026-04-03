/**
 * AgentPanel — unified agent component with chat and CLI terminal modes.
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
  lazy,
  Suspense,
  startTransition,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  IconMessage,
  IconTerminal2,
  IconSettings,
  IconLayoutSidebarRightCollapse,
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconFolder,
  IconX,
  IconPencil,
  IconClockHour3,
  IconDotsVertical,
  IconHistory,
} from "@tabler/icons-react";
import {
  MultiTabAssistantChat,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
import type { AssistantChatProps } from "./AssistantChat.js";
import { useDevMode } from "./use-dev-mode.js";
import { cn } from "./utils.js";

// Lazy-load AgentTerminal to avoid bundling xterm.js when not needed
const AgentTerminal = lazy(() =>
  import("./terminal/index.js").then((m) => ({ default: m.AgentTerminal })),
);

// Lazy-load ResourcesPanel to avoid bundling when not needed
const ResourcesPanel = lazy(() =>
  import("./resources/ResourcesPanel.js").then((m) => ({
    default: m.ResourcesPanel,
  })),
);

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "builder";
const EXEC_MODE_KEY = "agent-native-exec-mode";
type ExecMode = "build" | "plan";
const AGENT_PANEL_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const AGENT_PANEL_ROOT_STYLE = {
  fontFamily: AGENT_PANEL_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.2,
} satisfies React.CSSProperties;
const AGENT_PANEL_HEADER_CLASS =
  "relative z-[240] flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border";
const AGENT_PANEL_HEADER_STYLE = {
  paddingLeft: 12,
  paddingRight: 8,
} satisfies React.CSSProperties;
const AGENT_PANEL_CONTROL_STYLE = {
  fontSize: 12,
  lineHeight: 1,
} satisfies React.CSSProperties;

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
    fetch("/_agent-native/available-clis")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClis(data))
      .catch(() => {});
  }, []);
  return clis;
}

function useCliSelection() {
  const [selected, setSelected] = useState(CLI_DEFAULT);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CLI_STORAGE_KEY);
      if (saved) setSelected(saved);
    } catch {}
  }, []);
  const select = (cmd: string) => {
    setSelected(cmd);
    try {
      localStorage.setItem(CLI_STORAGE_KEY, cmd);
    } catch {}
  };
  return [selected, select] as const;
}

// Detect dev mode at build time (Vite replaces this)
const IS_DEV: boolean =
  typeof import.meta !== "undefined" &&
  typeof (import.meta as any).env !== "undefined" &&
  (import.meta as any).env.DEV === true;

interface SettingsSelectOption {
  value: string;
  label: string;
  description?: string;
}

function SettingsSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: SettingsSelectOption[];
  onValueChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-foreground">{label}</p>
      <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
        <SelectPrimitive.Trigger
          className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-left text-[12px] text-foreground outline-none transition-colors hover:bg-accent/40 data-[placeholder]:text-muted-foreground"
          aria-label={label}
          style={AGENT_PANEL_CONTROL_STYLE}
        >
          <SelectPrimitive.Value>
            {selected?.label ?? value}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <IconChevronDown size={14} className="text-muted-foreground" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-[9999] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex w-full cursor-pointer select-none items-start gap-2 rounded-md px-8 py-2.5 text-[12px] outline-none data-[highlighted]:bg-accent/60 data-[state=checked]:bg-accent/40"
                  style={AGENT_PANEL_CONTROL_STYLE}
                >
                  <span className="absolute left-2 top-2.5 flex h-4 w-4 items-center justify-center text-muted-foreground">
                    <SelectPrimitive.ItemIndicator>
                      <IconCheck size={14} />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>
                      <span className="text-foreground">{option.label}</span>
                    </SelectPrimitive.ItemText>
                    {option.description ? (
                      <span className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </div>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

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

// ─── Agent Settings Popover ──────────────────────────────────────────────────

function AgentSettingsPopover({
  isDevMode,
  onToggle,
}: {
  isDevMode: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Ignore clicks inside the popover itself or its trigger button
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      // Ignore clicks inside portaled Radix Select content (rendered outside the popover DOM)
      if (
        (target as Element).closest?.(
          "[data-radix-popper-content-wrapper], [data-radix-select-viewport], [role='listbox']",
        )
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const environmentOptions: SettingsSelectOption[] = [
    {
      value: "production",
      label: "Production",
      description: "Restricted to app tools only.",
    },
    {
      value: "development",
      label: "Development",
      description: "Full access to code editing, shell, and files.",
    },
  ];
  // Compute fixed position from the button so the popover escapes all
  // stacking contexts (the CLI terminal otherwise paints over it).
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
          open && "bg-accent/50 text-foreground",
        )}
        title="Agent settings"
      >
        <IconSettings size={14} />
      </button>
      {open &&
        pos &&
        ReactDOM.createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9990] w-72 rounded-lg border border-border bg-popover shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="space-y-3 p-3">
              <SettingsSelect
                label="Environment"
                value={isDevMode ? "development" : "production"}
                options={environmentOptions}
                onValueChange={(next) => {
                  const nextIsDev = next === "development";
                  if (nextIsDev !== isDevMode) onToggle();
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

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
}

function useClientOnly() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function AgentPanel({
  defaultMode = "chat",
  className,
  apiUrl,
  emptyStateText,
  suggestions,
  showHeader = true,
  onCollapse,
}: AgentPanelProps) {
  const mounted = useClientOnly();
  const [execMode, setExecMode] = useState<ExecMode>(() => {
    try {
      const saved = localStorage.getItem(EXEC_MODE_KEY);
      if (saved === "build" || saved === "plan") return saved;
    } catch {}
    return "build";
  });

  const switchExecMode = useCallback((next: ExecMode) => {
    setExecMode(next);
    try {
      localStorage.setItem(EXEC_MODE_KEY, next);
    } catch {}
    window.dispatchEvent(
      new CustomEvent("agent-panel:exec-mode-change", {
        detail: { mode: next },
      }),
    );
  }, []);

  const [mode, setMode] = useState<"chat" | "cli" | "resources">(() => {
    try {
      const saved = localStorage.getItem("agent-native-panel-mode");
      if (saved === "chat" || saved === "cli" || saved === "resources")
        return saved;
    } catch {}
    return defaultMode;
  });
  useEffect(() => {
    try {
      localStorage.setItem("agent-native-panel-mode", mode);
    } catch {}
  }, [mode]);
  const switchMode = useCallback((m: "chat" | "cli" | "resources") => {
    startTransition(() => setMode(m));
  }, []);
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
        if (prev.length <= 1) return prev;
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

  const availableClis = useAvailableClis();
  const [selectedCli, selectCli] = useCliSelection();
  const selectedLabel =
    availableClis.find((c) => c.command === selectedCli)?.label || selectedCli;
  const { isDevMode, canToggle, setDevMode } = useDevMode(apiUrl);
  const isLocalhost =
    mounted &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1");
  const showDevToggle = canToggle && isLocalhost;

  const renderModeButtons = useCallback(
    (activeMode: "chat" | "cli" | "resources") => (
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => switchMode("chat")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
            activeMode === "chat"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          title="Chat mode"
          style={AGENT_PANEL_CONTROL_STYLE}
        >
          <IconMessage size={14} />
          Chat
        </button>
        {isDevMode && (
          <button
            onClick={() => switchMode("cli")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
              activeMode === "cli"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            title="CLI terminal mode"
            style={AGENT_PANEL_CONTROL_STYLE}
          >
            <IconTerminal2 size={14} />
            CLI
          </button>
        )}
        <button
          onClick={() => switchMode("resources")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[12px] leading-none",
            activeMode === "resources"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          title="Files & resources"
          style={AGENT_PANEL_CONTROL_STYLE}
        >
          <IconFolder size={14} />
          Files
        </button>
      </div>
    ),
    [isDevMode],
  );

  const renderHeaderActions = useCallback(
    () => (
      <div className="flex shrink-0 items-center gap-1.5">
        {showDevToggle && (
          <IconTooltip content="Agent settings">
            <div>
              <AgentSettingsPopover
                isDevMode={isDevMode}
                onToggle={() => setDevMode(!isDevMode)}
              />
            </div>
          </IconTooltip>
        )}
        {onCollapse && (
          <IconTooltip content="Collapse sidebar">
            <button
              onClick={onCollapse}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconLayoutSidebarRightCollapse size={14} />
            </button>
          </IconTooltip>
        )}
      </div>
    ),
    [isDevMode, onCollapse, setDevMode, showDevToggle],
  );

  const [tabMenuOpen, setTabMenuOpen] = useState<string | null>(null);
  const [cliPickerOpen, setCliPickerOpen] = useState(false);

  // Ref callback: scroll the active tab into view whenever it mounts/changes
  const activeTabRefCb = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
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
        {/* Tab bar: always visible for chat and CLI */}
        {(mode === "chat" || mode === "cli") && (
          <div className="flex items-center px-1 py-1 border-b border-border gap-0.5">
            <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none flex-1">
              {mode === "chat"
                ? tabs.map((tab) => (
                    <div
                      key={tab.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActiveTabId(tab.id);
                        scrollActiveTabIntoView();
                      }}
                      {...(tab.id === activeTabId
                        ? { "data-active-tab": true }
                        : {})}
                      className={cn(
                        "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer max-w-[150px]",
                        tab.id === activeTabId
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span className="truncate pr-1">{tab.label}</span>
                      {tab.status === "running" && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
                      )}
                      {tabs.length > 1 && (
                        <button
                          type="button"
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
                      )}
                    </div>
                  ))
                : cliTabs.map((id, i) => (
                    <div
                      key={id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActiveCliTab(id);
                        scrollActiveTabIntoView();
                      }}
                      {...(id === activeCliTab
                        ? { "data-active-tab": true }
                        : {})}
                      className={cn(
                        "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer",
                        id === activeCliTab
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span>Terminal {i + 1}</span>
                      {cliTabs.length > 1 && (
                        <button
                          type="button"
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
                      )}
                    </div>
                  ))}
            </div>
            <div className="flex items-center gap-0.5 shrink-0 ml-auto">
              {mode === "chat" && (
                <>
                  <IconTooltip content="New chat">
                    <button
                      onClick={() => {
                        addTab();
                        scrollActiveTabIntoView();
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    >
                      <IconPlus size={14} />
                    </button>
                  </IconTooltip>
                  {toggleHistory && (
                    <IconTooltip content="Chat history">
                      <button
                        onClick={toggleHistory}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
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
                          "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                          tabMenuOpen === "__chat_global" &&
                            "bg-accent text-foreground",
                        )}
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
                              {"\u2318"}W
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
                            className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            onClick={() => {
                              closeAllTabs();
                              setTabMenuOpen(null);
                            }}
                          >
                            Close All Tabs
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
                      onClick={() => {
                        addCliTab();
                        scrollActiveTabIntoView();
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    >
                      <IconPlus size={14} />
                    </button>
                  </IconTooltip>
                  {availableClis.length > 0 && (
                    <div className="relative">
                      <IconTooltip content={`CLI: ${selectedLabel}`}>
                        <button
                          onClick={() => setCliPickerOpen(!cliPickerOpen)}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                            cliPickerOpen && "bg-accent text-foreground",
                          )}
                        >
                          <IconSettings size={14} />
                        </button>
                      </IconTooltip>
                      {cliPickerOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setCliPickerOpen(false)}
                          />
                          <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-border bg-popover py-1 shadow-lg">
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
                                  <IconCheck size={12} className="shrink-0" />
                                )}
                                <span
                                  className={
                                    cli.command !== selectedCli ? "ml-5" : ""
                                  }
                                >
                                  {cli.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        </>
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
                          "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                          tabMenuOpen === "__cli_global" &&
                            "bg-accent text-foreground",
                        )}
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
                              {"\u2318"}W
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
                            className="flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                            onClick={() => {
                              closeAllCliTabs();
                              setTabMenuOpen(null);
                            }}
                          >
                            Close All Tabs
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    ),
    [
      mode,
      renderHeaderActions,
      renderModeButtons,
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
    ],
  );

  return (
    <div
      className={cn(
        "agent-panel-root flex flex-1 flex-col min-h-0 h-full text-[13px] leading-[1.2] antialiased",
        className,
      )}
      style={AGENT_PANEL_ROOT_STYLE}
    >
      {/* Tailwind group-hover/tab doesn't work in core package — inject directly */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".agent-tab-close{opacity:0}.agent-tab:hover .agent-tab-close{opacity:1}",
        }}
      />
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
            onSwitchToCli={isDevMode ? () => switchMode("cli") : undefined}
            composerSlot={
              <div className="shrink-0 px-3 pt-1.5 pb-0 flex items-center justify-between gap-2">
                {execMode === "plan" ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 min-w-0 truncate">
                    <IconPencil size={12} className="shrink-0" />
                    <span className="truncate">
                      Plan mode — will plan before executing
                    </span>
                  </div>
                ) : (
                  <div />
                )}
                <div
                  className="flex shrink-0 items-center rounded-md border border-border overflow-hidden"
                  style={AGENT_PANEL_CONTROL_STYLE}
                >
                  <button
                    onClick={() => switchExecMode("build")}
                    className={cn(
                      "px-2 py-1 text-[11px] leading-none",
                      execMode === "build"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    title="Build mode — agent executes immediately"
                  >
                    Build
                  </button>
                  <button
                    onClick={() => switchExecMode("plan")}
                    className={cn(
                      "px-2 py-1 text-[11px] leading-none",
                      execMode === "plan"
                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    title="Plan mode — agent plans before executing"
                  >
                    Plan
                  </button>
                </div>
              </div>
            }
          />
        )}
      </div>

      {/* CLI terminals — always mounted in dev mode to preserve state (WebSocket, buffer).
          Hidden via display:none when another mode is active, matching how chat is handled. */}
      {isDevMode &&
        cliTabs.map((id) => (
          <div
            key={id}
            className={cn(
              "min-h-0 relative",
              mode === "cli" ? "flex-1" : "hidden",
            )}
            style={{
              display:
                mode === "cli" && id === activeCliTab ? undefined : "none",
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
                hideInHarness={false}
                className="h-full"
                style={{ background: "transparent" }}
              />
            </Suspense>
          </div>
        ))}

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
    </div>
  );
}

// ─── Resize handle ──────────────────────────────────────────────────────────

const SIDEBAR_STORAGE_KEY = "agent-native-sidebar-width";
const SIDEBAR_OPEN_KEY = "agent-native-sidebar-open";
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 700;

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

// ─── AgentSidebar — wraps content with a toggleable agent panel ─────────────

export interface AgentSidebarProps {
  children: React.ReactNode;
  /** Placeholder text for the empty chat state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Width of the agent sidebar. Default: 380 */
  sidebarWidth?: number;
  /** Which side the sidebar appears on. Default: "right" */
  position?: "left" | "right";
  /** Whether the sidebar starts open. Default: false */
  defaultOpen?: boolean;
}

/**
 * Wraps app content with a toggleable agent sidebar.
 * Use AgentToggleButton in your header to open/close it.
 */
export function AgentSidebar({
  children,
  emptyStateText = "How can I help you?",
  suggestions,
  sidebarWidth = 380,
  position = "right",
  defaultOpen = false,
}: AgentSidebarProps) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (saved !== null) return saved === "true";
    } catch {}
    return defaultOpen;
  });
  const [width, setWidth] = useState(sidebarWidth);
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

  useEffect(() => {
    const toggleHandler = () => {
      setOpenPersisted((prev) => !prev);
    };
    const openHandler = () => {
      setOpenPersisted(true);
    };
    window.addEventListener("agent-panel:toggle", toggleHandler);
    window.addEventListener("agent-panel:open", openHandler);
    return () => {
      window.removeEventListener("agent-panel:toggle", toggleHandler);
      window.removeEventListener("agent-panel:open", openHandler);
    };
  }, [setOpenPersisted]);

  // Cmd+I / Ctrl+I to focus the agent chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        focusAgentChat();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
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

  const sidebar = (
    <>
      {isLeft ? null : <ResizeHandle position={position} onDrag={handleDrag} />}
      <div
        className="agent-sidebar-panel flex shrink-0 flex-col overflow-hidden text-[13px] leading-[1.2] antialiased"
        style={{ ...AGENT_PANEL_ROOT_STYLE, width, maxHeight: "100vh" }}
      >
        <AgentPanel
          emptyStateText={emptyStateText}
          suggestions={suggestions}
          onCollapse={() => setOpenPersisted(false)}
        />
      </div>
      {isLeft ? <ResizeHandle position={position} onDrag={handleDrag} /> : null}
    </>
  );

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      {isLeft && open ? sidebar : null}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>
      {!isLeft && open ? sidebar : null}
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
        "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
        className,
      )}
      title="Toggle agent"
    >
      <IconMessage size={16} />
    </button>
  );
}
