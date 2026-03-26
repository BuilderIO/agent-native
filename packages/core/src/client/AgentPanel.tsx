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

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
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

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "builder";
const AGENT_PANEL_HEADER_CLASS =
  "flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-2";

interface AvailableCli {
  command: string;
  label: string;
  available: boolean;
}

function useAvailableClis() {
  const [clis, setClis] = useState<AvailableCli[]>([]);
  useEffect(() => {
    fetch("/api/available-clis")
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

// ─── Icons ──────────────────────────────────────────────────────────────────

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ─── Agent Settings Popover ──────────────────────────────────────────────────

function AgentSettingsPopover({
  isDevMode,
  onToggle,
  availableClis,
  selectedCli,
  onSelectCli,
}: {
  isDevMode: boolean;
  onToggle: () => void;
  availableClis: AvailableCli[];
  selectedCli: string;
  onSelectCli: (command: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
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
        <CogIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-border bg-popover shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
        >
          <div className="p-3 pb-2">
            <p className="text-[12px] font-medium text-foreground">
              Environment
            </p>
          </div>
          <div className="px-3">
            <div className="flex items-center rounded-md bg-muted/50 p-0.5">
              <button
                onClick={() => {
                  if (isDevMode) onToggle();
                }}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-[11px] font-medium text-center",
                  !isDevMode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Production
              </button>
              <button
                onClick={() => {
                  if (!isDevMode) onToggle();
                }}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-[11px] font-medium text-center",
                  isDevMode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Development
              </button>
            </div>
          </div>
          <div className="px-3 pb-3 pt-1.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {isDevMode
                ? "Full access — code editing, shell, files"
                : "Restricted — app tools only"}
            </p>
          </div>
          {IS_DEV && availableClis.length > 0 && (
            <>
              <div className="border-t border-border/70 p-3 pb-2">
                <p className="text-[12px] font-medium text-foreground">
                  CLI Agent
                </p>
              </div>
              <div className="px-3 pb-3">
                <select
                  value={selectedCli}
                  onChange={(e) => onSelectCli(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none"
                  title="Select AI CLI"
                >
                  {availableClis.map((cli) => (
                    <option key={cli.command} value={cli.command}>
                      {cli.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
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
  const [mode, setMode] = useState<"chat" | "cli">(defaultMode);
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
    (activeMode: "chat" | "cli") => (
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => setMode("chat")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[12px]",
            activeMode === "chat"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          title="Chat mode"
        >
          <ChatBubbleIcon className="h-3.5 w-3.5" />
          Chat
        </button>
        {IS_DEV && (
          <button
            onClick={() => setMode("cli")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[12px]",
              activeMode === "cli"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            title="CLI terminal mode"
          >
            <TerminalIcon className="h-3.5 w-3.5" />
            CLI
          </button>
        )}
      </div>
    ),
    [],
  );

  const renderHeaderActions = useCallback(
    () => (
      <div className="flex shrink-0 items-center gap-1.5">
        {showDevToggle && (
          <AgentSettingsPopover
            isDevMode={isDevMode}
            onToggle={() => setDevMode(!isDevMode)}
            availableClis={availableClis}
            selectedCli={selectedCli}
            onSelectCli={selectCli}
          />
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
            title="Collapse sidebar"
          >
            <SidebarIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    ),
    [
      availableClis,
      isDevMode,
      onCollapse,
      selectCli,
      selectedCli,
      setDevMode,
      showDevToggle,
    ],
  );

  const renderChatHeader = useCallback(
    ({
      tabs,
      activeTabId,
      activeTabMessageCount,
      setActiveTabId,
      addTab,
      closeTab,
      clearActiveTab,
    }: MultiTabAssistantChatHeaderProps) => (
      <div className={AGENT_PANEL_HEADER_CLASS}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {renderModeButtons(mode)}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            {tabs.length > 1 &&
              tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    "group/tab flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium",
                    tab.id === activeTabId
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.status === "running" && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
                  )}
                  {tab.status === "completed" && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                  )}
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className={cn(
                      "rounded p-0.5 opacity-100",
                      tab.id === activeTabId
                        ? "text-foreground/45 hover:bg-accent hover:text-foreground"
                        : "text-muted-foreground/55 hover:!bg-accent hover:!text-foreground",
                    )}
                    title={`Close chat ${tab.label}`}
                    aria-label={`Close chat ${tab.label}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </span>
                </button>
              ))}
            {activeTabMessageCount > 0 && (
              <button
                onClick={clearActiveTab}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground"
                title="Clear chat"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={addTab}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground"
              title="New chat"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {renderHeaderActions()}
      </div>
    ),
    [mode, renderHeaderActions, renderModeButtons],
  );

  return (
    <div className={cn("flex flex-1 flex-col h-full min-h-0", className)}>
      {showHeader && mode === "cli" && (
        <div className={AGENT_PANEL_HEADER_CLASS}>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {renderModeButtons("cli")}
          </div>
          {renderHeaderActions()}
        </div>
      )}

      {/* Chat view — multi-tab, client-only
          because @assistant-ui uses useLayoutEffect which breaks SSR */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-0",
          mode !== "chat" && "hidden",
        )}
      >
        {mounted && (
          <MultiTabAssistantChat
            apiUrl={apiUrl}
            showHeader={false}
            renderHeader={showHeader ? renderChatHeader : undefined}
            emptyStateText={emptyStateText}
            suggestions={suggestions}
            onSwitchToCli={IS_DEV ? () => setMode("cli") : undefined}
          />
        )}
      </div>

      {/* CLI terminal — only rendered in dev mode */}
      {IS_DEV && mode === "cli" && (
        <div className="flex-1 min-h-0">
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
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      // For a left sidebar, dragging right = wider (positive delta)
      // For a right sidebar, dragging left = wider (negative delta)
      onDrag(position === "left" ? delta : -delta);
    },
    [onDrag, position],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="group relative shrink-0 w-px"
    >
      <div
        className={cn(
          "absolute inset-y-0 cursor-col-resize",
          position === "left" ? "-right-2.5 left-0" : "-left-2.5 right-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-y-0 w-px bg-border transition-colors group-hover:bg-accent group-active:bg-accent",
          position === "left" ? "left-0" : "right-0",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full border border-border/80 bg-background/95 px-1 py-0.5 text-[9px] font-medium tracking-[0.18em] text-muted-foreground opacity-0 shadow-sm transition-all group-hover:opacity-100 group-active:opacity-100 group-hover:text-foreground group-hover:border-accent/50 group-active:border-accent/50 group-active:text-foreground",
          position === "left"
            ? "left-1/2 -translate-x-1/2"
            : "right-1/2 translate-x-1/2",
        )}
      >
        <span className="block leading-none">‹›</span>
      </div>
    </div>
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
        className="flex flex-col shrink-0 overflow-hidden agent-sidebar-panel"
        style={{ width }}
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
    <div className="flex flex-1 overflow-hidden">
      {isLeft && open ? sidebar : null}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>
      {!isLeft && open ? sidebar : null}
    </div>
  );
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
      <ChatBubbleIcon className="h-4 w-4" />
    </button>
  );
}
