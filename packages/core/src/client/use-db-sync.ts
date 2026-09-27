import { useEffect, useRef, useState } from "react";

import { ensureDemoModeFetchInterceptor } from "../demo/fetch-interceptor.js";
import {
  parseHandshakeFrame,
  parseTokenFrame,
  REALTIME_CAP_POLL_LIVE,
  REALTIME_POLL_LIVE_QUERY_PARAM,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SSE_HANDSHAKE_EVENT,
  REALTIME_SSE_TOKEN_EVENT,
} from "../realtime-protocol.js";

export { REALTIME_CAP_POLL_LIVE } from "../realtime-protocol.js";
import {
  addSurfaceVisibilityListener,
  isHostSurfaceHidden,
  isSurfaceHidden,
} from "../shared/surface-visibility.js";
import { agentNativePath } from "./api-path.js";
import { getBrowserTabId } from "./browser-tab-id.js";
import { isTerminalAuthFailure } from "./create-query-client.js";
import {
  ensureEmbedAuthFetchInterceptor,
  isEmbedAuthActive,
} from "./embed-auth.js";
import { bumpChangeVersion } from "./use-change-version.js";

interface Query {
  queryKey: readonly unknown[];
  state?: { error?: unknown };
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

type InvalidateFilters = {
  queryKey?: string[];
  predicate?: (query: Query) => boolean;
  dedupeKey?: string;
};

const POLL_ABORT_MIN_MS = 10_000;
const SSE_FALLBACK_INTERVAL_MS = 60_000;
const IDLE_POLL_INTERVAL_MS = 60_000;
const HIDDEN_POLL_INTERVAL_MS = 10_000;
const POLL_AUTH_FAILURE_COOLDOWN_MS = 60_000;
const LOCAL_SSE_RECONNECT_BASE_MS = 1_000;
const LOCAL_SSE_RECONNECT_MAX_MS = 30_000;
const LOCAL_SSE_REFUSAL_SHORT_TIER_ATTEMPTS = 8;
const LOCAL_SSE_REFUSAL_BASE_MS = 5 * 60_000;
const LOCAL_SSE_REFUSAL_MAX_MS = 60 * 60_000;
const ACTIVE_CHAT_TTL_MS = 5 * 60 * 1_000;
const ACTIVE_CHAT_MAX = 1_000;
const INVALIDATE_COALESCE_MS = 250;
const SSE_LEADER_LOCK_PREFIX = "agent-native-sync:";

class HttpStatusError extends Error {
  status: number;

  constructor(status: number) {
    super("HTTP " + status);
    this.status = status;
  }
}

export type SyncEvent = {
  version?: number;
  cursorId?: string;
  source?: string;
  type?: string;
  key?: string;
  requestSource?: string;
  [k: string]: unknown;
};

type PollResponse = {
  version: number;
  events: SyncEvent[];
  cursor?: string;
};

type SyncCursor = {
  version: number;
  id: string;
};

const INITIAL_SYNC_CURSOR: SyncCursor = { version: 0, id: "" };

function encodeSyncCursor(cursor: SyncCursor): string {
  return `${cursor.version}.${cursor.id}`;
}

function decodeSyncCursor(value: unknown): SyncCursor | undefined {
  if (typeof value !== "string") return undefined;
  const separator = value.indexOf(".");
  if (separator < 1) return undefined;
  const version = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(version) || version < 0) return undefined;
  return { version, id };
}

function compareSyncCursors(a: SyncCursor, b: SyncCursor): number {
  if (a.version !== b.version) return a.version - b.version;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function syncEventCursor(event: SyncEvent): SyncCursor | undefined {
  if (
    typeof event.version !== "number" ||
    !Number.isSafeInteger(event.version) ||
    typeof event.cursorId !== "string"
  ) {
    return undefined;
  }
  return { version: event.version, id: event.cursorId };
}

function maxSyncCursor(a: SyncCursor, b: SyncCursor | undefined): SyncCursor {
  return b && compareSyncCursors(b, a) > 0 ? b : a;
}

function cursorForEvents(events: readonly SyncEvent[]): SyncCursor | undefined {
  let cursor: SyncCursor | undefined;
  for (const event of events) {
    const eventCursor =
      syncEventCursor(event) ??
      (typeof event.version === "number" &&
      Number.isSafeInteger(event.version) &&
      event.version >= 0
        ? { version: event.version, id: "" }
        : undefined);
    if (
      eventCursor &&
      (!cursor || compareSyncCursors(eventCursor, cursor) > 0)
    ) {
      cursor = eventCursor;
    }
  }
  return cursor;
}

function isSyncEventAfterCursor(
  event: SyncEvent,
  cursor: SyncCursor,
  subscriberVersion: number,
): boolean {
  const eventCursor = syncEventCursor(event);
  if (eventCursor) return compareSyncCursors(eventCursor, cursor) > 0;
  const version = typeof event.version === "number" ? event.version : 0;
  return version === 0 || version > subscriberVersion;
}

type SyncBroadcast =
  | {
      type: "events";
      events: SyncEvent[];
      version: number | undefined;
      cursor?: SyncCursor;
    }
  | { type: "sse-state"; connected: boolean; capabilities: string[] }
  | { type: "sse-state-request" };

type EventSubscriber = (
  events: SyncEvent[],
  version: number | undefined,
  cursor?: SyncCursor,
) => void;

function getPollAbortMs(interval: number): number {
  return Math.max(POLL_ABORT_MIN_MS, interval * 4);
}

function isDocumentHidden(): boolean {
  return isSurfaceHidden();
}

function resolveSseUrl(sseUrl: string | false | undefined): string | false {
  if (sseUrl === false) return false;
  if (isEmbedAuthActive()) return false;
  const path = agentNativePath(sseUrl ?? "/_agent-native/events");
  return `${path}${path.includes("?") ? "&" : "?"}${REALTIME_POLL_LIVE_QUERY_PARAM}=1`;
}

const REALTIME_GATEWAY_SSE_PATH = "/stream";
const REALTIME_GATEWAY_POLL_PATH = "/poll";
const REALTIME_TOKEN_MINT_PATH = "/_agent-native/realtime-token";
const HOSTED_UNHEALTHY_THRESHOLD = 3;

interface RealtimeGatewayBinding {
  sseUrl: string;
  pollUrl: string;
  tokenMintUrl: string;
}

function getRealtimeConfig():
  | { transport?: string; gatewayBaseUrl?: string }
  | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__AGENT_NATIVE_CONFIG__?.realtime;
}

