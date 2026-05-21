import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  IconX,
  IconPlus,
  IconHistory,
  IconSearch,
  IconLink,
  IconLinkOff,
  IconCheck,
} from "@tabler/icons-react";
import {
  AssistantChat,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
import { isTrustedFrameMessage } from "./frame.js";
import { cn } from "./utils.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.js";
import {
  useChatThreads,
  type ChatThreadScope,
  type ChatThreadSummary,
} from "./use-chat-threads.js";
import { agentNativePath } from "./api-path.js";
import { RunStuckBanner } from "./RunStuckBanner.js";
import { DEFAULT_MODEL } from "../agent/default-model.js";
import {
  getReasoningEffortOptionsForModel,
  isReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";

interface EngineModelGroup {
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
}

interface ModelSelection {
  model: string;
  engine?: string;
  effort?: ReasoningEffort;
}

const MODEL_SELECTION_STORAGE_KEY = "agent-native:chat-models:selection";

function readStoredModelSelection(key: string): ModelSelection | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ModelSelection>;
    if (typeof parsed.model !== "string" || !parsed.model.trim()) {
      return undefined;
    }
    const selection: ModelSelection = {
      model: parsed.model,
      effort: isReasoningEffort(parsed.effort) ? parsed.effort : "auto",
    };
    if (typeof parsed.engine === "string") selection.engine = parsed.engine;
    return selection;
  } catch {
    return undefined;
  }
}

function writeStoredModelSelection(key: string, selection: ModelSelection) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(selection));
  } catch {}
}

function resolveModelSelection(
  selection: ModelSelection | undefined,
  groups: EngineModelGroup[],
): ModelSelection | undefined {
  if (!selection?.model) return undefined;
  if (groups.length === 0) {
    const requestedEffort = selection.effort ?? "auto";
    const effortOptions = getReasoningEffortOptionsForModel(selection.model);
    return {
      model: selection.model,
      effort:
        requestedEffort === "auto" || effortOptions.includes(requestedEffort)
          ? requestedEffort
          : "auto",
    };
  }
  const preferredGroup = groups.find(
    (group) =>
      group.engine === selection.engine &&
      group.models.includes(selection.model),
  );
  const fallbackGroup = groups.find((group) =>
    group.models.includes(selection.model),
  );
  if (groups.length > 0 && !preferredGroup && !fallbackGroup) {
    return undefined;
  }
  const engine =
    preferredGroup?.engine ?? fallbackGroup?.engine ?? selection.engine;
  if (!engine && groups.length > 0) return undefined;

  const requestedEffort = selection.effort ?? "auto";
  const effortOptions = getReasoningEffortOptionsForModel(selection.model);
  const effort =
    requestedEffort === "auto" || effortOptions.includes(requestedEffort)
      ? requestedEffort
      : "auto";
  const resolved: ModelSelection = { model: selection.model, effort };
  if (engine) resolved.engine = engine;
  return resolved;
}

// ─── Skeleton Loader ─────────────────────────────────────────────────────────

function ChatSkeleton({
  header,
  headerOnly = false,
}: {
  header?: React.ReactNode;
  headerOnly?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col min-h-0",
        headerOnly ? "shrink-0" : "flex-1 h-full",
      )}
    >
      {header ?? (
        <div className="flex items-center px-1 py-1 border-b border-border shrink-0 gap-0.5">
          <div className="h-[22px] w-20 rounded-md bg-muted animate-pulse" />
          <div className="ml-auto flex gap-0.5">
            <div className="h-[22px] w-[22px] rounded-md bg-muted animate-pulse" />
            <div className="h-[22px] w-[22px] rounded-md bg-muted animate-pulse" />
          </div>
        </div>
      )}
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

// ─── Scope Badge ─────────────────────────────────────────────────────────────

function formatScopeType(type: string) {
  return type.replace(/[-_]+/g, " ");
}

function indefiniteArticleFor(value: string) {
  return /^[aeiou]/i.test(value.trim()) ? "an" : "a";
}

function getScopeCopy(scope: ChatThreadScope, isCurrentScope: boolean) {
  const type = formatScopeType(scope.type);
  const fallbackObject = isCurrentScope
    ? `this ${type}`
    : `${indefiniteArticleFor(type)} ${type}`;
  const objectLabel = scope.label || fallbackObject;
  return {
    objectLabel,
    chipLabel:
      scope.label || (isCurrentScope ? `this ${type}` : `${type} context`),
  };
}

