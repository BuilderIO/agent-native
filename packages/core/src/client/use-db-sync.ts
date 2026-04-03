import { useEffect, useRef } from "react";

interface QueryClient {
  invalidateQueries(opts: { queryKey: string[] }): void;
}

/**
 * Hook that polls /_agent-native/poll for DB change events and invalidates
 * react-query caches when changes are detected.
 *
 * Works in all deployment environments (serverless, edge, long-lived server).
 *
 * @param options.queryClient - The react-query QueryClient instance
 * @param options.queryKeys - Array of query key prefixes to invalidate on change.
 *   Default: ["data"]
 * @param options.pollUrl - Poll endpoint URL. Default: "/_agent-native/poll"
 * @param options.onEvent - Optional callback for each change event
 * @param options.interval - Poll interval in ms. Default: 2000
 * @param options.ignoreSource - Skip events whose `requestSource` matches this
 *   value. Use a per-tab ID so the UI ignores its own writes while still
 *   picking up changes from other tabs, agents, and scripts.
 */
export function useDbSync(
  options: {
    queryClient?: QueryClient;
    queryKeys?: string[];
    pollUrl?: string;
    /** @deprecated Use pollUrl instead */
    eventsUrl?: string;
    onEvent?: (data: any) => void;
    interval?: number;
    ignoreSource?: string;
  } = {},
): void {
  const {
    queryClient,
    queryKeys = ["data"],
    pollUrl = options.eventsUrl ?? "/_agent-native/poll",
    interval = 2000,
  } = options;

  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  const ignoreSourceRef = useRef(options.ignoreSource);
  ignoreSourceRef.current = options.ignoreSource;

  useEffect(() => {
    let versionRef = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(`${pollUrl}?since=${versionRef}`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const { version, events } = data as {
          version: number;
          events: Array<{ source: string; type: string; key?: string }>;
        };

        if (events.length > 0 && queryClient) {
          const ignore = ignoreSourceRef.current;
          const relevant = ignore
            ? events.filter((e: any) => e.requestSource !== ignore)
            : events;

          if (relevant.length > 0) {
            for (const key of keysRef.current) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
          }

          // Always forward all events to onEvent — templates can decide
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
  }, [pollUrl, queryClient, interval]);
}

/** @deprecated Use useDbSync instead */
export const useFileWatcher = useDbSync;
