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
import { AssistantChat } from "./AssistantChat.js";
import type { AssistantChatProps } from "./AssistantChat.js";
import { cn } from "./utils.js";

// Lazy-load AgentTerminal to avoid bundling xterm.js when not needed
const AgentTerminal = lazy(() =>
  import("./terminal/index.js").then((m) => ({ default: m.AgentTerminal })),
);

const CLI_STORAGE_KEY = "agent-native-cli-command";
const CLI_DEFAULT = "builder";

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

  return (
    <div className={cn("flex flex-1 flex-col h-full min-h-0", className)}>
      {showHeader && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-1.5">
            {/* Mode toggle — only show CLI option in dev mode */}
            <button
              onClick={() => setMode("chat")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-[12px]",
                mode === "chat"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
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
                  "flex items-center gap-1 px-2 py-1 rounded-md text-[12px]",
                  mode === "cli"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
                title="CLI terminal mode"
              >
                <TerminalIcon className="h-3.5 w-3.5" />
                CLI
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* CLI selector — only visible in CLI mode */}
            {IS_DEV && mode === "cli" && availableClis.length > 0 && (
              <select
                value={selectedCli}
                onChange={(e) => selectCli(e.target.value)}
                className="text-[12px] text-muted-foreground bg-transparent border border-border rounded px-1.5 py-0.5 outline-none hover:text-foreground cursor-pointer"
                title="Select AI CLI"
              >
                {availableClis.map((cli) => (
                  <option key={cli.command} value={cli.command}>
                    {cli.label}
                  </option>
                ))}
              </select>
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
        </div>
      )}

      {/* Chat view — always mounted to preserve conversation (client-only
          because @assistant-ui uses useLayoutEffect which breaks SSR) */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-0",
          mode !== "chat" && "hidden",
        )}
      >
        {mounted && (
          <AssistantChat
            apiUrl={apiUrl}
            showHeader={false}
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
      className={cn(
        "shrink-0 w-1 cursor-col-resize hover:bg-accent/60 active:bg-accent transition-colors",
        position === "left"
          ? "border-r border-border"
          : "border-l border-border",
      )}
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
    const handler = () => {
      setOpenPersisted((prev) => !prev);
    };
    window.addEventListener("agent-panel:toggle", handler);
    return () => window.removeEventListener("agent-panel:toggle", handler);
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

  const collapsedTab = (
    <button
      onClick={() => setOpenPersisted(true)}
      className={cn(
        "shrink-0 flex flex-col items-center pt-3 w-10 bg-card text-muted-foreground hover:text-foreground",
        isLeft ? "border-r border-border" : "border-l border-border",
      )}
      title="Open agent sidebar"
    >
      <ChatBubbleIcon className="h-4 w-4" />
    </button>
  );

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
      {isLeft && (open ? sidebar : collapsedTab)}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>
      {!isLeft && (open ? sidebar : collapsedTab)}
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
