/**
 * Client-side hook for collaborative document editing via Yjs.
 *
 * Creates a STABLE Y.Doc per docId that never changes identity. This allows
 * TipTap's Collaboration extension to bind once without editor recreation.
 * Server state is applied to the existing doc when it arrives.
 *
 * Also manages Yjs Awareness for cursor positions and user presence,
 * synced via polling to the server's awareness endpoint.
 *
 * Connection sharing: connections live in a module-level, ref-counted registry
 * keyed by docId (mirroring the SyncTransport registry in use-db-sync.ts).
 * Every `useCollaborativeDoc` mount for the same docId attaches to ONE shared
 * connection — one Y.Doc, one Awareness, one state fetch, one poll loop, one
 * awareness POST cycle — instead of each hook instance opening an independent
 * connection and doubling all collab traffic (e.g. a presence bar and the
 * editor mounting the hook for the same doc). The first subscriber starts the
 * connection; the last one leaving tears it down after a short linger so
 * StrictMode double-mounts and rapid unmount/remounts don't thrash the doc.
 *
 * Transport improvements (vs previous version):
 * - Local update POSTs are debounced and coalesced with Y.mergeUpdates (~80ms)
 *   to avoid per-keystroke requests. The batch is flushed immediately on
 *   visibilitychange/pagehide and before each poll/awareness cycle.
 * - GET state?stateVector= is NOT fetched on every poll cycle. It is fetched:
 *   (a) on (re)connect / initial load, (b) when a poll response indicates a
 *   gap (version jump > ring-buffer size), (c) after applying an update fails,
 *   and (d) as a low-frequency safety net every STATE_VECTOR_FETCH_INTERVAL
 *   poll cycles (~15×).
 * - Network errors use exponential backoff with jitter (cap ~15s), reset on
 *   success.
 * - SSE fast-path: collab events are received push-style from
 *   /_agent-native/events (the framework SSE stream). While SSE is
 *   healthy the poll loop relaxes to a slow cadence (10–15s). If SSE is
 *   unavailable the 2s poll resumes automatically.
 */

import {
  dedupeCollabUsersByEmail,
  type CollabUser,
} from "@agent-native/toolkit/collab-ui";
import { useEffect, useMemo, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { agentNativePath } from "../client/api-path.js";
import { subscribeSyncEvents, type SyncEvent } from "../client/use-db-sync.js";
import { AGENT_CLIENT_ID } from "./agent-identity.js";

export {
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
  type CollabUser,
} from "@agent-native/toolkit/collab-ui";

export interface UseCollaborativeDocOptions {
  /** Document ID to collaborate on. Pass null to disable. */
  docId: string | null;
  /** Poll interval in ms when SSE is unavailable. Default: 2000 */
  pollInterval?: number;
  /** Poll interval in ms while SSE is healthy. Default: 12000 */
  pollIntervalWithSse?: number;
  /** Pause remote update/presence polling while the tab is hidden. Default: true */
  pauseWhenHidden?: boolean;
  /** Base URL for collab endpoints. Default: "/_agent-native/collab" */
  baseUrl?: string;
  /** Request source ID for jitter prevention (e.g., tab ID). */
  requestSource?: string;
  /** Current user info for cursor labels. */
  user?: CollabUser;
}

export interface UseCollaborativeDocResult {
  /** The Yjs document instance. Stable per docId — never changes identity. */
  ydoc: Y.Doc | null;
  /** Yjs Awareness instance for cursor/presence sync. */
  awareness: Awareness | null;
  /** Whether the initial state is still loading from the server. */
  isLoading: boolean;
  /** Whether the doc is synced with the server. */
  isSynced: boolean;
  /** Active users on this document (from awareness). */
  activeUsers: CollabUser[];
  /** True briefly when the AI agent makes an edit (for presence indicator). */
  agentActive: boolean;
  /** True when the AI agent has an active awareness entry (durable presence). */
  agentPresent: boolean;
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * Leader election for applying authoritative external snapshots into a shared
 * collaborative document.
 *
 * When the agent (or a Notion pull, or any full-document rewrite) writes new
 * content to SQL, the open editor reconciles it into the live Y.Doc with
 * `setContent`. If EVERY connected client did that independently, each would
 * diff the same snapshot into the CRDT and the changed region would be inserted
 * N times (concurrent inserts at the same position → duplicated text). So only
 * ONE client — the "lead" — applies the snapshot; every other client receives
 * the result through normal Yjs sync.
 *
 * The lead is the present client with the lowest Yjs `clientID`. The agent's
 * awareness entry uses `AGENT_CLIENT_ID` (max int) so it can never be the lead,
 * and a client editing alone is always the lead. This is deterministic across
 * clients with no coordination round-trip.
 */
export function isReconcileLeadClient(
  awareness: Awareness | null | undefined,
  localClientId: number | null | undefined,
): boolean {
  if (localClientId == null) return false;
  if (!awareness) return true; // standalone / tests — act alone

  let hasPeer = false;
  let minVisible = localClientId;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === AGENT_CLIENT_ID) return; // agent never leads
    if (clientId === localClientId) return;
    const s = state as { user?: unknown; visible?: boolean };
    if (!s || !s.user) return; // skip empty/stale entries
    hasPeer = true;
    // Only VISIBLE peers can act; a peer published `visible: false` (backgrounded)
    // is skipped. A peer that hasn't published the field is treated as visible.
    if (s.visible !== false && clientId < minVisible) minVisible = clientId;
  });

  // Sole client: always the applier — no other client can duplicate the edit,
  // so single-user agent edits apply even if this tab reports hidden.
  if (!hasPeer) return true;

  // With peers present, exactly one VISIBLE client applies (the lowest clientId
  // among visible ones). A backgrounded tab pauses its poll and can't reliably
  // act, so it yields — otherwise an agent edit would never reach the tab the
  // user is actually looking at. The caller re-elects on visibility change.
  const localHidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  if (localHidden) return false;
  return localClientId <= minVisible;
}

