import { useEffect, useRef, useState } from "react";

import { ensureDemoModeFetchInterceptor } from "../demo/fetch-interceptor.js";
import { agentNativePath } from "./api-path.js";
import {
  ensureEmbedAuthFetchInterceptor,
  isEmbedAuthActive,
} from "./embed-auth.js";
import { bumpChangeVersion } from "./use-change-version.js";

interface Query {
  queryKey: readonly unknown[];
}

interface QueryClient {
  invalidateQueries(opts?: {
    queryKey?: string[];
    predicate?: (query: Query) => boolean;
  }): void;
}

const POLL_ABORT_MIN_MS = 10_000;
const SSE_FALLBACK_INTERVAL_MS = 15_000;
const POLL_AUTH_FAILURE_COOLDOWN_MS = 60_000;

class HttpStatusError extends Error {
  status: number;

  constructor(status: number) {
    super("HTTP " + status);
    this.status = status;
  }
}

export type SyncEvent = {
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

/** Callback delivered to each transport subscriber for every batch of events. */
type EventSubscriber = (
  events: SyncEvent[],
  version: number | undefined,
) => void;

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
  if (isEmbedAuthActive()) return false;
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

function isAuthFailure(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403)
  );
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
    if (!res.ok) throw new HttpStatusError(res.status);
    // Await the json before the finally so a body-stream abort doesn't
    // produce a dangling promise that escapes as an unhandled rejection.
    return await res.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Shared SSE + poll transport
//
// One SyncTransport per (pollUrl, sseUrl) pair is held in a module-level
// registry. Both `useDbSync` and `useScreenRefreshKey` subscribe to it, so a
// single browser tab opens exactly ONE SSE connection and ONE poll loop
// regardless of how many hook instances are mounted.
//
// Lifecycle: the transport starts when the first subscriber joins and shuts
// down when the last subscriber leaves. This makes it safe to SSR and to
// mount/unmount hooks independently.
// ---------------------------------------------------------------------------

interface TransportSubscription {
  onEvents: EventSubscriber;
  /**
   * Whether this subscriber wants the transport to pause when the tab is
   * hidden. The transport pauses only when ALL subscribers request it — any
   * subscriber with `pauseWhenHidden: false` keeps the connection alive.
   */
  pauseWhenHidden: boolean;
  /**
   * Requested poll interval in ms. The transport uses the minimum across all
   * subscribers so the most-frequent caller is satisfied.
   */
  interval: number;
  /** Requested fallback interval while SSE is connected. */
  fallbackInterval: number;
  /**
   * Optional: notified when the shared SSE connection opens or closes (also
   * fired once with the current state when the subscriber joins). Lets
   * subscribers with their own fallback loops (e.g. the collab doc poll)
   * relax their cadence while the push path is healthy.
   */
  onSseStateChange?: (connected: boolean) => void;
}

class SyncTransport {
  private subscribers = new Map<symbol, TransportSubscription>();
  private versionRef = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private inFlight = false;
  private eventSource: EventSource | null = null;
  private sseConnected = false;
  private authFailureUntil = 0;
  private consecutiveFailures = 0;

  constructor(
    private readonly pollUrl: string,
    private readonly sseUrl: string | false,
  ) {}

  // -------------------------------------------------------------------------
  // Subscriber management
  // -------------------------------------------------------------------------

  add(id: symbol, sub: TransportSubscription): void {
    const wasEmpty = this.subscribers.size === 0;
    this.subscribers.set(id, sub);
    if (wasEmpty) {
      this.stopped = false;
      this.start();
    }
    sub.onSseStateChange?.(this.sseConnected);
  }