function resolveGatewayBinding(
  localSseUrl: string | false,
): RealtimeGatewayBinding | null {
  if (localSseUrl === false) return null;
  if (isEmbedAuthActive()) return null;
  const config = getRealtimeConfig();
  if (config?.transport !== "hosted") return null;
  const base = config.gatewayBaseUrl?.replace(/\/+$/, "");
  if (!base) return null;
  return {
    sseUrl: `${base}${REALTIME_GATEWAY_SSE_PATH}`,
    pollUrl: `${base}${REALTIME_GATEWAY_POLL_PATH}`,
    tokenMintUrl: agentNativePath(REALTIME_TOKEN_MINT_PATH),
  };
}

function applyReconnectJitter(delay: number): number {
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delay + jitter));
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

function hasTerminalAuthFailure(query: Query): boolean {
  return isTerminalAuthFailure(query.state?.error);
}

const INTERACTION_CRITICAL_APP_STATE_KEYS = [
  "navigate",
  "show-questions",
  "__set_url__",
];
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

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

function appStateQueryMatchesKeys(
  query: Query,
  changedKeys: readonly string[],
): boolean {
  if (query.queryKey[0] !== "app-state") return false;
  if (query.queryKey.length === 1) return true;
  const queryStateKey = query.queryKey[1];
  if (typeof queryStateKey !== "string") return false;
  return changedKeys.some(
    (changedKey) =>
      changedKey === "*" ||
      changedKey === queryStateKey ||
      changedKey.startsWith(`${queryStateKey}:`) ||
      queryStateKey.startsWith(`${changedKey}:`),
  );
}

