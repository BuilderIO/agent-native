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
}

const ACTIVE_THREAD_KEY = "agent-chat-active-thread";

function scopeKeySegment(scope?: ChatThreadScope | null): string {
  if (!scope) return "";
  return `:scope:${scope.type}:${scope.id}`;
}

export function useChatThreads(
  apiUrl = agentNativePath("/_agent-native/agent-chat"),
  storageKey?: string,
  scope?: ChatThreadScope | null,
) {
  // Each (storageKey, scope) pair gets its own active-thread localStorage
  // key, so navigating between decks/designs/dashboards lands on whatever
  // thread the user had open last *for that resource* — not whichever
  // thread was active globally.
  const activeThreadKey = useMemo(() => {
    const scopePart = scopeKeySegment(scope);
    return storageKey
      ? `${ACTIVE_THREAD_KEY}:${storageKey}${scopePart}`
      : `${ACTIVE_THREAD_KEY}${scopePart}`;
  }, [storageKey, scope?.type, scope?.id]);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);

  // IDs we generated client-side this session — consumers use this to know
  // whether to skip the per-thread restore skeleton, and we use it to
  // protect the optimistic-only thread from being yanked out of local
  // state when the server's threads list (which never sees it) loads.
  const newlyCreatedRef = useRef<Set<string>>(new Set());

  // Restore the saved active thread synchronously on mount so the chat shell
  // can paint immediately. We do NOT synthesize a fresh UUID here when no
  // saved id exists — that flow was creating empty `chat_threads` rows on
  // every page load via the optimistic POST, even if the user never chatted.
  // (Steve's account had 127 threads; 112 had message_count=0 and zero
  // agent_runs — pure ghosts.) When localStorage is empty, the initial
  // useEffect picks the most-recent server thread, or synthesizes a brand
  // new id only when there are no server threads at all.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(activeThreadKey);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef(false);
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  // Persist active thread ID — and rehydrate on scope flips. When the
  // user navigates from deck A to deck B, `activeThreadKey` changes; we
  // need to re-read whatever thread was last active for B *before*
  // persisting back, otherwise we'd write A's id under B's key on the
  // very next render. The ref-and-branch pattern below keeps the two
  // concerns in one effect without racing them.
  const persistedKeyRef = useRef(activeThreadKey);
  useEffect(() => {
    if (persistedKeyRef.current !== activeThreadKey) {
      persistedKeyRef.current = activeThreadKey;
      try {
        setActiveThreadId(localStorage.getItem(activeThreadKey));
      } catch {
        setActiveThreadId(null);
      }
      return;
    }
    try {
      if (activeThreadId) {
        localStorage.setItem(activeThreadKey, activeThreadId);
      } else {
        localStorage.removeItem(activeThreadKey);
      }
    } catch {}
  }, [activeThreadId, activeThreadKey]);

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

  // Latest scope as a ref so `createThread` (a useCallback that we don't
  // want to depend on scope identity) reads the current value at call
  // time. The scope a new chat inherits is the one in effect when the +
  // button is clicked, not when the hook first mounted.
  const scopeRef = useRef<ChatThreadScope | null | undefined>(scope);
  scopeRef.current = scope;

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
    (id: string, threadScope: ChatThreadScope | null) => {
      const now = Date.now();
      const optimistic: ChatThreadSummary = {
        id,
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
        scope: threadScope,
      };
      setThreads((prev) =>
        prev.some((t) => t.id === id) ? prev : [optimistic, ...prev],
      );
    },
    [],
  );

  // Initial load: load threads from server, then reconcile against the
  // saved active thread.
  //
  // - savedId in loadedThreads → keep it (user's last conversation).
  // - savedId in newlyCreatedRef (we just created it this session) → keep
  //   it; the server hasn't seen it yet because there's no POST anymore,
  //   the row gets written when the user sends a message.
  // - savedId is set but neither on the server nor newly created here →
  //   it's a stale id from a previous session whose row no longer exists
  //   (was a ghost cleaned up, or the user emptied their account, etc.).
  //   Drop them on the most-recent real thread instead of leaving them
  //   staring at a 404'd composer.
  // - No savedId, no server threads → synthesize a fresh local id (no
  //   POST; server creates the row on first message).
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      setIsLoading(true);
      const loadedThreads = await fetchThreads();
      const savedId = activeThreadIdRef.current;

      if (loadedThreads && loadedThreads.length > 0) {
        if (
          savedId &&
          !newlyCreatedRef.current.has(savedId) &&
          !loadedThreads.find((t) => t.id === savedId)
        ) {
          setActiveThreadId(loadedThreads[0].id);
        } else if (!savedId) {
          setActiveThreadId(loadedThreads[0].id);
        }
      } else if (!savedId) {
        // Brand new user — synthesize a local id so the composer has a
        // target. No POST: the server creates the row on first send.
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
          const id = crypto.randomUUID();
          newlyCreatedRef.current.add(id);
          addOptimisticThread(id, scopeRef.current ?? null);
          setActiveThreadId(id);
        }
      }
      setIsLoading(false);
    })();
  }, [fetchThreads, addOptimisticThread]);

  const createThread = useCallback(
    (preferredId?: string): Promise<string | null> => {
      // Generate ID client-side for instant UI response. No POST — the
      // server creates the row when the user actually sends a message,
      // which prevents accumulation of empty thread rows when the user
      // clicks "+" but never chats.
      const id = preferredId || crypto.randomUUID();
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
      } catch {}
    },
    [apiUrl],
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
      } catch {}
      setThreads((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (id === activeThreadId) {
          // Switch to the next available thread, or create new if empty
          if (next.length > 0) {
            setActiveThreadId(next[0].id);
          } else {
            // Create a new thread
            createThread();
          }
        }
        return next;
      });
    },
    [apiUrl, activeThreadId, createThread],
  );

  // Ref to look up the latest scope of a known thread inside
  // saveThreadData without making the callback re-create on every
  // setThreads. The thread's scope is owned by createThread /
  // detachThread / fetchThreads — saveThreadData just mirrors it on
  // every save so the server eventually catches up after
  // persistSubmittedUserMessage creates the row sans scope.
  const threadsRef = useRef<ChatThreadSummary[]>(threads);
  threadsRef.current = threads;

  const saveThreadData = useCallback(
    async (
      id: string,
      data: {
        threadData: string;
        title: string;
        preview: string;
        messageCount?: number;
      },
    ) => {
      try {
        const localScope =
          threadsRef.current.find((t) => t.id === id)?.scope ?? null;
        await fetch(`${apiUrl}/threads/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, scope: localScope }),
        });
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
                    title: data.title,
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
              title: data.title,
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
    async (sourceId: string): Promise<string | null> => {
      const id = crypto.randomUUID();
      try {
        const res = await fetch(
          `${apiUrl}/threads/${encodeURIComponent(sourceId)}/fork`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          },
        );
        if (!res.ok) {
          // Surface failures so a click on the Fork button isn't a silent
          // no-op when the source thread can't be found or auth has lapsed.
          console.error(
            `[chat] fork failed for ${sourceId}: ${res.status} ${res.statusText}`,
          );
          return null;
        }
        const thread = await res.json();
        setThreads((prev) => [
          {
            id: thread.id,
            title: thread.title,
            preview: thread.preview,
            messageCount: thread.messageCount,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            scope: thread.scope ?? null,
          },
          ...prev,
        ]);
        return thread.id;
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
    forkThread,
    saveThreadData,
    generateTitle,
    searchThreads,
    refreshThreads,
    isNewThread,
  };
}
