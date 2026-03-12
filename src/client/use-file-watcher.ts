import { useEffect } from "react";

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
export function useFileWatcher(options: {
  queryClient?: QueryClient;
  queryKeys?: string[];
  eventsUrl?: string;
  onEvent?: (data: any) => void;
} = {}): void {
  const { queryClient, onEvent } = options;
  const keys = options.queryKeys ?? ["file", "fileTree"];
  const url = options.eventsUrl ?? "/api/events";

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (queryClient) {
          for (const key of keys) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        }

        onEvent?.(data);
      } catch (err) {
        console.error("[useFileWatcher] error parsing event data", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("[useFileWatcher] SSE connection error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [url, queryClient, onEvent, ...keys]);
}
