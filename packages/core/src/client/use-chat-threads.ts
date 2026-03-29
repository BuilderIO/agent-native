import { useState, useEffect, useCallback, useRef } from "react";

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

export function useChatThreads(apiUrl = "/api/agent-chat") {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_THREAD_KEY);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef(false);

  // Persist active thread ID
  useEffect(() => {
    try {
      if (activeThreadId) {
        localStorage.setItem(ACTIVE_THREAD_KEY, activeThreadId);
      }
    } catch {}
  }, [activeThreadId]);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/threads`);
      if (!res.ok) return;
      const data = await res.json();
      setThreads(data.threads ?? []);
      return data.threads as ChatThreadSummary[];
    } catch {
      return undefined;
    }
  }, [apiUrl]);

  // Initial load
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      setIsLoading(true);
      const loadedThreads = await fetchThreads();

      if (loadedThreads && loadedThreads.length > 0) {
        // If the saved active thread still exists, keep it. Otherwise use the most recent.
        const savedId = activeThreadId;
        if (!savedId || !loadedThreads.find((t) => t.id === savedId)) {
          setActiveThreadId(loadedThreads[0].id);
        }
      } else {
        // No threads — create the first one
        try {
          const res = await fetch(`${apiUrl}/threads`, { method: "POST" });
          if (res.ok) {
            const thread = await res.json();
            setThreads([thread]);
            setActiveThreadId(thread.id);
          }
        } catch {}
      }
      setIsLoading(false);
    })();
  }, [fetchThreads, apiUrl, activeThreadId]);

  const createThread = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${apiUrl}/threads`, { method: "POST" });
      if (!res.ok) return null;
      const thread = await res.json();
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
      return thread.id;
    } catch {
      return null;
    }
  }, [apiUrl]);

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
        messageCount: number;
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
                  messageCount: data.messageCount,
                  updatedAt: Date.now(),
                }
              : t,
          ),
        );
      } catch {}
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
    saveThreadData,
    refreshThreads,
  };
}