export interface RemoteAwarenessSnapshot {
  clientId: number;
  state: unknown;
}

export function reconcileRemoteAwarenessStates(
  states: Map<number, unknown>,
  localClientId: number,
  remoteStates: RemoteAwarenessSnapshot[],
): { added: number[]; updated: number[]; removed: number[] } {
  const incoming = new Set<number>();
  const added: number[] = [];
  const updated: number[] = [];
  const removed: number[] = [];

  for (const remote of remoteStates) {
    if (
      !Number.isFinite(remote.clientId) ||
      remote.clientId === localClientId
    ) {
      continue;
    }
    incoming.add(remote.clientId);
    const hadState = states.has(remote.clientId);
    states.set(remote.clientId, remote.state);
    (hadState ? updated : added).push(remote.clientId);
  }

  for (const clientId of Array.from(states.keys())) {
    if (clientId === localClientId) continue;
    if (incoming.has(clientId)) continue;
    states.delete(clientId);
    removed.push(clientId);
  }

  return { added, updated, removed };
}

// Base64 helpers
function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

/** Debounce delay for coalescing local Yjs update POSTs (ms). */
const UPDATE_DEBOUNCE_MS = 80;

/** Fetch state-vector every N poll cycles as a low-frequency safety net. */
const STATE_VECTOR_FETCH_INTERVAL = 15;

/** Poll ring-buffer size on the server (MAX_BUFFER in poll.ts). */
const POLL_RING_BUFFER_SIZE = 200;

/** Exponential backoff: base delay (ms), multiplier, cap (ms). */
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;

