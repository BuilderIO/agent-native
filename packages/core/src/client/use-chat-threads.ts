import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { agentNativePath } from "./api-path.js";
import { getBrowserTabId } from "./browser-tab-id.js";

export interface ChatThreadScope {
  type: string;
  id: string;
  label?: string;
  contextKey?: string;
  context?: string;
  contextVersion?: string;
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
  autoCreate?: boolean;
  restoreActiveThread?: boolean;
  browserTabId?: string;
  routeThreadId?: string | null;
  includeExternal?: boolean;
  isolateHistoryByScope?: boolean;
}

const ACTIVE_THREAD_KEY = "agent-chat-active-thread";
const THREADS_UPDATED_EVENT = "agent-chat:threads-updated";
const THREADS_PAGE_SIZE = 50;
const CLIENT_DRAFT_THREAD_PREFIX = "agent-chat-client-draft-thread:";
const MAX_THREAD_SAVE_RETRIES = 3;
const THREAD_SAVE_RETRYABLE_STATUSES = new Set([408, 409, 429]);

function shouldRetryThreadSave(status: number): boolean {
  return status >= 500 || THREAD_SAVE_RETRYABLE_STATUSES.has(status);
}

function clientDraftThreadKey(id: string): string {
  return `${CLIENT_DRAFT_THREAD_PREFIX}${encodeURIComponent(id)}`;
}

function hasClientDraftThreadMarker(id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(clientDraftThreadKey(id)) === "1";
  } catch {
    // coercion-ok: current-session drafts remain in newlyCreatedRef; without storage, an older active pointer cannot be restored either.
    return false;
  }
}

function markClientDraftThread(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(clientDraftThreadKey(id), "1");
  } catch {
    // coercion-ok: newlyCreatedRef keeps this draft active in memory; storage only preserves it across reloads.
  }
}

function clearClientDraftThreadMarker(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(clientDraftThreadKey(id));
  } catch {
    // coercion-ok: callers retain server confirmation in memory; this marker only helps classify a draft on reload.
  }
}

async function fetchThreadListPage(
  apiUrl: string,
  offset: number,
  includeExternal: boolean,
  scope?: ChatThreadScope | null,
): Promise<ChatThreadSummary[] | undefined> {
  const params = new URLSearchParams();
  if (offset > 0) params.set("offset", String(offset));
  if (includeExternal) params.set("includeExternal", "1");
  appendChatThreadScopeParams(params, scope);
  const query = params.toString();
  return fetch(`${apiUrl}/threads${query ? `?${query}` : ""}`).then(
    async (res) => {
      if (!res.ok) return undefined;
      const data = await res.json();
      return (data.threads ?? []) as ChatThreadSummary[];
    },
  );
}

