import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  AssistantChat,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
import { getHarnessOrigin } from "./harness.js";
import { cn } from "./utils.js";
import { useChatThreads, type ChatThreadSummary } from "./use-chat-threads.js";

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

function IconHistory({ size = 12 }: { size?: number }) {
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
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function IconSearch({ size = 14 }: { size?: number }) {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

// ─── Skeleton Loader ─────────────────────────────────────────────────────────

function ChatSkeleton() {
  return (
    <div className="flex flex-1 flex-col h-full min-h-0">
      <div className="flex items-center h-8 px-2 border-b border-border shrink-0 gap-2">
        <div className="h-4 w-12 rounded bg-muted animate-pulse" />
        <div className="ml-auto flex gap-1">
          <div className="h-5 w-5 rounded bg-muted animate-pulse" />
          <div className="h-5 w-5 rounded bg-muted animate-pulse" />
        </div>
      </div>
      <div className="flex-1 flex flex-col gap-3 p-4">
        <div className="flex justify-center py-8">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="h-3 w-32 rounded bg-muted animate-pulse mx-auto" />
      </div>
    </div>
  );
}

// ─── History Popover ─────────────────────────────────────────────────────────

function HistoryPopover({
  threads,
  openTabIds,
  onSelect,
  onClose,
  onSearch,
}: {
  threads: ChatThreadSummary[];
  openTabIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: () => void;
  onSearch?: (query: string) => Promise<ChatThreadSummary[]>;
}) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<
    ChatThreadSummary[] | null
  >(null);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Debounced server-side search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      if (onSearch) {
        const results = await onSearch(q);
        setSearchResults(results);
      } else {
        // Fallback to client-side filtering
        setSearchResults(null);
      }
      setIsSearching(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, onSearch]);

  // Only show threads not currently open as tabs
  const closedThreads = threads.filter(
    (t) => !openTabIds.has(t.id) && t.messageCount > 0,
  );

  const filtered = search.trim()
    ? (searchResults ?? closedThreads).filter((t) => t.messageCount > 0)
    : closedThreads;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0)
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-2 top-0 z-50 w-72 rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <IconSearch size={13} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search past chats..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {isSearching ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              Searching...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {search ? "No matching chats" : "No past chats"}
            </div>
          ) : (
            filtered.map((thread) => (
              <button
                key={thread.id}
                onClick={() => {
                  onSelect(thread.id);
                  onClose();
                }}
                className="w-full px-3 py-2 text-left hover:bg-accent/50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-foreground truncate">
                    {thread.title || thread.preview || "Chat"}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatTime(thread.updatedAt)}
                  </span>
                </div>
                {thread.preview && thread.title !== thread.preview && (
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {thread.preview}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </>
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
  /** Open the history popover */
  showHistory?: boolean;
  toggleHistory?: () => void;
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
    generateTitle,
    searchThreads,
  } = useChatThreads(apiUrl);

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const chatRefs = useRef<Map<string, AssistantChatHandle>>(new Map());
  const pendingSends = useRef<Map<string, string>>(new Map());
  const [runningThreads, setRunningThreads] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);

  // Open tabs — persisted to localStorage so they survive refresh.
  const OPEN_TABS_KEY = "agent-chat-open-tabs";
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(OPEN_TABS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const initializedRef = useRef(false);

  // Persist open tab IDs to localStorage
  useEffect(() => {
    if (openTabIds.length > 0) {
      try {
        localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabIds));
      } catch {}
    }
  }, [openTabIds]);

  // Initialize open tabs once threads load — validate saved tabs still exist
  useEffect(() => {
    if (initializedRef.current || !activeThreadId || threads.length === 0)
      return;
    initializedRef.current = true;
    const threadIds = new Set(threads.map((t) => t.id));
    setOpenTabIds((prev) => {
      // Filter out any saved tabs that no longer exist
      const valid = prev.filter((id) => threadIds.has(id));
      // Ensure active thread is included
      if (!valid.includes(activeThreadId)) {
        valid.push(activeThreadId);
      }
      return valid.length > 0 ? valid : [activeThreadId];
    });
  }, [activeThreadId, threads]);

  // Ensure active thread is always in open tabs.
  // Use functional update to check inside the setter — avoids race with the
  // initialization effect that may have already added the ID in the same batch.
  useEffect(() => {
    if (activeThreadId) {
      setOpenTabIds((prev) =>
        prev.includes(activeThreadId) ? prev : [...prev, activeThreadId],
      );
    }
  }, [activeThreadId]);

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
      const context = event.data.data?.context as string | undefined;
      const fullMessage = context
        ? `${message}\n\n<context>\n${context}\n</context>`
        : message;

      const currentTabId = activeThreadIdRef.current;
      if (!currentTabId) return;
      const activeRef = chatRefs.current.get(currentTabId);
      if (activeRef) {
        activeRef.sendMessage(fullMessage);
      } else {
        pendingSends.current.set(currentTabId, fullMessage);
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
  }, [openTabIds]);

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

  const addTab = useCallback(async () => {
    const id = await createThread();
    if (id) {
      setOpenTabIds((prev) => [...prev, id]);
    }
  }, [createThread]);

  const closeTab = useCallback(
    (tabId: string) => {
      setOpenTabIds((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((id) => id !== tabId);
        if (tabId === activeThreadIdRef.current && next.length > 0) {
          const idx = prev.indexOf(tabId);
          switchThread(next[Math.min(idx, next.length - 1)]);
        }
        return next;
      });
      chatRefs.current.delete(tabId);
      pendingSends.current.delete(tabId);
    },
    [switchThread],
  );

  const clearActiveTab = useCallback(() => {
    addTab();
  }, [addTab]);

  const openFromHistory = useCallback(
    (threadId: string) => {
      if (!openTabIds.includes(threadId)) {
        setOpenTabIds((prev) => [...prev, threadId]);
      }
      switchThread(threadId);
    },
    [openTabIds, switchThread],
  );

  const handleGenerateTitle = useCallback(
    (message: string) => {
      if (activeThreadId) {
        generateTitle(activeThreadId, message).then((title) => {
          if (title && activeThreadId) {
            // Persist the generated title to the server
            saveThreadData(activeThreadId, {
              threadData: "",
              title,
              preview: message.slice(0, 120),
              messageCount: 0,
            });
          }
        });
      }
    },
    [activeThreadId, generateTitle, saveThreadData],
  );

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

  // Build tabs from open thread IDs
  const threadMap = new Map(threads.map((t) => [t.id, t]));
  const tabs: ChatTab[] = openTabIds
    .filter((id) => threadMap.has(id) || id === activeThreadId)
    .map((id) => {
      const t = threadMap.get(id);
      return {
        id,
        label: t?.title || t?.preview?.slice(0, 20) || "New chat",
        status: runningThreads.has(id)
          ? ("running" as const)
          : (messageCounts[id] ?? t?.messageCount ?? 0) > 0
            ? ("completed" as const)
            : ("idle" as const),
      };
    });

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
    showHistory,
    toggleHistory: () => setShowHistory((v) => !v),
  };

  if (isLoading) {
    return <ChatSkeleton />;
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
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
        <div className="flex items-center px-1 py-1 border-b border-border shrink-0 gap-0.5">
          <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none flex-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => switchThread(tab.id)}
                className={cn(
                  "agent-tab relative flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium shrink-0 max-w-[130px]",
                  tab.id === activeThreadId
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <span className="truncate pr-1">{tab.label}</span>
                {tab.status === "running" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                )}
                {openTabIds.length > 1 && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="agent-tab-close flex items-center justify-end text-muted-foreground hover:!text-foreground"
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
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50",
                showHistory && "bg-accent text-foreground",
              )}
              title="Chat history"
            >
              <IconHistory size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Chat content with optional overlay */}
      <div className="relative flex-1 flex flex-col min-h-0">
        {renderOverlay ? renderOverlay(headerProps) : null}

        {/* History popover — rendered inside relative container so positioning works */}
        {showHistory && (
          <HistoryPopover
            threads={threads}
            openTabIds={new Set(openTabIds)}
            onSelect={openFromHistory}
            onClose={() => setShowHistory(false)}
            onSearch={searchThreads}
          />
        )}

        {/* Render all open tabs, hide inactive ones to preserve state */}
        {[...new Set(openTabIds)].map((tabId) => (
          <div
            key={tabId}
            className="flex-1 min-h-0"
            style={{
              display:
                contentHidden || tabId !== activeThreadId ? "none" : "flex",
            }}
          >
            <AssistantChat
              {...props}
              ref={(handle) => {
                if (handle) {
                  chatRefs.current.set(tabId, handle);
                } else {
                  chatRefs.current.delete(tabId);
                }
              }}
              threadId={tabId}
              tabId={tabId}
              apiUrl={apiUrl}
              onMessageCountChange={(count) =>
                setMessageCounts((prev) =>
                  prev[tabId] === count ? prev : { ...prev, [tabId]: count },
                )
              }
              onSaveThread={
                tabId === activeThreadId ? handleSaveThread : undefined
              }
              onGenerateTitle={
                tabId === activeThreadId ? handleGenerateTitle : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
