import { useEffect, useRef, useState } from "react";
import { agentNativePath } from "./api-path.js";

interface QueryClient {
  invalidateQueries(opts?: { queryKey?: string[] }): void;
}

const POLL_ABORT_MIN_MS = 10_000;
const SSE_FALLBACK_INTERVAL_MS = 15_000;

type SyncEvent = {
  version?: number;
  source?: string;
  type?: string;
  key?: string;
  requestSource?: string;
  [k: string]: unknown;
};

type PollResponse = {
  version: number;
  events: SyncEvent[];
};

function getPollAbortMs(interval: number): number {
  return Math.max(POLL_ABORT_MIN_MS, interval * 4);
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function resolveSseUrl(sseUrl: string | false | undefined): string | false {
  if (sseUrl === false) return false;
  return agentNativePath(sseUrl ?? "/_agent-native/events");
}

function normalizeEventPayload(payload: unknown): SyncEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { type?: unknown; events?: unknown };
  if (record.type === "batch" && Array.isArray(record.events)) {
    return record.events.filter(
      (event): event is SyncEvent => !!event && typeof event === "object",
    );
  }
  if (Array.isArray(record.events)) {
    return record.events.filter(
      (event): event is SyncEvent => !!event && typeof event === "object",
    );
  }
  return [payload as SyncEvent];
}

