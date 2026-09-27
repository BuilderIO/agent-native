import {
  dedupeCollabUsersByEmail,
  type CollabUser,
} from "@agent-native/toolkit/collab-ui";
import { useEffect, useMemo, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { agentNativePath } from "../client/api-path.js";
import { useAvatarUrl } from "../client/use-avatar.js";
import { subscribeSyncEvents, type SyncEvent } from "../client/use-db-sync.js";
import {
  REALTIME_CAP_NO_AWARENESS,
  REALTIME_CAP_POLL_LIVE,
} from "../realtime-protocol.js";
export {
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
  isReconcileLeadClient,
  type CollabUser,
} from "@agent-native/toolkit/collab-ui";

export interface UseCollaborativeDocOptions {
  docId: string | null;
  pollInterval?: number;
  pollIntervalWithSse?: number;
  pauseWhenHidden?: boolean;
  baseUrl?: string;
  requestSource?: string;
  user?: CollabUser;
}

export type CollabInitializationErrorCategory =
  | "forbidden-or-not-found"
  | "server"
  | "network"
  | "invalid-payload";

export type CollabInitializationState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; category: CollabInitializationErrorCategory };

export type CollaborativeDocSyncResult =
  | { status: "synced" }
  | { status: "failed"; error: Error }
  | { status: "unavailable" };

export interface UseCollaborativeDocResult {
  ydoc: Y.Doc | null;
  awareness: Awareness | null;
  isLoading: boolean;
  isSynced: boolean;
  initialization: CollabInitializationState;
  retry: () => void;
  requestSync: () => Promise<CollaborativeDocSyncResult>;
  activeUsers: CollabUser[];
  agentActive: boolean;
  agentPresent: boolean;
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function collabUsersEqual(a: CollabUser[], b: CollabUser[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.email !== right.email ||
      left.name !== right.name ||
      left.color !== right.color ||
      left.avatarUrl !== right.avatarUrl
    ) {
      return false;
    }
  }
  return true;
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

const UPDATE_DEBOUNCE_MS = 80;

const STATE_VECTOR_FETCH_INTERVAL = 15;

const STATE_VECTOR_FETCH_TIMEOUT_MS = 15_000;

const POLL_RING_BUFFER_SIZE = 200;

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;

function calcBackoff(consecutiveErrors: number): number {
  const exp = Math.min(consecutiveErrors, 10);
  const delay = BACKOFF_BASE_MS * Math.pow(2, exp);
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, BACKOFF_MAX_MS);
}

const _awarenessThrottleTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function awarenessThrottleKey(
  baseUrl: string,
  docId: string,
  clientId: number,
): string {
  return `${baseUrl}::${docId}::${clientId}`;
}

function cancelAwarenessPush(
  baseUrl: string,
  docId: string,
  clientId: number,
): void {
  const key = awarenessThrottleKey(baseUrl, docId, clientId);
  const timer = _awarenessThrottleTimers.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  _awarenessThrottleTimers.delete(key);
}

function scheduleAwarenessPush(
  baseUrl: string,
  docId: string,
  clientId: number,
  getState: () => Record<string, unknown> | null,
): void {
  if (typeof window === "undefined") return;
  const key = awarenessThrottleKey(baseUrl, docId, clientId);
  if (_awarenessThrottleTimers.has(key)) return;

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
    }).catch(() => {});
  }, 150);

  _awarenessThrottleTimers.set(key, timer);
}

interface CollabDocSnapshot {
  isLoading: boolean;
  isSynced: boolean;
  initialization: CollabInitializationState;
  activeUsers: CollabUser[];
  agentActive: boolean;
  agentPresent: boolean;
}

interface CollabDocSubscription {
  pollInterval: number;
  pollIntervalWithSse: number;
  pauseWhenHidden: boolean;
  requestSource?: string;
  onSnapshot: (snapshot: CollabDocSnapshot) => void;
}

const EMPTY_SNAPSHOT: CollabDocSnapshot = Object.freeze({
  isLoading: false,
  isSynced: false,
  initialization: { status: "loading" as const },
  activeUsers: [],
  agentActive: false,
  agentPresent: false,
});

const requestSyncUnavailable = (): Promise<CollaborativeDocSyncResult> =>
  Promise.resolve({ status: "unavailable" });

const DISPOSE_LINGER_MS = 1000;

class CollabDocConnection {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  snapshot: CollabDocSnapshot;
  disposed = false;