function calcBackoff(consecutiveErrors: number): number {
  const exp = Math.min(consecutiveErrors, 10);
  const delay = BACKOFF_BASE_MS * Math.pow(2, exp);
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Fast awareness helper — throttled per (docId, ydocId) pair so multiple
// setLocalStateField calls within a 150ms window are coalesced into one POST.
// ---------------------------------------------------------------------------

const _awarenessThrottleTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function scheduleAwarenessPush(
  baseUrl: string,
  docId: string,
  clientId: number,
  getState: () => Record<string, unknown> | null,
): void {
  if (typeof window === "undefined") return;
  const key = `${docId}::${clientId}`;
  if (_awarenessThrottleTimers.has(key)) return; // already scheduled

  const timer = setTimeout(() => {
    _awarenessThrottleTimers.delete(key);
    const state = getState();
    fetch(`${baseUrl}/${docId}/awareness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        state: state ? JSON.stringify(state) : null,
      }),
    }).catch(() => {}); // best-effort; poll cycle is the baseline fallback
  }, 150);

  _awarenessThrottleTimers.set(key, timer);
}

// ---------------------------------------------------------------------------
// Shared per-docId collab connection
//
// One CollabDocConnection per (baseUrl, docId) pair is held in a module-level
// registry (the same pattern as SyncTransport in use-db-sync.ts). Every
// `useCollaborativeDoc` mount for a docId subscribes to the shared connection,
// so a tab runs exactly ONE state fetch, ONE poll fallback loop, and ONE
// awareness POST cycle per document no matter how many components mount the
// hook (e.g. a presence bar + the editor for the same doc).
//
// Lifecycle: the connection is created on first render that needs it (the
// Y.Doc must exist during render so TipTap can bind on mount), starts its
// network activity when the first subscriber attaches, and is disposed a short
// linger after the last subscriber detaches. The linger keeps StrictMode's
// mount→unmount→mount and rapid route remounts from destroying and refetching
// the doc, and doubles as the cleanup path for connections created by a render
// that React later discarded (no subscriber ever attaches).
// ---------------------------------------------------------------------------

/**
 * Shared reactive state each subscriber mirrors into its own React state.
 * Replaced immutably on every change so hooks can bail out on identity.
 */
interface CollabDocSnapshot {
  isLoading: boolean;
  isSynced: boolean;
  activeUsers: CollabUser[];
  agentActive: boolean;
  agentPresent: boolean;
}

interface CollabDocSubscription {
  /** Requested poll interval; the connection uses the MIN across subscribers. */
  pollInterval: number;
  /** Requested relaxed interval while SSE is healthy (MIN across subscribers). */
  pollIntervalWithSse: number;
  /**
   * Whether this subscriber wants polling paused while the tab is hidden.
   * The connection pauses only when ALL subscribers request it.
   */
  pauseWhenHidden: boolean;
  /**
   * Echo-suppression tag. The connection adopts the first defined value and
   * uses it for BOTH tagging outgoing updates and filtering incoming echoes,
   * so suppression stays self-consistent even when subscribers pass different
   * per-tab IDs (all values identify the same tab).
   */
  requestSource?: string;
  onSnapshot: (snapshot: CollabDocSnapshot) => void;
}

const EMPTY_SNAPSHOT: CollabDocSnapshot = Object.freeze({
  isLoading: false,
  isSynced: false,
  activeUsers: [],
  agentActive: false,
  agentPresent: false,
});

/**
 * How long a connection with zero subscribers lingers before disposal.
 * Long enough to absorb StrictMode double-mounts and route-level remounts
 * (which would otherwise destroy the Y.Doc, refetch server state, and lose
 * echo-suppression context), short enough that navigating away stops the
 * doc's traffic promptly.
 */
const DISPOSE_LINGER_MS = 1000;

class CollabDocConnection {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  /** Immutable snapshot of the shared reactive state (replaced on change). */
  snapshot: CollabDocSnapshot;
  disposed = false;

  private subscribers = new Map<symbol, CollabDocSubscription>();
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private docMissing = false;
  private requestSource: string | undefined;
  private lastSetUser: CollabUser | null = null;

  // Local-update batching (debounced + coalesced with Y.mergeUpdates).
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private updateHandlerAttached = false;

  // Poll loop + SSE fast path.
  private syncActive = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;
  private pollCycleCount = 0;
  private pollVersion = 0;
  private lastPolledVersion = 0;
  private sseActive = false;
  private sseSubscribedWithPause: boolean | null = null;
  private unsubscribeCollabEvents: (() => void) | null = null;
  private unsubscribeAwarenessEvents: (() => void) | null = null;
  private agentTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly docId: string,
    private readonly baseUrl: string,
    /**
     * Detached connections are created for SSR renders only: a per-hook
     * Y.Doc/Awareness with no registry entry and no network activity
     * (matching the previous per-hook behavior on the server). They are
     * never started and are reclaimed by GC with the render.
     */
    readonly detached = false,
  ) {
    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.snapshot = {
      isLoading: true,
      isSynced: false,
      activeUsers: [],
      agentActive: false,
      agentPresent: false,
    };

    // Track active users / agent presence from awareness changes, and drive
    // the fast (throttled) awareness push once a local user is published.
    this.awareness.on("change", this.handleAwarenessChange);

    // Orphan guard: the connection is created during render (the Y.Doc must
    // exist before mount), so a discarded render can create one that never
    // gets a subscriber. The linger timer disposes it; the first `add()`
    // cancels the timer.
    if (!detached) this.scheduleDispose();
  }

  private get registryKey(): string {
    return collabRegistryKey(this.docId, this.baseUrl);
  }

  // -------------------------------------------------------------------------
  // Subscriber management (ref-counting)
  // -------------------------------------------------------------------------

  add(id: symbol, sub: CollabDocSubscription): void {
    this.subscribers.set(id, sub);
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    // Adopt the first defined echo-suppression tag for the connection's
    // lifetime (see CollabDocSubscription.requestSource).
    if (!this.requestSource && sub.requestSource) {
      this.requestSource = sub.requestSource;
    }
    if (!this.started) {
      this.started = true;
      this.start();
    } else {
      // A joining subscriber can change the effective poll cadence or the
      // pause-when-hidden aggregate; pick both up without waiting a cycle.
      this.resubscribeCollabEventsIfPauseChanged();
      this.reschedulePoll();
    }
  }

  remove(id: symbol): void {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) {
      this.scheduleDispose();
    } else {
      this.resubscribeCollabEventsIfPauseChanged();
      this.reschedulePoll();
    }
  }

  private scheduleDispose(): void {
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      this.dispose();
    }, DISPOSE_LINGER_MS);
  }

  /**
   * Tear the connection down: stop all loops and listeners, flush any pending
   * local updates, clear awareness local state (via destroy), and destroy the
   * Y.Doc. Also used by the test-only registry reset. @internal
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.stopSync();
    this.unsubscribeAwarenessEvents?.();
    this.unsubscribeAwarenessEvents = null;
    this.flushPendingUpdates(true);
    this.detachUpdateHandler();
    if (this.agentTimer) {
      clearTimeout(this.agentTimer);
      this.agentTimer = null;
    }
    // Detach our change listener BEFORE destroy so the destroy-time
    // `setLocalState(null)` does not schedule a push (matches the previous
    // per-hook effect cleanup ordering).
    this.awareness.off("change", this.handleAwarenessChange);
    this.awareness.destroy();
    this.ydoc.destroy();
    if (collabConnectionRegistry.get(this.registryKey) === this) {
      collabConnectionRegistry.delete(this.registryKey);
    }
  }

  // -------------------------------------------------------------------------
  // Derived settings (aggregate over active subscribers)
  // -------------------------------------------------------------------------

  private get effectivePollInterval(): number {
    let min = Infinity;
    for (const sub of this.subscribers.values()) {
      if (sub.pollInterval < min) min = sub.pollInterval;
    }
    return isFinite(min) ? min : 2000;
  }

  private get effectivePollIntervalWithSse(): number {
    let min = Infinity;
    for (const sub of this.subscribers.values()) {
      if (sub.pollIntervalWithSse < min) min = sub.pollIntervalWithSse;
    }
    return isFinite(min) ? min : 12_000;
  }

  private get effectivePauseWhenHidden(): boolean {
    // Pause only if every subscriber has opted in.
    for (const sub of this.subscribers.values()) {
      if (!sub.pauseWhenHidden) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Shared state fan-out
  // -------------------------------------------------------------------------

  private setSnapshot(patch: Partial<CollabDocSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const sub of this.subscribers.values()) {
      sub.onSnapshot(this.snapshot);
    }
  }

  private markAgentActive(): void {
    this.setSnapshot({ agentActive: true });
    if (this.agentTimer) clearTimeout(this.agentTimer);
    this.agentTimer = setTimeout(() => {
      this.agentTimer = null;
      this.setSnapshot({ agentActive: false });
    }, 3000);
  }

  // -------------------------------------------------------------------------
  // Awareness: local identity, active-user tracking, fast push
  // -------------------------------------------------------------------------

  /**
   * Publish the local user identity (cursor label) and current visibility.
   * Set once per tab — repeated calls with the same identity are no-ops so
   * multiple subscribers for the same user don't re-emit awareness updates.
   */
  setUser(user: CollabUser): void {
    if (this.disposed) return;
    const prev = this.lastSetUser;
    if (
      prev &&
      prev.name === user.name &&
      prev.email === user.email &&
      prev.color === user.color
    ) {
      return;
    }
    this.lastSetUser = {
      name: user.name,
      email: user.email,
      color: user.color,
    };
    this.awareness.setLocalStateField("user", {
      name: user.name,
      email: user.email,
      color: user.color,
    });
    // Also publish this tab's visibility so peers can elect a VISIBLE client
    // to apply external snapshots (see isReconcileLeadClient) — a backgrounded
    // tab pauses its poll and must not hold that role.
    this.awareness.setLocalStateField("visible", !isDocumentHidden());
  }

  private handleAwarenessChange = (): void => {
    const users: CollabUser[] = [];
    let hasAgent = false;
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.ydoc.clientID) return; // Skip self
      if (state.user) {
        users.push(state.user as CollabUser);
        if ((state.user as CollabUser).email === "agent@system") {
          hasAgent = true;
        }
      }
    });
    this.setSnapshot({
      activeUsers: dedupeCollabUsersByEmail(users),
      agentPresent: hasAgent,
    });

    // Fast awareness push: whenever awareness changes (e.g. cursor moves,
    // setPresence() calls), schedule a throttled POST so peers receive updates
    // at ~150ms instead of waiting for the next poll cycle. Only active once a
    // local user identity has been published (matches the previous per-hook
    // gating on `user`). The poll cycle remains the authoritative baseline.
    if (this.lastSetUser && !this.disposed) {
      scheduleAwarenessPush(
        this.baseUrl,
        this.docId,
        this.ydoc.clientID,
        () => this.awareness.getLocalState() as Record<string, unknown> | null,
      );
    }
  };

  // -------------------------------------------------------------------------
  // Startup: initial state fetch, update handler, sync loops
  // -------------------------------------------------------------------------

  private start(): void {
    this.attachUpdateHandler();
    this.fetchInitialState();
    this.startSync();

    // SSE fast-path for awareness: listen on the SHARED framework transport
    // and apply awareness-change events immediately so peers receive cursor
    // moves push-style without waiting for the next poll cycle. Kept alive
    // even when the doc is missing (matches the previous per-hook behavior).
    this.unsubscribeAwarenessEvents = subscribeSyncEvents({
      onEvents: (events) => {
        if (this.disposed) return;
        for (const data of events) this.applyAwarenessEvent(data);
      },
    });
  }

  private fetchInitialState(): void {
    fetch(`${this.baseUrl}/${this.docId}/state`)
      .then(async (res) => {
        if (this.disposed) return;
        if (res.status === 404 || res.status === 403) {
          this.markDocMissing();
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          state?: string;
        } | null;
        if (this.disposed) return;
        if (data?.state) {
          const binary = base64ToUint8Array(data.state);
          if (binary.length > 4) {
            Y.applyUpdate(this.ydoc, binary, "remote");
          }
        }
        this.setSnapshot({ isLoading: false, isSynced: true });
      })
      .catch(() => {
        if (this.disposed) return;
        this.setSnapshot({ isLoading: false, isSynced: true });
      });
  }

  /**
   * The initial state fetch returned 404/403 — the doc doesn't exist or isn't
   * accessible. Stop doc-update traffic (poll loop, update POSTs, collab SSE
   * handling) so we don't spam the console with errors against it. The
   * awareness SSE subscription stays (matches previous behavior).
   */
  private markDocMissing(): void {
    this.docMissing = true;
    this.flushPendingUpdates(true);
    this.detachUpdateHandler();
    this.stopSync();
    this.setSnapshot({ isLoading: false, isSynced: true });
  }

  // -------------------------------------------------------------------------
  // Local update batching
  // -------------------------------------------------------------------------

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === "remote") return;
    this.pendingUpdates.push(update);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(
      () => this.flushPendingUpdates(),
      UPDATE_DEBOUNCE_MS,
    );
  };

  private handlePageHide = (): void => {
    this.flushPendingUpdates(true /* keepalive */);
  };

  private attachUpdateHandler(): void {
    if (this.updateHandlerAttached || this.docMissing) return;
    this.updateHandlerAttached = true;
    this.ydoc.on("update", this.handleDocUpdate);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handlePageHide);
    }
  }

  private detachUpdateHandler(): void {
    if (!this.updateHandlerAttached) return;
    this.updateHandlerAttached = false;
    this.ydoc.off("update", this.handleDocUpdate);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handlePageHide);
    }
  }

  private flushPendingUpdates(keepalive = false): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingUpdates.length === 0) return;
    const toSend = this.pendingUpdates;
    this.pendingUpdates = [];

    const merged = toSend.length === 1 ? toSend[0] : Y.mergeUpdates(toSend);
    fetch(`${this.baseUrl}/${this.docId}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        update: uint8ArrayToBase64(merged),
        requestSource: this.requestSource,
      }),
      ...(keepalive ? { keepalive: true } : {}),
    }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Remote sync: SSE fast path + poll fallback loop
  // -------------------------------------------------------------------------

  private startSync(): void {
    if (this.syncActive || this.docMissing || this.disposed) return;
    this.syncActive = true;

    this.subscribeCollabEvents();

    if (!this.effectivePauseWhenHidden || !isDocumentHidden()) {
      void this.poll();
    }
    window.addEventListener("focus", this.handleFocus);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private stopSync(): void {
    if (!this.syncActive) return;
    this.syncActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.unsubscribeCollabEvents?.();
    this.unsubscribeCollabEvents = null;
    this.sseSubscribedWithPause = null;
    window.removeEventListener("focus", this.handleFocus);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }

  /**
   * SSE fast-path: subscribe to the SHARED framework transport for
   * /_agent-native/events instead of opening a dedicated EventSource per
   * collab doc. A tab holds exactly one SSE connection regardless of how many
   * docs are mounted. Collab update events arrive push-style; we apply them
   * immediately, avoiding ~2s polling latency for peer edits.
   *
   * NOTE: SSE events are subject to the same server-side access scoping as
   * polling — the server only pushes events that canSeeChangeForUser allows.
   */
  private subscribeCollabEvents(): void {
    const pauseWhenHidden = this.effectivePauseWhenHidden;
    this.sseSubscribedWithPause = pauseWhenHidden;
    this.unsubscribeCollabEvents = subscribeSyncEvents({
      onEvents: (events) => {
        if (this.disposed || !this.syncActive) return;
        for (const change of events) this.handleSharedEvent(change);
      },
      onSseStateChange: (connected) => {
        this.sseActive = connected;
        if (connected) this.consecutiveErrors = 0;
      },
      pauseWhenHidden,
    });
  }

  /**
   * The pause-when-hidden aggregate can flip when subscribers join or leave;
   * the shared-transport subscription captures it at subscribe time, so
   * re-subscribe when it changes.
   */
  private resubscribeCollabEventsIfPauseChanged(): void {
    if (!this.syncActive) return;
    if (this.sseSubscribedWithPause === this.effectivePauseWhenHidden) return;
    this.unsubscribeCollabEvents?.();
    this.subscribeCollabEvents();
  }

  private handleSharedEvent(change: SyncEvent): void {
    if (
      change.source === "collab" &&
      change.docId === this.docId &&
      typeof change.update === "string"
    ) {
      // Own echo — skip entirely (including the version tracking below, so
      // the next poll re-delivers and dedupe happens there; matches the
      // previous per-hook behavior).
      if (this.requestSource && change.requestSource === this.requestSource) {
        return;
      }
      try {
        Y.applyUpdate(this.ydoc, base64ToUint8Array(change.update), "remote");
      } catch {
        // Malformed update — trigger state-vector fetch on next poll
      }

      if (change.requestSource === "agent") {
        this.markAgentActive();
      }
    }

    // Keep the poll cursor updated from shared-transport events so the poll
    // loop starts from the right version when SSE drops.
    if (typeof change.version === "number") {
      this.pollVersion = Math.max(this.pollVersion, change.version);
    }
  }

  private getActivePollInterval(): number {
    return this.sseActive
      ? this.effectivePollIntervalWithSse
      : this.effectivePollInterval;
  }

  private schedulePoll(): void {
    if (!this.syncActive || this.disposed) return;
    if (this.effectivePauseWhenHidden && isDocumentHidden()) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, this.getActivePollInterval());
  }

  /**
   * A subscriber joined or left, potentially changing the effective interval.
   * If a poll is already scheduled, reschedule with the new cadence (the next
   * natural tick would pick it up anyway; this just avoids a stale long wait
   * when a faster subscriber joins).
   */
  private reschedulePoll(): void {
    if (this.pollTimer === null) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.schedulePoll();
  }

  private async fetchStateVector(): Promise<void> {
    try {
      const stateVector = uint8ArrayToBase64(Y.encodeStateVector(this.ydoc));
      const stateRes = await fetch(
        `${this.baseUrl}/${this.docId}/state?stateVector=${encodeURIComponent(stateVector)}`,
      );
      if (stateRes.ok) {
        const stateData = (await stateRes.json().catch(() => null)) as {
          state?: string;
        } | null;
        if (this.disposed) return;
        if (stateData?.state) {
          const binary = base64ToUint8Array(stateData.state);
          if (binary.length > 2) {
            Y.applyUpdate(this.ydoc, binary, "remote");
          }
        }
      }
    } catch {
      // Non-fatal; the next poll cycle will retry
    }
  }

  private async poll(): Promise<void> {
    if (!this.syncActive || this.disposed) return;

    // Flush any pending local updates before polling so the server has the
    // latest state before we read remote changes.
    this.flushPendingUpdates();

    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/poll?since=${this.pollVersion}`),
      );
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      if (!this.syncActive || this.disposed) return;
      const { version, events } = data as {
        version: number;
        events: Array<{
          source: string;
          docId?: string;
          update?: string;
          requestSource?: string;
        }>;
      };

      // Detect ring-buffer overflow: if the version jumped by more than the
      // ring buffer size, some events were evicted and we need a state-vector
      // fetch to reconcile the gap.
      const versionGap = version - this.lastPolledVersion;
      const hadGap = versionGap > POLL_RING_BUFFER_SIZE;

      for (const evt of events) {
        if (evt.source === "collab" && evt.docId === this.docId && evt.update) {
          if (this.requestSource && evt.requestSource === this.requestSource) {
            continue;
          }
          try {
            Y.applyUpdate(this.ydoc, base64ToUint8Array(evt.update), "remote");
          } catch {
            // Failed to apply — fetch full state-vector below
            await this.fetchStateVector();
          }

          if (evt.requestSource === "agent") {
            this.markAgentActive();
          }
        }
      }

      this.pollVersion = version;
      this.lastPolledVersion = version;
      this.pollCycleCount++;
      this.consecutiveErrors = 0;

      // Fetch state-vector only when needed:
      //   1. Ring-buffer overflow detected (missed events).
      //   2. Low-frequency safety net every STATE_VECTOR_FETCH_INTERVAL cycles.
      //   3. NOT on every cycle (the previous behavior causing 3 requests/cycle).
      const shouldFetchStateVector =
        hadGap || this.pollCycleCount % STATE_VECTOR_FETCH_INTERVAL === 0;

      if (shouldFetchStateVector) {
        await this.fetchStateVector();
      }

      // Sync awareness (cursor positions)
      const localState = this.awareness.getLocalState();
      if (localState && !this.disposed) {
        try {
          const awarenessRes = await fetch(
            `${this.baseUrl}/${this.docId}/awareness`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId: this.ydoc.clientID,
                state: JSON.stringify(localState),
              }),
            },
          );
          if (awarenessRes.ok && !this.disposed) {
            const awarenessData = await awarenessRes.json();
            const remoteStates: RemoteAwarenessSnapshot[] = [];
            for (const remote of awarenessData.states || []) {
              try {
                const remoteState = JSON.parse(remote.state);
                remoteStates.push({
                  clientId: Number(remote.clientId),
                  state: remoteState,
                });
              } catch {
                // Invalid state — skip
              }
            }
            if (this.disposed) return;
            const changes = reconcileRemoteAwarenessStates(
              this.awareness.getStates() as Map<number, unknown>,
              this.ydoc.clientID,
              remoteStates,
            );
            if (
              changes.added.length ||
              changes.updated.length ||
              changes.removed.length
            ) {
              this.awareness.emit("change", [changes, "remote"]);
            }
          }
        } catch {
          // Awareness sync failure is non-fatal
        }
      }
    } catch {
      // Network error — exponential backoff
      this.consecutiveErrors++;
      const backoff = calcBackoff(this.consecutiveErrors);
      if (this.syncActive && !this.disposed) {
        this.pollTimer = setTimeout(() => {
          this.pollTimer = null;
          void this.poll();
        }, backoff);
      }
      return;
    }

    this.schedulePoll();
  }

  private pollNow(): void {
    if (!this.syncActive || this.disposed) return;
    if (this.effectivePauseWhenHidden && isDocumentHidden()) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    void this.poll();
  }

  /**
   * Publish this tab's visibility to peers. A hidden tab pauses its poll, so
   * we push the state immediately (keepalive) instead of waiting for the next
   * cycle — otherwise peers keep treating a backgrounded tab as the visible
   * lead and an agent edit never lands on the tab the user is actually viewing.
   */
  private publishVisibility(visible: boolean): void {
    this.awareness.setLocalStateField("visible", visible);
    const localState = this.awareness.getLocalState();
    if (!localState) return;
    fetch(`${this.baseUrl}/${this.docId}/awareness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: this.ydoc.clientID,
        state: JSON.stringify(localState),
      }),
      keepalive: true,
    }).catch(() => {});
  }

  private handleVisibilityChange = (): void => {
    const visible = document.visibilityState === "visible";
    this.publishVisibility(visible);
    if (visible) {
      // Also flush any pending updates when coming back into view
      this.flushPendingUpdates();
      this.pollNow();
    } else if (this.effectivePauseWhenHidden && this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  };

  private handleFocus = (): void => {
    this.pollNow();
  };

  // -------------------------------------------------------------------------
  // Awareness SSE fast-path
  // -------------------------------------------------------------------------

  private applyAwarenessEvent(data: SyncEvent): void {
    if (
      data.source !== "awareness" ||
      data.type !== "awareness-change" ||
      data.docId !== this.docId
    ) {
      return;
    }
    const states = Array.isArray(data.states)
      ? (data.states as Array<{ clientId: number; state: string }>)
      : [];
    const remoteStates: RemoteAwarenessSnapshot[] = [];
    for (const remote of states) {
      try {
        remoteStates.push({
          clientId: Number(remote.clientId),
          state: JSON.parse(remote.state),
        });
      } catch {
        // Invalid state entry — skip
      }
    }
    const changes = reconcileRemoteAwarenessStates(
      this.awareness.getStates() as Map<number, unknown>,
      this.ydoc.clientID,
      remoteStates,
    );
    if (
      changes.added.length ||
      changes.updated.length ||
      changes.removed.length
    ) {
      this.awareness.emit("change", [changes, "remote"]);
    }
  }
}