function eventVersion(event: SyncEvent): number {
  return typeof event.version === "number" ? event.version : 0;
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
 * Hook that listens to /_agent-native/events for DB change events and
 * invalidates react-query caches when changes are detected. Falls back to
 * /_agent-native/poll so cross-process/serverless writes still show up.
 *
 * Works in all deployment environments (serverless, edge, long-lived server).
 * SSE is the fast path; polling is the safety net.
 *
 * @param options.queryClient - The react-query QueryClient instance
 * @param options.queryKeys - Array of query key prefixes to invalidate on change.
 *   Default: ["data"]
 * @param options.pollUrl - Poll endpoint URL. Default: "/_agent-native/poll"
 * @param options.sseUrl - SSE endpoint URL. Default: "/_agent-native/events".
 *   Pass false to disable SSE and use polling only.
 * @param options.onEvent - Optional callback for each change event
 * @param options.interval - Poll interval in ms. Default: 2000
 * @param options.fallbackInterval - Poll interval while SSE is connected.
 *   Default: 15000
 * @param options.pauseWhenHidden - Pause polling while the tab is hidden.
 *   Default: true
 * @param options.ignoreSource - Skip events whose `requestSource` matches this
 *   value. Use a per-tab ID so the UI ignores its own writes while still
 *   picking up changes from other tabs, agents, and scripts.
 */
export function useDbSync(
  options: {
    queryClient?: QueryClient;
    queryKeys?: string[];
    pollUrl?: string;
    sseUrl?: string | false;
    /** @deprecated Use pollUrl instead */
    eventsUrl?: string;
    onEvent?: (data: any) => void;
    interval?: number;
    fallbackInterval?: number;
    pauseWhenHidden?: boolean;
    ignoreSource?: string;
  } = {},
): void {
  const {
    queryClient,
    queryKeys = ["data"],
    pollUrl = agentNativePath(options.eventsUrl ?? "/_agent-native/poll"),
    sseUrl = resolveSseUrl(options.sseUrl),
    interval = 2000,
    fallbackInterval = Math.max(
      options.fallbackInterval ?? SSE_FALLBACK_INTERVAL_MS,
      interval,
    ),
    pauseWhenHidden = true,
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
    let eventSource: EventSource | null = null;
    let sseConnected = false;

    function schedulePoll() {
      if (stopped) return;
      if (pauseWhenHidden && isDocumentHidden()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = null;
          void poll();
        },
        sseConnected ? fallbackInterval : interval,
      );
    }

    function invalidateForEvents(events: SyncEvent[]) {
      const ignore = ignoreSourceRef.current;
      const relevant = ignore
        ? events.filter((e) => e.requestSource !== ignore)
        : events;

      if (relevant.length > 0 && queryClient) {
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
        queryClient.invalidateQueries({ queryKey: ["extension-slots"] });
        queryClient.invalidateQueries({ queryKey: ["slot-installs"] });
        queryClient.invalidateQueries({ queryKey: ["slot-available"] });
        queryClient.invalidateQueries({ queryKey: ["tool"] });
        queryClient.invalidateQueries({ queryKey: ["tools"] });
        queryClient.invalidateQueries({ queryKey: ["app-state"] });
        queryClient.invalidateQueries({ queryKey: ["navigate-command"] });
        queryClient.invalidateQueries({ queryKey: ["show-questions"] });
        queryClient.invalidateQueries({ queryKey: ["__set_url__"] });
      }

      // Always forward all events to onEvent — templates can decide.
      for (const evt of events) {
        onEventRef.current?.(evt);
      }
    }

    function applyEvents(events: SyncEvent[], version?: number) {
      const freshEvents = events.filter((event) => {
        const version = eventVersion(event);
        return version === 0 || version > versionRef;
      });

      if (freshEvents.length > 0) {
        invalidateForEvents(freshEvents);
      }

      const maxEventVersion = freshEvents.reduce(
        (max, event) => Math.max(max, eventVersion(event)),
        0,
      );
      versionRef = Math.max(versionRef, version ?? 0, maxEventVersion);
    }

    function closeEvents() {
      if (!eventSource) return;
      eventSource.close();
      eventSource = null;
      sseConnected = false;
    }

    function connectEvents() {
      if (
        stopped ||
        !sseUrl ||
        eventSource ||
        typeof EventSource === "undefined" ||
        (pauseWhenHidden && isDocumentHidden())
      ) {
        return;
      }

      const source = new EventSource(sseUrl);
      eventSource = source;
      source.onopen = () => {
        sseConnected = true;
        schedulePoll();
      };
      source.onerror = () => {
        sseConnected = false;
        schedulePoll();
      };
      source.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          const events = normalizeEventPayload(payload);
          const version =
            typeof payload?.version === "number" ? payload.version : undefined;
          applyEvents(events, version);
        } catch {
          // Ignore malformed SSE frames; polling is the safety net.
        }
      };
    }

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const data = await fetchPollJson<PollResponse>(
          pollUrl,
          versionRef,
          interval,
        );
        applyEvents(data.events ?? [], data.version);
      } catch {
        // Network error — will retry on next interval
      } finally {
        inFlight = false;
        schedulePoll();
      }
    }

    function pollNow() {
      if (pauseWhenHidden && isDocumentHidden()) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      connectEvents();
      void poll();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        connectEvents();
        pollNow();
      } else if (pauseWhenHidden) {
        closeEvents();
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    }

    // Initial poll immediately when visible. Hidden tabs catch up on focus.
    if (!pauseWhenHidden || !isDocumentHidden()) {
      connectEvents();
      void poll();
    }
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      closeEvents();
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    pollUrl,
    sseUrl,
    queryClient,
    interval,
    fallbackInterval,
    pauseWhenHidden,
  ]);
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
  options: {
    pollUrl?: string;
    sseUrl?: string | false;
    interval?: number;
    fallbackInterval?: number;
    pauseWhenHidden?: boolean;
  } = {},
): number {
  const {
    pollUrl = agentNativePath(options.pollUrl ?? "/_agent-native/poll"),
    sseUrl = resolveSseUrl(options.sseUrl),
    interval = 2000,
    fallbackInterval = Math.max(
      options.fallbackInterval ?? SSE_FALLBACK_INTERVAL_MS,
      interval,
    ),
    pauseWhenHidden = true,
  } = options;
  const [key, setKey] = useState(0);

  useEffect(() => {
    let versionRef = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight = false;
    let eventSource: EventSource | null = null;
    let sseConnected = false;

    function schedulePoll() {
      if (stopped) return;
      if (pauseWhenHidden && isDocumentHidden()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = null;
          void poll();
        },
        sseConnected ? fallbackInterval : interval,
      );
    }

    function applyEvents(events: SyncEvent[], version?: number) {
      const freshEvents = events.filter((event) => {
        const version = eventVersion(event);
        return version === 0 || version > versionRef;
      });
      if (freshEvents.some((e) => e.source === "screen-refresh")) {
        setKey((k) => k + 1);
      }
      const maxEventVersion = freshEvents.reduce(
        (max, event) => Math.max(max, eventVersion(event)),
        0,
      );
      versionRef = Math.max(versionRef, version ?? 0, maxEventVersion);
    }

    function closeEvents() {
      if (!eventSource) return;
      eventSource.close();
      eventSource = null;
      sseConnected = false;
    }

    function connectEvents() {
      if (
        stopped ||
        !sseUrl ||
        eventSource ||
        typeof EventSource === "undefined" ||
        (pauseWhenHidden && isDocumentHidden())
      ) {
        return;
      }

      const source = new EventSource(sseUrl);
      eventSource = source;
      source.onopen = () => {
        sseConnected = true;
        schedulePoll();
      };
      source.onerror = () => {
        sseConnected = false;
        schedulePoll();
      };
      source.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          const events = normalizeEventPayload(payload);
          const version =
            typeof payload?.version === "number" ? payload.version : undefined;
          applyEvents(events, version);
        } catch {
          // Polling will catch missed screen-refresh events.
        }
      };
    }

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const data = await fetchPollJson<PollResponse>(
          pollUrl,
          versionRef,
          interval,
        );
        applyEvents(data.events ?? [], data.version);
      } catch {
        // Network error — retry on next interval.
      } finally {
        inFlight = false;
        schedulePoll();
      }
    }

    function pollNow() {
      if (pauseWhenHidden && isDocumentHidden()) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      connectEvents();
      void poll();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        connectEvents();
        pollNow();
      } else if (pauseWhenHidden) {
        closeEvents();
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    }

    if (!pauseWhenHidden || !isDocumentHidden()) {
      connectEvents();
      void poll();
    }
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      closeEvents();
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pollUrl, sseUrl, interval, fallbackInterval, pauseWhenHidden]);

  return key;
}