async function fetchThreadById(
  apiUrl: string,
  id: string,
  scope?: ChatThreadScope | null,
): Promise<ChatThreadSummary | null | undefined> {
  try {
    const params = new URLSearchParams();
    appendChatThreadScopeParams(params, scope);
    const query = params.toString();
    const res = await fetch(
      `${apiUrl}/threads/${encodeURIComponent(id)}${query ? `?${query}` : ""}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    return (await res.json()) as ChatThreadSummary;
  } catch {
    return undefined;
  }
}

export function appendChatThreadScopeParams(
  params: URLSearchParams,
  scope?: ChatThreadScope | null,
): void {
  if (!scope) return;
  params.set("scopeType", scope.type);
  params.set("scopeId", scope.id);
}

function withChatThreadScope(
  url: string,
  scope?: ChatThreadScope | null,
): string {
  const params = new URLSearchParams();
  appendChatThreadScopeParams(params, scope);
  const query = params.toString();
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
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
  browserTabId?: string,
): string {
  const scopePart = scopeKeySegment(scope);
  const tabPart = browserTabId ? `:tab:${browserTabId}` : "";
  return storageKey
    ? `${ACTIVE_THREAD_KEY}:${storageKey}${scopePart}${tabPart}`
    : `${ACTIVE_THREAD_KEY}${scopePart}${tabPart}`;
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

function threadCanStayVisibleInHistory(
  threadScope: ChatThreadScope | null,
  currentScope?: ChatThreadScope | null,
  isolateHistoryByScope = false,
): boolean {
  if (!isolateHistoryByScope) {
    return threadCanStayVisibleInScope(threadScope, currentScope);
  }
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
  if (!currentTitle && source === "extracted") return "";
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
  const isolateHistoryByScope = options?.isolateHistoryByScope === true;
  const browserTabId =
    options?.browserTabId ??
    (typeof window === "undefined" ? undefined : getBrowserTabId());
  const isolateHistory = isolateHistoryByScope && Boolean(scope);
  const historyScope = useMemo(
    () => (isolateHistory && scope ? { type: scope.type, id: scope.id } : null),
    [isolateHistory, scope?.id, scope?.type],
  );
  const historyScopeKey = historyScope
    ? `${historyScope.type}:${historyScope.id}`
    : null;
  const routeControlsActiveThread = options?.routeThreadId !== undefined;
  const routeThreadId = normalizeThreadId(options?.routeThreadId);
  const activeThreadKey = useMemo(() => {
    return activeThreadStorageKey(storageKey, scope, browserTabId);
  }, [browserTabId, storageKey, scope?.type, scope?.id]);
  const legacyActiveThreadKey = useMemo(
    () => activeThreadStorageKey(storageKey, scope),
    [storageKey, scope?.type, scope?.id],
  );
  const activeThreadSeenKey = useMemo(
    () => activeThreadSeenStorageKey(activeThreadKey),
    [activeThreadKey],
  );
  const initialActiveThreadRef = useRef<{
    id: string | null;
    isNew: boolean;
    seenAt?: number;
  } | null>(null);
  if (initialActiveThreadRef.current === null) {
    let id: string | null = null;
    let isNew = false;
    let seenAt: number | undefined;
    if (typeof window !== "undefined") {
      if (routeControlsActiveThread) {
        id = routeThreadId;
      } else {
        try {
          id = restoreActiveThread
            ? (localStorage.getItem(activeThreadKey) ??
              (browserTabId
                ? localStorage.getItem(legacyActiveThreadKey)
                : null))
            : null;
          if (id) {
            const rawSeenAt =
              localStorage.getItem(activeThreadSeenKey) ??
              (browserTabId
                ? localStorage.getItem(
                    activeThreadSeenStorageKey(legacyActiveThreadKey),
                  )
                : null);
            const parsed = rawSeenAt ? Number.parseInt(rawSeenAt, 10) : NaN;
            if (Number.isFinite(parsed)) seenAt = parsed;
          }
        } catch {
          id = null;
        }
      }
      if (!id && autoCreate) {
        id = createLocalThreadId();
        isNew = true;
      }
    }
    initialActiveThreadRef.current = { id, isNew, seenAt };
  }

  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [isLoadingMoreThreads, setIsLoadingMoreThreads] = useState(false);
  const [threadsLoadError, setThreadsLoadError] = useState<string | null>(null);
  const [restoredThreadIdOnListFailure, setRestoredThreadIdOnListFailure] =
    useState<string | null>(null);
  const nextThreadsOffsetRef = useRef(0);
  const latestFetchRequestRef = useRef(0);
  const threadsRef = useRef<ChatThreadSummary[]>(threads);
  threadsRef.current = threads;

  const newlyCreatedRef = useRef<Set<string>>(
    initialActiveThreadRef.current.isNew && initialActiveThreadRef.current.id
      ? new Set([initialActiveThreadRef.current.id])
      : new Set(),
  );
  const optimisticThreadScopesRef = useRef<Map<string, ChatThreadScope | null>>(
    new Map(),
  );
  const knownThreadScopesRef = useRef<Map<string, ChatThreadScope | null>>(
    new Map(),
  );
  const serverConfirmedThreadIdsRef = useRef<Set<string>>(new Set());
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

  const scopeRef = useRef<ChatThreadScope | null | undefined>(scope);
  scopeRef.current = scope;

  const readKnownThreadScope = useCallback(
    (id: string): ChatThreadScope | null | undefined => {
      const thread = threadsRef.current.find((t) => t.id === id);
      if (thread) return thread.scope ?? null;
      if (optimisticThreadScopesRef.current.has(id)) {
        return optimisticThreadScopesRef.current.get(id) ?? null;
      }
      if (knownThreadScopesRef.current.has(id)) {
        return knownThreadScopesRef.current.get(id) ?? null;
      }
      return undefined;
    },
    [],
  );

  const addOptimisticThread = useCallback(
    (id: string, threadScope: ChatThreadScope | null, seedAt?: number) => {
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

  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadRef.current.id,
  );
  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef(false);
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const initialDraftMarkerWrittenRef = useRef(false);

  const persistActiveThreadId = useCallback(
    (id: string) => {
      try {
        const threadScope = readKnownThreadScope(id);
        const targetKey =
          threadScope === undefined
            ? activeThreadKey
            : activeThreadStorageKey(storageKey, threadScope, browserTabId);
        localStorage.setItem(targetKey, id);
        localStorage.setItem(
          activeThreadSeenStorageKey(targetKey),
          String(Date.now()),
        );
        if (
          !initialDraftMarkerWrittenRef.current &&
          initialActiveThreadRef.current?.id === id &&
          initialActiveThreadRef.current.isNew
        ) {
          initialDraftMarkerWrittenRef.current = true;
          markClientDraftThread(id);
        }
        const legacyScope =
          threadScope !== undefined ? threadScope : (scopeRef.current ?? null);
        if (browserTabId) {
          const legacyKey = activeThreadStorageKey(storageKey, legacyScope);
          localStorage.setItem(legacyKey, id);
          localStorage.setItem(
            activeThreadSeenStorageKey(legacyKey),
            String(Date.now()),
          );
        }
      } catch {}
    },
    [activeThreadKey, browserTabId, readKnownThreadScope, storageKey],
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
        if (currentThreadScope === undefined) {
          return;
        }
        if (
          threadCanStayVisibleInHistory(
            currentThreadScope,
            scopeRef.current,
            isolateHistory,
          )
        ) {
          persistedKeyRef.current = activeThreadKey;
          return;
        }
      }
      persistedKeyRef.current = activeThreadKey;
      let nextActiveThreadId: string | null = null;
      try {
        nextActiveThreadId =
          localStorage.getItem(activeThreadKey) ??
          (browserTabId ? localStorage.getItem(legacyActiveThreadKey) : null);
      } catch {
        nextActiveThreadId = null;
      }
      // Only a known mismatch disqualifies the pointer — an unresolved scope
      // must not be read as "belongs here".
      if (nextActiveThreadId) {
        const savedScope = readKnownThreadScope(nextActiveThreadId);
        if (
          savedScope !== undefined &&
          !threadCanStayVisibleInHistory(
            savedScope,
            scopeRef.current,
            isolateHistory,
          )
        ) {
          nextActiveThreadId = null;
        }
      }
      if (!nextActiveThreadId && autoCreate) {
        nextActiveThreadId = createLocalThreadId();
        newlyCreatedRef.current.add(nextActiveThreadId);
        markClientDraftThread(nextActiveThreadId);
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
        if (!browserTabId && legacyActiveThreadKey !== activeThreadKey) {
          localStorage.removeItem(legacyActiveThreadKey);
        }
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
    browserTabId,
    persistActiveThreadId,
    readKnownThreadScope,
    restoreActiveThread,
    legacyActiveThreadKey,
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
          historyScope,
        );
        if (requestId !== latestFetchRequestRef.current) return undefined;
        if (!loaded) {
          if (!options?.append) {
            setThreadsLoadError("Could not load chat history.");
          }
          return;
        }
        for (const thread of loaded) {
          knownThreadScopesRef.current.set(thread.id, thread.scope ?? null);
          serverConfirmedThreadIdsRef.current.add(thread.id);
          clearClientDraftThreadMarker(thread.id);
          newlyCreatedRef.current.delete(thread.id);
        }
        setThreadsLoadError(null);
        if (!options?.append) {
          nextThreadsOffsetRef.current = loaded.length;
        } else {
          nextThreadsOffsetRef.current += loaded.length;
        }
        setHasMoreThreads(loaded.length >= THREADS_PAGE_SIZE);
        const visibleLoaded = isolateHistory
          ? loaded.filter((thread) =>
              threadCanStayVisibleInHistory(
                thread.scope,
                historyScope,
                isolateHistory,
              ),
            )
          : loaded;
        setThreads((prev) => {
          const loadedIds = new Set(visibleLoaded.map((t) => t.id));
          const optimisticOnly = prev.filter(
            (t) =>
              newlyCreatedRef.current.has(t.id) &&
              !loadedIds.has(t.id) &&
              !t.archivedAt &&
              (!isolateHistory ||
                threadCanStayVisibleInHistory(
                  t.scope,
                  historyScope,
                  isolateHistory,
                )),
          );
          const merged = visibleLoaded.map((server) => {
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
        return visibleLoaded;
      } catch {
        if (requestId !== latestFetchRequestRef.current) return undefined;
        if (!options?.append) {
          setThreadsLoadError("Could not load chat history.");
        }
        return undefined;
      }
    },
    [apiUrl, historyScope, includeExternal, isolateHistory],
  );

  const loadedHistoryScopeKeyRef = useRef(historyScopeKey);
  useEffect(() => {
    if (loadedHistoryScopeKeyRef.current === historyScopeKey) return;
    loadedHistoryScopeKeyRef.current = historyScopeKey;
    if (!isolateHistoryByScope) return;

    nextThreadsOffsetRef.current = 0;
    setHasMoreThreads(false);
    setThreadsLoadError(null);
    setThreads((prev) =>
      prev.filter(
        (thread) =>
          !isolateHistory ||
          threadCanStayVisibleInHistory(
            thread.scope,
            historyScope,
            isolateHistory,
          ),
      ),
    );
    setIsLoading(true);
    void fetchThreads().finally(() => setIsLoading(false));
  }, [
    fetchThreads,
    historyScope,
    historyScopeKey,
    isolateHistory,
    isolateHistoryByScope,
  ]);

  const loadMoreThreads = useCallback(async (): Promise<void> => {
    if (isLoadingMoreThreads || !hasMoreThreads) return;
    setIsLoadingMoreThreads(true);
    try {
      await fetchThreads({ append: true });
    } finally {
      setIsLoadingMoreThreads(false);
    }
  }, [fetchThreads, hasMoreThreads, isLoadingMoreThreads]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    void (async () => {
      const loadedThreads = await fetchThreads();
      const restoredId = activeThreadIdRef.current;
      if (loadedThreads === undefined) {
        if (
          restoredId &&
          autoCreate &&
          !routeControlsActiveThread &&
          !newlyCreatedRef.current.has(restoredId)
        ) {
          setRestoredThreadIdOnListFailure(restoredId);
        }
        setIsLoading(false);
        return;
      }
      setRestoredThreadIdOnListFailure(null);
      const lookupRestored = Boolean(
        restoredId &&
        !routeControlsActiveThread &&
        !newlyCreatedRef.current.has(restoredId) &&
        !hasClientDraftThreadMarker(restoredId),
      );
      const restoredOnPage = restoredId
        ? loadedThreads.find((t) => t.id === restoredId)
        : undefined;
      const restoredThread =
        lookupRestored && !restoredOnPage
          ? await fetchThreadById(apiUrl, restoredId!, historyScope)
          : restoredOnPage;
      if (restoredThread) {
        serverConfirmedThreadIdsRef.current.add(restoredThread.id);
        knownThreadScopesRef.current.set(
          restoredThread.id,
          restoredThread.scope ?? null,
        );
        clearClientDraftThreadMarker(restoredThread.id);
        newlyCreatedRef.current.delete(restoredThread.id);
      }
      if (restoredThread === undefined && lookupRestored && !restoredOnPage) {
        setIsLoading(false);
        return;
      }
      const restoredIsUnavailable =
        restoredThread === null && lookupRestored && !restoredOnPage;
      const restoredBelongsElsewhere = Boolean(
        restoredThread &&
        !threadCanStayVisibleInHistory(
          restoredThread.scope ?? null,
          scopeRef.current,
          isolateHistory,
        ),
      );
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
        setActiveThreadId(savedId);
      } else if (
        savedId &&
        !newlyCreatedRef.current.has(savedId) &&
        !loadedHasSavedId &&
        !restoredIsUnavailable
      ) {
        newlyCreatedRef.current.add(savedId);
        let seenAt =
          initialActiveThreadRef.current?.id === savedId
            ? initialActiveThreadRef.current.seenAt
            : undefined;
        if (seenAt === undefined) {
          try {
            const raw = localStorage.getItem(activeThreadSeenKey);
            const parsed = raw ? Number.parseInt(raw, 10) : NaN;
            if (Number.isFinite(parsed)) seenAt = parsed;
          } catch {
            // coercion-ok: without a readable age, retaining the tab with a fresh timestamp avoids discarding its draft.
          }
        }
        addOptimisticThread(savedId, scopeRef.current ?? null, seenAt);
        // activeThreadId already === savedId from the localStorage
        // initializer; nothing else to set.
      } else if (!savedId && autoCreate) {
        const id = createLocalThreadId();
        newlyCreatedRef.current.add(id);
        markClientDraftThread(id);
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
    historyScope,
    isolateHistory,
    routeControlsActiveThread,
    routeThreadId,
  ]);

  const createThread = useCallback(
    (preferredId?: string): Promise<string | null> => {
      const id = preferredId || createLocalThreadId();
      newlyCreatedRef.current.add(id);
      markClientDraftThread(id);
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
    markClientDraftThread(id);
    addOptimisticThread(id, scopeRef.current ?? null);
    setActiveThreadId(id);
  }, [
    addOptimisticThread,
    autoCreate,
    routeControlsActiveThread,
    routeThreadId,
  ]);

  const detachThread = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        const res = await fetch(
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
            historyScope,
          ),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope: null }),
          },
        );
        if (!res.ok) {
          await fetchThreads();
          return;
        }
        knownThreadScopesRef.current.set(threadId, null);
        optimisticThreadScopesRef.current.set(threadId, null);
        const wasActive = activeThreadIdRef.current === threadId;
        if (isolateHistory) {
          setThreads((prev) =>
            prev.filter(
              (thread) =>
                thread.id !== threadId &&
                threadCanStayVisibleInHistory(
                  thread.scope,
                  historyScope,
                  isolateHistory,
                ),
            ),
          );
          if (wasActive) {
            const remaining = threadsRef.current.filter(
              (thread) =>
                thread.id !== threadId &&
                threadCanStayVisibleInHistory(
                  thread.scope,
                  historyScope,
                  isolateHistory,
                ),
            );
            if (remaining.length > 0) {
              setActiveThreadId(remaining[0].id);
            } else if (autoCreate) {
              void createThread();
            } else {
              setActiveThreadId(null);
            }
          }
        } else {
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, scope: null } : t)),
          );
        }
        emitThreadsUpdated();
      } catch {
        await fetchThreads().catch(() => {});
      }
    },
    [
      apiUrl,
      autoCreate,
      createThread,
      fetchThreads,
      historyScope,
      isolateHistory,
    ],
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
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/pin`,
            historyScope,
          ),
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
    [apiUrl, fetchThreads, historyScope],
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
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/archive`,
            historyScope,
          ),
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
    [apiUrl, fetchThreads, historyScope],
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
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/rename`,
            historyScope,
          ),
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
    [
      apiUrl,
      clearUserRenamedThread,
      fetchThreads,
      historyScope,
      markUserRenamedThread,
    ],
  );

  const isNewThread = useCallback(
    (id: string) => {
      if (routeControlsActiveThread && routeThreadId === id) return false;
      if (serverConfirmedThreadIdsRef.current.has(id)) return false;
      return newlyCreatedRef.current.has(id) || hasClientDraftThreadMarker(id);
    },
    [routeControlsActiveThread, routeThreadId],
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
        await fetch(
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(id)}`,
            historyScope,
          ),
          {
            method: "DELETE",
          },
        );
        emitThreadsUpdated();
      } catch {}
      clearUserRenamedThread(id);
      optimisticThreadScopesRef.current.delete(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (id === activeThreadIdRef.current) {
        const remaining = threadsRef.current.filter((t) => t.id !== id);
        if (remaining.length > 0) {
          setActiveThreadId(remaining[0].id);
        } else {
          void createThread();
        }
      }
    },
    [apiUrl, clearUserRenamedThread, createThread, historyScope],
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
        const putThread = () =>
          fetch(
            withChatThreadScope(
              `${apiUrl}/threads/${encodeURIComponent(id)}`,
              historyScope,
            ),
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
          );
        let response = await putThread();
        if (response.status === 404) {
          const created = await fetch(
            withChatThreadScope(`${apiUrl}/threads`, historyScope),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                title,
                ...(knownScope ? { scope: knownScope } : {}),
              }),
            },
          );
          if (!created.ok && created.status !== 409) return;
          response = await putThread();
        }
        for (
          let retry = 0;
          !response.ok &&
          shouldRetryThreadSave(response.status) &&
          retry < MAX_THREAD_SAVE_RETRIES;
          retry++
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(250, 50 * (retry + 1))),
          );
          response = await putThread();
        }
        if (!response.ok) return;
        serverConfirmedThreadIdsRef.current.add(id);
        clearClientDraftThreadMarker(id);
        newlyCreatedRef.current.delete(id);
        emitThreadsUpdated();
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
    [apiUrl, historyScope, readKnownThreadScope],
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
        const createRes = await fetch(
          withChatThreadScope(`${apiUrl}/threads`, historyScope),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              title,
              ...(source.scope ? { scope: source.scope } : {}),
            }),
          },
        );
        if (!createRes.ok) return null;

        const saveRes = await fetch(
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(id)}`,
            historyScope,
          ),
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
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(sourceId)}/fork`,
            historyScope,
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...(source ? { source } : {}) }),
          },
        );
        let thread: ChatThreadSummary | null = null;
        if (!res.ok) {
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
    [apiUrl, historyScope],
  );

  const searchThreads = useCallback(
    async (query: string): Promise<ChatThreadSummary[]> => {
      try {
        const params = new URLSearchParams({ q: query });
        if (includeExternal) params.set("includeExternal", "1");
        appendChatThreadScopeParams(params, historyScope);
        const res = await fetch(`${apiUrl}/threads?${params.toString()}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.threads ?? []).filter(
          (thread: ChatThreadSummary) =>
            !isolateHistory ||
            threadCanStayVisibleInHistory(
              thread.scope,
              historyScope,
              isolateHistory,
            ),
        );
      } catch {
        return [];
      }
    },
    [apiUrl, historyScope, includeExternal, isolateHistory],
  );

  const getThreadShareState = useCallback(
    async (threadId: string): Promise<ChatThreadShareState | null> => {
      try {
        const res = await fetch(
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/share`,
            historyScope,
          ),
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.share ?? null;
      } catch {
        return null;
      }
    },
    [apiUrl, historyScope],
  );

  const createThreadShareLink = useCallback(
    async (threadId: string): Promise<ChatThreadShareLink | null> => {
      try {
        const res = await fetch(
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/share`,
            historyScope,
          ),
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
    [apiUrl, historyScope],
  );

  const revokeThreadShareLink = useCallback(
    async (threadId: string): Promise<ChatThreadShareState | null> => {
      try {
        const res = await fetch(
          withChatThreadScope(
            `${apiUrl}/threads/${encodeURIComponent(threadId)}/share`,
            historyScope,
          ),
          { method: "DELETE" },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.share ?? null;
      } catch {
        return null;
      }
    },
    [apiUrl, historyScope],
  );

  const refreshThreads = useCallback(() => {
    void fetchThreads();
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
    restoredThreadIdOnListFailure,
    isNewThread,
  };
}
