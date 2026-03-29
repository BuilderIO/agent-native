import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  AssistantChat,
  type AssistantChatProps,
  type AssistantChatHandle,
  CHAT_STORAGE_PREFIX,
} from "./AssistantChat.js";
import { generateTabId } from "./agent-chat.js";
import { getHarnessOrigin } from "./harness.js";
import { cn } from "./utils.js";

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

function IconTrash({ size = 12 }: { size?: number }) {
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
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
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

const TABS_STORAGE_KEY = "agent-chat-tabs";
const ACTIVE_TAB_STORAGE_KEY = "agent-chat-tabs:active";

function createChatTab(label: string): ChatTab {
  return {
    id: generateTabId(),
    label,
    status: "idle",
  };
}

function getNextLabel(tabs: ChatTab[]): string {
  const numericLabels = tabs
    .map((t) => parseInt(t.label, 10))
    .filter((n) => !isNaN(n));
  const maxNum = numericLabels.length > 0 ? Math.max(...numericLabels) : 0;
  return String(maxNum + 1);
}

function loadTabs(): { tabs: ChatTab[]; activeId: string } | null {
  try {
    const saved = localStorage.getItem(TABS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Reset status on restore (nothing is running after refresh)
        const restored: ChatTab[] = parsed.map((t: ChatTab) => ({
          ...t,
          status: "idle" as const,
        }));
        const activeId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        const validActive =
          activeId && restored.find((t) => t.id === activeId)
            ? activeId
            : restored[0].id;
        return { tabs: restored, activeId: validActive };
      }
    }
  } catch {}
  return null;
}

function saveTabs(tabs: ChatTab[], activeId: string) {
  try {
    // Only persist id and label, not status
    const toSave = tabs.map(({ id, label }) => ({ id, label }));
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(toSave));
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeId);
  } catch {}
}

function getPersistedMessageCount(tabId: string): number {
  try {
    const saved = sessionStorage.getItem(`${CHAT_STORAGE_PREFIX}${tabId}`);
    if (!saved) return 0;
    const repo = JSON.parse(saved);
    return Array.isArray(repo?.messages) ? repo.messages.length : 0;
  } catch {
    return 0;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export type MultiTabAssistantChatProps = Omit<AssistantChatProps, "tabId"> & {
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
  ...props
}: MultiTabAssistantChatProps) {
  const [tabs, setTabs] = useState<ChatTab[]>(() => {
    const loaded = loadTabs();
    return loaded ? loaded.tabs : [createChatTab("1")];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const loaded = loadTabs();
    return loaded ? loaded.activeId : tabs[0].id;
  });
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const chatRefs = useRef<Map<string, AssistantChatHandle>>(new Map());
  const pendingSends = useRef<Map<string, string>>(new Map());
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(
        tabs.map((tab) => [tab.id, getPersistedMessageCount(tab.id)]),
      ),
  );

  // Persist tabs to localStorage
  useEffect(() => {
    saveTabs(tabs, activeTabId);
  }, [tabs, activeTabId]);

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

      const currentTabId = activeTabIdRef.current;
      const activeRef = chatRefs.current.get(currentTabId);

      if (activeRef) {
        activeRef.sendMessage(message);
      } else {
        pendingSends.current.set(currentTabId, message);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Process pending sends when refs mount
  useEffect(() => {
    for (const [tabId, message] of pendingSends.current) {
      const ref = chatRefs.current.get(tabId);
      if (ref) {
        setTimeout(() => ref.sendMessage(message), 50);
        pendingSends.current.delete(tabId);
      }
    }
  }, [tabs]);

  // Listen for chatRunning completion events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { isRunning, tabId } = detail;
      if (!tabId) return;

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          if (isRunning === false) return { ...t, status: "completed" };
          if (isRunning === true) return { ...t, status: "running" };
          return t;
        }),
      );
    };
    window.addEventListener("builder.chatRunning", handler);
    return () => window.removeEventListener("builder.chatRunning", handler);
  }, []);

  const addTab = useCallback(() => {
    setTabs((prev) => {
      // When going from 1 → 2 tabs, relabel the existing tab as "1"
      const renumbered =
        prev.length === 1 ? [{ ...prev[0], label: "1" }] : prev;
      const label = getNextLabel(renumbered);
      const tab = createChatTab(label);
      setMessageCounts((p) => ({ ...p, [tab.id]: 0 }));
      setActiveTabId(tab.id);
      return [...renumbered, tab];
    });
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveTabId(next[newIdx].id);
        }
        return next;
      });
      chatRefs.current.delete(tabId);
      pendingSends.current.delete(tabId);
      setMessageCounts((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      // Clean up persisted messages
      try {
        sessionStorage.removeItem(`agent-chat:${tabId}`);
      } catch {}
    },
    [activeTabId],
  );

  const clearActiveTab = useCallback(() => {
    const currentId = activeTabId;
    // Remove persisted messages for the current tab
    try {
      sessionStorage.removeItem(`agent-chat:${currentId}`);
    } catch {}
    // Replace with a fresh tab in the same position
    const newTab = createChatTab(
      tabs.find((t) => t.id === currentId)?.label || "1",
    );
    setTabs((prev) => prev.map((t) => (t.id === currentId ? newTab : t)));
    setMessageCounts((prev) => {
      const next = { ...prev };
      delete next[currentId];
      next[newTab.id] = 0;
      return next;
    });
    setActiveTabId(newTab.id);
    chatRefs.current.delete(currentId);
  }, [activeTabId, tabs]);

  const headerProps: MultiTabAssistantChatHeaderProps = {
    tabs,
    activeTabId,
    activeTabMessageCount: messageCounts[activeTabId] ?? 0,
    setActiveTabId,
    addTab,
    closeTab,
    clearActiveTab,
  };

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
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "agent-tab flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[11px] font-medium shrink-0",
                  tab.id === activeTabId
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <span>{tab.label}</span>
                {tab.status === "running" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                )}
                {tab.status === "completed" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
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
              onClick={clearActiveTab}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50"
              title="Clear chat"
            >
              <IconTrash size={11} />
            </button>
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

        {/* Render all tabs, hide inactive ones to preserve state */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex-1 min-h-0"
            style={{
              display:
                contentHidden || tab.id !== activeTabId ? "none" : "flex",
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
              onMessageCountChange={(count) =>
                setMessageCounts((prev) =>
                  prev[tab.id] === count ? prev : { ...prev, [tab.id]: count },
                )
              }
              {...props}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