async function fetchPollJson<T>(
  pollUrl: string,
  cursor: SyncCursor,
  interval: number,
  token?: string,
): Promise<T> {
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), getPollAbortMs(interval))
    : null;

  const separator = pollUrl.includes("?") ? "&" : "?";
  const cursorQuery = `since=${cursor.version}`;
  const compositeCursorQuery =
    cursor.version > 0 || cursor.id
      ? `&cursor=${encodeURIComponent(encodeSyncCursor(cursor))}`
      : "";
  const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : "";
  const url = `${pollUrl}${separator}${cursorQuery}${compositeCursorQuery}${tokenQuery}`;

  try {
    const res = await fetch(
      url,
      controller ? { signal: controller.signal } : undefined,
    );
    if (!res.ok) throw new HttpStatusError(res.status);
    return await res.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface TransportSubscription {
  onEvents: EventSubscriber;
  pauseWhenHidden: boolean;
  interval: number;
  idleInterval: number;
  fallbackInterval: number;
  onSseStateChange?: (
    connected: boolean,
    capabilities?: readonly string[],
  ) => void;
}

class SyncTransport {
  private subscribers = new Map<symbol, TransportSubscription>();
  private cursorRef: SyncCursor = { ...INITIAL_SYNC_CURSOR };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refreshRequested = false;
  private removeVisibilityListener?: () => void;
  private stopped = false;
  private inFlight = false;
  private eventSource: EventSource | null = null;
  private localReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private localReconnectAttempts = 0;
  private localRefusalAttempts = 0;
  private localSseOpened = false;
  private sseConnected = false;
  private authFailureUntil = 0;
  private consecutiveFailures = 0;
  private activeChatIds = new Map<string, number>();
  // Hosted-gateway state. `mode` starts "hosted" when a binding is present and
  // flips to "local" on health-gate revert; `token` is the current subscribe
  // token (minted from the app, rotated over the stream), never part of any
  // registry key.
  private mode: "hosted" | "local";
  private token: string | null = null;
  private tokenMintInFlight: Promise<boolean> | null = null;
  private gatewayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private capabilities: string[] = [];
  private leaderState: "unknown" | "pending" | "leader" = "unknown";
  private releaseLeadership: (() => void) | null = null;
  private leaderAbort: AbortController | null = null;
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly pollUrl: string,
    private readonly sseUrl: string | false,
    private readonly gateway: RealtimeGatewayBinding | null = null,
  ) {
    this.mode = gateway ? "hosted" : "local";
  }

  getCapabilities(): readonly string[] {
    return this.capabilities;
  }

  private get activeSseUrl(): string | false {
    if (this.mode === "hosted" && this.gateway) {
      if (!this.token) return this.gateway.sseUrl;
      const base = `${this.gateway.sseUrl}?token=${encodeURIComponent(this.token)}`;
      return this.cursorRef.version > 0 || this.cursorRef.id
        ? `${base}&since=${this.cursorRef.version}&cursor=${encodeURIComponent(encodeSyncCursor(this.cursorRef))}`
        : base;
    }
    return this.sseUrl;
  }

  private get activePollUrl(): string {
    return this.mode === "hosted" && this.gateway
      ? this.gateway.pollUrl
      : this.pollUrl;
  }

  private mintToken(): Promise<boolean> {
    if (!this.gateway || this.mode !== "hosted") return Promise.resolve(false);
    if (this.tokenMintInFlight) return this.tokenMintInFlight;
    const mintUrl = this.gateway.tokenMintUrl;
    this.tokenMintInFlight = (async () => {
      const controller =
        typeof AbortController === "undefined" ? null : new AbortController();
      const timeout = controller
        ? setTimeout(() => controller.abort(), POLL_ABORT_MIN_MS)
        : null;
      try {
        const res = await fetch(mintUrl, {
          credentials: "same-origin",
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (res.ok) {
          const data = (await res.json()) as { token?: unknown };
          if (typeof data?.token === "string" && data.token) {
            this.token = data.token;
            return true;
          }
          this.revertToLocal();
          return false;
        }
        if (res.status === 404 || res.status === 401 || res.status === 403) {
          this.revertToLocal();
          return false;
        }
        this.onGatewayTransientFailure();
        return false;
      } catch {
        this.onGatewayTransientFailure();
        return false;
      } finally {
        if (timeout) clearTimeout(timeout);
        this.tokenMintInFlight = null;
      }
    })();
    return this.tokenMintInFlight;
  }

  private onGatewayTransientFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= HOSTED_UNHEALTHY_THRESHOLD) {
      this.revertToLocal();
    }
  }

  private revertToLocal(): void {
    if (this.mode === "local") return;
    this.mode = "local";
    this.token = null;
    this.capabilities = [];
    this.consecutiveFailures = 0;
    if (this.gatewayReconnectTimer) {
      clearTimeout(this.gatewayReconnectTimer);
      this.gatewayReconnectTimer = null;
    }
    this.closeEvents();
    if (!this.stopped) {
      this.connectEvents();
      this.schedulePoll();
    }
  }

  private scheduleGatewayReconnect(): void {
    if (this.stopped || this.gatewayReconnectTimer) return;
    this.gatewayReconnectTimer = setTimeout(() => {
      this.gatewayReconnectTimer = null;
      if (!this.stopped && !this.eventSource) this.connectEvents();
    }, applyReconnectJitter(1000));
  }

  add(id: symbol, sub: TransportSubscription): void {
    const wasEmpty = this.subscribers.size === 0;
    const wasActive = this.isActive;
    this.subscribers.set(id, sub);
    if (wasEmpty) {
      this.stopped = false;
      this.start();
    } else if (!wasActive && this.isActive) {
      this.pollNow();
    } else {
      this.reschedule();
    }
    sub.onSseStateChange?.(this.sseConnected, this.capabilities);
  }

  remove(id: symbol): void {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) {
      this.teardown();
    } else {
      this.reschedule();
    }
  }

  private shouldStayIdle(): boolean {
    if (isHostSurfaceHidden()) return true;
    return this.effectivePauseWhenHidden && isDocumentHidden();
  }

  private get effectivePauseWhenHidden(): boolean {
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
    const now = Date.now();
    for (const [id, lastSeen] of this.activeChatIds) {
      if (now - lastSeen > ACTIVE_CHAT_TTL_MS) {
        this.activeChatIds.delete(id);
      }
    }
    return this.activeChatIds.size > 0;
  }

  private get effectiveFallbackInterval(): number {
    let min = Infinity;
    for (const sub of this.subscribers.values()) {
      if (sub.fallbackInterval < min) min = sub.fallbackInterval;
    }
    return isFinite(min) ? min : SSE_FALLBACK_INTERVAL_MS;
  }

  private fan(
    events: SyncEvent[],
    version: number | undefined,
    cursor: SyncCursor = this.cursorRef,
  ): void {
    for (const sub of this.subscribers.values()) {
      sub.onEvents(events, version, cursor);
    }
  }

  private setSseConnected(connected: boolean): void {
    if (this.sseConnected === connected) return;
    this.sseConnected = connected;
    this.notifySseState();
    this.broadcast({
      type: "sse-state",
      connected,
      capabilities: this.capabilities,
    });
  }

  private notifySseState(): void {
    for (const sub of this.subscribers.values()) {
      sub.onSseStateChange?.(this.sseConnected, this.capabilities);
    }
  }

  private authFailureDelayMs(): number {
    return Math.max(0, this.authFailureUntil - Date.now());
  }

  private schedulePoll(): void {
    if (this.stopped) return;
    if (this.shouldStayIdle()) return;
    if (this.timer) clearTimeout(this.timer);
    const authDelay = this.authFailureDelayMs();
    if (authDelay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.poll();
      }, authDelay);
      return;
    }
    const visibleBase = this.isActive
      ? this.effectiveInterval
      : this.sseConnected
        ? this.effectiveFallbackInterval
        : this.effectiveIdleInterval;
    const base = isDocumentHidden()
      ? Math.max(visibleBase, HIDDEN_POLL_INTERVAL_MS)
      : visibleBase;
    const backoff =
      this.consecutiveFailures > 0
        ? Math.min(base * 2 ** Math.min(this.consecutiveFailures, 5), 300_000)
        : base;
    const delay = this.gateway ? applyReconnectJitter(backoff) : backoff;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delay);
  }

  private reschedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.schedulePoll();
    }
  }

  private closeEvents(): void {
    if (this.localReconnectTimer) {
      clearTimeout(this.localReconnectTimer);
      this.localReconnectTimer = null;
    }
    if (!this.eventSource) return;
    this.eventSource.close();
    this.eventSource = null;
    this.setSseConnected(false);
  }

  private get leaderKey(): string {
    return `${SSE_LEADER_LOCK_PREFIX}${this.pollUrl}`;
  }

  private electLeader(): void {
    if (this.leaderState === "pending") return;
    const locks =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks || typeof BroadcastChannel === "undefined") {
      this.leaderState = "leader";
      this.connectEvents();
      return;
    }

    this.openChannel();
    this.leaderState = "pending";
    const abort = new AbortController();
    this.leaderAbort = abort;
    void locks
      .request(
        this.leaderKey,
        { signal: abort.signal },
        () =>
          new Promise<void>((resolve) => {
            if (this.stopped) {
              resolve();
              return;
            }
            this.releaseLeadership = resolve;
            this.leaderState = "leader";
            this.connectEvents();
          }),
      )
      .catch(() => {
        if (this.stopped || abort.signal.aborted) return;
        this.leaderState = "leader";
        this.connectEvents();
      });
  }

  private dropLeadership(): void {
    this.leaderAbort?.abort();
    this.leaderAbort = null;
    this.releaseLeadership?.();
    this.releaseLeadership = null;
    this.leaderState = "unknown";
  }

  private openChannel(): void {
    if (this.channel || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(this.leaderKey);
    channel.onmessage = (message: MessageEvent) => {
      const frame = message.data as SyncBroadcast | null;
      if (this.stopped) return;
      if (frame?.type === "sse-state-request") {
        if (this.leaderState === "leader") {
          this.broadcast({
            type: "sse-state",
            connected: this.sseConnected,
            capabilities: this.capabilities,
          });
        }
        return;
      }
      if (this.leaderState === "leader") return;
      if (frame?.type === "events") {
        this.applyVersion(
          frame.events,
          frame.cursor ? undefined : frame.version,
        );
        this.cursorRef = maxSyncCursor(this.cursorRef, frame.cursor);
        this.fan(frame.events, frame.version, this.cursorRef);
      } else if (frame?.type === "sse-state") {
        const capabilitiesChanged =
          frame.capabilities.length !== this.capabilities.length ||
          frame.capabilities.some((cap, i) => cap !== this.capabilities[i]);
        this.capabilities = frame.capabilities;
        const wasConnected = this.sseConnected;
        this.setSseConnected(frame.connected);
        if (capabilitiesChanged && this.sseConnected === wasConnected) {
          this.notifySseState();
        }
        this.reschedule();
      }
    };
    this.channel = channel;
    channel.postMessage({ type: "sse-state-request" });
  }

  private broadcast(frame: SyncBroadcast): void {
    if (this.leaderState !== "leader") return;
    try {
      this.channel?.postMessage(frame);
      // postMessage throws only on a channel closed by tab teardown: there is
      // no reader left to tell, and rethrowing would take the leader's own
      // event handling down with it. Followers still have their poll.
      // coercion-ok: no live follower can observe this failure.
    } catch {
      /* empty */
    }
  }

  private closeChannel(): void {
    this.channel?.close();
    this.channel = null;
  }

  private scheduleLocalReconnect(): void {
    if (this.stopped || this.localReconnectTimer) return;
    const delay = Math.min(
      LOCAL_SSE_RECONNECT_BASE_MS * 2 ** this.localReconnectAttempts,
      LOCAL_SSE_RECONNECT_MAX_MS,
    );
    this.localReconnectAttempts += 1;
    this.localReconnectTimer = setTimeout(() => {
      this.localReconnectTimer = null;
      this.connectEvents();
    }, delay);
  }

  private scheduleLocalRefusalRetry(): void {
    if (this.stopped || this.localReconnectTimer) return;
    const attempt = this.localRefusalAttempts++;
    const delay =
      attempt < LOCAL_SSE_REFUSAL_SHORT_TIER_ATTEMPTS
        ? Math.min(
            LOCAL_SSE_RECONNECT_BASE_MS * 2 ** attempt,
            LOCAL_SSE_RECONNECT_MAX_MS,
          )
        : Math.min(
            LOCAL_SSE_REFUSAL_BASE_MS *
              2 ** (attempt - LOCAL_SSE_REFUSAL_SHORT_TIER_ATTEMPTS),
            LOCAL_SSE_REFUSAL_MAX_MS,
          );
    this.localReconnectTimer = setTimeout(() => {
      this.localReconnectTimer = null;
      this.connectEvents();
    }, delay);
  }

  private connectEvents(): void {
    if (
      this.stopped ||
      this.eventSource ||
      (this.localReconnectTimer && !this.localSseOpened) ||
      typeof EventSource === "undefined" ||
      this.shouldStayIdle()
    ) {
      return;
    }

    if (this.leaderState !== "leader") {
      this.electLeader();
      return;
    }

    // Hosted gateway needs a subscribe token before the stream can open.
    // EventSource can't set headers, so the token rides the connect query
    // string (see activeSseUrl). Mint first, then connect.
    if (this.mode === "hosted" && this.gateway && !this.token) {
      void this.mintToken().then((ok) => {
        if (this.stopped) return;
        if (ok && !this.eventSource) {
          this.connectEvents();
        } else if (!ok && this.mode === "hosted") {
          this.scheduleGatewayReconnect();
        }
      });
      return;
    }

    const url = this.activeSseUrl;
    if (!url) return;

    const source = new EventSource(url);
    this.eventSource = source;
    source.onopen = () => {
      if (this.mode === "local") {
        this.localSseOpened = true;
        this.localRefusalAttempts = 0;
        if (this.capabilities.includes(REALTIME_CAP_POLL_LIVE)) {
          this.capabilities = this.capabilities.filter(
            (cap) => cap !== REALTIME_CAP_POLL_LIVE,
          );
        }
      }
      const wasConnected = this.sseConnected;
      this.localReconnectAttempts = 0;
      this.setSseConnected(true);
      if (wasConnected) this.notifySseState();
      if (this.mode === "hosted") {
        this.consecutiveFailures = 0;
      }
      this.schedulePoll();
    };
    source.onerror = () => {
      if (this.eventSource !== source) return;
      this.setSseConnected(false);
      if (this.mode === "hosted" && this.gateway) {
        if (source.readyState === EventSource.CLOSED) this.token = null;
        this.closeEvents();
        this.onGatewayTransientFailure();
        if (this.mode === "hosted") this.scheduleGatewayReconnect();
        return;
      }
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        this.eventSource = null;
        if (this.localSseOpened) {
          this.scheduleLocalReconnect();
        } else {
          if (!this.capabilities.includes(REALTIME_CAP_POLL_LIVE)) {
            this.capabilities = [...this.capabilities, REALTIME_CAP_POLL_LIVE];
            this.notifySseState();
            this.broadcast({
              type: "sse-state",
              connected: this.sseConnected,
              capabilities: this.capabilities,
            });
          }
          this.scheduleLocalRefusalRetry();
        }
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
        this.fan(events, version, this.cursorRef);
        const eventCursor = cursorForEvents(events);
        this.broadcast({
          type: "events",
          events,
          version,
          cursor: eventCursor,
        });
      } catch {
        // Ignore malformed SSE frames; polling is the safety net.
      }
    };

    if (this.mode === "hosted" && this.gateway) {
      source.addEventListener(REALTIME_SSE_HANDSHAKE_EVENT, (e) => {
        const hs = parseHandshakeFrame((e as MessageEvent).data);
        if (!hs) return;
        if (hs.protocol !== REALTIME_PROTOCOL_VERSION) {
          console.warn(
            `[agent-native] unsupported realtime protocol ${hs.protocol} (expected ${REALTIME_PROTOCOL_VERSION})`,
          );
          return;
        }
        this.capabilities = hs.capabilities;
        this.notifySseState();
      });
      source.addEventListener(REALTIME_SSE_TOKEN_EVENT, (e) => {
        const frame = parseTokenFrame((e as MessageEvent).data);
        if (!frame?.token) return;
        this.token = frame.token;
        // EventSource can't change a live stream's URL, and its auto-reconnect
        // reuses the original (old-token) URL. Close and reconnect (jittered) so
        // the rotated token is actually used on the next connect.
        this.closeEvents();
        this.scheduleGatewayReconnect();
      });
    }
  }

  private applyVersion(events: SyncEvent[], version: number | undefined): void {
    if (typeof version === "number" && version > this.cursorRef.version) {
      this.cursorRef = { version, id: "" };
    }
    for (const evt of events) {
      this.cursorRef = maxSyncCursor(this.cursorRef, syncEventCursor(evt));
    }
  }

  private async poll(force = false): Promise<void> {
    if (this.stopped || this.inFlight) return;
    if (!force && this.shouldStayIdle()) return;
    this.inFlight = true;
    try {
      if (this.mode === "hosted" && this.gateway && !this.token) {
        const ok = await this.mintToken();
        if (!ok || this.stopped) return;
      }
      const data = await fetchPollJson<PollResponse>(
        this.activePollUrl,
        this.cursorRef,
        this.effectiveInterval,
        this.mode === "hosted" ? (this.token ?? undefined) : undefined,
      );
      if (this.stopped) return;
      this.consecutiveFailures = 0;
      if (this.authFailureUntil > 0) {
        this.authFailureUntil = 0;
        this.connectEvents();
      }
      const events = data.events ?? [];
      const responseCursor = decodeSyncCursor(data.cursor);
      this.applyVersion(events, responseCursor ? undefined : data.version);
      this.cursorRef = maxSyncCursor(this.cursorRef, responseCursor);
      this.fan(events, data.version, this.cursorRef);
    } catch (err) {
      if (this.stopped) return;
      this.consecutiveFailures++;
      if (this.mode === "hosted" && this.gateway) {
        if (isTerminalAuthFailure(err)) {
          this.token = null;
          void this.mintToken();
        }
        if (this.consecutiveFailures >= HOSTED_UNHEALTHY_THRESHOLD) {
          this.revertToLocal();
        }
      } else if (isTerminalAuthFailure(err)) {
        this.authFailureUntil = Date.now() + POLL_AUTH_FAILURE_COOLDOWN_MS;
        this.closeEvents();
      }
      // Network error — retried on the next (backed-off) interval.
    } finally {
      this.inFlight = false;
      if (this.refreshRequested && !this.stopped) {
        this.refreshRequested = false;
        void this.poll(true);
      } else {
        this.schedulePoll();
      }
    }
  }

  private pollNow(): void {
    if (this.shouldStayIdle()) return;
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
    if (!isSurfaceHidden()) {
      this.connectEvents();
      this.pollNow();
    } else if (this.shouldStayIdle()) {
      this.closeEvents();
      this.dropLeadership();
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    } else {
      this.reschedule();
    }
  };

  private handleFocus = (): void => {
    this.pollNow();
  };

  private handleRefreshData = (): void => {
    if (this.inFlight) {
      this.refreshRequested = true;
      return;
    }
    void this.poll(true);
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
    if (running) {
      this.activeChatIds.delete(id);
      this.activeChatIds.set(id, Date.now());
      while (this.activeChatIds.size > ACTIVE_CHAT_MAX) {
        const oldestId = this.activeChatIds.keys().next().value;
        if (typeof oldestId !== "string") break;
        this.activeChatIds.delete(oldestId);
      }
    } else {
      this.activeChatIds.delete(id);
    }
    if (wasActive === this.isActive) return;

    if (this.isActive) {
      this.pollNow();
    } else {
      this.reschedule();
    }
  };

  private start(): void {
    ensureEmbedAuthFetchInterceptor();
    ensureDemoModeFetchInterceptor();

    if (!this.shouldStayIdle()) {
      this.connectEvents();
      void this.poll();
    }
    window.addEventListener("focus", this.handleFocus);
    window.addEventListener("agentNative:refresh-data", this.handleRefreshData);
    window.addEventListener("agentNative.chatRunning", this.handleChatRunning);
    this.removeVisibilityListener = addSurfaceVisibilityListener(
      this.handleVisibilityChange,
    );
  }

  private teardown(): void {
    this.stopped = true;
    this.activeChatIds.clear();
    this.closeEvents();
    this.dropLeadership();
    this.closeChannel();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.gatewayReconnectTimer) {
      clearTimeout(this.gatewayReconnectTimer);
      this.gatewayReconnectTimer = null;
    }
    if (this.localReconnectTimer) {
      clearTimeout(this.localReconnectTimer);
      this.localReconnectTimer = null;
    }
    window.removeEventListener("focus", this.handleFocus);
    window.removeEventListener(
      "agentNative:refresh-data",
      this.handleRefreshData,
    );
    window.removeEventListener(
      "agentNative.chatRunning",
      this.handleChatRunning,
    );
    this.removeVisibilityListener?.();
    this.removeVisibilityListener = undefined;
  }
}