/**
 * Registry of active connections keyed by "<baseUrl>\0<docId>".
 * Module-level singleton: survives React render cycles, shared across all
 * hook instances in the same browser tab.
 */
const collabConnectionRegistry = new Map<string, CollabDocConnection>();

function collabRegistryKey(docId: string, baseUrl: string): string {
  return `${baseUrl}\0${docId}`;
}

function getOrCreateCollabConnection(
  docId: string,
  baseUrl: string,
): CollabDocConnection {
  const key = collabRegistryKey(docId, baseUrl);
  let conn = collabConnectionRegistry.get(key);
  if (!conn || conn.disposed) {
    conn = new CollabDocConnection(docId, baseUrl);
    collabConnectionRegistry.set(key, conn);
  }
  return conn;
}

// ---------------------------------------------------------------------------
// Internal test helpers — reset/inspect the connection registry between tests.
// ---------------------------------------------------------------------------
/** @internal */
export function _resetCollabDocRegistryForTests(): void {
  for (const conn of Array.from(collabConnectionRegistry.values())) {
    conn.dispose();
  }
  collabConnectionRegistry.clear();
}

/** @internal — current registry size, for leak assertions in tests. */
export function _collabDocRegistrySizeForTests(): number {
  return collabConnectionRegistry.size;
}