  remove(id: symbol): void {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) {
      this.teardown();
    } else {
      // Recalculate poll interval in case the leaving subscriber was the
      // fastest caller; reschedule with the updated cadence.
      this.reschedule();
    }
  }

  // -------------------------------------------------------------------------
  // Derived settings (aggregate over active subscribers)
  // -------------------------------------------------------------------------

  private get effectivePauseWhenHidden(): boolean {
    // Pause only if every subscriber has opted in.
    for (const sub of this.subscribers.values()) {
      if (!sub.pauseWhenHidden) return false;
    }
    return true;
  }

  private get effectiveInterval(): number {
    let min = Infinity;
    for (const sub of this.subscribers.values()) {
      if (sub.interval < min) min = sub.interval;
    }
    return isFinite(min) ? min : 2000;
  }

  private get effectiveFallbackInterval(): number {
    let min = Infinity;
    for (const sub of this.subscribers.values()) {
      if (sub.fallbackInterval < min) min = sub.fallbackInterval;
    }
    return isFinite(min) ? min : SSE_FALLBACK_INTERVAL_MS;
  }

  // -------------------------------------------------------------------------
  // Event fan-out
  // -------------------------------------------------------------------------

  private fan(events: SyncEvent[], version: number | undefined): void {
    for (const sub of this.subscribers.values()) {
      sub.onEvents(events, version);
    }
  }

  private setSseConnected(connected: boolean): void {
    if (this.sseConnected === connected) return;
    this.sseConnected = connected;
    for (const sub of this.subscribers.values()) {
      sub.onSseStateChange?.(connected);
    }
  }

  // -------------------------------------------------------------------------
  // SSE + poll loop (mirrors the original per-hook logic exactly)
  // -------------------------------------------------------------------------

  private authFailureDelayMs(): number {
    return Math.max(0, this.authFailureUntil - Date.now());
  }

  private schedulePoll(): void {
    if (this.stopped) return;
    if (this.effectivePauseWhenHidden && isDocumentHidden()) return;
    if (this.timer) clearTimeout(this.timer);
    const authDelay = this.authFailureDelayMs();
    if (authDelay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.poll();
      }, authDelay);
      return;
    }
    const base = this.sseConnected
      ? this.effectiveFallbackInterval
      : this.effectiveInterval;
    // Exponential backoff while polls keep failing (500s during a deploy,
    // DNS blips, a struggling DB). Auth failures have their own cooldown
    // above; this covers everything else so a down server isn't hammered at
    // full cadence. Resets on the first successful poll.
    const delay =
      this.consecutiveFailures > 0
        ? Math.min(base * 2 ** Math.min(this.consecutiveFailures, 5), 30_000)
        : base;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delay);
  }

  private reschedule(): void {
    // Only need to act if a timer is already pending; next natural tick will
    // pick up the new effective interval otherwise.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.schedulePoll();
    }
  }

  private closeEvents(): void {
    if (!this.eventSource) return;
    this.eventSource.close();
    this.eventSource = null;
    this.setSseConnected(false);
  }

  private connectEvents(): void {
    if (
      this.stopped ||
      !this.sseUrl ||
      this.eventSource ||
      typeof EventSource === "undefined" ||
      (this.effectivePauseWhenHidden && isDocumentHidden())
    ) {
      return;
    }

    const source = new EventSource(this.sseUrl);
    this.eventSource = source;
    source.onopen = () => {
      this.setSseConnected(true);
      this.schedulePoll();
    };
    source.onerror = () => {
      this.setSseConnected(false);
      // When the browser gives up permanently (HTTP error → readyState
      // CLOSED), it won't auto-reconnect. Drop the ref so a later
      // connectEvents() (on focus/visibility) can establish a fresh stream;
      // otherwise the non-null closed `eventSource` blocks reconnection and
      // we'd be stuck on polling-only forever.
      if (source.readyState === EventSource.CLOSED) {
        this.eventSource = null;
      }
      this.schedulePoll();
    };
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        const events = normalizeEventPayload(payload);
        const version =
          typeof payload?.version === "number" ? payload.version : undefined;
        this.applyVersion(events, version);
        this.fan(events, version);
      } catch {
        // Ignore malformed SSE frames; polling is the safety net.
      }
    };
  }

  /**
   * Advance the transport's shared version cursor. Subscribers receive the
   * raw events and decide independently which ones are "fresh" relative to
   * their own cursor, but the transport-level cursor ensures the poll
   * `?since=` parameter always advances.
   */
  private applyVersion(events: SyncEvent[], version: number | undefined): void {
    let max = typeof version === "number" ? version : 0;
    for (const evt of events) {
      const v = typeof evt.version === "number" ? evt.version : 0;
      if (v > max) max = v;
    }
    if (max > this.versionRef) this.versionRef = max;
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    try {
      const data = await fetchPollJson<PollResponse>(
        this.pollUrl,
        this.versionRef,
        this.effectiveInterval,
      );
      if (this.stopped) return;
      this.consecutiveFailures = 0;
      const events = data.events ?? [];
      this.applyVersion(events, data.version);
      this.fan(events, data.version);
    } catch (err) {
      if (this.stopped) return;
      this.consecutiveFailures++;
      if (isAuthFailure(err)) {
        this.authFailureUntil = Date.now() + POLL_AUTH_FAILURE_COOLDOWN_MS;
        this.closeEvents();
      }
      // Network error — retried on the next (backed-off) interval.
    } finally {
      this.inFlight = false;
      this.schedulePoll();
    }
  }

  private pollNow(): void {
    if (this.effectivePauseWhenHidden && isDocumentHidden()) return;
    if (this.authFailureDelayMs() > 0) {
      this.schedulePoll();
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.connectEvents();
    void this.poll();
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      this.connectEvents();
      this.pollNow();
    } else if (this.effectivePauseWhenHidden) {
      this.closeEvents();
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
  };

  private handleFocus = (): void => {
    this.pollNow();
  };

  private start(): void {
    // Universal demo-mode redaction for the UI. Idempotent + browser-only +
    // a no-op until demo mode is on. Lives here because every template root
    // already mounts useDbSync, so this needs zero per-template wiring.
    ensureEmbedAuthFetchInterceptor();
    ensureDemoModeFetchInterceptor();

    if (!this.effectivePauseWhenHidden || !isDocumentHidden()) {
      this.connectEvents();
      void this.poll();
    }
    window.addEventListener("focus", this.handleFocus);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private teardown(): void {
    this.stopped = true;
    this.closeEvents();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    window.removeEventListener("focus", this.handleFocus);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }
}

/**
 * Registry of active transports keyed by "<pollUrl>\0<sseUrl>".
 * Module-level singleton: survives React render cycles, shared across all
 * hook instances in the same browser tab.
 */
const transportRegistry = new Map<string, SyncTransport>();

function getOrCreateTransport(
  pollUrl: string,
  sseUrl: string | false,
): SyncTransport {
  const key = `${pollUrl}\0${String(sseUrl)}`;
  let transport = transportRegistry.get(key);
  if (!transport) {
    transport = new SyncTransport(pollUrl, sseUrl);
    transportRegistry.set(key, transport);
  }
  return transport;
}

/** Remove a transport from the registry once torn down (last subscriber left). */
function releaseTransport(pollUrl: string, sseUrl: string | false): void {
  const key = `${pollUrl}\0${String(sseUrl)}`;
  // Leave the entry in place: SSE/poll is already stopped inside the class;
  // the next subscriber will re-start it via `add()`. Clearing the map entry
  // prevents any dangling reference from the old SyncTransport instance.
  transportRegistry.delete(key);
}

// ---------------------------------------------------------------------------
// Internal test helper — reset transport registry between tests.
// ---------------------------------------------------------------------------
/** @internal */
export function _resetSyncTransportRegistryForTests(): void {
  transportRegistry.clear();
}

export interface SubscribeSyncEventsOptions {
  /** Receives every batch of change events (SSE push or poll). */
  onEvents: (events: SyncEvent[], version: number | undefined) => void;
  /** Notified when the shared SSE connection opens/closes (and once on join). */
  onSseStateChange?: (connected: boolean) => void;
  pollUrl?: string;
  sseUrl?: string | false;
  pauseWhenHidden?: boolean;
  /**
   * Poll cadence this subscriber requests from the SHARED poll loop. The
   * transport uses the minimum across subscribers, so the defaults here are
   * deliberately high: subscribing must not speed up the shared poll —
   * useDbSync (mounted by every template root) already sets the pace.
   */
  interval?: number;
  fallbackInterval?: number;
}

/**
 * Subscribe to the shared SSE + poll transport without the React Query
 * invalidation behavior of `useDbSync`. Use this instead of opening another
 * `EventSource` to `/_agent-native/events` — a browser tab should hold ONE
 * SSE connection no matter how many features listen to it (extra streams eat
 * the per-origin connection budget and starve data fetches, especially on
 * HTTP/1.1 dev servers).
 *
 * Returns an unsubscribe function. Safe to call only in browser contexts.
 */
export function subscribeSyncEvents(
  options: SubscribeSyncEventsOptions,
): () => void {
  const pollUrl = agentNativePath(options.pollUrl ?? "/_agent-native/poll");
  const sseUrl = resolveSseUrl(options.sseUrl);
  const transport = getOrCreateTransport(pollUrl, sseUrl);
  const id = Symbol("subscribeSyncEvents");
  transport.add(id, {
    onEvents: options.onEvents,
    onSseStateChange: options.onSseStateChange,
    pauseWhenHidden: options.pauseWhenHidden ?? true,
    interval: options.interval ?? 60_000,
    fallbackInterval: options.fallbackInterval ?? 60_000,
  });
  return () => {
    transport.remove(id);
    if (!transport["subscribers"].size) {
      releaseTransport(pollUrl, sseUrl);
    }
  };
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
 * @param options.queryKeys - **Deprecated and ignored.** The hook uses
 *   framework-owned fixed prefixes plus per-source change counters instead of
 *   caller-supplied key lists. Kept in the type signature for backward
 *   compatibility — existing call sites that still pass this option keep
 *   working but the value has no effect.
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
 * @param options.actionInvalidatePredicate - Optional filter for the broad
 *   compatibility invalidate triggered by `action` events. Use this to keep
 *   expensive active queries on explicit-refresh semantics while still letting
 *   normal source-versioned queries react through `useChangeVersion`.
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
    actionInvalidatePredicate?: (query: Query) => boolean;
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
  const actionInvalidatePredicateRef = useRef(
    options.actionInvalidatePredicate,
  );
  actionInvalidatePredicateRef.current = options.actionInvalidatePredicate;

  useEffect(() => {
    const id = Symbol("useDbSync");
    // Per-subscriber version cursor: tracks which events have already been
    // processed by THIS subscriber so stale poll re-deliveries are ignored.
    let subscriberVersion = 0;

    function hasAppStateEvent(events: SyncEvent[], key: string): boolean {
      return events.some(
        (event) =>
          event.source === "app-state" &&
          (event.key === key ||
            event.key === "*" ||
            (typeof event.key === "string" && event.key.startsWith(`${key}:`))),
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

      // Awareness (cursor/presence) events never change action/extension/
      // app-state query results, but they arrive on every peer keystroke and
      // carry no version (so the freshness filter always passes them). Keep
      // them out of the invalidate block or an idle collaborative doc turns
      // every peer's cursor move into a framework-wide refetch storm; they
      // still reach onEvent below for callers that render presence.
      const invalidating = relevant.filter((e) => e.source !== "awareness");

      if (invalidating.length > 0 && queryClient) {
        const hasActionEvent = invalidating.some(
          (evt) => evt.source === "action",
        );
        if (hasActionEvent) {
          // Custom apps frequently start with raw `useQuery` calls before
          // graduating to `useActionQuery` or source-versioned query keys.
          // A successful mutating action is the core "agent changed app data"
          // signal, so refresh active queries broadly as a compatibility
          // safety net. Other event sources stay targeted to avoid request
          // storms from noisy domain-specific writes.
          const predicate = actionInvalidatePredicateRef.current;
          queryClient.invalidateQueries(predicate ? { predicate } : undefined);
        }

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
        if (hasAppStateEvent(invalidating, "navigate")) {
          queryClient.invalidateQueries({ queryKey: ["navigate-command"] });
        }
        if (hasAppStateEvent(invalidating, "show-questions")) {
          queryClient.invalidateQueries({ queryKey: ["show-questions"] });
        }
        if (hasAppStateEvent(invalidating, "__set_url__")) {
          queryClient.invalidateQueries({ queryKey: ["__set_url__"] });
        }
      }

      // Always forward all events to onEvent — templates can layer surgical
      // logic on top (e.g. ignore their own writes via requestSource, or
      // invalidate inactive queries for a specific source).
      for (const evt of events) {
        onEventRef.current?.(evt);
      }
    }

    function onEvents(events: SyncEvent[], version: number | undefined): void {
      const freshEvents = events.filter((event) => {
        const v = typeof event.version === "number" ? event.version : 0;
        return v === 0 || v > subscriberVersion;
      });

      if (freshEvents.length > 0) {
        invalidateForEvents(freshEvents);
      }

      const maxEventVersion = freshEvents.reduce(
        (max, event) =>
          Math.max(max, typeof event.version === "number" ? event.version : 0),
        0,
      );
      subscriberVersion = Math.max(
        subscriberVersion,
        version ?? 0,
        maxEventVersion,
      );
    }

    const transport = getOrCreateTransport(pollUrl, sseUrl);
    transport.add(id, {
      onEvents,
      pauseWhenHidden,
      interval,
      fallbackInterval,
    });

    return () => {
      transport.remove(id);
      // If the registry still holds this transport, and the transport is now
      // empty, evict it so the next mount gets a fresh instance rather than a
      // stopped-but-still-registered one (the registry entry being cleared by
      // releaseTransport is the signal to rebuild state).
      if (!transport["subscribers"].size) {
        releaseTransport(pollUrl, sseUrl);
      }
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
    const id = Symbol("useScreenRefreshKey");
    // Per-subscriber version cursor (same freshness logic as useDbSync).
    let subscriberVersion = 0;

    function onEvents(events: SyncEvent[], version: number | undefined): void {
      const freshEvents = events.filter((event) => {
        const v = typeof event.version === "number" ? event.version : 0;
        return v === 0 || v > subscriberVersion;
      });
      if (freshEvents.some((e) => e.source === "screen-refresh")) {
        setKey((k) => k + 1);
      }
      const maxEventVersion = freshEvents.reduce(
        (max, event) =>
          Math.max(max, typeof event.version === "number" ? event.version : 0),
        0,
      );
      subscriberVersion = Math.max(
        subscriberVersion,
        version ?? 0,
        maxEventVersion,
      );
    }

    const transport = getOrCreateTransport(pollUrl, sseUrl);
    transport.add(id, {
      onEvents,
      pauseWhenHidden,
      interval,
      fallbackInterval,
    });

    return () => {
      transport.remove(id);
      if (!transport["subscribers"].size) {
        releaseTransport(pollUrl, sseUrl);
      }
    };
  }, [pollUrl, sseUrl, interval, fallbackInterval, pauseWhenHidden]);

  return key;
}