const transportRegistry = new Map<string, SyncTransport>();

function getOrCreateTransport(
  pollUrl: string,
  sseUrl: string | false,
  gateway: RealtimeGatewayBinding | null = null,
): SyncTransport {
  // Key on the LOCAL urls only — a transport may flip hosted→local at runtime,
  // and the token must never fragment the registry, so neither is in the key.
  const key = `${pollUrl}\0${String(sseUrl)}`;
  let transport = transportRegistry.get(key);
  if (!transport) {
    transport = new SyncTransport(pollUrl, sseUrl, gateway);
    transportRegistry.set(key, transport);
  }
  return transport;
}

function releaseTransport(pollUrl: string, sseUrl: string | false): void {
  const key = `${pollUrl}\0${String(sseUrl)}`;
  transportRegistry.delete(key);
}

// ---------------------------------------------------------------------------
// Internal test helper — reset transport registry between tests.
// ---------------------------------------------------------------------------
/** @internal */
export function _resetSyncTransportRegistryForTests(): void {
  for (const transport of transportRegistry.values()) {
    transport["teardown"]();
  }
  transportRegistry.clear();
}

export interface SubscribeSyncEventsOptions {
  onEvents: (events: SyncEvent[], version: number | undefined) => void;
  onSseStateChange?: (
    connected: boolean,
    capabilities?: readonly string[],
  ) => void;
  pollUrl?: string;
  sseUrl?: string | false;
  pauseWhenHidden?: boolean;
  interval?: number;
  fallbackInterval?: number;
}

