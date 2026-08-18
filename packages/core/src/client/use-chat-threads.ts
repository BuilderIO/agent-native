import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { agentNativePath } from "./api-path.js";

export interface ChatThreadScope {
  type: string;
  id: string;
  label?: string;
  /** Composer context key used by ambient resource context adapters. */
  contextKey?: string;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: ChatThreadScope | null;
  source?: ChatThreadSource | null;
  pinnedAt?: number | null;
  archivedAt?: number | null;
}

export interface ChatThreadSource {
  platform?: string;
  appId?: string;
  url?: string;
}

export interface ChatThreadData {
  id: string;
  ownerEmail: string;
  title: string;
  preview: string;
  threadData: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: ChatThreadScope | null;
  source?: ChatThreadSource | null;
  pinnedAt?: number | null;
  archivedAt?: number | null;
}

export interface ChatThreadSnapshot {
  threadData: string;
  title: string;
  preview: string;
  messageCount: number;
}

export interface ChatThreadShareState {
  enabled: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  revokedAt: number | null;
}

export interface ChatThreadShareLink extends ChatThreadShareState {
  token?: string;
  url: string;
}

type ThreadTitleSource = "generated" | "extracted";

interface ForkSnapshotWithScope extends ChatThreadSnapshot {
  scope: ChatThreadScope | null;
}

export interface UseChatThreadsOptions {
  /** Create an optimistic empty thread on mount when no active thread exists. */
  autoCreate?: boolean;
  /** Restore the active thread from localStorage. Defaults to true. */
  restoreActiveThread?: boolean;
  /**
   * Route-owned active thread. `undefined` preserves the legacy localStorage
   * source of truth; a string opens that thread; `null` means the URL is in
   * create/new-chat mode.
   */
  routeThreadId?: string | null;
  /** Include connected and other-app chats in list/search results. */
  includeExternal?: boolean;
}

const ACTIVE_THREAD_KEY = "agent-chat-active-thread";
const THREADS_UPDATED_EVENT = "agent-chat:threads-updated";
const THREADS_PAGE_SIZE = 50;

async function fetchThreadListPage(
  apiUrl: string,
  offset: number,
  includeExternal: boolean,
): Promise<ChatThreadSummary[] | undefined> {
  const params = new URLSearchParams();
  if (offset > 0) params.set("offset", String(offset));
  if (includeExternal) params.set("includeExternal", "1");
  const query = params.toString();
  return fetch(`${apiUrl}/threads${query ? `?${query}` : ""}`).then(
    async (res) => {
      if (!res.ok) return undefined;
      const data = await res.json();
      return (data.threads ?? []) as ChatThreadSummary[];
    },
  );
}

/**
 * Look up one thread the list page did not carry. Distinguishes the three states
 * the caller must not collapse: the thread (found), `null` (the server denies it
 * exists), and `undefined` (unreachable — nothing was learned).
 */
