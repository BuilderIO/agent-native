import { useEffect, useRef } from "react";

interface QueryClient {
  invalidateQueries(opts: { queryKey: string[] }): void;
}

/**
 * Hook that polls /api/poll for DB change events and invalidates
 * react-query caches when changes are detected.
 *
 * Replaces the old SSE-based useFileWatcher. Works in all deployment
 * environments (serverless, edge, long-lived server).
 *
 * @param options.queryClient - The react-query QueryClient instance
 * @param options.queryKeys - Array of query key prefixes to invalidate on change.
 *   Default: ["file", "fileTree"]
 * @param options.eventsUrl - Poll endpoint URL. Default: "/api/poll"
 * @param options.onEvent - Optional callback for each change event
 * @param options.interval - Poll interval in ms. Default: 2000
 */
export function useFileWatcher(
  options: {
    queryClient?: QueryClient;
    queryKeys?: string[];
    eventsUrl?: string;
    onEvent?: (data: any) => void;
    interval?: number;
  } = {},
): void {
  const {
    queryClient,
    queryKeys = ["file", "fileTree"],
    eventsUrl = "/api/poll",
    interval = 2000,
  } = options;

  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    let versionRef = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(`${eventsUrl}?since=${versionRef}`);
        if (!res.ok) return;
        const data = await res.json();
        const { version, events } = data as {
          version: number;
          events: Array<{ source: string; type: string; key?: string }>;
        };

        if (events.length > 0 && queryClient) {
          for (const key of keysRef.current) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
          for (const evt of events) {
            onEventRef.current?.(evt);
          }
        }

        versionRef = version;
      } catch {
        // Network error — will retry on next interval
      }
      if (!stopped) {
        timer = setTimeout(poll, interval);
      }
    }

    // Initial poll immediately
    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [eventsUrl, queryClient, interval]);
}
