import { useEffect, useRef, useState } from "react";
import { agentNativePath } from "./api-path.js";

interface QueryClient {
  invalidateQueries(opts?: { queryKey?: string[] }): void;
}

const POLL_ABORT_MIN_MS = 10_000;

function getPollAbortMs(interval: number): number {
  return Math.max(POLL_ABORT_MIN_MS, interval * 4);
}

async function fetchPollJson<T>(
  pollUrl: string,
  since: number,
  interval: number,
): Promise<T> {
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), getPollAbortMs(interval))
    : null;

  try {
    const res = await fetch(
      `${pollUrl}?since=${since}`,
      controller ? { signal: controller.signal } : undefined,
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
    let inFlight = false;

    function schedulePoll() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, interval);
    }

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const data = await fetchPollJson<{
          version: number;
          events: Array<{
            source: string;
            type: string;
            key?: string;
            requestSource?: string;
          }>;
        }>(pollUrl, versionRef, interval);
        const { version, events } = data as {
          version: number;
          events: Array<{
            source: string;
            type: string;
            key?: string;
            requestSource?: string;
          }>;
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
            queryClient.invalidateQueries({ queryKey: ["extension"] });
            queryClient.invalidateQueries({ queryKey: ["extensions"] });
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
      } finally {
        inFlight = false;
        schedulePoll();
      }
    }

    function pollNow() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void poll();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") pollNow();
    }

    // Initial poll immediately
    void poll();
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
    let inFlight = false;

    function schedulePoll() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, interval);
    }

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const data = await fetchPollJson<{
          version: number;
          events: Array<{ source: string }>;
        }>(pollUrl, versionRef, interval);
        if (data.events?.some((e) => e.source === "screen-refresh")) {
          setKey((k) => k + 1);
        }
        versionRef = Math.max(versionRef, data.version);
      } catch {
        // Network error — retry on next interval.
      } finally {
        inFlight = false;
        schedulePoll();
      }
    }

    function pollNow() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void poll();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") pollNow();
    }

    void poll();
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pollUrl, interval]);

  return key;
}
