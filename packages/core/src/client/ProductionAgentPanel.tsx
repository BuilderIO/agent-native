import React, { useState, useEffect } from "react";
import { AssistantChat } from "./AssistantChat.js";
import { cn } from "./utils.js";

// ─── Icons ─────────────────────────────────────────────────────────────────

function AgentIcon({ className }: { className?: string }) {
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
      <path d="M12 2a6 6 0 0 1 6 6v2a6 6 0 0 1-12 0V8a6 6 0 0 1 6-6z" />
      <path d="M9 22v-2a3 3 0 0 1 6 0v2" />
      <path d="M2 18a10 10 0 0 1 20 0" />
    </svg>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface ProductionAgentPanelProps {
  children: React.ReactNode;
  /** Placeholder text for the empty chat state */
  emptyStateText?: string;
  /** Suggestion prompts shown when no messages */
  suggestions?: string[];
  /** Width of the agent sidebar. Default: 380 */
  sidebarWidth?: number;
}

/**
 * Wraps app content with an agent chat sidebar.
 * Toggle the sidebar via the agent icon button (rendered separately via AgentToggleButton),
 * or use the provided context.
 */
export function ProductionAgentPanel({
  children,
  emptyStateText = "How can I help you?",
  suggestions,
  sidebarWidth = 380,
}: ProductionAgentPanelProps) {
  const [open, setOpen] = useState(false);
  const [hasAgentActivity, setHasAgentActivity] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.running) setHasAgentActivity(true);
    };
    window.addEventListener("builder.fusion.chatRunning", handler);
    return () =>
      window.removeEventListener("builder.fusion.chatRunning", handler);
  }, []);

  // Listen for toggle events from AgentToggleButton
  useEffect(() => {
    const handler = () => {
      setOpen((prev) => {
        if (!prev) setHasAgentActivity(false);
        return !prev;
      });
    };
    window.addEventListener("agent-panel:toggle", handler);
    return () => window.removeEventListener("agent-panel:toggle", handler);
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {children}
      </div>

      {/* Agent sidebar */}
      {open && (
        <div
          className="flex flex-col border-l border-border shrink-0 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <AssistantChat
            showHeader
            emptyStateText={emptyStateText}
            suggestions={suggestions}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Button to toggle the agent sidebar. Place this in your app's header/toolbar.
 * Dispatches a custom event that ProductionAgentPanel listens for.
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
      <AgentIcon className="h-4 w-4" />
    </button>
  );
}