export function useCollaborativeDoc(
  options: UseCollaborativeDocOptions,
): UseCollaborativeDocResult {
  const {
    docId,
    pollInterval = 2000,
    pollIntervalWithSse = 12000,
    pauseWhenHidden = true,
    baseUrl = agentNativePath("/_agent-native/collab"),
    requestSource,
    user,
  } = options;

  // Bumped when the effect finds the memoized connection was disposed in the
  // render→effect gap (rare: a suspended transition outliving the linger
  // window) so the memo below re-acquires a live one.
  const [generation, setGeneration] = useState(0);

  // Shared connection per docId. Acquired during render so the Y.Doc identity
  // is available on first render (TipTap binds on mount); get-or-create is
  // idempotent, so StrictMode's double render returns the same instance.
  const conn = useMemo(() => {
    void generation;
    if (!docId) return null;
    if (typeof window === "undefined") {
      // SSR render: per-hook detached doc, never started (matches the
      // previous per-hook behavior on the server).
      return new CollabDocConnection(docId, baseUrl, true);
    }
    return getOrCreateCollabConnection(docId, baseUrl);
  }, [docId, baseUrl, generation]);

  const [snapshot, setSnapshot] = useState<CollabDocSnapshot>(() =>
    conn ? conn.snapshot : EMPTY_SNAPSHOT,
  );

  // Render-time reset when the connection identity changes (docId switch) so
  // consumers never see the previous doc's state for a frame.
  const [prevConn, setPrevConn] = useState(conn);
  if (prevConn !== conn) {
    setPrevConn(conn);
    setSnapshot(conn ? conn.snapshot : EMPTY_SNAPSHOT);
  }

  // Subscribe (ref-count) — the first subscriber starts the connection, the
  // last one leaving schedules its teardown.
  useEffect(() => {
    if (!conn || conn.detached) return;
    if (conn.disposed) {
      // Disposed between render and effect — re-acquire a live connection.
      setGeneration((g) => g + 1);
      return;
    }
    const id = Symbol("useCollaborativeDoc");
    conn.add(id, {
      pollInterval,
      pollIntervalWithSse,
      pauseWhenHidden,
      requestSource,
      onSnapshot: setSnapshot,
    });
    // Re-sync in case the connection changed state between render and effect.
    setSnapshot(conn.snapshot);
    return () => {
      conn.remove(id);
    };
  }, [conn, pollInterval, pollIntervalWithSse, pauseWhenHidden, requestSource]);

  // Publish local user identity for cursor labels (set once per tab; the
  // connection dedupes repeated identical identities across subscribers).
  useEffect(() => {
    if (!conn || conn.detached || !user) return;
    conn.setUser({ name: user.name, email: user.email, color: user.color });
  }, [conn, user?.name, user?.email, user?.color]);

  return {
    ydoc: conn ? conn.ydoc : null,
    awareness: conn ? conn.awareness : null,
    isLoading: snapshot.isLoading,
    isSynced: snapshot.isSynced,
    activeUsers: snapshot.activeUsers,
    agentActive: snapshot.agentActive,
    agentPresent: snapshot.agentPresent,
  };
}
