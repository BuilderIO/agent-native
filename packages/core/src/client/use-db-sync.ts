import { useEffect, useRef, useState } from "react";
import { agentNativePath } from "./api-path.js";
import { bumpChangeVersion } from "./use-change-version.js";

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
    // Await the json before the finally so a body-stream abort doesn't
    // produce a dangling promise that escapes as an unhandled rejection.
    return await res.json();
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
 * @param options.queryKeys - **Deprecated and ignored.** The hook now
 *   invalidates every active query on any non-own change event, so templates
 *   no longer need to enumerate their keys. Kept in the type signature for
 *   backward compatibility — existing call sites that still pass this option
 *   keep working but the value has no effect.
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

      // Bump per-source change counters. Components that read these via
      // `useChangeVersion(source)` and fold the value into a React Query
      // queryKey get a targeted refetch — no whole-cache invalidate, no
      // request storm. See `use-change-version.ts` for the contract.
      for (const evt of relevant) {
        const src = typeof evt.source === "string" ? evt.source : "";
        const ver = typeof evt.version === "number" ? evt.version : 0;
        if (src && ver > 0) bumpChangeVersion(src, ver);
      }

      if (relevant.length > 0 && queryClient) {
        // Framework-level invalidate: a small, fixed list of query-key
        // prefixes the framework's own hooks/components use (action results,
        // extension state, application-state, the agent's `set-url` channel,
        // etc.). Templates' own data queries do NOT live here — they react
        // through `useChangeVersion(source)` in their query keys instead, so
        // a single change event doesn't fan out into "refetch everything".
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

      // Always forward all events to onEvent — templates can layer surgical
      // logic on top (e.g. ignore their own writes via requestSource, or
      // invalidate inactive queries for a specific source).
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
