import { useEffect, useRef, useState } from "react";

import {
  ensureDemoModeFetchInterceptor,
  refreshDemoModeFetchInterceptor,
} from "../demo/fetch-interceptor.js";
import { agentNativePath } from "./api-path.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import {
  ensureEmbedAuthFetchInterceptor,
  isEmbedAuthActive,
} from "./embed-auth.js";
import { bumpChangeVersion } from "./use-change-version.js";

interface Query {
  queryKey: readonly unknown[];
}

interface QueryClient {
  invalidateQueries(
    opts?: {
      queryKey?: string[];
      predicate?: (query: Query) => boolean;
    },
    options?: { cancelRefetch?: boolean },
  ): unknown;
  isFetching?(filters?: {
    queryKey?: string[];
    predicate?: (query: Query) => boolean;
  }): number;
}

const POLL_ABORT_MIN_MS = 10_000;
// SSE delivers changes immediately in the normal path. The poll is a
// cross-process/serverless safety net, so an idle tab should not bill the host
// four times per minute forever. Focus and active agent work still poll now.
const SSE_FALLBACK_INTERVAL_MS = 60_000;
const IDLE_POLL_INTERVAL_MS = 60_000;
const POLL_AUTH_FAILURE_COOLDOWN_MS = 60_000;
/**
 * Max cadence for SSE/poll-driven query invalidation in `useDbSync`. Events
 * that arrive within this window of the first one in a burst are merged into
 * a single `invalidateForEvents` call instead of one call per event — see the
 * `queueInvalidateBatch` comment at the call site.
 */
const INVALIDATE_COALESCE_MS = 250;

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

/**
 * App-state keys that drive immediate UI navigation/interaction and must
 * never sit behind the invalidation coalesce window (see
 * `isInteractionCriticalSyncEvent`).
 */
const INTERACTION_CRITICAL_APP_STATE_KEYS = [
  "navigate",
  "show-questions",
  "__set_url__",
];

/**
 * True for sync events that drive immediate, agent-initiated UI navigation
 * or interaction rather than passive data invalidation — app-state writes in
 * general (they back `["app-state"]` queries directly), and specifically the
 * `navigate` / `show-questions` / `__set_url__` app-state keys that
 * `invalidateForEvents` special-cases into their own query keys below.
 *
 * `useDbSync` batches ordinary invalidation-driving events (action/collab/db
 * change events) into one flush per `INVALIDATE_COALESCE_MS` so a chatty doc
 * doesn't refetch on every keystroke. That trade-off is wrong for these
 * events: agent-driven navigation, `set-url`, and guided-questions prompts
 * must land as close to instantly as possible, so any batch containing one
 * of these bypasses the coalesce window and flushes immediately instead.
 *
 * Exported as a small pure predicate so this classification is unit-testable
 * independent of the transport/timer plumbing around it.
 */
