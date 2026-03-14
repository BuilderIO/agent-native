import { useEffect, useRef } from "react";

interface QueryClient {
  invalidateQueries(opts: { queryKey: string[] }): void;
}

/**
 * Hook that opens an EventSource connection to /api/events and invalidates
 * react-query caches when file changes are detected.
 *
 * @param options.queryClient - The react-query QueryClient instance (from useQueryClient())
 * @param options.queryKeys - Array of query key prefixes to invalidate on change.
 *   Default: ["file", "fileTree"]
 * @param options.eventsUrl - SSE endpoint URL. Default: "/api/events"
 * @param options.onEvent - Optional callback for each SSE event
 */
export function useFileWatcher(
  options: {
    queryClient?: QueryClient;
    queryKeys?: string[];
    eventsUrl?: string;
    onEvent?: (data: any) => void;
  } = {},
): void {
  const {
    queryClient,
    queryKeys = ["file", "fileTree"],
    eventsUrl = "/api/events",
  } = options;

  const url = eventsUrl;

  // Stable refs — updated every render, read inside the effect
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      // Invalidate all keys on reconnection to catch events missed during downtime
      if (queryClient) {
        for (const key of keysRef.current) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (queryClient) {
          for (const key of keysRef.current) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        }
        onEventRef.current?.(data);
      } catch (e) {
        console.warn("[useFileWatcher] Failed to parse SSE event:", e);
      }
    };

    eventSource.onerror = () => {
      console.warn("[useFileWatcher] EventSource error, will reconnect");
    };

    return () => eventSource.close();
  }, [url, queryClient]); // only reconnect on genuine config changes
}
