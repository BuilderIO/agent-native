import { useState, useEffect, useCallback, useRef } from "react";
import { agentNativePath } from "./api-path.js";

export interface ChatThreadSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
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
}

const ACTIVE_THREAD_KEY = "agent-chat-active-thread";
const THREAD_DATA_CACHE_PREFIX = "agent-chat-thread-cache:";

/**
 * Key for the per-thread message cache in localStorage. AssistantChat reads
 * this synchronously on mount so existing chats can hydrate from cache and
 * paint immediately, then refreshes from the server in the background.
 */
export function getThreadCacheKey(threadId: string): string {
  return `${THREAD_DATA_CACHE_PREFIX}${threadId}`;
}

export function useChatThreads(
  apiUrl = agentNativePath("/_agent-native/agent-chat"),
  storageKey?: string,
) {
  const activeThreadKey = storageKey
    ? `${ACTIVE_THREAD_KEY}:${storageKey}`
    : ACTIVE_THREAD_KEY;
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);

  // IDs we generated client-side this session — consumers use this to know
  // whether to skip the per-thread restore skeleton. Tracked by ref instead
  // of state because the consumer reads it inside the render path and we
  // never need to re-render when the set changes.
  const newlyCreatedRef = useRef<Set<string>>(new Set());

  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem(activeThreadKey);
      if (saved) return saved;
    } catch {}
    // No saved thread — generate one synchronously so the chat shell + composer
    // can paint on first render instead of after a network round-trip.
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      const id = crypto.randomUUID();
      newlyCreatedRef.current.add(id);
      return id;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef(false);
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  // Persist active thread ID
  useEffect(() => {
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
        // Preserve any optimistic threads we've created this session that
        // haven't shown up in the server list yet (POST still in-flight).
        const loadedIds = new Set(loaded.map((t) => t.id));
        const optimisticOnly = prev.filter(
          (t) => newlyCreatedRef.current.has(t.id) && !loadedIds.has(t.id),
        );
        return [...optimisticOnly, ...loaded];
      });
      return data.threads as ChatThreadSummary[];
    } catch {
      return undefined;
    }
  }, [apiUrl]);

  // Persist a client-generated thread to the server in the background.
  // Optimistically adds it to the local thread list so callers can render
  // immediately; rolls back on failure.
  const persistNewThread = useCallback(
    (id: string) => {
      const now = Date.now();
      const optimistic: ChatThreadSummary = {
        id,
        title: "",
        preview: "",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      setThreads((prev) =>
        prev.some((t) => t.id === id) ? prev : [optimistic, ...prev],
      );
      fetch(`${apiUrl}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Thread create failed with ${res.status}`);
          }
          const created = (await res
            .json()
            .catch(() => null)) as ChatThreadSummary | null;
          if (!created) return;
          setThreads((prev) =>
            prev.map((thread) => (thread.id === id ? created : thread)),
          );
        })
        .catch(() => {
          setThreads((prev) => prev.filter((t) => t.id !== id));
          newlyCreatedRef.current.delete(id);
          setActiveThreadId((current) => (current === id ? null : current));
        });
    },
    [apiUrl],
  );

  // Initial load. Runs in the background — does NOT gate the consumer's
  // first paint. The composer renders against the optimistic active thread
  // we set up in useState above; this fetch just populates the history list
  // and reconciles a stale saved active id.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // Persist any thread we optimistically created during the initial render.
    for (const id of newlyCreatedRef.current) {
      persistNewThread(id);
    }

    (async () => {
      const loadedThreads = await fetchThreads();
      if (loadedThreads && loadedThreads.length > 0) {
        const savedId = activeThreadIdRef.current;
        // If the saved active thread isn't on the server (and isn't one we
        // just created client-side), fall back to the most recent.
        if (
          savedId &&
          !newlyCreatedRef.current.has(savedId) &&
          !loadedThreads.find((t) => t.id === savedId)
        ) {
          setActiveThreadId(loadedThreads[0].id);
        }
      }
      setIsLoading(false);
    })();
  }, [fetchThreads, persistNewThread]);

  const createThread = useCallback(
    (preferredId?: string): Promise<string | null> => {
      // Generate ID client-side for instant UI response
      const id = preferredId || crypto.randomUUID();
      newlyCreatedRef.current.add(id);
      setActiveThreadId(id);
      persistNewThread(id);
      return Promise.resolve(id);
    },
    [persistNewThread],
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
      try {
        localStorage.removeItem(getThreadCacheKey(id));
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
      // Cache locally so the next mount of this thread can hydrate
      // synchronously and skip the per-message restore skeleton. Quota errors
      // (5–10MB cap) are swallowed — the thread just falls back to fetching.
      try {
        localStorage.setItem(getThreadCacheKey(id), data.threadData);
      } catch {}
      try {
        await fetch(`${apiUrl}/threads/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        // Update local thread list metadata
        setThreads((prev) =>
          prev.map((t) =>
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
          ),
        );
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
    forkThread,
    saveThreadData,
    generateTitle,
    searchThreads,
    refreshThreads,
    isNewThread,
  };
}