export function isInteractionCriticalSyncEvent(event: SyncEvent): boolean {
  return (
    event.source === "app-state" &&
    (event.key === "*" ||
      INTERACTION_CRITICAL_APP_STATE_KEYS.some(
        (key) =>
          event.key === key ||
          (typeof event.key === "string" && event.key.startsWith(`${key}:`)),
      ))
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
  /** Requested poll interval while the tab has no active agent work. */
  idleInterval: number;
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
  private activeChatIds = new Set<string>();

  constructor(
    private readonly pollUrl: string,
    private readonly sseUrl: string | false,
  ) {}

  // -------------------------------------------------------------------------
  // Subscriber management
  // -------------------------------------------------------------------------

  add(id: symbol, sub: TransportSubscription): void {
    const wasEmpty = this.subscribers.size === 0;
    const wasActive = this.isActive;
    this.subscribers.set(id, sub);
    if (wasEmpty) {
      this.stopped = false;
      this.start();
    } else if (!wasActive && this.isActive) {
      // A collab surface (or other active subscriber) just joined. Catch up
      // immediately rather than waiting out an idle-cadence timer.
      this.pollNow();
    } else {
      this.reschedule();
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

  private get effectiveIdleInterval(): number {
    let min = Infinity;
    for (const sub of this.subscribers.values()) {
      if (sub.idleInterval < min) min = sub.idleInterval;
    }
    return isFinite(min) ? min : IDLE_POLL_INTERVAL_MS;
  }

  private get isActive(): boolean {
    return this.activeChatIds.size > 0;
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
    if (
      events.some(
        (event) =>
          event.source === "app-state" &&
          (event.key === "demo-mode" || event.key === "*"),
      )
    ) {
      void refreshDemoModeFetchInterceptor();
    }
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
    const base = this.isActive
      ? this.effectiveInterval
      : this.sseConnected
        ? this.effectiveFallbackInterval
        : this.effectiveIdleInterval;
    // Exponential backoff while polls keep failing (500s during a deploy,
    // DNS blips, a struggling DB). Auth failures have their own cooldown
    // above; this covers everything else so a down server isn't hammered at
    // full cadence. Resets on the first successful poll.
    const delay =
      this.consecutiveFailures > 0
        ? Math.min(base * 2 ** Math.min(this.consecutiveFailures, 5), 300_000)
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

  private handleChatRunning = (event: Event): void => {
    const detail = (
      event as CustomEvent<{
        isRunning?: unknown;
        running?: unknown;
        tabId?: unknown;
      }>
    ).detail;
    const running =
      typeof detail?.isRunning === "boolean"
        ? detail.isRunning
        : typeof detail?.running === "boolean"
          ? detail.running
          : null;
    if (running === null) return;

    const id =
      typeof detail?.tabId === "string" && detail.tabId
        ? detail.tabId
        : "__default__";
    const wasActive = this.isActive;
    if (running) this.activeChatIds.add(id);
    else this.activeChatIds.delete(id);
    if (wasActive === this.isActive) return;

    if (this.isActive) {
      // Run start is a high-signal indication that cross-process writes are
      // imminent. Catch up now, then stay on the active cadence.
      this.pollNow();
    } else {
      this.reschedule();
    }
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
    window.addEventListener("agentNative.chatRunning", this.handleChatRunning);
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
    window.removeEventListener(
      "agentNative.chatRunning",
      this.handleChatRunning,
    );
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
    idleInterval: options.interval ?? 60_000,
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
 *   Default: 60000
 * @param options.pauseWhenHidden - Pause polling while the tab is hidden.
 *   Default: true
 * @param options.ignoreSource - Skip events whose `requestSource` matches this
 *   value. Use a per-tab ID so the UI ignores its own writes while still
 *   picking up changes from other tabs, agents, and scripts.
 * @param options.actionInvalidatePredicate - Optional filter for the broad
 *   compatibility invalidate triggered by `action` events. Use this to keep
 *   expensive active queries on explicit-refresh semantics while still letting
 *   normal source-versioned queries react through `useChangeVersion`.
 * @param options.suppressActionInvalidationFor - Action names whose sync events
 *   should not invalidate all action queries. Use only for high-volume
 *   background actions that perform their own narrow client invalidation.
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
    suppressActionInvalidationFor?: string[];
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
  const idleInterval =
    options.interval === undefined ? IDLE_POLL_INTERVAL_MS : interval;

  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const ignoreSourceRef = useRef(options.ignoreSource);
  ignoreSourceRef.current = options.ignoreSource;
  const actionInvalidatePredicateRef = useRef(
    options.actionInvalidatePredicate,
  );
  actionInvalidatePredicateRef.current = options.actionInvalidatePredicate;
  const suppressActionInvalidationForRef = useRef(
    options.suppressActionInvalidationFor,
  );
  suppressActionInvalidationForRef.current =
    options.suppressActionInvalidationFor;

  useEffect(() => {
    const id = Symbol("useDbSync");
    // Per-subscriber version cursor: tracks which events have already been
    // processed by THIS subscriber so stale poll re-deliveries are ignored.
    let subscriberVersion = 0;

    // Coalesce bursts of SSE-driven invalidation into at most one flush per
    // INVALIDATE_COALESCE_MS. A chatty doc (many small agent edits, several
    // peers editing at once) can otherwise deliver a handful of `action`/
    // `collab` events within a few hundred ms, each independently calling
    // `queryClient.invalidateQueries` and firing `onEvent` — every one of
    // those touches whatever query subscribers are mounted (e.g. a
    // full-page editor) even though the end state only needs to be
    // refreshed once. Version bookkeeping stays synchronous (below) so
    // freshness filtering for the NEXT batch is unaffected by the delay.
    //
    // This coalesce window is wrong for interaction-critical events (agent
    // navigation, `set-url`, guided questions — see
    // `isInteractionCriticalSyncEvent`): those must reach the UI immediately,
    // not up to INVALIDATE_COALESCE_MS late. So a fresh batch containing one
    // of those flushes synchronously (queued + new events together,
    // canceling any pending timer) instead of joining the coalesce window.
    // Pure invalidation bursts with no interaction-critical members keep the
    // coalesced behavior.
    let pendingInvalidateEvents: SyncEvent[] = [];
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;

    function flushInvalidateBatch() {
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
        invalidateTimer = null;
      }
      if (pendingInvalidateEvents.length === 0) return;
      const batch = pendingInvalidateEvents;
      pendingInvalidateEvents = [];
      invalidateForEvents(batch);
    }

    function queueInvalidateBatch(events: SyncEvent[]) {
      pendingInvalidateEvents.push(...events);
      if (events.some(isInteractionCriticalSyncEvent)) {
        flushInvalidateBatch();
        return;
      }
      if (invalidateTimer) return;
      invalidateTimer = setTimeout(
        flushInvalidateBatch,
        INVALIDATE_COALESCE_MS,
      );
    }

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
      const ownBrowserSource = getBrowserTabId();
      const relevant = events.filter(
        (event) =>
          !(
            event.source === "action" &&
            event.requestSource === ownBrowserSource
          ) &&
          (!ignore || event.requestSource !== ignore),
      );
      const suppressedActions = new Set(
        suppressActionInvalidationForRef.current ?? [],
      );
      const isSuppressedActionEvent = (evt: SyncEvent) =>
        evt.source === "action" &&
        typeof evt.key === "string" &&
        suppressedActions.has(evt.key);
      const nonAwareness = relevant.filter((e) => e.source !== "awareness");
      const suppressesWholeBatch =
        nonAwareness.length > 0 &&
        nonAwareness.every((evt) => evt.source === "action") &&
        nonAwareness.every(isSuppressedActionEvent);

      // Bump per-source change counters. Components that read these via
      // `useChangeVersion(source)` and fold the value into a React Query
      // queryKey get a targeted refetch — no whole-cache invalidate, no
      // request storm. See `use-change-version.ts` for the contract.
      for (const evt of relevant) {
        const src = typeof evt.source === "string" ? evt.source : "";
        const ver = typeof evt.version === "number" ? evt.version : 0;
        if (src && ver > 0) {
          bumpChangeVersion(src, ver);
          if (typeof evt.key === "string" && evt.key) {
            bumpChangeVersion(`${src}:${evt.key}`, ver);
          }
        }
      }

      // Awareness (cursor/presence) events never change action/extension/
      // app-state query results, but they arrive on every peer keystroke and
      // carry no version (so the freshness filter always passes them). Keep
      // them out of the invalidate block or an idle collaborative doc turns
      // every peer's cursor move into a framework-wide refetch storm; they
      // still reach onEvent below for callers that render presence.
      const invalidating = relevant.filter((e) => e.source !== "awareness");

      if (invalidating.length > 0 && queryClient) {
        // Sync events describe completed writes. If a matching read is already
        // in flight, let it finish instead of aborting and immediately
        // launching the same request again. Repeated action events otherwise
        // turn a slow endpoint into a cancel/restart loop that never settles.
        const invalidateWithoutCancel = (filters?: {
          queryKey?: string[];
          predicate?: (query: Query) => boolean;
        }) => {
          const needsTrailingRefresh =
            (queryClient.isFetching?.(filters) ?? 0) > 0;
          const completion = queryClient.invalidateQueries(filters, {
            cancelRefetch: false,
          });
          // TanStack Query deliberately leaves an in-flight fetch alone when
          // cancelRefetch is false. Queue one post-settlement invalidation so
          // a write that landed after that read began cannot be cleared as
          // fresh by the older response.
          if (needsTrailingRefresh && completion instanceof Promise) {
            void completion.then(
              () => queryClient.invalidateQueries(filters),
              () => {},
            );
          }
        };
        const hasActionEvent = invalidating.some(
          (evt) => evt.source === "action" && !isSuppressedActionEvent(evt),
        );
        if (hasActionEvent) {
          // Action-backed reads share the ["action"] prefix. Keep the default
          // refresh targeted to those queries; invalidating every active query
          // makes one agent write fan out across unrelated provider reads,
          // dashboards, and background status checks. Older apps that still
          // need broad compatibility can opt in with a predicate.
          const predicate = actionInvalidatePredicateRef.current;
          invalidateWithoutCancel(
            predicate ? { predicate } : { queryKey: ["action"] },
          );
        }

        // Framework-level invalidate: a small, fixed list of query-key
        // prefixes the framework's own hooks/components use (action results,
        // extension state, application-state, the agent's `set-url` channel,
        // etc.). Templates' own data queries do NOT live here — they react
        // through `useChangeVersion(source)` in their query keys instead, so
        // a single change event doesn't fan out into "refetch everything".
        // Suppressed-action-only batches skip this whole list (their
        // mutations perform their own narrow invalidation) — but events must
        // STILL reach the onEvent forwarding below, so guard, don't return.
        //
        // Invalidation is scoped by source. Data-query prefixes (action,
        // extension, tool) refetch only when the batch carries an event that
        // can actually change action/extension-backed data — action
        // mutations, settings, extension, collab, screen-refresh, etc.
        // `app-state` events (agent/UI navigation, selection, and the
        // set-url/questions command channel) drive their OWN keys below and
        // must NEVER fan out into "refetch every action query": an active
        // agent session mirrors navigation + selection into application_state
        // continuously, and the serverless poll path replays those writes
        // back to the originating tab (the DB-scan fallback cannot preserve
        // `requestSource`, so `ignoreSource` can't filter them). Fanning each
        // one into a full `["action"]` refetch turned a normal session into a
        // client fetch storm that exhausted the DB connection pool — which in
        // turn starved run heartbeat writes and surfaced as `stale_run`.
        if (!suppressesWholeBatch) {
          const hasDataChangingEvent = invalidating.some(
            (evt) => evt.source !== "app-state",
          );
          if (hasDataChangingEvent) {
            const hasFrameworkPrefixEvent = invalidating.some((evt) =>
              ["extensions", "extension", "tool", "tools", "slots"].includes(
                evt.source ?? "",
              ),
            );
            // The action-specific invalidation above already refreshed
            // ["action"]. A mixed action + extension/tool batch still needs
            // the independent framework prefixes, while pure action batches
            // retain their narrow storm-resistant invalidation.
            if (!hasActionEvent) {
              invalidateWithoutCancel({ queryKey: ["action"] });
            }
            if (!hasActionEvent || hasFrameworkPrefixEvent) {
              invalidateWithoutCancel({ queryKey: ["extension"] });
              invalidateWithoutCancel({ queryKey: ["extensions"] });
              invalidateWithoutCancel({ queryKey: ["extension-slots"] });
              invalidateWithoutCancel({ queryKey: ["slot-installs"] });
              invalidateWithoutCancel({ queryKey: ["slot-available"] });
              invalidateWithoutCancel({ queryKey: ["tool"] });
              invalidateWithoutCancel({ queryKey: ["tools"] });
            }
          }
          if (invalidating.some((evt) => evt.source === "app-state")) {
            invalidateWithoutCancel({ queryKey: ["app-state"] });
          }
          if (hasAppStateEvent(invalidating, "navigate")) {
            invalidateWithoutCancel({ queryKey: ["navigate-command"] });
          }
          if (hasAppStateEvent(invalidating, "show-questions")) {
            invalidateWithoutCancel({ queryKey: ["show-questions"] });
          }
          if (hasAppStateEvent(invalidating, "__set_url__")) {
            invalidateWithoutCancel({ queryKey: ["__set_url__"] });
          }
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
        queueInvalidateBatch(freshEvents);
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
      idleInterval,
      fallbackInterval,
    });

    return () => {
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
        // Flush synchronously on unmount so a pending batch isn't silently
        // dropped (e.g. a route change right after an agent edit lands).
        flushInvalidateBatch();
      }
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
    idleInterval,
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
  const idleInterval =
    options.interval === undefined ? IDLE_POLL_INTERVAL_MS : interval;
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
      idleInterval,
      fallbackInterval,
    });

    return () => {
      transport.remove(id);
      if (!transport["subscribers"].size) {
        releaseTransport(pollUrl, sseUrl);
      }
    };
  }, [
    pollUrl,
    sseUrl,
    interval,
    idleInterval,
    fallbackInterval,
    pauseWhenHidden,
  ]);

  return key;
}
