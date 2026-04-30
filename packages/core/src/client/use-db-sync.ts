import { useEffect, useRef, useState } from "react";
import { agentNativePath } from "./api-path.js";

interface QueryClient {
  invalidateQueries(opts?: { queryKey?: string[] }): void;
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
    pollUrl = agentNativePath(options.eventsUrl ?? "/_agent-native/poll"),
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

            // Framework-level invalidation: always invalidate framework query
            // keys on any non-own change event so that mutating actions
            // (agent or HTTP) auto-refresh the UI — regardless of how the
            // template configured queryKeys / onEvent.
            queryClient.invalidateQueries({ queryKey: ["action"] });
            queryClient.invalidateQueries({ queryKey: ["tool"] });
            queryClient.invalidateQueries({ queryKey: ["tools"] });
          }

          // Always forward all events to onEvent — templates can decide
          for (const evt of events) {
            onEventRef.current?.(evt);
          }
        }

        // Never decrease — protects against serverless instances with
        // slightly different version counters.
        versionRef = Math.max(versionRef, version);
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

/**
 * Subscribe to `refresh-screen` events from the agent. Returns an integer
 * that increments every time the agent invokes the framework's `refresh-screen`
 * tool. Apply it as a React `key` on the main content wrapper (the part
 * OUTSIDE the agent chat sidebar) so that region remounts and re-fetches its
 * data while the chat, sidebar, and any other persistent chrome keep their
 * in-flight state.
 *
 * Usage in a template's root:
 *
 *   const screenKey = useScreenRefreshKey();
 *   return (
 *     <AppLayout>
 *       <div key={screenKey}>
 *         <Outlet />
 *       </div>
 *     </AppLayout>
 *   );
 */
export function useScreenRefreshKey(
  options: { pollUrl?: string; interval?: number } = {},
): number {
  const {
    pollUrl = agentNativePath(options.pollUrl ?? "/_agent-native/poll"),
    interval = 2000,
  } = options;
  const [key, setKey] = useState(0);

  useEffect(() => {
    let versionRef = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(`${pollUrl}?since=${versionRef}`);
        if (res.ok) {
          const data = (await res.json()) as {
            version: number;
            events: Array<{ source: string }>;
          };
          if (data.events?.some((e) => e.source === "screen-refresh")) {
            setKey((k) => k + 1);
          }
          versionRef = Math.max(versionRef, data.version);
        }
      } catch {
        // Network error — retry on next interval.
      }
      if (!stopped) timer = setTimeout(poll, interval);
    }

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollUrl, interval]);

  return key;
}
