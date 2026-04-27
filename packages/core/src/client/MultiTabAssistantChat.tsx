import React, { useState, useRef, useEffect, useCallback } from "react";
import { IconX, IconPlus, IconHistory, IconSearch } from "@tabler/icons-react";
import {
  AssistantChat,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
import { getFrameOrigin } from "./frame.js";
import { cn } from "./utils.js";
import { useChatThreads, type ChatThreadSummary } from "./use-chat-threads.js";

interface EngineModelGroup {
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
}

// ─── Skeleton Loader ─────────────────────────────────────────────────────────

function ChatSkeleton({ headerOnly = false }: { headerOnly?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col min-h-0",
        headerOnly ? "shrink-0" : "flex-1 h-full",
      )}
    >
      <div className="flex items-center px-1 py-1 border-b border-border shrink-0 gap-0.5">
        <div className="h-[22px] w-20 rounded-md bg-muted animate-pulse" />
        <div className="ml-auto flex gap-0.5">
          <div className="h-[22px] w-[22px] rounded-md bg-muted animate-pulse" />
          <div className="h-[22px] w-[22px] rounded-md bg-muted animate-pulse" />
        </div>
      </div>
      {!headerOnly && (
        <div className="flex-1 flex flex-col gap-3 p-4">
          <div className="flex justify-center py-8">
            <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="h-3 w-32 rounded bg-muted animate-pulse mx-auto" />
        </div>
      )}
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
  const searchIdRef = useRef(0);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (!q) {
      searchIdRef.current++;
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const id = ++searchIdRef.current;
    debounceRef.current = setTimeout(async () => {
      if (onSearch) {
        const results = await onSearch(q);
        if (id !== searchIdRef.current) return;
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

// ─── Help Popover ────────────────────────────────────────────────────────────

function HelpPopover({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const commands = [
    {
      name: "/clear",
      description: "Start a new chat (keeps current chat in history)",
    },
    { name: "/new", description: "Same as /clear" },
    { name: "/history", description: "Browse and search past chats" },
    { name: "/help", description: "Show this list of commands" },
    { name: "@", description: "Mention files, agents, or resources" },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-2 top-0 z-50 w-72 rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-medium text-foreground">
            Available Commands
          </span>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <IconX size={12} />
          </button>
        </div>
        <div className="py-1">
          {commands.map((cmd) => (
            <div key={cmd.name} className="px-3 py-1.5">
              <div className="text-xs font-medium text-foreground">
                {cmd.name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {cmd.description}
              </div>
            </div>
          ))}
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
  /** If this tab is a sub-agent, the parent thread ID */
  parentThreadId?: string;
  /** Short name for sub-agent tabs (e.g. "Research", "Draft email") */
  subAgentName?: string;
}

export interface MultiTabAssistantChatHeaderProps {
  tabs: ChatTab[];
  activeTabId: string;
  activeTabMessageCount: number;
  setActiveTabId: (tabId: string) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeAllTabs: () => void;
  clearActiveTab: () => void;
  /** Open the history popover */
  showHistory?: boolean;
  toggleHistory?: () => void;
  /** Number of open tabs (useful for triggering scroll on tab count change) */
  tabCount: number;
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
  /** Namespace for localStorage keys — used to isolate chat state per app in the frame. */
  storageKey?: string;
};

export function MultiTabAssistantChat({
  showTabBar = true,
  renderHeader,
  renderOverlay,
  contentHidden = false,
  apiUrl = "/_agent-native/agent-chat",
  storageKey,
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
    refreshThreads,
  } = useChatThreads(apiUrl, storageKey);

  // Namespace all localStorage keys by storageKey when provided (for per-app isolation in frame)
  const keyPrefix = storageKey ? `:${storageKey}` : "";

  // Track which tabs have been focused at least once (lazy mount for sub-agent tabs)
  const mountedTabsRef = useRef<Set<string>>(new Set());
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  // Mark the active tab as mounted so it persists when switched away
  if (activeThreadId) mountedTabsRef.current.add(activeThreadId);
  const chatRefs = useRef<Map<string, AssistantChatHandle>>(new Map());
  const pendingSends = useRef<Map<string, string>>(new Map());
  const [runningThreads, setRunningThreads] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const newThreadIds = useRef<Set<string>>(new Set());

  // ─── Model state ─────────────────────────────────────────────────────────
  const [availableModels, setAvailableModels] = useState<EngineModelGroup[]>(
    [],
  );
  const [defaultModel, setDefaultModel] = useState("claude-sonnet-4-6");
  const threadModelRef = useRef<Map<string, { model: string; engine: string }>>(
    new Map(),
  );
  const [selectedModelForActiveThread, setSelectedModelForActiveThread] =
    useState<string | undefined>(undefined);

  const activeThreadModel = selectedModelForActiveThread ?? defaultModel;

  const handleModelChange = useCallback((model: string, engine: string) => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) return;
    threadModelRef.current.set(threadId, { model, engine });
    setSelectedModelForActiveThread(model);
  }, []);

  const refreshEngines = useCallback(() => {
    Promise.all([
      fetch("/_agent-native/actions/manage-agent-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch("/_agent-native/env-status")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/_agent-native/builder/status")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([enginesData, envKeys, builderStatus]) => {
        if (!enginesData?.engines) return;
        const configuredKeys = new Set(
          (envKeys as Array<{ key: string; configured: boolean }>)
            .filter((k) => k.configured)
            .map((k) => k.key),
        );
        const builderConnected = builderStatus?.configured === true;
        const currentEngineName: string | undefined =
          enginesData.current?.engine;
        const currentModel: string | undefined = enginesData.current?.model;

        let groups: EngineModelGroup[];

        if (builderConnected) {
          // When Builder.io is connected, show all Builder-supported
          // models grouped by provider — all route through the builder
          // engine so no individual API keys are needed.
          const builderEngine = enginesData.engines.find(
            (e: any) => e.name === "builder",
          );
          const builderModels: string[] = builderEngine?.supportedModels ?? [];
          const claude = builderModels.filter((m: string) =>
            m.startsWith("claude-"),
          );
          const openai = builderModels.filter((m: string) =>
            m.startsWith("gpt-"),
          );
          const gemini = builderModels.filter((m: string) =>
            m.startsWith("gemini-"),
          );
          const other = builderModels.filter(
            (m: string) =>
              !m.startsWith("claude-") &&
              !m.startsWith("gpt-") &&
              !m.startsWith("gemini-"),
          );

          groups = [
            ...(claude.length
              ? [
                  {
                    engine: "builder",
                    label: "Claude",
                    models: claude,
                    configured: true,
                  },
                ]
              : []),
            ...(openai.length
              ? [
                  {
                    engine: "builder",
                    label: "OpenAI",
                    models: openai,
                    configured: true,
                  },
                ]
              : []),
            ...(gemini.length
              ? [
                  {
                    engine: "builder",
                    label: "Gemini",
                    models: gemini,
                    configured: true,
                  },
                ]
              : []),
            ...(other.length
              ? [
                  {
                    engine: "builder",
                    label: "More",
                    models: other,
                    configured: true,
                  },
                ]
              : []),
          ];

          // Ensure the current model shows in the list even if it's not
          // in BUILDER_SUPPORTED_MODELS (e.g. custom model string).
          if (currentModel && !builderModels.includes(currentModel)) {
            const firstGroup = groups[0];
            if (firstGroup) firstGroup.models.unshift(currentModel);
          }
        } else {
          // No Builder connection — show SDK engines that have API keys.
          const allowedEngines = new Set([
            "anthropic",
            "ai-sdk:openai",
            "ai-sdk:google",
          ]);
          groups = enginesData.engines
            .filter((e: any) => allowedEngines.has(e.name))
            .map((e: any) => {
              const models = [...e.supportedModels];
              if (
                e.name === currentEngineName &&
                currentModel &&
                !models.includes(currentModel)
              ) {
                models.unshift(currentModel);
              }
              return {
                engine: e.name,
                label: e.label,
                models,
                configured:
                  e.requiredEnvVars.length === 0 ||
                  e.requiredEnvVars.some((v: string) =>
                    configuredKeys.has(v),
                  ) ||
                  e.name === currentEngineName,
              };
            });
        }
        setAvailableModels(groups);
        setDefaultModel(currentModel ?? "claude-sonnet-4-6");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshEngines();
    window.addEventListener("agent-engine:configured-changed", refreshEngines);
    return () =>
      window.removeEventListener(
        "agent-engine:configured-changed",
        refreshEngines,
      );
  }, [refreshEngines]);

  // Parent-child thread mapping — persisted to localStorage.
  // Maps childThreadId → parentThreadId for sub-agent tabs.
  const PARENT_MAP_KEY = `agent-chat-parent-map${keyPrefix}`;
  const [parentMap, setParentMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(PARENT_MAP_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  // Persist parent map to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(PARENT_MAP_KEY, JSON.stringify(parentMap));
    } catch {}
  }, [parentMap, PARENT_MAP_KEY]);

  // Sub-agent display names — persisted to localStorage.
  // Maps childThreadId → short name (e.g. "Research", "Draft email").
  const SUB_AGENT_NAMES_KEY = `agent-chat-sub-agent-names${keyPrefix}`;
  const [subAgentNames, setSubAgentNames] = useState<Record<string, string>>(
    () => {
      try {
        const saved = localStorage.getItem(SUB_AGENT_NAMES_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
      return {};
    },
  );

  useEffect(() => {
    try {
      localStorage.setItem(SUB_AGENT_NAMES_KEY, JSON.stringify(subAgentNames));
    } catch {}
  }, [subAgentNames, SUB_AGENT_NAMES_KEY]);

  // Open tabs — persisted to localStorage so they survive refresh.
  const OPEN_TABS_KEY = `agent-chat-open-tabs${keyPrefix}`;
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(OPEN_TABS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Mark restored tabs as mounted
          for (const id of parsed) mountedTabsRef.current.add(id);
          return parsed;
        }
      }
    } catch {}
    return [];
  });
  const initializedRef = useRef(false);

  // Persist open tab IDs to localStorage (exclude sub-agent tabs — they're session-only)
  useEffect(() => {
    const mainTabs = openTabIds.filter((id) => !parentMap[id]);
    if (mainTabs.length > 0) {
      try {
        localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(mainTabs));
      } catch {}
    }
  }, [openTabIds, parentMap, OPEN_TABS_KEY]);

  // Initialize open tabs once threads load — validate saved tabs still exist
  useEffect(() => {
    if (initializedRef.current || !activeThreadId || threads.length === 0)
      return;
    initializedRef.current = true;
    const threadIds = new Set(threads.map((t) => t.id));
    const threadMap = new Map(threads.map((t) => [t.id, t]));

    // Auto-close tabs inactive for more than 4 hours
    const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
    const now = Date.now();
    const isStale = (id: string) => {
      const thread = threadMap.get(id);
      return thread ? now - thread.updatedAt > STALE_THRESHOLD_MS : false;
    };

    // If the active thread is a sub-agent, switch to its parent or the most recent main thread
    if (parentMap[activeThreadId]) {
      const parent = parentMap[activeThreadId];
      if (parent && threadIds.has(parent)) {
        switchThread(parent);
      } else {
        // Fall back to most recent main thread
        const mainThread = threads.find((t) => !parentMap[t.id]);
        if (mainThread) switchThread(mainThread.id);
      }
    }

    setOpenTabIds((prev) => {
      // Filter out tabs that no longer exist, sub-agent tabs, or stale tabs (>4h inactive)
      const valid = prev.filter(
        (id) => threadIds.has(id) && !parentMap[id] && !isStale(id),
      );
      // Ensure active thread is included (only if it's not a sub-agent and not stale)
      if (
        !parentMap[activeThreadId] &&
        !valid.includes(activeThreadId) &&
        !isStale(activeThreadId)
      ) {
        valid.push(activeThreadId);
      }
      return valid;
    });

    // If active thread is stale, start fresh
    if (!parentMap[activeThreadId] && isStale(activeThreadId)) {
      createThread();
    }
  }, [activeThreadId, threads, parentMap, switchThread, createThread]);

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

  // Ensure at least one tab is always open — auto-create if sidebar is empty
  const autoCreatingRef = useRef(false);
  useEffect(() => {
    if (isLoading || autoCreatingRef.current) return;
    if (openTabIds.length === 0) {
      autoCreatingRef.current = true;
      createThread().then((id) => {
        autoCreatingRef.current = false;
        if (id) {
          newThreadIds.current.add(id);
          setOpenTabIds([id]);
        }
      });
    }
  }, [isLoading, openTabIds, createThread]);

  // Focus the composer and sync model state when switching tabs
  useEffect(() => {
    if (!activeThreadId) return;
    // Sync model picker to this thread's override (or clear to default)
    setSelectedModelForActiveThread(
      threadModelRef.current.get(activeThreadId)?.model ?? undefined,
    );
    // Small delay to ensure the tab is visible before focusing
    const t = setTimeout(() => {
      chatRefs.current.get(activeThreadId)?.focusComposer();
    }, 50);
    return () => clearTimeout(t);
  }, [activeThreadId]);

  // Ref callback: scroll the active tab into view in the overflow container.
  // Uses getBoundingClientRect for reliable positioning regardless of offsetParent.
  // A margin keeps the active tab from sitting flush against either container
  // edge — at the right edge it was landing directly under the +/history/menu
  // buttons, which visually clipped the tab label.
  const activeTabRefCb = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const MARGIN = 24;
    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const tabRect = el.getBoundingClientRect();
      if (tabRect.left < containerRect.left + MARGIN) {
        container.scrollLeft += tabRect.left - containerRect.left - MARGIN;
      } else if (tabRect.right > containerRect.right - MARGIN) {
        container.scrollLeft += tabRect.right - containerRect.right + MARGIN;
      }
    });
  }, []);

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
    const execModeKey = `agent-native-exec-mode${keyPrefix}`;
    const PLAN_MODE_INSTRUCTION =
      `PLAN MODE ACTIVE: Before making any changes, you MUST:\n` +
      `1. Explore the codebase to understand what's needed\n` +
      `2. Write a plan to \`.builder/plans/YYYY-MM-DD-<topic>.md\`\n` +
      `3. Present your approach clearly and wait for the user's explicit approval\n` +
      `Do NOT edit any files, run any scripts, or make any changes until the user says to proceed.`;

    const handler = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin &&
        event.origin !== getFrameOrigin()
      ) {
        return;
      }
      if (event.data?.type !== "builder.submitChat") return;
      const message = event.data.data?.message as string;
      if (!message) return;
      const context = event.data.data?.context as string | undefined;
      const openSidebar = event.data.data?.openSidebar as boolean | undefined;
      const model = event.data.data?.model as string | undefined;

      // If a model override was specified, apply it only if we recognize it
      if (model) {
        const threadId = activeThreadIdRef.current;
        const matchedGroup = availableModels.find((g) =>
          g.models.includes(model),
        );
        if (threadId && matchedGroup) {
          threadModelRef.current.set(threadId, {
            model,
            engine: matchedGroup.engine,
          });
          setSelectedModelForActiveThread(model);
        }
      }

      // Make sure the sidebar is visible to show the response, unless the
      // caller explicitly opted out.
      if (openSidebar !== false) {
        window.dispatchEvent(new CustomEvent("agent-panel:open"));
      }

      const isPlanMode = (() => {
        if (!props.execMode) return false;
        try {
          return localStorage.getItem(execModeKey) === "plan";
        } catch {
          return false;
        }
      })();

      const baseMessage = context
        ? `${message}\n\n<context>\n${context}\n</context>`
        : message;

      const fullMessage = isPlanMode
        ? `${PLAN_MODE_INSTRUCTION}\n\n${baseMessage}`
        : baseMessage;

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
  }, [keyPrefix, availableModels]);

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
      newThreadIds.current.add(id);
    }
  }, [createThread]);

  const closeTab = useCallback(
    (tabId: string) => {
      setOpenTabIds((prev) => {
        if (prev.length <= 1) {
          // Last tab — create a new one and replace the old tab atomically
          createThread().then((newId) => {
            if (newId) {
              newThreadIds.current.add(newId);
              setOpenTabIds([newId]);
            }
          });
          return prev; // Keep old tab until new one is ready
        }
        const next = prev.filter((id) => id !== tabId);
        if (tabId === activeThreadIdRef.current && next.length > 0) {
          const idx = prev.indexOf(tabId);
          switchThread(next[Math.min(idx, next.length - 1)]);
        }
        return next;
      });
      chatRefs.current.delete(tabId);
      pendingSends.current.delete(tabId);
      newThreadIds.current.delete(tabId);
      threadModelRef.current.delete(tabId);
      // Clean up parent map and sub-agent names
      setParentMap((prev) => {
        if (!(tabId in prev)) return prev;
        const { [tabId]: _, ...rest } = prev;
        return rest;
      });
      setSubAgentNames((prev) => {
        if (!(tabId in prev)) return prev;
        const { [tabId]: _, ...rest } = prev;
        return rest;
      });
    },
    [switchThread, createThread],
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      setOpenTabIds([tabId]);
      if (activeThreadIdRef.current !== tabId) {
        switchThread(tabId);
      }
      // Clean up refs for closed tabs
      for (const key of chatRefs.current.keys()) {
        if (key !== tabId) {
          chatRefs.current.delete(key);
          pendingSends.current.delete(key);
          newThreadIds.current.delete(key);
          threadModelRef.current.delete(key);
        }
      }
      // Clean up parent map and sub-agent names — only keep entries for the surviving tab
      setParentMap((prev) => {
        if (tabId in prev) return { [tabId]: prev[tabId] };
        return {};
      });
      setSubAgentNames((prev) => {
        if (tabId in prev) return { [tabId]: prev[tabId] };
        return {};
      });
    },
    [switchThread],
  );

  const closeAllTabs = useCallback(async () => {
    const id = await createThread();
    if (id) {
      newThreadIds.current.add(id);
      setOpenTabIds([id]);
      switchThread(id);
      // Clean up all old refs
      chatRefs.current.clear();
      pendingSends.current.clear();
      threadModelRef.current.clear();
      setParentMap({});
      setSubAgentNames({});
    }
  }, [createThread, switchThread]);

  // Keyboard shortcuts dispatched from AgentPanel based on the active mode
  useEffect(() => {
    const handleCloseCurrent = () => {
      const id = activeThreadIdRef.current;
      if (id) closeTab(id);
    };
    const handleCloseAll = () => {
      void closeAllTabs();
    };
    window.addEventListener("agent-chat:close-current-tab", handleCloseCurrent);
    window.addEventListener("agent-chat:close-all-tabs", handleCloseAll);
    return () => {
      window.removeEventListener(
        "agent-chat:close-current-tab",
        handleCloseCurrent,
      );
      window.removeEventListener("agent-chat:close-all-tabs", handleCloseAll);
    };
  }, [closeTab, closeAllTabs]);

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

  // Listen for agent-task-open events (from AgentTaskCard "Open" button)
  useEffect(() => {
    function handleOpenTask(e: Event) {
      const detail = (e as CustomEvent).detail;
      const threadId = detail?.threadId;
      if (!threadId) return;
      // The current active thread is the parent that spawned this sub-agent
      const parentId = activeThreadIdRef.current;
      if (parentId && parentId !== threadId) {
        setParentMap((prev) =>
          prev[threadId] === parentId
            ? prev
            : { ...prev, [threadId]: parentId },
        );
      }
      // Store the sub-agent name/description for the tab label
      const name = detail.name || detail.description || "";
      if (name) {
        setSubAgentNames((prev) =>
          prev[threadId] === name ? prev : { ...prev, [threadId]: name },
        );
      }
      // Refresh thread list so the new sub-agent thread appears with its title
      refreshThreads();
      // Open the sub-agent thread as a tab — insert after parent for visual grouping
      if (!openTabIds.includes(threadId)) {
        setOpenTabIds((prev) => {
          if (parentId) {
            const parentIdx = prev.indexOf(parentId);
            if (parentIdx !== -1) {
              // Insert after the parent (and any existing children of that parent)
              const next = [...prev];
              let insertIdx = parentIdx + 1;
              // Skip past any existing children of the same parent
              while (
                insertIdx < next.length &&
                parentMap[next[insertIdx]] === parentId
              ) {
                insertIdx++;
              }
              next.splice(insertIdx, 0, threadId);
              return next;
            }
          }
          return [...prev, threadId];
        });
      }
      switchThread(threadId);
    }
    window.addEventListener("agent-task-open", handleOpenTask);
    return () => window.removeEventListener("agent-task-open", handleOpenTask);
  }, [openTabIds, switchThread, refreshThreads, parentMap]);

  // Watch for agent-issued chat-command in application-state
  const lastChatCommandRef = useRef(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function pollChatCommand() {
      if (stopped) return;
      try {
        const res = await fetch(
          "/_agent-native/application-state/chat-command",
        );
        if (res.ok) {
          const data = await res.json();
          if (
            data?.value?.command === "open-thread" &&
            data.value.threadId &&
            data.value.timestamp > lastChatCommandRef.current
          ) {
            lastChatCommandRef.current = data.value.timestamp;
            const threadId = data.value.threadId as string;
            // Open the thread as a tab and focus it
            if (!openTabIds.includes(threadId)) {
              setOpenTabIds((prev) => [...prev, threadId]);
            }
            switchThread(threadId);
            // Clear the command
            fetch("/_agent-native/application-state/chat-command", {
              method: "DELETE",
            }).catch(() => {});
          }
        }
      } catch {}
      if (!stopped) {
        timer = setTimeout(pollChatCommand, 2000);
      }
    }

    pollChatCommand();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [openTabIds, switchThread]);

  const handleGenerateTitle = useCallback(
    (threadId: string, message: string) => {
      generateTitle(threadId, message).then((title) => {
        if (title) {
          // Persist the generated title to the server
          saveThreadData(threadId, {
            threadData: "",
            title,
            preview: message.slice(0, 120),
          });
        }
      });
    },
    [generateTitle, saveThreadData],
  );

  const handleSaveThread = useCallback(
    (
      threadId: string,
      data: {
        threadData: string;
        title: string;
        preview: string;
        messageCount: number;
      },
    ) => {
      saveThreadData(threadId, data);
    },
    [saveThreadData],
  );

  // ─── Slash command handler ──────────────────────────────────────────
  const [helpVisible, setHelpVisible] = useState(false);

  const handleSlashCommand = useCallback(
    (command: string) => {
      switch (command) {
        case "clear":
        case "new":
          addTab();
          break;
        case "history":
          setShowHistory(true);
          break;
        case "help":
          setHelpVisible(true);
          break;
      }
    },
    [addTab],
  );

  // Build tabs from open thread IDs
  const threadMap = new Map(threads.map((t) => [t.id, t]));
  const tabs: ChatTab[] = openTabIds
    .filter((id) => threadMap.has(id) || id === activeThreadId)
    .map((id) => {
      const t = threadMap.get(id);
      return {
        id,
        label: t?.title || t?.preview?.slice(0, 30) || "New chat",
        status: runningThreads.has(id)
          ? ("running" as const)
          : (messageCounts[id] ?? t?.messageCount ?? 0) > 0
            ? ("completed" as const)
            : ("idle" as const),
        parentThreadId: parentMap[id],
        subAgentName: subAgentNames[id],
      };
    });

  // Include sub-agent tabs that aren't in threadMap yet (just created, not refreshed)
  for (const id of openTabIds) {
    if (!tabs.some((t) => t.id === id)) {
      tabs.push({
        id,
        label:
          subAgentNames[id] || (parentMap[id] ? "Sub-agent..." : "New chat"),
        status: "running" as const,
        parentThreadId: parentMap[id],
        subAgentName: subAgentNames[id],
      });
    }
  }

  const headerProps: MultiTabAssistantChatHeaderProps = {
    tabs,
    activeTabId: activeThreadId ?? "",
    activeTabMessageCount: activeThreadId
      ? (messageCounts[activeThreadId] ?? 0)
      : 0,
    setActiveTabId: switchThread,
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    clearActiveTab,
    showHistory,
    toggleHistory: () => setShowHistory((v) => !v),
    tabCount: openTabIds.length,
  };

  if (isLoading) {
    return <ChatSkeleton headerOnly={contentHidden} />;
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
      {renderHeader
        ? renderHeader(headerProps)
        : showTabBar
          ? (() => {
              const activeTab = tabs.find((t) => t.id === activeThreadId);
              const focusParentId = activeTab?.parentThreadId || activeThreadId;
              const childTabs = tabs.filter(
                (t) => t.parentThreadId === focusParentId,
              );
              const hasSubTabs = childTabs.length > 0;
              const mainTabs = tabs.filter((t) => !t.parentThreadId);

              return (
                <>
                  <div className="flex items-center px-1 py-1 border-b border-border shrink-0 gap-0.5">
                    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none flex-1">
                      {mainTabs.map((tab) => {
                        const isActive =
                          tab.id === activeThreadId ||
                          (tab.id === focusParentId &&
                            activeTab?.parentThreadId === tab.id);
                        return (
                          <button
                            key={tab.id}
                            ref={isActive ? activeTabRefCb : undefined}
                            onClick={() => switchThread(tab.id)}
                            className={cn(
                              "agent-tab relative flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium shrink-0 max-w-[130px]",
                              isActive
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent",
                            )}
                          >
                            <span className="truncate pr-1">{tab.label}</span>
                            {tab.status === "running" && (
                              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse" />
                            )}
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
                          </button>
                        );
                      })}
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
                  {hasSubTabs && (
                    <div className="flex items-center px-1 py-0.5 border-b border-border shrink-0 gap-0.5 bg-muted/30">
                      <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none flex-1">
                        <button
                          onClick={() => switchThread(focusParentId!)}
                          className={cn(
                            "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium cursor-pointer",
                            activeThreadId === focusParentId
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          Main
                        </button>
                        {childTabs.map((tab) => (
                          <button
                            key={tab.id}
                            ref={
                              tab.id === activeThreadId
                                ? activeTabRefCb
                                : undefined
                            }
                            onClick={() => switchThread(tab.id)}
                            className={cn(
                              "agent-tab relative flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium cursor-pointer max-w-[130px]",
                              tab.id === activeThreadId
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            <span className="truncate pr-1">
                              {tab.subAgentName || tab.label}
                            </span>
                            {tab.status === "running" && (
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse" />
                            )}
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
                                width: 24,
                                paddingRight: 4,
                                borderRadius: "0 6px 6px 0",
                                background:
                                  "linear-gradient(to right, transparent, hsl(var(--accent)) 40%)",
                              }}
                            >
                              <IconX size={8} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()
          : null}

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

        {/* Help popover — shown by /help slash command */}
        {helpVisible && <HelpPopover onClose={() => setHelpVisible(false)} />}

        {/* Render tabs that have been activated at least once, hide inactive ones to preserve state.
            Sub-agent tabs are only mounted when first focused — prevents stale restore from running
            while the component is display:none before the user switches to it. */}
        {[...new Set(openTabIds)]
          .filter(
            (tabId) =>
              tabId === activeThreadId || mountedTabsRef.current.has(tabId),
          )
          .map((tabId) => (
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
                isNewThread={newThreadIds.current.has(tabId)}
                onMessageCountChange={(count) =>
                  setMessageCounts((prev) =>
                    prev[tabId] === count ? prev : { ...prev, [tabId]: count },
                  )
                }
                onSaveThread={handleSaveThread}
                onGenerateTitle={handleGenerateTitle}
                onSlashCommand={handleSlashCommand}
                selectedModel={threadModelRef.current.get(tabId)?.model}
                selectedEngine={threadModelRef.current.get(tabId)?.engine}
                defaultModel={defaultModel}
                availableModels={availableModels}
                onModelChange={handleModelChange}
              />
            </div>
          ))}
      </div>
    </div>
  );
}