  private subscribers = new Map<symbol, CollabDocSubscription>();
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private docMissing = false;
  private requestSource: string | undefined;
  private lastSetUser: CollabUser | null = null;

  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private updateInFlight = false;
  private keepaliveInFlight = false;
  private updateErrors = 0;
  private updateAbortController: AbortController | null = null;
  private updateHandlerAttached = false;

  private syncActive = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;
  private pollCycleCount = 0;
  private pollVersion = 0;
  private lastPolledVersion = 0;
  private stateVectorFetch: Promise<CollaborativeDocSyncResult> | null = null;
  private stateVectorAbortControllers = new Set<AbortController>();
  private sseActive = false;
  private sseAwarenessCovered = false;
  private ssePollLive = false;
  private sseSubscribedWithPause: boolean | null = null;
  private unsubscribeCollabEvents: (() => void) | null = null;
  private unsubscribeAwarenessEvents: (() => void) | null = null;
  private agentTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly docId: string,
    private readonly baseUrl: string,
    readonly detached = false,
  ) {
    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.snapshot = {
      isLoading: true,
      isSynced: false,
      initialization: { status: "loading" },
      activeUsers: [],
      agentActive: false,
      agentPresent: false,
    };

    this.awareness.on("change", this.handleAwarenessChange);

    if (!detached) this.scheduleDispose();
  }

  private get registryKey(): string {
    return collabRegistryKey(this.docId, this.baseUrl);
  }

  private get retiredUpdatesKey(): string | null {
    const email = this.lastSetUser?.email?.trim().toLowerCase();
    return email
      ? `${this.registryKey}\0${email}\0${this.requestSource ?? ""}`
      : null;
  }

  add(id: symbol, sub: CollabDocSubscription): void {
    this.subscribers.set(id, sub);
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    if (!this.requestSource && sub.requestSource) {
      this.requestSource = sub.requestSource;
    }
    if (!this.started) {
      this.started = true;
      this.start();
    } else {
      this.resubscribeCollabEventsIfPauseChanged();
      this.reschedulePoll();
    }
  }

  remove(id: symbol): void {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) {
      cancelAwarenessPush(this.baseUrl, this.docId, this.ydoc.clientID);
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
    for (const controller of this.stateVectorAbortControllers) {
      controller.abort();
    }
    this.stateVectorAbortControllers.clear();
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.stopSync();
    this.unsubscribeAwarenessEvents?.();
    this.unsubscribeAwarenessEvents = null;
    this.updateAbortController?.abort();
    if (this.pendingUpdates.length && this.retiredUpdatesKey) {
      retiredCollabUpdates.set(this.retiredUpdatesKey, this.pendingUpdates);
    }
    void this.flushPendingUpdates(true);
    this.detachUpdateHandler();
    if (this.agentTimer) {
      clearTimeout(this.agentTimer);
      this.agentTimer = null;
    }
    this.awareness.off("change", this.handleAwarenessChange);
    cancelAwarenessPush(this.baseUrl, this.docId, this.ydoc.clientID);
    this.awareness.destroy();
    this.ydoc.destroy();
    if (collabConnectionRegistry.get(this.registryKey) === this) {
      collabConnectionRegistry.delete(this.registryKey);
    }
  }

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
    for (const sub of this.subscribers.values()) {
      if (!sub.pauseWhenHidden) return false;
    }
    return true;
  }

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

  setUser(user: CollabUser): void {
    if (this.disposed) return;
    const prev = this.lastSetUser;
    if (prev && prev.email !== user.email) {
      if (this.pendingUpdates.length && this.retiredUpdatesKey) {
        retiredCollabUpdates.set(this.retiredUpdatesKey, this.pendingUpdates);
      }
      this.pendingUpdates = [];
      this.updateAbortController?.abort();
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.updateErrors = 0;
    }
    if (
      prev &&
      prev.name === user.name &&
      prev.email === user.email &&
      prev.color === user.color &&
      prev.avatarUrl === user.avatarUrl
    ) {
      return;
    }
    const avatarUrl =
      typeof user.avatarUrl === "string" && user.avatarUrl.trim()
        ? user.avatarUrl
        : undefined;
    this.lastSetUser = {
      name: user.name,
      email: user.email,
      color: user.color,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
    const retiredKey = this.retiredUpdatesKey;
    const retired = retiredKey
      ? retiredCollabUpdates.get(retiredKey)
      : undefined;
    if (retired && retiredKey) {
      retiredCollabUpdates.delete(retiredKey);
      this.pendingUpdates.push(...retired);
      if (this.snapshot.initialization.status === "ready") {
        for (const update of retired)
          Y.applyUpdate(this.ydoc, update, "remote");
        void this.flushPendingUpdates();
      }
    }
    this.awareness.setLocalStateField("user", {
      name: user.name,
      email: user.email,
      color: user.color,
      ...(avatarUrl ? { avatarUrl } : {}),
    });
    this.awareness.setLocalStateField("visible", !isDocumentHidden());
  }

  private handleAwarenessChange = (
    _changes?: { added: number[]; updated: number[]; removed: number[] },
    origin?: unknown,
  ): void => {
    const users: CollabUser[] = [];
    let hasAgent = false;
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.ydoc.clientID) return;
      if (state.user) {
        users.push(state.user as CollabUser);
        if ((state.user as CollabUser).email === "agent@system") {
          hasAgent = true;
        }
      }
    });
    const nextActiveUsers = dedupeCollabUsersByEmail(users);
    const activeUsers = collabUsersEqual(
      this.snapshot.activeUsers,
      nextActiveUsers,
    )
      ? this.snapshot.activeUsers
      : nextActiveUsers;
    if (
      activeUsers !== this.snapshot.activeUsers ||
      hasAgent !== this.snapshot.agentPresent
    ) {
      this.setSnapshot({ activeUsers, agentPresent: hasAgent });
    }

    if (
      this.lastSetUser &&
      this.snapshot.isSynced &&
      origin === "local" &&
      !this.disposed
    ) {
      scheduleAwarenessPush(
        this.baseUrl,
        this.docId,
        this.ydoc.clientID,
        () => this.awareness.getLocalState() as Record<string, unknown> | null,
      );
    }
  };

  private start(): void {
    this.fetchInitialState();
  }

  private startTransport(): void {
    this.attachUpdateHandler();
    this.startSync();

    this.unsubscribeAwarenessEvents = subscribeSyncEvents({
      onEvents: (events) => {
        if (this.disposed) return;
        for (const data of events) this.applyAwarenessEvent(data);
      },
    });
  }

  private fetchInitialState(): void {
    fetch(`${this.baseUrl}/${this.docId}/state`).then(
      async (res) => {
        if (this.disposed) return;
        if (res.status === 404 || res.status === 403) {
          this.markInitializationFailed("forbidden-or-not-found");
          return;
        }
        if (!res.ok) {
          this.markInitializationFailed("server");
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          state?: string;
        } | null;
        if (this.disposed) return;
        if (typeof data?.state !== "string" || data.state.length === 0) {
          this.markInitializationFailed("invalid-payload");
          return;
        }
        if (data.state) {
          try {
            const binary = base64ToUint8Array(data.state);
            const validationDoc = new Y.Doc();
            try {
              Y.applyUpdate(validationDoc, binary, "remote");
            } finally {
              validationDoc.destroy();
            }
            Y.applyUpdate(this.ydoc, binary, "remote");
            for (const update of this.pendingUpdates) {
              Y.applyUpdate(this.ydoc, update, "remote");
            }
          } catch {
            this.markInitializationFailed("invalid-payload");
            return;
          }
        }
        this.setSnapshot({
          isLoading: false,
          isSynced: true,
          initialization: { status: "ready" },
        });
        this.startTransport();
      },
      () => {
        if (this.disposed) return;
        this.markInitializationFailed("network");
      },
    );
  }

  private markInitializationFailed(
    category: CollabInitializationErrorCategory,
  ): void {
    this.docMissing = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.detachUpdateHandler();
    this.stopSync();
    this.unsubscribeAwarenessEvents?.();
    this.unsubscribeAwarenessEvents = null;
    this.setSnapshot({
      isLoading: false,
      isSynced: false,
      initialization: { status: "error", category },
    });
  }

  private retryInitialization(): void {
    if (this.disposed) return;
    this.detachUpdateHandler();
    this.stopSync();
    this.unsubscribeAwarenessEvents?.();
    this.unsubscribeAwarenessEvents = null;
    this.docMissing = false;
    this.setSnapshot({
      isLoading: true,
      isSynced: false,
      initialization: { status: "loading" },
    });
    this.fetchInitialState();
  }

  retry = (): void => {
    this.retryInitialization();
  };

  requestSync = (): Promise<CollaborativeDocSyncResult> => {
    if (
      this.disposed ||
      this.subscribers.size === 0 ||
      this.snapshot.initialization.status !== "ready"
    ) {
      return Promise.resolve({ status: "unavailable" });
    }

    return this.performStateVectorFetch();
  };

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === "remote") return;
    this.pendingUpdates.push(update);
    if (this.updateErrors && this.flushTimer) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPendingUpdates();
    }, UPDATE_DEBOUNCE_MS);
  };

  private handlePageHide = (): void => {
    this.flushPendingUpdates(true);
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

  private async flushPendingUpdates(keepalive = false): Promise<void> {
    if (
      keepalive
        ? this.keepaliveInFlight
        : this.disposed ||
          this.updateInFlight ||
          (this.updateErrors > 0 && this.flushTimer !== null)
    )
      return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingUpdates.length === 0) return;
    const toSend = this.pendingUpdates.slice();
    const retiredKey = this.retiredUpdatesKey;
    const merged = toSend.length === 1 ? toSend[0] : Y.mergeUpdates(toSend);
    const controller = new AbortController();
    if (keepalive) this.keepaliveInFlight = true;
    else {
      this.updateInFlight = true;
      this.updateAbortController = controller;
    }
    const timeout = setTimeout(
      () => controller.abort(),
      STATE_VECTOR_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetch(`${this.baseUrl}/${this.docId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update: uint8ArrayToBase64(merged),
          requestSource: this.requestSource,
        }),
        signal: controller.signal,
        ...(keepalive ? { keepalive: true } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const previous = this.pendingUpdates;
      const acknowledged = new Set(toSend);
      this.pendingUpdates = previous.filter(
        (update) => !acknowledged.has(update),
      );
      const retired = retiredKey
        ? retiredCollabUpdates.get(retiredKey)
        : undefined;
      if (retired && retiredKey) {
        const remaining = retired.filter((update) => !acknowledged.has(update));
        if (remaining.length) {
          retiredCollabUpdates.set(retiredKey, remaining);
        } else {
          retiredCollabUpdates.delete(retiredKey);
        }
      }
      this.updateErrors = 0;
    } catch {
      this.updateErrors++;
    } finally {
      clearTimeout(timeout);
      if (keepalive) this.keepaliveInFlight = false;
      else {
        this.updateInFlight = false;
        this.updateAbortController = null;
      }
      if (!this.disposed && this.pendingUpdates.length && !this.flushTimer) {
        this.flushTimer = setTimeout(
          () => {
            this.flushTimer = null;
            void this.flushPendingUpdates();
          },
          this.updateErrors
            ? calcBackoff(this.updateErrors)
            : UPDATE_DEBOUNCE_MS,
        );
      }
    }
  }

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

  private subscribeCollabEvents(): void {
    const pauseWhenHidden = this.effectivePauseWhenHidden;
    this.sseSubscribedWithPause = pauseWhenHidden;
    this.unsubscribeCollabEvents = subscribeSyncEvents({
      onEvents: (events) => {
        if (this.disposed || !this.syncActive) return;
        for (const change of events) this.handleSharedEvent(change);
      },
      onSseStateChange: (connected, capabilities) => {
        const wasActive = this.sseActive;
        this.sseActive = connected;
        const awarenessCovered =
          connected && !capabilities?.includes(REALTIME_CAP_NO_AWARENESS);
        const coverageFlipped = awarenessCovered !== this.sseAwarenessCovered;
        this.sseAwarenessCovered = awarenessCovered;
        const pollLive =
          capabilities?.includes(REALTIME_CAP_POLL_LIVE) === true;
        const pollLiveFlipped = pollLive !== this.ssePollLive;
        this.ssePollLive = pollLive;
        if ((coverageFlipped || pollLiveFlipped) && connected === wasActive) {
          this.reschedulePoll();
        }
        if (connected) this.consecutiveErrors = 0;
      },
      pauseWhenHidden,
    });
  }

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

    if (typeof change.version === "number") {
      this.pollVersion = Math.max(this.pollVersion, change.version);
    }
  }

  private getActivePollInterval(): number {
    return (this.sseActive && this.sseAwarenessCovered) || this.ssePollLive
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

  private reschedulePoll(): void {
    if (this.pollTimer === null) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.schedulePoll();
  }

  private fetchStateVector(): Promise<CollaborativeDocSyncResult> {
    if (this.stateVectorFetch) return this.stateVectorFetch;
    if (this.disposed || this.snapshot.initialization.status !== "ready") {
      return Promise.resolve({ status: "unavailable" });
    }

    return this.startStateVectorFetch();
  }

  private startStateVectorFetch(): Promise<CollaborativeDocSyncResult> {
    const request = this.performStateVectorFetch();
    this.stateVectorFetch = request;
    void request.finally(() => {
      if (this.stateVectorFetch === request) this.stateVectorFetch = null;
    });
    return request;
  }

  private async performStateVectorFetch(): Promise<CollaborativeDocSyncResult> {
    const controller = new AbortController();
    this.stateVectorAbortControllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      STATE_VECTOR_FETCH_TIMEOUT_MS,
    );
    try {
      const stateVector = uint8ArrayToBase64(Y.encodeStateVector(this.ydoc));
      const stateRes = await fetch(
        `${this.baseUrl}/${this.docId}/state?stateVector=${encodeURIComponent(stateVector)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!stateRes.ok) {
        return {
          status: "failed",
          error: new Error(
            `State-vector request failed: HTTP ${stateRes.status}`,
          ),
        };
      }
      const stateData = (await stateRes.json()) as {
        state?: string;
      };
      if (
        this.disposed ||
        this.subscribers.size === 0 ||
        this.snapshot.initialization.status !== "ready"
      ) {
        return { status: "unavailable" };
      }
      if (
        typeof stateData?.state !== "string" ||
        stateData.state.length === 0
      ) {
        return {
          status: "failed",
          error: new Error("State-vector response did not contain state"),
        };
      }
      const binary = base64ToUint8Array(stateData.state);
      Y.applyUpdate(this.ydoc, binary, "remote");
      return { status: "synced" };
    } catch (error) {
      if (
        this.disposed ||
        this.subscribers.size === 0 ||
        this.snapshot.initialization.status !== "ready"
      ) {
        return { status: "unavailable" };
      }
      return {
        status: "failed",
        error:
          error instanceof Error
            ? error
            : new Error("State-vector request failed"),
      };
    } finally {
      clearTimeout(timeout);
      this.stateVectorAbortControllers.delete(controller);
    }
  }

  private async poll(): Promise<void> {
    if (!this.syncActive || this.disposed) return;

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

      const shouldFetchStateVector =
        hadGap || this.pollCycleCount % STATE_VECTOR_FETCH_INTERVAL === 0;

      if (shouldFetchStateVector) {
        await this.fetchStateVector();
      }

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

const collabConnectionRegistry = new Map<string, CollabDocConnection>();
// ponytail: in-memory retention survives component remounts; use a durable
// outbox if offline reload recovery becomes supported. No retired retry loop.
const retiredCollabUpdates = new Map<string, Uint8Array[]>();

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
  retiredCollabUpdates.clear();
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
  const storedAvatarUrl = useAvatarUrl(user?.email);
  const resolvedUser = useMemo(() => {
    if (!user || !storedAvatarUrl || storedAvatarUrl === user.avatarUrl) {
      return user;
    }
    return { ...user, avatarUrl: storedAvatarUrl };
  }, [storedAvatarUrl, user]);

  const [generation, setGeneration] = useState(0);

  const conn = useMemo(() => {
    void generation;
    if (!docId) return null;
    if (typeof window === "undefined") {
      return new CollabDocConnection(docId, baseUrl, true);
    }
    return getOrCreateCollabConnection(docId, baseUrl);
  }, [docId, baseUrl, generation]);

  const [snapshot, setSnapshot] = useState<CollabDocSnapshot>(() =>
    conn ? conn.snapshot : EMPTY_SNAPSHOT,
  );

  const [prevConn, setPrevConn] = useState(conn);
  if (prevConn !== conn) {
    setPrevConn(conn);
    setSnapshot(conn ? conn.snapshot : EMPTY_SNAPSHOT);
  }

  useEffect(() => {
    if (!conn || conn.detached) return;
    if (conn.disposed) {
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
    setSnapshot(conn.snapshot);
    return () => {
      conn.remove(id);
    };
  }, [conn, pollInterval, pollIntervalWithSse, pauseWhenHidden, requestSource]);

  useEffect(() => {
    if (!conn || conn.detached || !resolvedUser) return;
    conn.setUser(resolvedUser);
  }, [conn, resolvedUser]);

  return {
    ydoc: conn && snapshot.initialization.status === "ready" ? conn.ydoc : null,
    awareness:
      conn && snapshot.initialization.status === "ready"
        ? conn.awareness
        : null,
    isLoading: snapshot.isLoading,
    isSynced: snapshot.isSynced,
    initialization: snapshot.initialization,
    retry: conn
      ? () => {
          if (conn.disposed) {
            setGeneration((current) => current + 1);
            return;
          }
          conn.retry();
        }
      : () => {},
    requestSync: conn ? conn.requestSync : requestSyncUnavailable,
    activeUsers: snapshot.activeUsers,
    agentActive: snapshot.agentActive,
    agentPresent: snapshot.agentPresent,
  };
}