/**
 * Thin context chip at the top of a scoped chat. Click → popover with
 * related chats and the remove-context action. The chip stays unobtrusive
 * when the user doesn't need it, but remains available as the escape hatch
 * for taking a scoped chat back to a general one.
 */
function ScopeBadge({
  scope,
  currentScope,
  onDetach,
  otherScopedThreads,
  activeThreadId,
  openTabIds,
  onSelectThread,
}: {
  scope: ChatThreadScope;
  currentScope?: ChatThreadScope | null;
  onDetach: () => void;
  /** Other threads scoped to the same resource (excluding the active one),
   *  pre-sorted most-recent-first. The chip popover lists these so the user
   *  can hop between this resource's chats without opening the full history. */
  otherScopedThreads: ChatThreadSummary[];
  activeThreadId: string;
  openTabIds: Set<string>;
  onSelectThread: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isCurrentScope = Boolean(
    currentScope &&
    currentScope.type === scope.type &&
    currentScope.id === scope.id,
  );
  const hasDifferentCurrentScope = Boolean(currentScope && !isCurrentScope);
  const { objectLabel, chipLabel } = getScopeCopy(scope, isCurrentScope);
  const heading = `Using ${chipLabel}`;
  const detailSuffix = hasDifferentCurrentScope
    ? "Start a new chat to use the current page."
    : isCurrentScope
      ? "New chats here keep this context."
      : "Start a new chat for a general conversation.";
  const otherCount = otherScopedThreads.length;
  return (
    <div className="flex items-center justify-center py-1 px-3 text-[11px] text-muted-foreground border-b border-border/40 shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 hover:bg-accent/50 hover:text-foreground cursor-pointer"
            aria-label={heading}
          >
            <IconLink size={11} className="shrink-0 opacity-70" />
            <span className="truncate max-w-[220px]">{heading}</span>
            {otherCount > 0 && (
              <span
                className="ml-0.5 rounded-full bg-muted px-1.5 py-px text-[10px] leading-none text-muted-foreground"
                aria-label={`${otherCount} other chats for ${objectLabel}`}
              >
                +{otherCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" side="bottom" className="w-72 p-0">
          <p className="px-3 pt-2 pb-1.5 text-[11px] text-muted-foreground">
            This chat can see{" "}
            <span className="text-foreground">{objectLabel}</span>.{" "}
            {detailSuffix}
          </p>
          {otherCount > 0 && (
            <div className="border-t border-border">
              <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                Chats for {objectLabel}
              </div>
              <div className="max-h-56 overflow-y-auto pb-1">
                {otherScopedThreads.map((thread) =>
                  renderThreadRow(
                    thread,
                    activeThreadId,
                    openTabIds,
                    formatThreadTime,
                    onSelectThread,
                    () => setOpen(false),
                  ),
                )}
              </div>
            </div>
          )}
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDetach();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
            >
              <IconLinkOff size={13} />
              <span>Remove context</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Empty-state addon shown when the user starts a fresh chat inside a
 * scoped surface that already has other threads. Surfaces those threads
 * inline so chats don't feel "lost" after the user navigates away and
 * back — the chip popover lists them too, but this nudge is visible
 * without any extra clicks.
 */
function PreviousScopedChatsHint({
  scope,
  threads,
  onSelectThread,
}: {
  scope: ChatThreadScope;
  threads: ChatThreadSummary[];
  onSelectThread: (id: string) => void;
}) {
  const MAX_INLINE = 3;
  const shown = threads.slice(0, MAX_INLINE);
  const remaining = threads.length - shown.length;
  const scopeLabel = scope.label || `this ${formatScopeType(scope.type)}`;
  return (
    <div className="flex w-full max-w-[280px] flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 text-center">
        Previous chats for {scopeLabel}
      </div>
      <div className="flex flex-col gap-1">
        {shown.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => onSelectThread(thread.id)}
            className="flex items-baseline justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left hover:bg-accent cursor-pointer"
          >
            <span className="truncate text-[12px] text-foreground">
              {thread.title || thread.preview || "Chat"}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatThreadTime(thread.updatedAt)}
            </span>
          </button>
        ))}
      </div>
      {remaining > 0 && (
        <div className="text-[10px] text-muted-foreground/70 text-center">
          +{remaining} more
        </div>
      )}
    </div>
  );
}

/**
 * Thin confirmation banner shown briefly after detach. The chip itself
 * unmounts the moment scope clears on the active thread, so this banner
 * holds the visual feedback long enough for the user to register what
 * just happened and learn where the chat went (History popover).
 */
function DetachConfirmationBanner() {
  return (
    <div className="flex items-center justify-center py-1 px-3 text-[11px] text-muted-foreground border-b border-border/40 shrink-0">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/40 px-2 py-0.5 text-foreground">
        <IconCheck size={11} className="shrink-0 opacity-80" />
        <span>Context removed. Find this chat in History.</span>
      </span>
    </div>
  );
}

// ─── History Popover ─────────────────────────────────────────────────────────

function formatThreadTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderThreadRow(
  thread: ChatThreadSummary,
  activeThreadId: string | null,
  openTabIds: Set<string>,
  formatTime: (ts: number) => string,
  onSelect: (id: string) => void,
  onClose: () => void,
) {
  const isActive = thread.id === activeThreadId;
  return (
    <button
      key={thread.id}
      onClick={() => {
        onSelect(thread.id);
        onClose();
      }}
      className={cn(
        "w-full px-3 py-2 text-left hover:bg-accent/50 cursor-pointer",
        isActive && "bg-accent/30",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground truncate">
          {thread.title || thread.preview || "Chat"}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {isActive
            ? "Active"
            : openTabIds.has(thread.id)
              ? "Open"
              : formatTime(thread.updatedAt)}
        </span>
      </div>
      {thread.preview && thread.title !== thread.preview && (
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">
          {thread.preview}
        </div>
      )}
      {thread.scope?.label && (
        <div className="mt-0.5 text-[10px] text-muted-foreground/70 truncate">
          {thread.scope.label}
        </div>
      )}
    </button>
  );
}

function HistoryPopover({
  threads,
  openTabIds,
  activeThreadId,
  currentScope,
  onSelect,
  onClose,
  onSearch,
}: {
  threads: ChatThreadSummary[];
  openTabIds: Set<string>;
  activeThreadId: string | null;
  currentScope?: ChatThreadScope | null;
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

  // Hide empty threads from the history list — except the currently-active
  // one. The active thread always belongs in the list so the user can see
  // they're in it (the previous filter dropped a brand-new chat the user
  // had just opened, making them think their chat had vanished).
  const visibleThreads = threads.filter(
    (t) => t.messageCount > 0 || t.id === activeThreadId,
  );

  const filtered = search.trim()
    ? (searchResults ?? visibleThreads).filter(
        (t) => t.messageCount > 0 || t.id === activeThreadId,
      )
    : visibleThreads;

  // When scope is set we split history into two sections so the user can
  // see "this deck's chats" first without losing access to general /
  // other-deck chats. Section labels intentionally use the current
  // resource type (deck/design/dashboard) instead of a generic phrase.
  const sectionedThreads = currentScope
    ? {
        scoped: filtered.filter(
          (t) =>
            t.scope?.type === currentScope.type &&
            t.scope?.id === currentScope.id,
        ),
        other: filtered.filter(
          (t) =>
            !t.scope ||
            t.scope.type !== currentScope.type ||
            t.scope.id !== currentScope.id,
        ),
      }
    : null;

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
            placeholder="Search chats..."
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
              {search ? "No matching chats" : "No chats yet"}
            </div>
          ) : sectionedThreads ? (
            <>
              {sectionedThreads.scoped.length > 0 && (
                <>
                  <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    This {currentScope!.type}
                  </div>
                  {sectionedThreads.scoped.map((thread) =>
                    renderThreadRow(
                      thread,
                      activeThreadId,
                      openTabIds,
                      formatThreadTime,
                      onSelect,
                      onClose,
                    ),
                  )}
                </>
              )}
              {sectionedThreads.other.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    All chats
                  </div>
                  {sectionedThreads.other.map((thread) =>
                    renderThreadRow(
                      thread,
                      activeThreadId,
                      openTabIds,
                      formatThreadTime,
                      onSelect,
                      onClose,
                    ),
                  )}
                </>
              )}
            </>
          ) : (
            filtered.map((thread) =>
              renderThreadRow(
                thread,
                activeThreadId,
                openTabIds,
                formatThreadTime,
                onSelect,
                onClose,
              ),
            )
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
    { name: "/history", description: "Browse all chats" },
    { name: "/plan", description: "Switch to read-only planning" },
    { name: "/act", description: "Switch back to acting" },
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
            aria-label="Close help"
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
  /** Stable browser tab id used for tab-scoped app-state context. */
  browserTabId?: string;
  /**
   * Bind new chats to a resource (deck, design, dashboard, etc.). When set,
   * the tab bar, history popover, and active-thread persistence all
   * partition by `{type, id}` — switching resources lands the user on the
   * thread they last had open for that resource, not whichever chat was
   * globally active. New chats automatically inherit this scope; the user
   * can detach a chat via the scope chip above the composer.
   */
  scope?: ChatThreadScope | null;
};

export function MultiTabAssistantChat({
  showTabBar = true,
  renderHeader,
  renderOverlay,
  contentHidden = false,
  apiUrl = agentNativePath("/_agent-native/agent-chat"),
  storageKey,
  browserTabId,
  scope = null,
  ...props
}: MultiTabAssistantChatProps) {
  const {
    threads,
    activeThreadId,
    isLoading,
    createThread,
    switchThread,
    deleteThread,
    detachThread,
    forkThread,
    saveThreadData,
    generateTitle,
    searchThreads,
    refreshThreads,
    isNewThread,
  } = useChatThreads(apiUrl, storageKey, scope);

  // Namespace all localStorage keys by storageKey when provided (for per-app isolation in frame)
  const keyPrefix = storageKey ? `:${storageKey}` : "";
  const modelSelectionKey = `${MODEL_SELECTION_STORAGE_KEY}${keyPrefix}`;

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
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_MODEL);
  const threadModelRef = useRef<
    Map<string, { model: string; engine?: string; effort?: ReasoningEffort }>
  >(new Map());
  const [persistedModelSelection, setPersistedModelSelection] = useState<
    ModelSelection | undefined
  >(() => readStoredModelSelection(modelSelectionKey));
  const [modelSelectionVersion, setModelSelectionVersion] = useState(0);

  useEffect(() => {
    setPersistedModelSelection(readStoredModelSelection(modelSelectionKey));
  }, [modelSelectionKey]);

  const bumpModelSelectionVersion = useCallback(() => {
    setModelSelectionVersion((version) => version + 1);
  }, []);
  const postMessageSubmissionsDisabled = props.composerDisabled === true;

  const resolveThreadModelSelection = useCallback(
    (threadId: string) =>
      resolveModelSelection(
        threadModelRef.current.get(threadId) ?? persistedModelSelection,
        availableModels,
      ),
    [availableModels, persistedModelSelection, modelSelectionVersion],
  );

  const persistModelSelection = useCallback(
    (selection: ModelSelection) => {
      setPersistedModelSelection(selection);
      writeStoredModelSelection(modelSelectionKey, selection);
    },
    [modelSelectionKey],
  );

  const handleModelChange = useCallback(
    (model: string, engine: string) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;
      const existing = threadModelRef.current.get(threadId);
      const existingEffort = existing?.effort ?? "auto";
      const effortOptions = getReasoningEffortOptionsForModel(model);
      const effort =
        existingEffort === "auto" || effortOptions.includes(existingEffort)
          ? existingEffort
          : "auto";
      const selection = { model, engine, effort };
      threadModelRef.current.set(threadId, selection);
      persistModelSelection(selection);
      bumpModelSelectionVersion();
    },
    [bumpModelSelectionVersion, persistModelSelection],
  );

  const handleEffortChange = useCallback(
    (effort: ReasoningEffort) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;
      const existing = resolveThreadModelSelection(threadId);
      const model = existing?.model ?? defaultModel;
      const engine =
        existing?.engine ??
        availableModels.find((group) => group.models.includes(model))?.engine ??
        availableModels[0]?.engine;
      const selection: ModelSelection = { model, effort };
      if (engine) selection.engine = engine;
      threadModelRef.current.set(threadId, selection);
      persistModelSelection(selection);
      bumpModelSelectionVersion();
    },
    [
      availableModels,
      bumpModelSelectionVersion,
      defaultModel,
      persistModelSelection,
      resolveThreadModelSelection,
    ],
  );

  const refreshEngines = useCallback(() => {
    Promise.all([
      fetch(agentNativePath("/_agent-native/actions/manage-agent-engine"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(agentNativePath("/_agent-native/env-status"))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(agentNativePath("/_agent-native/builder/status"))
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
          ];

          // Ensure the current model shows in the list even if it's not
          // in BUILDER_SUPPORTED_MODELS (e.g. custom model string).
          if (currentModel && !builderModels.includes(currentModel)) {
            const firstGroup = groups[0];
            if (firstGroup) firstGroup.models.unshift(currentModel);
          }
        } else {
          // No Builder connection — show SDK engines this app can run.
          const allowedEngines = new Set([
            "anthropic",
            "ai-sdk:openai",
            "ai-sdk:google",
          ]);
          groups = enginesData.engines
            .filter(
              (e: any) =>
                allowedEngines.has(e.name) && e.packageInstalled !== false,
            )
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
        setDefaultModel(currentModel ?? DEFAULT_MODEL);
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
  // Per-scope: when scope changes (e.g. user navigates from Deck A to Deck
  // B), the tab bar reflects whichever tabs they had open for *that*
  // resource. We do not bleed deck A's tabs into deck B's view.
  const scopeKeyPart = scope ? `:scope:${scope.type}:${scope.id}` : "";
  const OPEN_TABS_KEY = `agent-chat-open-tabs${keyPrefix}${scopeKeyPart}`;
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

  // Rehydrate open tabs when the scope flips. Mirrors `persistedKeyRef` in
  // `useChatThreads`: on a scope change we need to read the new key BEFORE
  // the persistence effect writes the current (now-wrong) tab list under
  // that new key.
  const openTabsKeyRef = useRef(OPEN_TABS_KEY);
  useEffect(() => {
    if (openTabsKeyRef.current === OPEN_TABS_KEY) return;
    openTabsKeyRef.current = OPEN_TABS_KEY;
    initializedRef.current = false;
    try {
      const saved = localStorage.getItem(OPEN_TABS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const id of parsed) mountedTabsRef.current.add(id);
          setOpenTabIds(parsed);
          return;
        }
      }
    } catch {}
    setOpenTabIds([]);
  }, [OPEN_TABS_KEY]);

  // Look up the active thread's actual scope from the list — when the
  // user opens a chat from history that was scoped to a different
  // resource, the badge should advertise that thread's binding, not
  // necessarily the resource currently in the viewport. When the thread
  // and the live prop refer to the same resource, prefer the prop's
  // label so a rename or a deferred deck-title load shows up in the UI
  // without waiting on the next persistence cycle.
  const activeThreadScope = useMemo<ChatThreadScope | null>(() => {
    if (!activeThreadId) return null;
    const t = threads.find((x) => x.id === activeThreadId);
    const stored = t?.scope ?? null;
    if (!stored) return null;
    if (scope && stored.type === scope.type && stored.id === scope.id) {
      return { ...stored, label: scope.label || stored.label };
    }
    return stored;
  }, [threads, activeThreadId, scope?.type, scope?.id, scope?.label]);

  // Brief confirmation banner shown after detach. The chip itself disappears
  // the instant scope clears, which the user described as "nothing different
  // happened." We hold the confirmation in the same slot for ~2s so the
  // detach is visually acknowledged and the user is pointed at History.
  const [detachConfirmType, setDetachConfirmType] = useState<string | null>(
    null,
  );
  const detachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (detachTimerRef.current) clearTimeout(detachTimerRef.current);
    };
  }, []);
  const handleDetachActiveThread = useCallback(() => {
    if (!activeThreadId || !activeThreadScope) return;
    const type = activeThreadScope.type;
    setDetachConfirmType(type);
    if (detachTimerRef.current) clearTimeout(detachTimerRef.current);
    detachTimerRef.current = setTimeout(() => setDetachConfirmType(null), 2200);
    detachThread(activeThreadId);
  }, [activeThreadId, activeThreadScope, detachThread]);

  // Other chats scoped to the active thread's resource (excluding the active
  // thread itself). Sorted most-recent-first to match user expectation in the
  // chip popover and empty-state addon.
  const otherScopedThreads = useMemo<ChatThreadSummary[]>(() => {
    if (!activeThreadScope) return [];
    return threads
      .filter(
        (t) =>
          t.id !== activeThreadId &&
          t.scope?.type === activeThreadScope.type &&
          t.scope?.id === activeThreadScope.id,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [threads, activeThreadId, activeThreadScope]);

  // Persist open tab IDs to localStorage (exclude sub-agent tabs — they're session-only)
  useEffect(() => {
    if (openTabsKeyRef.current !== OPEN_TABS_KEY) return;
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

    // Hide tabs that have had no activity for more than 12 hours. Stale tabs
    // are removed from the sidebar on load but remain accessible via history.
    const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
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
      // Filter out tabs that no longer exist, sub-agent tabs, or stale tabs (>12h inactive)
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

  // Ensure at least one tab is always open — auto-create if sidebar is empty.
  // Skipped when an active thread already exists (e.g. the hook generated an
  // optimistic id for a brand-new session); the activeThreadId effect above
  // adds it to openTabIds without spinning up a duplicate thread.
  const autoCreatingRef = useRef(false);
  useEffect(() => {
    if (isLoading || autoCreatingRef.current) return;
    if (openTabIds.length === 0 && !activeThreadId) {
      autoCreatingRef.current = true;
      createThread().then((id) => {
        autoCreatingRef.current = false;
        if (id) {
          newThreadIds.current.add(id);
          setOpenTabIds([id]);
        }
      });
    }
  }, [isLoading, openTabIds, activeThreadId, createThread]);

  // Focus the composer when switching tabs
  useEffect(() => {
    if (!activeThreadId) return;
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
  const activeTabRefCb = useCallback((el: HTMLElement | null) => {
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
    const handler = (event: MessageEvent) => {
      if (!isTrustedFrameMessage(event)) return;
      if (event.data?.type !== "agentNative.submitChat") return;
      const message = event.data.data?.message as string;
      if (!message) return;
      const context = event.data.data?.context as string | undefined;
      const openSidebar = event.data.data?.openSidebar as boolean | undefined;
      const model = event.data.data?.model as string | undefined;
      const effort = event.data.data?.effort as unknown;
      const newTab = event.data.data?.newTab as boolean | undefined;
      const tabId = event.data.data?.tabId;
      const requestedTabId = typeof tabId === "string" ? tabId : undefined;
      const background = event.data.data?.background as boolean | undefined;

      // Make sure the sidebar is visible to show the response, unless the
      // caller explicitly opted out or it's a background send.
      if (openSidebar !== false && !background) {
        window.dispatchEvent(new CustomEvent("agent-panel:open"));
      }
      if (postMessageSubmissionsDisabled) return;

      // Plan mode is sent as request metadata by the chat adapter. Keep the
      // user-visible message clean so mode instructions never enter history.
      const fullMessage = context
        ? `${message}\n\n<context>\n${context}\n</context>`
        : message;

      const sendToTab = (threadId: string) => {
        // If a model override was specified, apply it only if we recognize it
        if (model) {
          const matchedGroup = availableModels.find((g) =>
            g.models.includes(model),
          );
          if (matchedGroup) {
            const requestedEffort = isReasoningEffort(effort) ? effort : "auto";
            const effortOptions = getReasoningEffortOptionsForModel(model);
            const selectedEffort =
              requestedEffort === "auto" ||
              effortOptions.includes(requestedEffort)
                ? requestedEffort
                : "auto";
            threadModelRef.current.set(threadId, {
              model,
              engine: matchedGroup.engine,
              effort: selectedEffort,
            });
            bumpModelSelectionVersion();
          }
        }

        const ref = chatRefs.current.get(threadId);
        if (ref) {
          ref.sendMessage(fullMessage);
        } else {
          pendingSends.current.set(threadId, fullMessage);
        }
      };

      if (newTab) {
        const previousTabId = activeThreadIdRef.current;
        createThread(requestedTabId).then((newId) => {
          if (newId) {
            newThreadIds.current.add(newId);
            sendToTab(newId);
            if (background && previousTabId) {
              switchThread(previousTabId);
            }
          }
        });
      } else {
        const currentTabId = activeThreadIdRef.current;
        if (!currentTabId) return;
        sendToTab(currentTabId);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    availableModels,
    bumpModelSelectionVersion,
    createThread,
    postMessageSubmissionsDisabled,
    switchThread,
  ]);

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
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
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
    const handleNewChat = () => {
      void addTab();
    };
    window.addEventListener("agent-chat:close-current-tab", handleCloseCurrent);
    window.addEventListener("agent-chat:close-all-tabs", handleCloseAll);
    window.addEventListener("agent-chat:new-chat", handleNewChat);
    return () => {
      window.removeEventListener(
        "agent-chat:close-current-tab",
        handleCloseCurrent,
      );
      window.removeEventListener("agent-chat:close-all-tabs", handleCloseAll);
      window.removeEventListener("agent-chat:new-chat", handleNewChat);
    };
  }, [closeTab, closeAllTabs, addTab]);

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
          agentNativePath("/_agent-native/application-state/chat-command"),
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
            fetch(
              agentNativePath("/_agent-native/application-state/chat-command"),
              {
                method: "DELETE",
                headers: { "X-Agent-Native-CSRF": "1" },
              },
            ).catch(() => {});
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
        case "plan":
          props.onExecModeChange?.("plan");
          break;
        case "act":
          props.onExecModeChange?.("build");
          break;
        case "help":
          setHelpVisible(true);
          break;
      }
    },
    [addTab, props.onExecModeChange],
  );

  const handleForkChat = useCallback(
    async (sourceThreadId: string) => {
      const sourceSnapshot =
        chatRefs.current.get(sourceThreadId)?.exportThreadSnapshot() ?? null;
      const forkedId = await forkThread(sourceThreadId, sourceSnapshot);
      if (!forkedId) return false;
      setOpenTabIds((prev) => {
        const idx = prev.indexOf(sourceThreadId);
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx + 1, 0, forkedId);
          return next;
        }
        return [...prev, forkedId];
      });
      switchThread(forkedId);
      return true;
    },
    [forkThread, switchThread],
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

  // No full-shell skeleton: the hook seeds an optimistic activeThreadId
  // synchronously so the chat shell + composer can paint on first render.
  // Per-thread restore (existing chats with history) shows its own message-area
  // skeleton inside AssistantChat — header and composer stay visible.
  if (isLoading && !activeThreadId) {
    return (
      <ChatSkeleton
        header={renderHeader?.(headerProps)}
        headerOnly={contentHidden}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
      {/* Tailwind group-hover/tab doesn't work in core package — inject directly */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".agent-tab-close{opacity:0}.agent-tab:hover .agent-tab-close{opacity:1}" +
            ".agent-tabs-scroll{scrollbar-width:none;-ms-overflow-style:none;}" +
            ".agent-tabs-scroll::-webkit-scrollbar{display:none;}",
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
                    <div className="agent-tabs-scroll flex items-center gap-0.5 min-w-0 overflow-x-auto flex-1">
                      {mainTabs.map((tab) => {
                        const isActive =
                          tab.id === activeThreadId ||
                          (tab.id === focusParentId &&
                            activeTab?.parentThreadId === tab.id);
                        return (
                          <div
                            key={tab.id}
                            ref={isActive ? activeTabRefCb : undefined}
                            className={cn(
                              "agent-tab relative flex items-center rounded-md text-[11px] font-medium shrink-0 max-w-[130px]",
                              isActive
                                ? "bg-accent text-foreground ring-1 ring-inset ring-border/60 shadow-sm"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => switchThread(tab.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 min-w-0 flex-1 text-left"
                            >
                              <span className="truncate pr-1">{tab.label}</span>
                              {tab.status === "running" && (
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label="Close tab"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
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
                              <IconX size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <TooltipProvider delayDuration={200}>
                      <div className="flex items-center gap-px shrink-0 ml-auto">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={addTab}
                              aria-label="New chat"
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50"
                            >
                              <IconPlus size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>New chat</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setShowHistory(!showHistory)}
                              aria-label="All chats"
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50",
                                showHistory && "bg-accent text-foreground",
                              )}
                            >
                              <IconHistory size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>All chats</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  </div>
                  {hasSubTabs && (
                    <div className="flex items-center px-1 py-0.5 border-b border-border shrink-0 gap-0.5 bg-muted/30">
                      <div className="agent-tabs-scroll flex items-center gap-0.5 min-w-0 overflow-x-auto flex-1">
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
                          <div
                            key={tab.id}
                            ref={
                              tab.id === activeThreadId
                                ? activeTabRefCb
                                : undefined
                            }
                            className={cn(
                              "agent-tab relative flex shrink-0 items-center rounded-md text-[10px] font-medium max-w-[130px]",
                              tab.id === activeThreadId
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => switchThread(tab.id)}
                              className="flex items-center gap-1 px-2 py-1 min-w-0 flex-1 text-left"
                            >
                              <span className="truncate pr-1">
                                {tab.subAgentName || tab.label}
                              </span>
                              {tab.status === "running" && (
                                <span className="w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse" />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label="Close tab"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
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
                              <IconX size={12} />
                            </button>
                          </div>
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

        {/* Scope badge — only visible when the active chat is bound to a
            resource AND the chat content itself is visible. The scope used
            here comes from the THREAD (not the component prop) so a chat
            opened from history accurately advertises its own binding,
            not whichever resource the user happens to be viewing.
            Gated on `!contentHidden` because the wrapping AgentPanel keeps
            the chat mounted (to preserve state) while Workspace/Settings
            tabs are active — without this gate the badge leaks into those
            tabs even though the chat itself is `display: none`.
            When the user just detached, we hold a confirmation banner in
            the same slot for ~2s so the action is visibly acknowledged
            before the slot collapses. */}
        {!contentHidden &&
          (activeThreadScope && activeThreadId ? (
            <ScopeBadge
              scope={activeThreadScope}
              currentScope={scope}
              onDetach={handleDetachActiveThread}
              otherScopedThreads={otherScopedThreads}
              activeThreadId={activeThreadId}
              openTabIds={new Set(openTabIds)}
              onSelectThread={openFromHistory}
            />
          ) : detachConfirmType ? (
            <DetachConfirmationBanner />
          ) : null)}

        {/* History popover — rendered inside relative container so positioning works */}
        {showHistory && (
          <HistoryPopover
            threads={threads}
            openTabIds={new Set(openTabIds)}
            activeThreadId={activeThreadId}
            currentScope={scope}
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
          .map((tabId) => {
            const modelSelection = resolveThreadModelSelection(tabId);
            const tabThread = threads.find((thread) => thread.id === tabId);
            const tabScope =
              tabThread?.scope ??
              (tabId === activeThreadId ? activeThreadScope : null);
            const tabDynamicSuggestions =
              tabId === activeThreadId && !contentHidden
                ? props.dynamicSuggestions
                : false;
            return (
              <div
                key={tabId}
                className="flex-1 min-h-0 flex-col"
                style={{
                  display:
                    contentHidden || tabId !== activeThreadId ? "none" : "flex",
                }}
              >
                <RunStuckBanner
                  threadId={tabId}
                  apiUrl={apiUrl}
                  onRetry={() => {
                    const handle = chatRefs.current.get(tabId);
                    handle?.sendMessage(
                      "Continue from where you left off and finish my last request. Do not repeat completed work.",
                    );
                  }}
                />
                <AssistantChat
                  {...props}
                  dynamicSuggestions={tabDynamicSuggestions}
                  emptyStateText={
                    tabScope?.label && tabId === activeThreadId
                      ? `Ask about ${tabScope.label}`
                      : props.emptyStateText
                  }
                  emptyStateAddon={
                    tabId === activeThreadId &&
                    tabScope &&
                    otherScopedThreads.length > 0 ? (
                      <PreviousScopedChatsHint
                        scope={tabScope}
                        threads={otherScopedThreads}
                        onSelectThread={openFromHistory}
                      />
                    ) : undefined
                  }
                  ref={(handle) => {
                    if (handle) {
                      chatRefs.current.set(tabId, handle);
                    } else {
                      chatRefs.current.delete(tabId);
                    }
                  }}
                  threadId={tabId}
                  tabId={tabId}
                  browserTabId={browserTabId}
                  contextScope={tabScope}
                  apiUrl={apiUrl}
                  isNewThread={
                    newThreadIds.current.has(tabId) || isNewThread(tabId)
                  }
                  onMessageCountChange={(count) =>
                    setMessageCounts((prev) =>
                      prev[tabId] === count
                        ? prev
                        : { ...prev, [tabId]: count },
                    )
                  }
                  onSaveThread={handleSaveThread}
                  onGenerateTitle={handleGenerateTitle}
                  onSlashCommand={handleSlashCommand}
                  selectedModel={modelSelection?.model}
                  selectedEngine={modelSelection?.engine}
                  selectedEffort={modelSelection?.effort ?? "auto"}
                  defaultModel={defaultModel}
                  availableModels={availableModels}
                  onModelChange={handleModelChange}
                  onEffortChange={handleEffortChange}
                  onForkChat={() => handleForkChat(tabId)}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}
