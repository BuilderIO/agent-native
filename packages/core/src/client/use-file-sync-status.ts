import { useState, useEffect, useRef } from "react";

interface FileSyncStatus {
  enabled: boolean;
  connected: boolean;
  conflicts: string[];
  lastSyncedAt: number | null;
}

interface FileSyncEvent {
  source: "sync";
  type: string;
  path: string;
}

/**
 * React hook for tracking file sync status via SSE events.
 * Fetches initial state from GET /api/file-sync/status on mount,
 * then accumulates updates from SSE sync events.
 */
export function useFileSyncStatus(options?: {
  onEvent?: (event: FileSyncEvent) => void;
}): FileSyncStatus {
  const [status, setStatus] = useState<FileSyncStatus>({
    enabled: false,
    connected: false,
    conflicts: [],
    lastSyncedAt: null,
  });
  const onEventRef = useRef(options?.onEvent);
  onEventRef.current = options?.onEvent;

  // Fetch initial state on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/file-sync/status")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setStatus((prev) => ({
            ...prev,
            enabled: data.enabled,
            connected: data.enabled,
          }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to SSE sync events
  useEffect(() => {
    const es = new EventSource("/api/events");
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.source === "sync") {
          setStatus((prev) => ({
            ...prev,
            lastSyncedAt: Date.now(),
            conflicts:
              data.type === "conflict" || data.type === "conflict-saved"
                ? [...new Set([...prev.conflicts, data.path])]
                : data.type === "conflict-resolved"
                  ? prev.conflicts.filter((p: string) => p !== data.path)
                  : prev.conflicts,
          }));
          onEventRef.current?.(data);
        }
      } catch {
        /* malformed SSE data */
      }
    };
    es.addEventListener("message", handler);
    return () => {
      es.close();
    };
  }, []);

  return status;
}
