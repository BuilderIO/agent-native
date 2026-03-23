import React, { useState, useEffect } from "react";
import { AssistantChat } from "./AssistantChat.js";
import { cn } from "./utils.js";

// Only show the agent panel in production builds
// Vite replaces import.meta.env.PROD at build time; in SSR/Node contexts it defaults to false
const IS_PROD: boolean =
  typeof import.meta !== "undefined" &&
  typeof (import.meta as any).env !== "undefined" &&
  (import.meta as any).env.PROD === true;

// ─── Icons ─────────────────────────────────────────────────────────────────

function MailIcon({ className }: { className?: string }) {
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
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 7 10-7" />
    </svg>
  );
}

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

// ─── Bottom tab bar ─────────────────────────────────────────────────────────

function BottomTabBar({
  activeTab,
  onChange,
  hasUnread,
}: {
  activeTab: "mail" | "agent";
  onChange: (tab: "mail" | "agent") => void;
  hasUnread?: boolean;
}) {
  return (
    <div className="flex h-14 shrink-0 items-stretch border-t border-border/50 bg-card">
      <button
        onClick={() => onChange("mail")}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5",
          activeTab === "mail"
            ? "text-foreground"
            : "text-muted-foreground/50 hover:text-muted-foreground",
        )}
      >
        <MailIcon className="h-5 w-5" />
        <span className="text-[10px] font-medium tracking-wide">Mail</span>
      </button>
      <button
        onClick={() => onChange("agent")}
        className={cn(
          "relative flex flex-1 flex-col items-center justify-center gap-0.5",
          activeTab === "agent"
            ? "text-foreground"
            : "text-muted-foreground/50 hover:text-muted-foreground",
        )}
      >
        <AgentIcon className="h-5 w-5" />
        <span className="text-[10px] font-medium tracking-wide">Agent</span>
        {hasUnread && activeTab !== "agent" && (
          <span className="absolute top-2 right-[calc(50%-10px)] h-1.5 w-1.5 rounded-full bg-blue-400" />
        )}
      </button>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface ProductionAgentPanelProps {
  children: React.ReactNode;
}

/**
 * Wraps app content with a mobile-style bottom tab bar (Mail / Agent).
 * In development (`!import.meta.env.PROD`), renders children unchanged.
 */
export function ProductionAgentPanel({ children }: ProductionAgentPanelProps) {
  const [activeTab, setActiveTab] = useState<"mail" | "agent">("mail");
  const [hasAgentActivity, setHasAgentActivity] = useState(false);

  useEffect(() => {
    if (!IS_PROD) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.running) setHasAgentActivity(true);
    };
    window.addEventListener("builder.fusion.chatRunning", handler);
    return () =>
      window.removeEventListener("builder.fusion.chatRunning", handler);
  }, []);

  if (!IS_PROD) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Content area — always mounted, hidden when agent tab is active */}
      <div
        className={cn(
          "flex flex-1 overflow-hidden",
          activeTab !== "mail" && "hidden",
        )}
      >
        {children}
      </div>
      {/* Agent view — always mounted to preserve conversation across tab switches */}
      <div
        className={cn(
          "flex flex-1 overflow-hidden flex-col",
          activeTab !== "agent" && "hidden",
        )}
      >
        <AssistantChat
          showHeader
          emptyStateText="Ask me anything about your emails"
          suggestions={[
            "What's in my inbox?",
            "Summarize my unread emails",
            "Archive emails from last week",
          ]}
        />
      </div>

      <BottomTabBar
        activeTab={activeTab}
        onChange={(tab) => {
          setActiveTab(tab);
          if (tab === "agent") setHasAgentActivity(false);
        }}
        hasUnread={hasAgentActivity}
      />
    </div>
  );
}
