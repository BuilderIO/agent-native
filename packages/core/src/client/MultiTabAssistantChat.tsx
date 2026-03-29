import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  AssistantChat,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
import { getHarnessOrigin } from "./harness.js";
import { cn } from "./utils.js";
import { useChatThreads } from "./use-chat-threads.js";

// ─── Inline Icons ───────────────────────────────────────────────────────────

function IconX({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconPlus({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatTab {
  id: string;
  label: string;
  status: "idle" | "running" | "completed";
}

export interface MultiTabAssistantChatHeaderProps {
  tabs: ChatTab[];
  activeTabId: string;
  activeTabMessageCount: number;
  setActiveTabId: (tabId: string) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  clearActiveTab: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export type MultiTabAssistantChatProps = Omit<
  AssistantChatProps,
  "tabId" | "threadId"
> & {
  /** Show the tab bar. Default: true */
  showTabBar?: boolean;
  /** Optional custom single-row header renderer */
  renderHeader?: (props: MultiTabAssistantChatHeaderProps) => React.ReactNode;
  /** Optional overlay actions renderer for the active tab */
  renderOverlay?: (props: MultiTabAssistantChatHeaderProps) => React.ReactNode;
  /** Hide the chat content while keeping the header visible. Used when CLI/resources mode is active. */
  contentHidden?: boolean;
};

export function MultiTabAssistantChat({
  showTabBar = true,
  renderHeader,
  renderOverlay,
  contentHidden = false,
  apiUrl = "/api/agent-chat",
  ...props
}: MultiTabAssistantChatProps) {
  const {
    threads,
    activeThreadId,
    isLoading,
    createThread,
    switchThread,
    deleteThread,
    saveThreadData,
  } = useChatThreads(apiUrl);

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const chatRef = useRef<AssistantChatHandle | null>(null);
  const pendingSend = useRef<string | null>(null);
  const [runningThreads, setRunningThreads] = useState<Set<string>>(new Set());
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(threads.map((t) => [t.id, t.messageCount ?? 0])),
  );

  // Sync message counts from threads when they load
  useEffect(() => {
    if (threads.length > 0) {
      setMessageCounts((prev) => {
        const next = { ...prev };
        for (const t of threads) {
          if (!(t.id in next)) {
            next[t.id] = t.messageCount ?? 0;
          }
        }
        return next;
      });
    }
  }, [threads]);

  // Listen for builder.submitChat postMessages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin &&
        event.origin !== getHarnessOrigin()
      ) {
        return;
      }
      if (event.data?.type !== "builder.submitChat") return;
      const message = event.data.data?.message as string;
      if (!message) return;

      if (chatRef.current) {
        chatRef.current.sendMessage(message);
      } else {
        pendingSend.current = message;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Process pending send when ref mounts
  useEffect(() => {
    if (chatRef.current && pendingSend.current) {
      const msg = pendingSend.current;
      pendingSend.current = null;
      setTimeout(() => chatRef.current?.sendMessage(msg), 50);
    }
  }, [activeThreadId]);

  // Listen for chatRunning completion events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { isRunning, tabId } = detail;
      if (!tabId) return;

      setRunningThreads((prev) => {
        const next = new Set(prev);
        if (isRunning) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    };
    window.addEventListener("builder.chatRunning", handler);
    return () => window.removeEventListener("builder.chatRunning", handler);
  }, []);

  const addTab = useCallback(() => {
    createThread();
  }, [createThread]);

  const closeTab = useCallback(
    (tabId: string) => {
      deleteThread(tabId);
    },
    [deleteThread],
  );

  const clearActiveTab = useCallback(() => {
    // Create a new thread (old one stays in history)
    createThread();
  }, [createThread]);

  const handleSaveThread = useCallback(
    (data: {
      threadData: string;
      title: string;
      preview: string;
      messageCount: number;
    }) => {
      if (activeThreadId) {
        saveThreadData(activeThreadId, data);
      }
    },
    [activeThreadId, saveThreadData],
  );

  // Build backward-compatible tabs array from threads
  const tabs: ChatTab[] = threads.map((t) => ({
    id: t.id,
    label: t.title || t.preview?.slice(0, 20) || "New chat",
    status: runningThreads.has(t.id)
      ? "running"
      : (messageCounts[t.id] ?? t.messageCount) > 0
        ? "completed"
        : "idle",
  }));

  const headerProps: MultiTabAssistantChatHeaderProps = {
    tabs,
    activeTabId: activeThreadId ?? "",
    activeTabMessageCount: activeThreadId
      ? (messageCounts[activeThreadId] ?? 0)
      : 0,
    setActiveTabId: switchThread,
    addTab,
    closeTab,
    clearActiveTab,
  };

  if (isLoading) {
    return <div className="flex flex-1 flex-col h-full min-h-0" />;
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0">
      {/* Tailwind group-hover/tab doesn't work in core package — inject directly */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".agent-tab-close{opacity:0}.agent-tab:hover .agent-tab-close{opacity:1}",
        }}
      />
      {renderHeader ? (
        renderHeader(headerProps)
      ) : showTabBar ? (
        <div className="flex items-center h-8 px-1 border-b border-border shrink-0 gap-px">
          <div className="flex items-center gap-px min-w-0 overflow-x-auto scrollbar-none flex-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => switchThread(tab.id)}
                className={cn(
                  "agent-tab flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[11px] font-medium shrink-0 max-w-[120px]",
                  tab.id === activeThreadId
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <span className="truncate">{tab.label}</span>
                {tab.status === "running" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                )}
                {tabs.length > 1 && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="agent-tab-close rounded p-px text-muted-foreground/50 hover:!text-foreground hover:!bg-accent"
                  >
                    <IconX size={8} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-px shrink-0 ml-auto">
            <button
              onClick={addTab}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50"
              title="New chat"
            >
              <IconPlus size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Chat content with optional overlay */}
      <div className="relative flex-1 flex flex-col min-h-0">
        {renderOverlay ? renderOverlay(headerProps) : null}

        {/* Render only the active thread — keyed so React remounts on switch */}
        {activeThreadId && (
          <div
            className="flex-1 min-h-0"
            style={{ display: contentHidden ? "none" : "flex" }}
          >
            <AssistantChat
              {...props}
              key={activeThreadId}
              ref={(handle) => {
                chatRef.current = handle;
              }}
              threadId={activeThreadId}
              tabId={activeThreadId}
              apiUrl={apiUrl}
              onMessageCountChange={(count) =>
                setMessageCounts((prev) =>
                  prev[activeThreadId] === count
                    ? prev
                    : { ...prev, [activeThreadId]: count },
                )
              }
              onSaveThread={handleSaveThread}
            />
          </div>
        )}
      </div>
    </div>
  );
}
