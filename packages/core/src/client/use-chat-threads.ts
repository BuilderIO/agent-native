import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { agentNativePath } from "./api-path.js";

export interface ChatThreadScope {
  type: string;
  id: string;
  label?: string;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: ChatThreadScope | null;
  pinnedAt?: number | null;
  archivedAt?: number | null;
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
  pinnedAt?: number | null;
  archivedAt?: number | null;
}

export interface ChatThreadSnapshot {
  threadData: string;
  title: string;
  preview: string;
  messageCount: number;
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
}

const ACTIVE_THREAD_KEY = "agent-chat-active-thread";
const THREADS_UPDATED_EVENT = "agent-chat:threads-updated";

function emitThreadsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THREADS_UPDATED_EVENT));
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
      try {
        id = restoreActiveThread ? localStorage.getItem(activeThreadKey) : null;
      } catch {
        id = null;
      }
      if (!id && autoCreate) {
        id = createLocalThreadId();
        isNew = true;
      }
    }
    initialActiveThreadRef.current = { id, isNew };
  }

  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
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

  // Persist active thread ID — and rehydrate on scope flips. When the user
  // navigates from deck A to deck B, `activeThreadKey` changes; we re-read B's
  // scoped thread only if the currently visible chat is itself scoped to a
  // different resource. Unscoped chats are global and stay visible.
  const persistedKeyRef = useRef(activeThreadKey);
  useEffect(() => {
    if (persistedKeyRef.current !== activeThreadKey) {
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
      if (!nextActiveThreadId && autoCreate) {
        nextActiveThreadId = createLocalThreadId();
        newlyCreatedRef.current.add(nextActiveThreadId);
        addOptimisticThread(nextActiveThreadId, scopeRef.current ?? null);
      }
      setActiveThreadId(nextActiveThreadId);
      return;
    }
    try {
      if (activeThreadId) {
        const threadScope = readKnownThreadScope(activeThreadId);
        if (threadScope === undefined) return;
        const targetKey = activeThreadStorageKey(storageKey, threadScope);
        localStorage.setItem(targetKey, activeThreadId);
        localStorage.setItem(
          activeThreadSeenStorageKey(targetKey),
          String(Date.now()),
        );
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
    readKnownThreadScope,
    storageKey,
    threads,
  ]);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/threads`);
      if (!res.ok) return;
      const data = await res.json();
      setThreads((prev) => {
        const loaded = (data.threads ?? []) as ChatThreadSummary[];
        const loadedIds = new Set(loaded.map((t) => t.id));
        // Preserve any optimistic threads we've created this session that
        // haven't shown up in the server list yet — the server only learns
        // about a thread when the user actually sends a message and the
        // agent run's `persistSubmittedUserMessage` writes the row.
        const optimisticOnly = prev.filter(
          (t) => newlyCreatedRef.current.has(t.id) && !loadedIds.has(t.id),
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
        return [...optimisticOnly, ...merged];
      });
      return data.threads as ChatThreadSummary[];
    } catch {
      return undefined;
    }
  }, [apiUrl]);

  // Initial load: load threads from server, then reconcile against the
  // saved active thread.
  //
  // - savedId in loadedThreads → keep it (user's last conversation).
  // - savedId in newlyCreatedRef (we just created it this session) → keep
  //   it; the server hasn't seen it yet because there's no POST anymore,
  //   the row gets written when the user sends a message.
  // - savedId is set but neither on the server nor newly created here →
  //   it's an empty tab the user left open. A never-messaged tab is never
  //   POSTed (that was the 127-ghost-threads problem), and the only record
  //   that it's a deliberately-open tab — newlyCreatedRef — is wiped by the
  //   reload. So on refresh we can't tell it apart from a stale ghost.
  //   Keep it exactly as the user left it: re-register it as an optimistic
  //   empty tab rather than resurrecting an unrelated old conversation. The
  //   composer is fully functional with this id (the server writes the row
  //   on first message, same as any new tab), so there's no 404 to avoid.
  //   This is what makes "the state you left is the state you see on
  //   refresh" hold — stale (>12h) tabs are still cleared downstream.
  // - No savedId → synthesize a fresh local id (no POST; server creates the
  //   row on first message). The server may contain chats from another
  //   branch, preview, or project that shares the same user/database, so
  //   auto-opening the latest server thread here leaks unrelated context into
  //   a fresh surface. Existing threads remain available in History.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      setIsLoading(true);
      const loadedThreads = await fetchThreads();
      const savedId = activeThreadIdRef.current;
      if (loadedThreads === undefined) {
        // Thread-list fetch failed. Do not reclassify a saved id as a new
        // optimistic tab; AssistantChat should still get a chance to restore
        // the specific saved thread via /threads/:id.
        setIsLoading(false);
        return;
      }
      const loadedHasSavedId = Boolean(
        savedId && loadedThreads.some((t) => t.id === savedId),
      );

      if (
        savedId &&
        newlyCreatedRef.current.has(savedId) &&
        !loadedHasSavedId
      ) {
        addOptimisticThread(savedId, scopeRef.current ?? null);
      } else if (
        savedId &&
        !newlyCreatedRef.current.has(savedId) &&
        !loadedHasSavedId
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
  }, [fetchThreads, addOptimisticThread, autoCreate]);

  const createThread = useCallback(
    (preferredId?: string): Promise<string | null> => {
      // Generate ID client-side for instant UI response. No POST — the
      // server creates the row when the user actually sends a message,
      // which prevents accumulation of empty thread rows when the user
      // clicks "+" but never chats.
      const id = preferredId || createLocalThreadId();
      newlyCreatedRef.current.add(id);
      addOptimisticThread(id, scopeRef.current ?? null);
      setActiveThreadId(id);
      return Promise.resolve(id);
    },
    [addOptimisticThread],
  );

  // Drop a thread's scope so it becomes a general (cross-resource) chat.
  // This is the "Detach from <deck>" escape hatch in the UI. The PUT
  // also bumps the thread's updatedAt so it surfaces in the All Chats
  // list right away.
  const detachThread = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        await fetch(`${apiUrl}/threads/${encodeURIComponent(threadId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: null }),
        });
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, scope: null } : t)),
        );
        optimisticThreadScopesRef.current.set(threadId, null);
        emitThreadsUpdated();
      } catch {}
    },
    [apiUrl],
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

  const switchThread = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

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

  // Ref to look up the latest scope of a known thread inside
  // saveThreadData without making the callback re-create on every
  // setThreads. The thread's scope is owned by createThread /
  // detachThread / fetchThreads — saveThreadData just mirrors it on
  // every save so the server eventually catches up after
  // persistSubmittedUserMessage creates the row sans scope.
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
        const localScope = localThread?.scope ?? null;
        const preserveUserTitle = userRenamedThreadIdsRef.current.has(id);
        const title = nextThreadTitle(
          localThread?.title,
          data.title,
          data.preview,
          titleSource,
          { preserveUserTitle },
        );
        await fetch(`${apiUrl}/threads/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...threadDataPayload,
            title,
            scope: localScope,
          }),
        });
        emitThreadsUpdated();
        // Update local thread list metadata. If the thread isn't in our
        // local list yet (an optimistic-only thread that the server just
        // created via persistSubmittedUserMessage), add it so HistoryPopover
        // can show it once it has messages.
        setThreads((prev) => {
          const exists = prev.some((t) => t.id === id);
          if (exists) {
            return prev.map((t) =>
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
            );
          }
          const now = Date.now();
          return [
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
          ];
        });
      } catch {}
    },
    [apiUrl],
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
        const res = await fetch(
          `${apiUrl}/threads?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) return [];
        const data = await res.json();
        return data.threads ?? [];
      } catch {
        return [];
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
    refreshThreads,
    isNewThread,
  };
}