export function subscribeSyncEvents(
  options: SubscribeSyncEventsOptions,
): () => void {
  const pollUrl = agentNativePath(options.pollUrl ?? "/_agent-native/poll");
  const sseUrl = resolveSseUrl(options.sseUrl);
  const transport = getOrCreateTransport(
    pollUrl,
    sseUrl,
    resolveGatewayBinding(sseUrl),
  );
  const id = Symbol("subscribeSyncEvents");
  transport.add(id, {
    onEvents: options.onEvents,
    onSseStateChange: options.onSseStateChange,
    pauseWhenHidden: options.pauseWhenHidden ?? false,
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
    actionInvalidatePredicate?: (
      query: Query,
      events: readonly SyncEvent[],
    ) => boolean;
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
    pauseWhenHidden = false,
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
    let subscriberVersion = 0;
    let subscriberCursor: SyncCursor = { ...INITIAL_SYNC_CURSOR };

    let pendingInvalidateEvents: SyncEvent[] = [];
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const pendingTrailingRefreshes: Array<{
      filters: InvalidateFilters | undefined;
      completion: Promise<unknown>;
      predicateIdentity?: (query: Query) => boolean;
    }> = [];

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

    function appStateEventTabIds(events: SyncEvent[], key: string): string[] {
      const prefix = `${key}:`;
      return Array.from(
        new Set(
          events.flatMap((event) => {
            if (
              event.source !== "app-state" ||
              typeof event.key !== "string" ||
              !event.key.startsWith(prefix)
            ) {
              return [];
            }
            const browserTabId = event.key.slice(prefix.length);
            return SAFE_BROWSER_TAB_ID_RE.test(browserTabId)
              ? [browserTabId]
              : [];
          }),
        ),
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

      const invalidating = relevant.filter((e) => e.source !== "awareness");

      if (invalidating.length > 0 && queryClient) {
        const hasPendingTrailingRefresh = (
          filters: InvalidateFilters | undefined,
          predicateIdentity?: (query: Query) => boolean,
        ) =>
          pendingTrailingRefreshes.some((pending) => {
            if (pending.filters?.dedupeKey !== filters?.dedupeKey) return false;
            if (filters?.dedupeKey) return true;
            const pendingKey = pending.filters?.queryKey;
            const filterKey = filters?.queryKey;
            if (pendingKey || filterKey) {
              if (
                !pendingKey ||
                !filterKey ||
                pendingKey.length !== filterKey.length
              ) {
                return false;
              }
              return pendingKey.every((key, index) => key === filterKey[index]);
            }
            return pending.predicateIdentity === predicateIdentity;
          });

        const invalidateWithoutCancel = (requested?: InvalidateFilters) => {
          const callerPredicate = requested?.predicate;
          const normalizedFilters: InvalidateFilters = {
            ...requested,
            predicate: (query: Query) =>
              !hasTerminalAuthFailure(query) &&
              (callerPredicate?.(query) ?? true),
          };
          const needsTrailingRefresh =
            (queryClient.isFetching?.(normalizedFilters) ?? 0) > 0;
          const completion = queryClient.invalidateQueries(normalizedFilters, {
            cancelRefetch: false,
          });
          if (
            !disposed &&
            needsTrailingRefresh &&
            completion instanceof Promise &&
            !hasPendingTrailingRefresh(normalizedFilters, callerPredicate)
          ) {
            const pending = {
              filters: normalizedFilters,
              completion,
              predicateIdentity: callerPredicate,
            };
            pendingTrailingRefreshes.push(pending);
            void completion.then(
              () => {
                const index = pendingTrailingRefreshes.indexOf(pending);
                if (index < 0) return;
                pendingTrailingRefreshes.splice(index, 1);
                if (!disposed) queryClient.invalidateQueries(normalizedFilters);
              },
              () => {
                const index = pendingTrailingRefreshes.indexOf(pending);
                if (index >= 0) pendingTrailingRefreshes.splice(index, 1);
              },
            );
          }
        };
        const hasActionEvent = invalidating.some(
          (evt) => evt.source === "action" && !isSuppressedActionEvent(evt),
        );
        if (hasActionEvent) {
          const appPredicate = actionInvalidatePredicateRef.current;
          const predicate = appPredicate
            ? (query: Query) => appPredicate(query, invalidating)
            : undefined;
          invalidateWithoutCancel(
            predicate ? { predicate } : { queryKey: ["action"] },
          );
        }

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
            if (!hasActionEvent) {
              const appPredicate = actionInvalidatePredicateRef.current;
              const predicate = appPredicate
                ? (query: Query) => appPredicate(query, invalidating)
                : undefined;
              invalidateWithoutCancel(
                predicate ? { predicate } : { queryKey: ["action"] },
              );
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
          const appStateKeys = invalidating
            .filter((evt) => evt.source === "app-state")
            .map((evt) => evt.key)
            .map((key) => (typeof key === "string" && key ? key : "*"));
          if (appStateKeys.length > 0) {
            const appStateDedupeKey = Array.from(new Set(appStateKeys))
              .sort()
              .map((key) => `${key.length}:${key}`)
              .join("|");
            const needsBroadAppStateRefresh = appStateKeys.some(
              (key) =>
                key === "*" ||
                isInteractionCriticalSyncEvent({
                  source: "app-state",
                  key,
                }),
            );
            invalidateWithoutCancel(
              needsBroadAppStateRefresh
                ? { queryKey: ["app-state"] }
                : {
                    dedupeKey: `app-state:${appStateDedupeKey}`,
                    predicate: (query) =>
                      appStateQueryMatchesKeys(query, appStateKeys),
                  },
            );
          }
          if (hasAppStateEvent(invalidating, "navigate")) {
            for (const browserTabId of appStateEventTabIds(
              invalidating,
              "navigate",
            )) {
              invalidateWithoutCancel({
                queryKey: ["navigate-command", browserTabId],
              });
            }
            const hasUnscopedNavigateEvent = invalidating.some(
              (event) =>
                event.source === "app-state" &&
                (event.key === "navigate" || event.key === "*"),
            );
            if (hasUnscopedNavigateEvent) {
              invalidateWithoutCancel({ queryKey: ["navigate-command"] });
            }
          }
          if (hasAppStateEvent(invalidating, "show-questions")) {
            invalidateWithoutCancel({ queryKey: ["show-questions"] });
          }
          if (hasAppStateEvent(invalidating, "__set_url__")) {
            for (const browserTabId of appStateEventTabIds(
              invalidating,
              "__set_url__",
            )) {
              invalidateWithoutCancel({
                queryKey: ["__set_url__", browserTabId],
              });
            }
            const hasUnscopedSetUrlEvent = invalidating.some(
              (event) =>
                event.source === "app-state" &&
                (event.key === "__set_url__" || event.key === "*"),
            );
            if (hasUnscopedSetUrlEvent) {
              invalidateWithoutCancel({ queryKey: ["__set_url__"] });
            }
          }
        }
      }

      for (const evt of events) {
        onEventRef.current?.(evt);
      }
    }

    function onEvents(
      events: SyncEvent[],
      version: number | undefined,
      cursor: SyncCursor | undefined,
    ): void {
      const freshEvents = events.filter((event) => {
        return isSyncEventAfterCursor(
          event,
          subscriberCursor,
          subscriberVersion,
        );
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
      for (const event of freshEvents) {
        subscriberCursor = maxSyncCursor(
          subscriberCursor,
          syncEventCursor(event),
        );
      }
      if (cursor) subscriberCursor = maxSyncCursor(subscriberCursor, cursor);
    }

    const transport = getOrCreateTransport(
      pollUrl,
      sseUrl,
      resolveGatewayBinding(sseUrl),
    );
    transport.add(id, {
      onEvents,
      pauseWhenHidden,
      interval,
      idleInterval,
      fallbackInterval,
    });

    return () => {
      disposed = true;
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
        flushInvalidateBatch();
      }
      pendingTrailingRefreshes.length = 0;
      transport.remove(id);
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
    pauseWhenHidden = false,
  } = options;
  const idleInterval =
    options.interval === undefined ? IDLE_POLL_INTERVAL_MS : interval;
  const [key, setKey] = useState(0);

  useEffect(() => {
    const id = Symbol("useScreenRefreshKey");
    let subscriberVersion = 0;
    let subscriberCursor: SyncCursor = { ...INITIAL_SYNC_CURSOR };

    function onEvents(
      events: SyncEvent[],
      version: number | undefined,
      cursor: SyncCursor | undefined,
    ): void {
      const freshEvents = events.filter((event) => {
        return isSyncEventAfterCursor(
          event,
          subscriberCursor,
          subscriberVersion,
        );
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
      for (const event of freshEvents) {
        subscriberCursor = maxSyncCursor(
          subscriberCursor,
          syncEventCursor(event),
        );
      }
      if (cursor) subscriberCursor = maxSyncCursor(subscriberCursor, cursor);
    }

    const transport = getOrCreateTransport(
      pollUrl,
      sseUrl,
      resolveGatewayBinding(sseUrl),
    );
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