async function fetchThreadById(
  apiUrl: string,
  id: string,
): Promise<ChatThreadSummary | null | undefined> {
  try {
    const res = await fetch(`${apiUrl}/threads/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    return (await res.json()) as ChatThreadSummary;
  } catch {
    return undefined;
  }
}

function emitThreadsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THREADS_UPDATED_EVENT));
}

function sortThreadSummaries(
  threads: ChatThreadSummary[],
): ChatThreadSummary[] {
  return [...threads].sort((a, b) => {
    const aPinnedAt = a.pinnedAt ?? null;
    const bPinnedAt = b.pinnedAt ?? null;
    if (aPinnedAt !== null || bPinnedAt !== null) {
      if (aPinnedAt === null) return 1;
      if (bPinnedAt === null) return -1;
      if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
    }
    return b.updatedAt - a.updatedAt;
  });
}

function scopeKeySegment(scope?: ChatThreadScope | null): string {
  if (!scope) return "";
  return `:scope:${scope.type}:${scope.id}`;
}

function activeThreadStorageKey(
  storageKey?: string,
  scope?: ChatThreadScope | null,
): string {
  const scopePart = scopeKeySegment(scope);
  return storageKey
    ? `${ACTIVE_THREAD_KEY}:${storageKey}${scopePart}`
    : `${ACTIVE_THREAD_KEY}${scopePart}`;
}

function activeThreadSeenStorageKey(activeThreadKey: string): string {
  return `${activeThreadKey}:seen`;
}

function createLocalThreadId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeThreadId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function scopesMatch(
  a?: ChatThreadScope | null,
  b?: ChatThreadScope | null,
): boolean {
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

function threadCanStayVisibleInScope(
  threadScope: ChatThreadScope | null,
  currentScope?: ChatThreadScope | null,
): boolean {
  if (!threadScope) return true;
  return scopesMatch(threadScope, currentScope);
}

function nextThreadTitle(
  currentTitle: string | undefined,
  incomingTitle: string,
  incomingPreview: string,
  source: ThreadTitleSource = "extracted",
  options: { preserveUserTitle?: boolean } = {},
): string {
  if (options.preserveUserTitle && currentTitle) return currentTitle;
  if (source === "generated") return incomingTitle;
  if (!currentTitle) return incomingTitle;
  if (!incomingTitle) return currentTitle;
  if (currentTitle !== incomingTitle && currentTitle !== incomingPreview) {
    return currentTitle;
  }
  return incomingTitle;
}

export function useChatThreads(
  apiUrl = agentNativePath("/_agent-native/agent-chat"),
  storageKey?: string,
  scope?: ChatThreadScope | null,
  options?: UseChatThreadsOptions,
) {
  const autoCreate = options?.autoCreate !== false;
  const restoreActiveThread = options?.restoreActiveThread !== false;
  const includeExternal = options?.includeExternal === true;
  const routeControlsActiveThread = options?.routeThreadId !== undefined;
  const routeThreadId = normalizeThreadId(options?.routeThreadId);
  // Each (storageKey, scope) pair gets its own active-thread localStorage key
  // for chats that belong to a resource. General chats keep using the unscoped
  // key even while the user is looking at a resource, so clicking into a deck,
  // design, form, etc. doesn't make a global conversation vanish.
  const activeThreadKey = useMemo(() => {
    return activeThreadStorageKey(storageKey, scope);
  }, [storageKey, scope?.type, scope?.id]);
  // Companion key recording when the saved active thread was last live in
  // this client. A revived orphan tab (id in localStorage but not on the
  // server and not created this session) must keep its real last-seen time
  // so the 12h stale-tab cleanup can age it out — stamping it `Date.now()`
  // on every mount (the old behaviour) reset the clock forever, so
  // abandoned empty tabs never got pruned.
  const activeThreadSeenKey = useMemo(
    () => activeThreadSeenStorageKey(activeThreadKey),
    [activeThreadKey],
  );
  const initialActiveThreadRef = useRef<{
    id: string | null;
    isNew: boolean;
  } | null>(null);
  if (initialActiveThreadRef.current === null) {
    let id: string | null = null;
    let isNew = false;
    if (typeof window !== "undefined") {
      if (routeControlsActiveThread) {
        id = routeThreadId;
      } else {
        try {
          id = restoreActiveThread
            ? localStorage.getItem(activeThreadKey)
            : null;
        } catch {
          id = null;
        }
      }
      // Route-owned create mode still needs a local target immediately. The
      // URL owns which server thread is open, but an empty new chat is not a
      // server row yet and must not wait for the thread-list request to paint.
      if (!id && autoCreate) {
        id = createLocalThreadId();
        isNew = true;
      }
    }
    initialActiveThreadRef.current = { id, isNew };
  }

  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [isLoadingMoreThreads, setIsLoadingMoreThreads] = useState(false);
  const [threadsLoadError, setThreadsLoadError] = useState<string | null>(null);
  const nextThreadsOffsetRef = useRef(0);
  const latestFetchRequestRef = useRef(0);
  const threadsRef = useRef<ChatThreadSummary[]>(threads);
  threadsRef.current = threads;

  // IDs we generated client-side this session — consumers use this to know
  // whether to skip the per-thread restore skeleton, and we use it to
  // protect the optimistic-only thread from being yanked out of local
  // state when the server's threads list (which never sees it) loads.
  const newlyCreatedRef = useRef<Set<string>>(
    initialActiveThreadRef.current.isNew && initialActiveThreadRef.current.id
      ? new Set([initialActiveThreadRef.current.id])
      : new Set(),
  );
  const optimisticThreadScopesRef = useRef<Map<string, ChatThreadScope | null>>(
    new Map(),
  );
  const pendingPinnedAtRef = useRef<Map<string, number | null>>(new Map());
  const pendingArchivedAtRef = useRef<Map<string, number | null>>(new Map());
  const userRenamedThreadIdsRef = useRef<Set<string>>(new Set());
  const userRenamedClearTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const clearUserRenamedThread = useCallback((threadId: string) => {
    const timer = userRenamedClearTimersRef.current.get(threadId);
    if (timer) {
      clearTimeout(timer);
      userRenamedClearTimersRef.current.delete(threadId);
    }
    userRenamedThreadIdsRef.current.delete(threadId);
  }, []);

  const markUserRenamedThread = useCallback((threadId: string) => {
    userRenamedThreadIdsRef.current.add(threadId);
    const existingTimer = userRenamedClearTimersRef.current.get(threadId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      userRenamedClearTimersRef.current.delete(threadId);
      userRenamedThreadIdsRef.current.delete(threadId);
    }, 30_000);
    userRenamedClearTimersRef.current.set(threadId, timer);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of userRenamedClearTimersRef.current.values()) {
        clearTimeout(timer);
      }
      userRenamedClearTimersRef.current.clear();
      userRenamedThreadIdsRef.current.clear();
    };
  }, []);

  // Latest scope as a ref so `createThread` (a useCallback that we don't
  // want to depend on scope identity) reads the current value at call
  // time. The scope a new chat inherits is the one in effect when the +
  // button is clicked, not when the hook first mounted.
  const scopeRef = useRef<ChatThreadScope | null | undefined>(scope);
  scopeRef.current = scope;

  const readKnownThreadScope = useCallback(
    (id: string): ChatThreadScope | null | undefined => {
      const thread = threadsRef.current.find((t) => t.id === id);
      if (thread) return thread.scope ?? null;
      if (optimisticThreadScopesRef.current.has(id)) {
        return optimisticThreadScopesRef.current.get(id) ?? null;
      }
      return undefined;
    },
    [],
  );

  // Add a client-generated thread to the local list optimistically.
  //
  // Critically, this does NOT `POST /threads` to the server — that path was
  // creating an empty row in `chat_threads` (message_count=0, no
  // agent_runs) on every page mount and every "+" click. The server
  // already creates the row idempotently the moment the user actually
  // sends their first message (`persistSubmittedUserMessage` →
  // `createThread`), so the client doesn't need to pre-create it. This
  // makes the threads table reflect real conversations only.
  const addOptimisticThread = useCallback(
    (
      id: string,
      threadScope: ChatThreadScope | null,
      // When reviving a tab the user left open in a prior session, pass the
      // persisted last-seen time so the 12h stale-tab cleanup can still age
      // it out. Omit for genuinely new tabs (defaults to now).
      seedAt?: number,
    ) => {
      const stamp =
        typeof seedAt === "number" && Number.isFinite(seedAt)
          ? seedAt
          : Date.now();
      const optimistic: ChatThreadSummary = {
        id,
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: stamp,
        updatedAt: stamp,
        scope: threadScope,
      };
      optimisticThreadScopesRef.current.set(id, threadScope);
      setThreads((prev) =>
        prev.some((t) => t.id === id) ? prev : [optimistic, ...prev],
      );
    },
    [],
  );

  // Seed the active thread synchronously so the chat shell can paint
  // immediately. This may restore the saved id or create a local-only fresh id,
  // depending on options. Creating a local id is safe: no row is POSTed here,
  // so empty page loads do not create ghost `chat_threads` rows.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadRef.current.id,
  );
  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef(false);
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const persistActiveThreadId = useCallback(
    (id: string) => {
      try {
        const threadScope = readKnownThreadScope(id);
        const targetKey =
          threadScope === undefined
            ? activeThreadKey
            : activeThreadStorageKey(storageKey, threadScope);
        localStorage.setItem(targetKey, id);
        localStorage.setItem(
          activeThreadSeenStorageKey(targetKey),
          String(Date.now()),
        );
      } catch {}
    },
    [activeThreadKey, readKnownThreadScope, storageKey],
  );

  // Persist active thread ID — and rehydrate on scope flips. When the user
  // navigates from deck A to deck B, `activeThreadKey` changes; we re-read B's
  // scoped thread only if the currently visible chat is itself scoped to a
  // different resource. Unscoped chats are global and stay visible.
  const persistedKeyRef = useRef(activeThreadKey);
  useEffect(() => {
    if (persistedKeyRef.current !== activeThreadKey) {
      if (routeControlsActiveThread) {
        persistedKeyRef.current = activeThreadKey;
        return;
      }
      const currentId = activeThreadIdRef.current;
      if (currentId) {
        const currentThreadScope = readKnownThreadScope(currentId);
        // Thread metadata not yet loaded from the server — we can't tell
        // whether the visible chat is general (stays) or scoped-elsewhere
        // (swaps). Defer until `threads` resolves and this effect re-runs;
        // we intentionally do NOT update `persistedKeyRef` so the next
        // render gets another shot. Without this guard, navigating into a
        // resource before `GET /threads` resolves silently dropped the
        // active general chat the user was just in.
        if (currentThreadScope === undefined) {
          return;
        }
        if (threadCanStayVisibleInScope(currentThreadScope, scopeRef.current)) {
          persistedKeyRef.current = activeThreadKey;
          return;
        }
      }
      persistedKeyRef.current = activeThreadKey;
      let nextActiveThreadId: string | null = null;
      try {
        nextActiveThreadId = localStorage.getItem(activeThreadKey);
      } catch {
        nextActiveThreadId = null;
      }
      // Only a known mismatch disqualifies the pointer — an unresolved scope
      // must not be read as "belongs here".
      if (nextActiveThreadId) {
        const savedScope = readKnownThreadScope(nextActiveThreadId);
        if (
          savedScope !== undefined &&
          !threadCanStayVisibleInScope(savedScope, scopeRef.current)
        ) {
          nextActiveThreadId = null;
        }
      }
      if (!nextActiveThreadId && autoCreate) {
        nextActiveThreadId = createLocalThreadId();
        newlyCreatedRef.current.add(nextActiveThreadId);
        addOptimisticThread(nextActiveThreadId, scopeRef.current ?? null);
      }
      setActiveThreadId(nextActiveThreadId);
      return;
    }
    if (!activeThreadId && !restoreActiveThread && !routeControlsActiveThread) {
      return;
    }
    try {
      if (routeControlsActiveThread && !routeThreadId) {
        localStorage.removeItem(activeThreadKey);
        localStorage.removeItem(activeThreadSeenKey);
        return;
      }
      if (activeThreadId) {
        persistActiveThreadId(activeThreadId);
      } else {
        localStorage.removeItem(activeThreadKey);
        localStorage.removeItem(activeThreadSeenKey);
      }
    } catch {}
  }, [
    activeThreadId,
    activeThreadKey,
    activeThreadSeenKey,
    addOptimisticThread,
    autoCreate,
    persistActiveThreadId,
    readKnownThreadScope,
    restoreActiveThread,
    routeControlsActiveThread,
    routeThreadId,
    storageKey,
    threads,
  ]);

  const fetchThreads = useCallback(
    async (options?: { append?: boolean }) => {
      const requestId = ++latestFetchRequestRef.current;
      try {
        const offset = options?.append ? nextThreadsOffsetRef.current : 0;
        const loaded = await fetchThreadListPage(
          apiUrl,
          offset,
          includeExternal,
        );
        if (requestId !== latestFetchRequestRef.current) return undefined;
        if (!loaded) {
          if (!options?.append) {
            setThreadsLoadError("Could not load chat history.");
          }
          return;
        }
        setThreadsLoadError(null);
        if (!options?.append) {
          nextThreadsOffsetRef.current = loaded.length;
        } else {
          nextThreadsOffsetRef.current += loaded.length;
        }
        setHasMoreThreads(loaded.length >= THREADS_PAGE_SIZE);
        setThreads((prev) => {
          const loadedIds = new Set(loaded.map((t) => t.id));
          // Preserve any optimistic threads we've created this session that
          // haven't shown up in the server list yet — the server only learns
          // about a thread when the user actually sends a message and the
          // agent run's `persistSubmittedUserMessage` writes the row.
          //
          // Archived threads are excluded here too: the server list omits
          // archived threads by default, so a thread we archived this same
          // session would otherwise look identical to a not-yet-synced
          // optimistic thread (created this session, missing from `loaded`)
          // and get preserved forever instead of disappearing once archived.
          const optimisticOnly = prev.filter(
            (t) =>
              newlyCreatedRef.current.has(t.id) &&
              !loadedIds.has(t.id) &&
              !t.archivedAt,
          );
          // Reconcile each server thread against our local copy. If the local
          // copy has a newer updatedAt or higher messageCount, keep those
          // fields — the server probably hasn't observed the user's latest
          // send yet, and naively replacing makes the recent-chats list
          // visibly jump back to older timestamps right after a send.
          const merged = loaded.map((server) => {
            const local = prev.find((t) => t.id === server.id);
            if (!local) return server;
            const next = { ...server };
            if (local.updatedAt > server.updatedAt) {
              next.updatedAt = local.updatedAt;
            }
            if (userRenamedThreadIdsRef.current.has(server.id) && local.title) {
              next.title = local.title;
            }
            if (pendingPinnedAtRef.current.has(server.id)) {
              next.pinnedAt = pendingPinnedAtRef.current.get(server.id) ?? null;
            }
            if (pendingArchivedAtRef.current.has(server.id)) {
              next.archivedAt =
                pendingArchivedAtRef.current.get(server.id) ?? null;
            }
            if (local.messageCount > server.messageCount) {
              next.messageCount = local.messageCount;
              if (local.preview) next.preview = local.preview;
              if (local.title) next.title = local.title;
            }
            // Preserve optimistic scope: when the server creates the row
            // on first message it does so without scope, and the next PUT
            // (saveThreadData) writes the local scope back. In the brief
            // window between those, the server list returns scope: null
            // while the user is clearly working inside a deck — keep the
            // local value so the tab bar doesn't blink unscoped.
            if (local.scope && !server.scope) {
              next.scope = local.scope;
            }
            return next;
          });
          if (options?.append) {
            const existingIds = new Set(prev.map((t) => t.id));
            return sortThreadSummaries([
              ...prev,
              ...merged.filter((t) => !existingIds.has(t.id)),
            ]);
          }
          return [...optimisticOnly, ...merged];
        });
        return loaded;
      } catch {
        if (requestId !== latestFetchRequestRef.current) return undefined;
        if (!options?.append) {
          setThreadsLoadError("Could not load chat history.");
        }
        return undefined;
      }
    },
    [apiUrl, includeExternal],
  );

  const loadMoreThreads = useCallback(async (): Promise<void> => {
    if (isLoadingMoreThreads || !hasMoreThreads) return;
    setIsLoadingMoreThreads(true);
    try {
      await fetchThreads({ append: true });
    } finally {
      setIsLoadingMoreThreads(false);
    }
  }, [fetchThreads, hasMoreThreads, isLoadingMoreThreads]);

  // Initial load: load threads from server, then reconcile against the
  // saved active thread.
  //
  // - savedId in loadedThreads → keep it (user's last conversation).
  // - savedId in newlyCreatedRef (we just created it this session) → keep
  //   it; the server hasn't seen it yet because there's no POST anymore,
  //   the row gets written when the user sends a message.
  // - savedId is set but not on the current page → look it up directly. A
  //   found thread stays active. An unavailable lookup keeps the saved id for
  //   list-only readers and explicit routes, while a normal home surface drops
  //   a dead local pointer instead of opening with a restore error.
  // - No savedId → synthesize a fresh local id (no POST; server creates the
  //   row on first message). The server may contain chats from another
  //   branch, preview, or project that shares the same user/database, so
  //   auto-opening the latest server thread here leaks unrelated context into
  //   a fresh surface. Existing threads remain available in History.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      const loadedThreads = await fetchThreads();
      const restoredId = activeThreadIdRef.current;
      if (loadedThreads === undefined) {
        // Thread-list fetch failed. Do not reclassify a saved id as a new
        // optimistic tab; AssistantChat should still get a chance to restore
        // the specific saved thread via /threads/:id.
        setIsLoading(false);
        return;
      }
      // Exempts route-owned threads (the URL names what the user asked for) and
      // ids this client generated, which have never reached the server.
      const lookupRestored = Boolean(
        restoredId &&
        !routeControlsActiveThread &&
        !newlyCreatedRef.current.has(restoredId),
      );
      const restoredOnPage = restoredId
        ? loadedThreads.find((t) => t.id === restoredId)
        : undefined;
      // One page, so absence from it is not absence from the server — this is what
      // separates an older real thread from an unavailable saved id below.
      const restoredThread =
        lookupRestored && !restoredOnPage
          ? await fetchThreadById(apiUrl, restoredId!)
          : restoredOnPage;
      if (restoredThread === undefined && lookupRestored && !restoredOnPage) {
        // Lookup unreachable. Reclassifying now would stamp this thread with the
        // current scope on a guess; leave it untouched for the next mount.
        setIsLoading(false);
        return;
      }
      const restoredIsUnavailable =
        restoredThread === null && lookupRestored && !restoredOnPage;
      const restoredBelongsElsewhere = Boolean(
        restoredThread &&
        !threadCanStayVisibleInScope(
          restoredThread.scope ?? null,
          scopeRef.current,
        ),
      );
      // A missing saved id is stale local UI state on a normal home surface,
      // not a reason to show an error above a fresh composer. Preserve it for
      // explicit routes and list-only readers, where the caller still owns
      // recovery for a deliberately selected thread.
      const restoredNeedsReplacement =
        restoredBelongsElsewhere ||
        (restoredIsUnavailable && autoCreate && !routeControlsActiveThread);
      if (restoredNeedsReplacement) setActiveThreadId(null);
      const savedId = restoredNeedsReplacement ? null : restoredId;
      const loadedHasSavedId = Boolean(
        savedId &&
        (restoredThread || loadedThreads.some((t) => t.id === savedId)),
      );
      const savedIdCameFromRoute =
        Boolean(savedId) &&
        routeControlsActiveThread &&
        routeThreadId === savedId;

      if (
        savedId &&
        newlyCreatedRef.current.has(savedId) &&
        !loadedHasSavedId
      ) {
        addOptimisticThread(savedId, scopeRef.current ?? null);
      } else if (savedId && savedIdCameFromRoute && !loadedHasSavedId) {
        // A deep link may point to a thread that is not in the current list
        // response. Keep it route-owned so AssistantChat can restore it via
        // /threads/:id instead of reclassifying it as a new empty tab.
        setActiveThreadId(savedId);
      } else if (
        savedId &&
        !newlyCreatedRef.current.has(savedId) &&
        !loadedHasSavedId &&
        !restoredIsUnavailable
      ) {
        // The tab the user left open isn't a server thread and we didn't
        // create it this session (newlyCreatedRef was wiped by the
        // reload). Treat it as the empty tab it is — keep its id and
        // surface it as an optimistic thread so the tab bar restores it
        // verbatim instead of yanking in the most-recent old chat.
        newlyCreatedRef.current.add(savedId);
        // Seed from the persisted last-seen time (not now) so a tab the
        // user abandoned >12h ago is correctly recognized as stale and
        // pruned by the downstream cleanup instead of living forever.
        let seenAt: number | undefined;
        try {
          const raw = localStorage.getItem(activeThreadSeenKey);
          const parsed = raw ? Number.parseInt(raw, 10) : NaN;
          if (Number.isFinite(parsed)) seenAt = parsed;
        } catch {
          // localStorage unavailable — fall back to now (current behaviour).
        }
        addOptimisticThread(savedId, scopeRef.current ?? null, seenAt);
        // activeThreadId already === savedId from the localStorage
        // initializer; nothing else to set.
      } else if (!savedId && autoCreate) {
        // Brand new surface — synthesize a local id so the composer has a
        // target. No POST: the server creates the row on first send.
        const id = createLocalThreadId();
        newlyCreatedRef.current.add(id);
        addOptimisticThread(id, scopeRef.current ?? null);
        setActiveThreadId(id);
      }
      setIsLoading(false);
    })();
  }, [
    apiUrl,
    fetchThreads,
    addOptimisticThread,
    autoCreate,
    routeControlsActiveThread,
    routeThreadId,
  ]);

  const createThread = useCallback(
    (preferredId?: string): Promise<string | null> => {
      // Generate ID client-side for instant UI response. No POST — the
      // server creates the row when the user actually sends a message,
      // which prevents accumulation of empty thread rows when the user
      // clicks "+" but never chats.
      const id = preferredId || createLocalThreadId();
      newlyCreatedRef.current.add(id);
      addOptimisticThread(id, scopeRef.current ?? null);
      persistActiveThreadId(id);
      setActiveThreadId(id);
      return Promise.resolve(id);
    },
    [addOptimisticThread, persistActiveThreadId],
  );

  useEffect(() => {
    if (!routeControlsActiveThread) return;
    if (routeThreadId) {
      if (activeThreadIdRef.current !== routeThreadId) {
        setActiveThreadId(routeThreadId);
      }
      return;
    }

    const currentId = activeThreadIdRef.current;
    const currentThread = currentId
      ? threadsRef.current.find((thread) => thread.id === currentId)
      : undefined;
    const currentIsUnsavedNewThread =
      currentId !== null &&
      newlyCreatedRef.current.has(currentId) &&
      (currentThread?.messageCount ?? 0) === 0;
    if (currentIsUnsavedNewThread) return;

    if (!autoCreate) {
      if (currentId !== null) setActiveThreadId(null);
      return;
    }

    const id = createLocalThreadId();
    newlyCreatedRef.current.add(id);
    addOptimisticThread(id, scopeRef.current ?? null);
    setActiveThreadId(id);
  }, [
    addOptimisticThread,
    autoCreate,
    routeControlsActiveThread,
    routeThreadId,
  ]);

  // Drop a thread's scope so it becomes a general (cross-resource) chat.
  // This is the "Detach from <deck>" escape hatch in the UI. The PUT
  // also bumps the thread's updatedAt so it surfaces in the All Chats
  // list right away.
  const detachThread = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope: null }),
          },
        );
        if (!res.ok) {
          // Server rejected the detach (403/404/500) — resync from the
          // server instead of applying a scope change that didn't happen.
          await fetchThreads();
          return;
        }
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, scope: null } : t)),
        );
        optimisticThreadScopesRef.current.set(threadId, null);
        emitThreadsUpdated();
      } catch {
        await fetchThreads().catch(() => {});
      }
    },
    [apiUrl, fetchThreads],
  );

  const pinThread = useCallback(
    async (threadId: string, pinned: boolean): Promise<boolean> => {
      const previousPinnedAt =
        threadsRef.current.find((t) => t.id === threadId)?.pinnedAt ?? null;
      const previousUpdatedAt =
        threadsRef.current.find((t) => t.id === threadId)?.updatedAt ?? null;
      const now = Date.now();
      const pinnedAt = pinned ? now : null;
      pendingPinnedAtRef.current.set(threadId, pinnedAt);
      const rollback = () => {
        if (pendingPinnedAtRef.current.get(threadId) !== pinnedAt) return;
        pendingPinnedAtRef.current.delete(threadId);
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  pinnedAt: previousPinnedAt,
                  updatedAt: previousUpdatedAt ?? t.updatedAt,
                }
              : t,
          ),
        );
      };
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, pinnedAt } : t)),
      );
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}/pin`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pinned }),
          },
        );
        if (!res.ok) {
          rollback();
          await fetchThreads();
          return false;
        }
        if (pendingPinnedAtRef.current.get(threadId) === pinnedAt) {
          pendingPinnedAtRef.current.delete(threadId);
        }
        emitThreadsUpdated();
        return true;
      } catch {
        rollback();
        await fetchThreads();
        return false;
      }
    },
    [apiUrl, fetchThreads],
  );

  const archiveThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      const previousArchivedAt =
        threadsRef.current.find((t) => t.id === threadId)?.archivedAt ?? null;
      const previousUpdatedAt =
        threadsRef.current.find((t) => t.id === threadId)?.updatedAt ?? null;
      const previousActiveThreadId = activeThreadIdRef.current;
      const archivedAt = Date.now();
      pendingArchivedAtRef.current.set(threadId, archivedAt);
      const rollback = () => {
        if (pendingArchivedAtRef.current.get(threadId) !== archivedAt) return;
        pendingArchivedAtRef.current.delete(threadId);
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  archivedAt: previousArchivedAt,
                  updatedAt: previousUpdatedAt ?? t.updatedAt,
                }
              : t,
          ),
        );
        if (
          previousActiveThreadId === threadId &&
          activeThreadIdRef.current === null
        ) {
          setActiveThreadId(threadId);
        }
      };
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, archivedAt } : t)),
      );
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}/archive`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: true }),
          },
        );
        if (!res.ok) {
          rollback();
          await fetchThreads();
          return false;
        }
        if (pendingArchivedAtRef.current.get(threadId) === archivedAt) {
          pendingArchivedAtRef.current.delete(threadId);
        }
        if (threadId === activeThreadIdRef.current) {
          setActiveThreadId(null);
        }
        emitThreadsUpdated();
        return true;
      } catch {
        rollback();
        await fetchThreads();
        return false;
      }
    },
    [apiUrl, fetchThreads],
  );

  const renameThread = useCallback(
    async (threadId: string, title: string): Promise<boolean> => {
      const nextTitle = title.replace(/\s+/g, " ").trim().slice(0, 160);
      if (!nextTitle) return false;

      const previousTitle = threadsRef.current.find(
        (t) => t.id === threadId,
      )?.title;
      const rollback = () => {
        const currentTitle = threadsRef.current.find(
          (t) => t.id === threadId,
        )?.title;
        if (currentTitle !== nextTitle) return;
        clearUserRenamedThread(threadId);
        if (previousTitle !== undefined) {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === threadId ? { ...t, title: previousTitle } : t,
            ),
          );
        }
      };
      markUserRenamedThread(threadId);
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, title: nextTitle } : t)),
      );

      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}/rename`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: nextTitle }),
          },
        );
        if (!res.ok) {
          rollback();
          await fetchThreads();
          return false;
        }
        emitThreadsUpdated();
        return true;
      } catch {
        rollback();
        await fetchThreads();
        return false;
      }
    },
    [apiUrl, clearUserRenamedThread, fetchThreads, markUserRenamedThread],
  );

  const isNewThread = useCallback(
    (id: string) => newlyCreatedRef.current.has(id),
    [],
  );

  const switchThread = useCallback(
    (id: string) => {
      persistActiveThreadId(id);
      setActiveThreadId(id);
    },
    [persistActiveThreadId],
  );

  const removeThread = useCallback(
    async (id: string) => {
      try {
        await fetch(`${apiUrl}/threads/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        emitThreadsUpdated();
      } catch {}
      clearUserRenamedThread(id);
      optimisticThreadScopesRef.current.delete(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (id === activeThreadIdRef.current) {
        // Switch to the next available thread, or create a new one if the
        // list is now empty. Computed outside the setThreads updater so the
        // updater stays pure (StrictMode double-invokes updaters, which would
        // otherwise create duplicate optimistic threads on the empty branch).
        const remaining = threadsRef.current.filter((t) => t.id !== id);
        if (remaining.length > 0) {
          setActiveThreadId(remaining[0].id);
        } else {
          createThread();
        }
      }
    },
    [apiUrl, clearUserRenamedThread, createThread],
  );

  // Reads scope through refs so this callback survives every setThreads. Scope
  // rides only on creation: a periodic save must never move an existing thread
  // between resources, however stale this client's guess is.
  const saveThreadData = useCallback(
    async (
      id: string,
      data: {
        threadData: string;
        title: string;
        preview: string;
        messageCount?: number;
        titleSource?: ThreadTitleSource;
      },
    ) => {
      try {
        const { titleSource, ...threadDataPayload } = data;
        const localThread = threadsRef.current.find((t) => t.id === id);
        const knownScope = readKnownThreadScope(id) ?? null;
        const preserveUserTitle = userRenamedThreadIdsRef.current.has(id);
        const title = nextThreadTitle(
          localThread?.title,
          data.title,
          data.preview,
          titleSource,
          { preserveUserTitle },
        );
        const payload = { ...threadDataPayload, title };
        let response = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        // A passive realtime-voice transcript can be the first content in a
        // client-created thread, so no agent run has created its SQL row yet.
        // Materialize that row idempotently and retry the same full save.
        if (response.status === 404) {
          const created = await fetch(`${apiUrl}/threads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              title,
              ...(knownScope ? { scope: knownScope } : {}),
            }),
          });
          if (!created.ok) return;
          response = await fetch(
            `${apiUrl}/threads/${encodeURIComponent(id)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
          );
        }
        if (!response.ok) return;
        emitThreadsUpdated();
        // Update local thread list metadata. If the thread isn't in our
        // local list yet (an optimistic-only thread that the server just
        // created via persistSubmittedUserMessage), add it so HistoryPopover
        // can show it once it has messages.
        setThreads((prev) => {
          const exists = prev.some((t) => t.id === id);
          if (exists) {
            return sortThreadSummaries(
              prev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      title: nextThreadTitle(
                        t.title,
                        data.title,
                        data.preview,
                        titleSource,
                        {
                          preserveUserTitle:
                            userRenamedThreadIdsRef.current.has(id),
                        },
                      ),
                      preview: data.preview,
                      ...(data.messageCount != null && {
                        messageCount: data.messageCount,
                      }),
                      updatedAt: Date.now(),
                    }
                  : t,
              ),
            );
          }
          const now = Date.now();
          return sortThreadSummaries([
            {
              id,
              title,
              preview: data.preview,
              messageCount: data.messageCount ?? 0,
              createdAt: now,
              updatedAt: now,
              scope: scopeRef.current ?? null,
            },
            ...prev,
          ]);
        });
      } catch {}
    },
    [apiUrl, readKnownThreadScope],
  );

  const generateTitle = useCallback(
    async (threadId: string, message: string): Promise<string | null> => {
      try {
        const res = await fetch(`${apiUrl}/generate-title`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const title = data.title;
        if (!title) return null;
        if (userRenamedThreadIdsRef.current.has(threadId)) return null;
        // Update the title in local state
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, title } : t)),
        );
        return title;
      } catch {
        return null;
      }
    },
    [apiUrl],
  );

  const forkThread = useCallback(
    async (
      sourceId: string,
      sourceSnapshot?: ChatThreadSnapshot | null,
    ): Promise<string | null> => {
      const id = createLocalThreadId();
      const fallbackForkFromSnapshot = async (
        source: ForkSnapshotWithScope,
      ): Promise<ChatThreadSummary | null> => {
        const title = source.title ? `${source.title} (fork)` : "";
        const createdAt = Date.now();
        const createRes = await fetch(`${apiUrl}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            title,
            ...(source.scope ? { scope: source.scope } : {}),
          }),
        });
        if (!createRes.ok) return null;

        const saveRes = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadData: source.threadData,
              title,
              preview: source.preview,
              messageCount: source.messageCount,
              scope: source.scope,
            }),
          },
        );
        if (!saveRes.ok) return null;

        return {
          id,
          title,
          preview: source.preview,
          messageCount: source.messageCount,
          createdAt,
          updatedAt: Date.now(),
          scope: source.scope,
        };
      };

      try {
        const localScope =
          threadsRef.current.find((t) => t.id === sourceId)?.scope ?? null;
        const source =
          sourceSnapshot && sourceSnapshot.messageCount > 0
            ? { ...sourceSnapshot, scope: localScope }
            : undefined;
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(sourceId)}/fork`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...(source ? { source } : {}) }),
          },
        );
        let thread: ChatThreadSummary | null = null;
        if (!res.ok) {
          // Surface failures so a click on the Fork button isn't a silent
          // no-op when the source thread can't be found or auth has lapsed.
          console.error(
            `[chat] fork failed for ${sourceId}: ${res.status} ${res.statusText}`,
          );
          if (source && (res.status === 404 || res.status === 405)) {
            thread = await fallbackForkFromSnapshot(source);
          }
          if (!thread) return null;
        } else {
          thread = await res.json();
        }
        // thread is non-null: the null branch returned early above (line 935)
        // and the else branch always assigns it.
        const t = thread!;
        setThreads((prev) => [
          {
            id: t.id,
            title: t.title,
            preview: t.preview,
            messageCount: t.messageCount,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            scope: t.scope ?? null,
          },
          ...prev,
        ]);
        emitThreadsUpdated();
        return t.id;
      } catch (err) {
        console.error(`[chat] fork threw for ${sourceId}:`, err);
        return null;
      }
    },
    [apiUrl],
  );

  const searchThreads = useCallback(
    async (query: string): Promise<ChatThreadSummary[]> => {
      try {
        const params = new URLSearchParams({ q: query });
        if (includeExternal) params.set("includeExternal", "1");
        const res = await fetch(`${apiUrl}/threads?${params.toString()}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.threads ?? [];
      } catch {
        return [];
      }
    },
    [apiUrl, includeExternal],
  );

  const getThreadShareState = useCallback(
    async (threadId: string): Promise<ChatThreadShareState | null> => {
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}/share`,
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.share ?? null;
      } catch {
        return null;
      }
    },
    [apiUrl],
  );

  const createThreadShareLink = useCallback(
    async (threadId: string): Promise<ChatThreadShareLink | null> => {
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}/share`,
          { method: "POST" },
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.share || typeof data.url !== "string") return null;
        return { ...data.share, url: data.url };
      } catch {
        return null;
      }
    },
    [apiUrl],
  );

  const revokeThreadShareLink = useCallback(
    async (threadId: string): Promise<ChatThreadShareState | null> => {
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(threadId)}/share`,
          { method: "DELETE" },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.share ?? null;
      } catch {
        return null;
      }
    },
    [apiUrl],
  );

  const refreshThreads = useCallback(() => {
    fetchThreads();
  }, [fetchThreads]);

  return {
    threads,
    activeThreadId,
    isLoading,
    createThread,
    switchThread,
    deleteThread: removeThread,
    detachThread,
    pinThread,
    archiveThread,
    renameThread,
    forkThread,
    saveThreadData,
    generateTitle,
    searchThreads,
    loadMoreThreads,
    getThreadShareState,
    createThreadShareLink,
    revokeThreadShareLink,
    refreshThreads,
    hasMoreThreads,
    isLoadingMoreThreads,
    threadsLoadError,
    isNewThread,
  };
}
