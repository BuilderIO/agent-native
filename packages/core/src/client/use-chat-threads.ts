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

  // Restore the saved active thread synchronously on mount so the chat shell
  // can paint immediately. We do NOT synthesize a fresh UUID here when no
  // saved id exists — that races with the agent run's server-side thread
  // create and was producing ghost threads that disappeared from history.
  // First-time users see the brief loading state while threads load.
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
        const loadedIds = new Set(loaded.map((t) => t.id));
        // Preserve any optimistic threads we've created this session that
        // haven't shown up in the server list yet (POST still in-flight).
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
          return next;
        });
        return [...optimisticOnly, ...merged];
      });
      return data.threads as ChatThreadSummary[];
    } catch {
      return undefined;
    }
  }, [apiUrl]);

  // Persist a client-generated thread to the server in the background.
  // Optimistically adds it to the local thread list so callers can render
  // immediately. POST /threads is idempotent server-side (returns the
  // existing thread on UNIQUE conflict instead of 500), so client retries
  // and races with the agent run's `persistSubmittedUserMessage` no longer
  // wipe a freshly-created thread out of local state.
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
          if (!res.ok) return;
          const created = (await res
            .json()
            .catch(() => null)) as ChatThreadSummary | null;
          if (!created) return;
          setThreads((prev) =>
            prev.map((thread) => (thread.id === id ? created : thread)),
          );
        })
        .catch(() => {
          // Network blip — keep the optimistic row and let the next
          // fetchThreads reconcile. Don't yank the thread out of local
          // state: the agent's onRunPrepared will (idempotently) create
          // it server-side anyway and we don't want to drop the user's
          // active conversation just because POST /threads was flaky.
        });
    },
    [apiUrl],
  );

  // Initial load.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      setIsLoading(true);
      const loadedThreads = await fetchThreads();

      if (loadedThreads && loadedThreads.length > 0) {
        const savedId = activeThreadIdRef.current;
        // If the saved active thread isn't on the server, fall back to the
        // most recent so the user lands on real history instead of a ghost.
        if (!savedId || !loadedThreads.find((t) => t.id === savedId)) {
          setActiveThreadId(loadedThreads[0].id);
        }
      } else if (!activeThreadIdRef.current) {
        // No threads on server and no saved active id — create a fresh one
        // so the composer has something to send into. This matches the
        // pre-instant-paint behavior.
        try {
          const res = await fetch(`${apiUrl}/threads`, { method: "POST" });
          if (res.ok) {
            const thread = (await res.json()) as ChatThreadSummary;
            newlyCreatedRef.current.add(thread.id);
            setThreads([thread]);
            setActiveThreadId(thread.id);
          }
        } catch {}
      }
      setIsLoading(false);
    })();
  }, [fetchThreads, apiUrl]);

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
