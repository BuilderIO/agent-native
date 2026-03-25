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

import React, { useState, useEffect, lazy, Suspense } from "react";
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
  const [selected, setSelected] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(CLI_STORAGE_KEY) || CLI_DEFAULT;
    }
    return CLI_DEFAULT;
  });
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

// ─── AgentPanel ─────────────────────────────────────────────────────────────

export interface AgentPanelProps extends Omit<
  AssistantChatProps,
  "onSwitchToCli" | "showDevHint"
> {
  /** Initial mode. Default: "chat" */
  defaultMode?: "chat" | "cli";
  /** CSS class for the outer container */
  className?: string;
}

export function AgentPanel({
  defaultMode = "chat",
  className,
  apiUrl,
  emptyStateText,
  suggestions,
  showHeader = true,
}: AgentPanelProps) {
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
          {/* CLI selector */}
          {IS_DEV && availableClis.length > 0 && (
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
        </div>
      )}

      {/* Chat view — always mounted to preserve conversation */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-0",
          mode !== "chat" && "hidden",
        )}
      >
        <AssistantChat
          apiUrl={apiUrl}
          showHeader={false}
          showDevHint={IS_DEV}
          emptyStateText={emptyStateText}
          suggestions={suggestions}
          onSwitchToCli={IS_DEV ? () => setMode("cli") : undefined}
        />
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
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const handler = () => {
      setOpen((prev) => !prev);
    };
    window.addEventListener("agent-panel:toggle", handler);
    return () => window.removeEventListener("agent-panel:toggle", handler);
  }, []);

  const isLeft = position === "left";
  const borderClass = isLeft ? "border-r" : "border-l";

  const sidebar = open ? (
    <div
      className={`flex flex-col ${borderClass} border-border shrink-0 overflow-hidden agent-sidebar-panel`}
      style={{ width: sidebarWidth }}
    >
      <AgentPanel emptyStateText={emptyStateText} suggestions={suggestions} />
    </div>
  ) : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {isLeft && sidebar}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>
      {!isLeft && sidebar}
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
