import { useEffect, useMemo, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { agentNativePath } from "../client/api-path.js";
import { useAvatarUrl } from "../client/use-avatar.js";
import {
  acquireCollabPollBoost,
  noteCollabPollActivity,
  registerCollabActivityResource,
  subscribeSyncEvents,
  type SyncEvent,
} from "../client/use-db-sync.js";
import {
  REALTIME_CAP_NO_AWARENESS,
  REALTIME_CAP_POLL_LIVE,
} from "../realtime-protocol.js";
import { collabUpdateFits } from "./limits.js";
import { dedupeCollabUsersByEmail, type CollabUser } from "./types.js";
export {
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
  type CollabUser,
} from "./types.js";
export { isReconcileLeadClient } from "./lead-client.js";
export {
  COLLAB_MAX_STATE_BYTES,
  COLLAB_MAX_UPDATE_BYTES,
  collabUpdateFits,
} from "./limits.js";

export interface UseCollaborativeDocOptions {
  docId: string | null;
  pollInterval?: number;
  pollIntervalWithSse?: number;
  pauseWhenHidden?: boolean;
  baseUrl?: string;
  requestSource?: string;
  user?: CollabUser;
  activityResource?: { resourceType: string; resourceId: string };
  /**
   * Keeps this tab's unacknowledged updates in localStorage until the server
   * acknowledges them, and sends the ones a closed or reloaded tab left
   * behind when the doc next opens for the same user. Needs `user`, whose
   * email scopes what is kept.
   */
  durableUpdates?: boolean;
  /**
   * Called for each update the server acknowledged, with the live-copy
   * outcome it reported. With it, an acknowledgment whose body cannot be read
   * counts as undelivered and the update is sent again.
   */
  onUpdateAcknowledged?: (ack: CollabUpdateAck) => void;
}

/**
 * What the server reported for an acknowledged update: whether the app's rows
 * were derived from its live copy, or null when the server defines none.
 */
export interface CollabUpdateAck {
  liveCopy: "derived" | "not_derived" | "unchanged" | null;
  liveCopyReason?: string;
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

export interface CollabRebuildOptions {
  beforeReplace?: (next: Y.Doc) => void;
}

/**
 * What `rebuild` did. `too_large` replaced nothing: the server would still
 * refuse the content as one update, of `updateBytes`, leaving a document of
 * `stateBytes`.
 */
export type CollabRebuildResult =
  | { status: "rebuilt"; ydoc: Y.Doc }
  | { status: "too_large"; updateBytes: number; stateBytes: number }
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
  /**
   * Sends every local edit the server has not yet acknowledged. Resolves `true`
   * once none are outstanding and `false` when delivery failed (offline), so a
   * caller that saves the same content elsewhere can wait until collaborators
   * can already receive it through the document instead of inserting it twice.
   */
  flushUpdates: () => Promise<boolean>;
  /**
   * True once keeping this tab's unacknowledged updates, or reading the ones
   * another tab left, failed. Updates still send while the tab stays open.
   */
  durableUpdatesFailed: boolean;
  /**
   * True once the server refused one of this tab's updates as too large.
   * Every later update depends on it, so this tab stops sending updates and
   * stops keeping them with `durableUpdates`; `rebuild` replaces them.
   */
  updatesRefused: boolean;
  /**
   * After `updatesRefused`, writes the caller's content onto the server's
   * copy of the doc as one update, through `write`, and replaces this tab's
   * doc with one under a new client id that sends it. This doc takes the
   * server's copy first, so content `write` reads from an editor bound to it
   * holds what collaborators added. While the update would still be refused
   * it resolves `too_large` and keeps that update, with `durableUpdates`, in
   * place of the refused ones. Once `rebuilt`, `ydoc` and `awareness` are
   * the new doc's. `write` runs synchronously, up to twice per call, and
   * `beforeReplace` gets the new doc right before the hook moves to it, so an
   * editor can stop taking edits that would reach only the old one.
   */
  rebuild: (
    write: (doc: Y.Doc) => void,
    options?: CollabRebuildOptions,
  ) => Promise<CollabRebuildResult>;
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
  durableUpdatesFailed: boolean;
  updatesRefused: boolean;
  activeUsers: CollabUser[];
  agentActive: boolean;
  agentPresent: boolean;
}

interface CollabDocSubscription {
  pollInterval: number;
  pollIntervalWithSse: number;
  pauseWhenHidden: boolean;
  requestSource?: string;
  durableUpdates?: boolean;
  onUpdateAcknowledged?: (ack: CollabUpdateAck) => void;
  onSnapshot: (snapshot: CollabDocSnapshot) => void;
  onReplaced?: (next: CollabDocConnection) => void;
}

const EMPTY_SNAPSHOT: CollabDocSnapshot = Object.freeze({
  isLoading: false,
  isSynced: false,
  initialization: { status: "loading" as const },
  durableUpdatesFailed: false,
  updatesRefused: false,
  activeUsers: [],
  agentActive: false,
  agentPresent: false,
});

function readUpdateAck(body: unknown): CollabUpdateAck {
  if (!body || typeof body !== "object") {
    throw new Error("The collab update response was not an object.");
  }
  const { liveCopy, liveCopyReason } = body as {
    liveCopy?: unknown;
    liveCopyReason?: unknown;
  };
  if (liveCopy === undefined) return { liveCopy: null };
  if (
    liveCopy !== "derived" &&
    liveCopy !== "not_derived" &&
    liveCopy !== "unchanged"
  ) {
    throw new Error(`Unknown live-copy outcome ${String(liveCopy)}.`);
  }
  return typeof liveCopyReason === "string"
    ? { liveCopy, liveCopyReason }
    : { liveCopy };
}

// Unacknowledged updates kept in localStorage, one entry per connection. Yjs
// integrates an update once, so sending one the server already holds again
// changes nothing.
const OUTBOX_PREFIX = "agent-native-collab-outbox-v1:";
const OUTBOX_ORIGIN = "collab-outbox";
const REBUILD_ORIGIN = "collab-rebuild";
// A rebuild candidate writes the page's content again under a new client id,
// so unlike an unsent update it is not idempotent: two adopted together put
// that content in twice. Each is kept under its own key, which its tab holds
// as a Web Lock while open.
const REBUILD_CANDIDATE_MARK = "rebuild:";

function outboxPrefix(docKey: string, email: string): string {
  return `${OUTBOX_PREFIX}${encodeURIComponent(docKey)}:${encodeURIComponent(email)}:`;
}

interface StoredOutbox {
  key: string;
  raw: string;
}

const requestSyncUnavailable = (): Promise<CollaborativeDocSyncResult> =>
  Promise.resolve({ status: "unavailable" });

// Nothing is outstanding without a connection.
const flushUpdatesUnavailable = (): Promise<boolean> => Promise.resolve(true);

const rebuildUnavailable = (): Promise<CollabRebuildResult> =>
  Promise.resolve({ status: "unavailable" });

function rebuildFailed(error: unknown): {
  status: "failed";
  error: Error;
} {
  return {
    status: "failed",
    error: error instanceof Error ? error : new Error(String(error)),
  };
}

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
  private updateBatchLimit = Infinity;
  private updateAbortController: AbortController | null = null;
  private updateHandlerAttached = false;
  private keepsUnsentUpdates = false;
  private unsentUpdatesRestored = false;
  private onlineDuringUpdate = false;
  private readonly outboxOwnerId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  // The candidate the refused connection this one rebuilt kept, which this
  // one's first update replaces.
  private rebuiltFromKey: string | null = null;
  private rebuildInFlight: Promise<CollabRebuildResult> | null = null;
  private candidateLock: Promise<void> | null = null;
  private releaseCandidateLock: (() => void) | null = null;
  // Remote updates wait while a rebuild reads this doc against the server's,
  // so the content it reads holds nothing that copy lacks.
  private heldRemoteUpdates: Uint8Array[] | null = null;

  private syncActive = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;
  private pollCycleCount = 0;
  private pollVersion = 0;
  private lastPolledVersion = 0;
  private pollCursor: string | null = null;
  private pollActivityBaselineReady = false;
  private stateVectorFetch: Promise<CollaborativeDocSyncResult> | null = null;
  private stateVectorAbortControllers = new Set<AbortController>();
  private sseActive = false;
  private sseAwarenessCovered = false;
  private ssePollLive = false;
  private sseSubscribedWithPause: boolean | null = null;
  private unsubscribeCollabEvents: (() => void) | null = null;
  private unsubscribeAwarenessEvents: (() => void) | null = null;
  private agentTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseCollabPollBoost: (() => void) | null = null;

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
      durableUpdatesFailed: false,
      updatesRefused: false,
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
    // Once kept, updates stay kept until acknowledged, even if the caller
    // stops asking.
    if (sub.durableUpdates && !this.keepsUnsentUpdates) {
      this.keepsUnsentUpdates = true;
      this.storeUnsentUpdates();
      this.restoreUnsentUpdates();
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
    this.retirePendingUpdates();
    void this.flushPendingUpdates(true);
    this.detachUpdateHandler();
    this.releaseCandidateLock?.();
    this.releaseCandidateLock = null;
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

  private get outboxScope(): {
    prefix: string;
    key: string;
    candidateKey: string;
  } | null {
    const email = this.lastSetUser?.email?.trim().toLowerCase();
    if (!email || typeof window === "undefined") return null;
    const prefix = outboxPrefix(this.registryKey, email);
    return {
      prefix,
      key: prefix + this.outboxOwnerId,
      candidateKey: prefix + REBUILD_CANDIDATE_MARK + this.outboxOwnerId,
    };
  }

  // Refused updates are held back for good, so retired they would only be
  // sent again beside the candidate that replaces them.
  private retirePendingUpdates(): void {
    if (
      this.pendingUpdates.length &&
      this.retiredUpdatesKey &&
      !this.snapshot.updatesRefused
    ) {
      retiredCollabUpdates.set(this.retiredUpdatesKey, this.pendingUpdates);
    }
  }

  private markDurableUpdatesFailed(): void {
    if (!this.snapshot.durableUpdatesFailed) {
      this.setSnapshot({ durableUpdatesFailed: true });
    }
  }

  private storeUnsentUpdates(): void {
    if (!this.keepsUnsentUpdates || this.snapshot.updatesRefused) return;
    const scope = this.outboxScope;
    if (!scope) return;
    try {
      if (this.pendingUpdates.length === 0) {
        window.localStorage.removeItem(scope.key);
      } else {
        window.localStorage.setItem(
          scope.key,
          uint8ArrayToBase64(
            this.pendingUpdates.length === 1
              ? this.pendingUpdates[0]
              : Y.mergeUpdates(this.pendingUpdates),
          ),
        );
      }
    } catch {
      this.markDurableUpdatesFailed();
    }
  }

  private removeStored(key: "key" | "candidateKey"): void {
    if (!this.keepsUnsentUpdates) return;
    const scope = this.outboxScope;
    if (!scope) return;
    try {
      window.localStorage.removeItem(scope[key]);
    } catch {
      this.markDurableUpdatesFailed();
    }
  }

  // Replaces the candidate this connection keeps; call only while it holds
  // the candidate lock.
  private keepCandidate(update: Uint8Array): void {
    if (!this.keepsUnsentUpdates) return;
    const scope = this.outboxScope;
    if (!scope) return;
    try {
      window.localStorage.setItem(
        scope.candidateKey,
        uint8ArrayToBase64(update),
      );
    } catch {
      this.markDurableUpdatesFailed();
    }
  }

  /** Resolves once this tab holds its candidate's key as a Web Lock. */
  private holdCandidateLock(): Promise<void> {
    if (this.candidateLock) return this.candidateLock;
    const key = this.outboxScope?.candidateKey;
    const locks =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!key || !locks) {
      this.candidateLock = Promise.resolve();
      return this.candidateLock;
    }
    this.candidateLock = new Promise<void>((held) => {
      void locks
        .request(
          key,
          () =>
            new Promise<void>((release) => {
              this.releaseCandidateLock = release;
              if (this.disposed) release();
              held();
            }),
        )
        // coercion-ok: without the lock, the candidate is kept as a browser
        // without Web Locks keeps it; another tab may adopt it while this one
        // is open.
        .catch(() => held());
    });
    return this.candidateLock;
  }

  /**
   * Sends what other connections for this doc and user kept: a tab that
   * closed or reloaded before its updates were acknowledged. Applying them
   * queues what the doc lacks as this connection's own unsent updates, which
   * are kept before the other entry is removed. A live tab's entry is adopted
   * too, which sends its updates twice and changes nothing. Rebuild
   * candidates are adopted after, and only from tabs that are gone.
   */
  private restoreUnsentUpdates(): void {
    if (
      this.unsentUpdatesRestored ||
      !this.keepsUnsentUpdates ||
      !this.updateHandlerAttached ||
      this.disposed
    ) {
      return;
    }
    const scope = this.outboxScope;
    if (!scope) return;
    this.unsentUpdatesRestored = true;
    const candidatePrefix = scope.prefix + REBUILD_CANDIDATE_MARK;
    const stored = this.readStored(
      (key) =>
        key.startsWith(scope.prefix) &&
        !key.startsWith(candidatePrefix) &&
        key !== scope.key,
    );
    if (!stored) return;
    this.adoptStored(stored);
    void this.restoreRebuildCandidates(candidatePrefix, scope.candidateKey);
  }

  private async restoreRebuildCandidates(
    candidatePrefix: string,
    ownKey: string,
  ): Promise<void> {
    const locks =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    let open: Set<string>;
    try {
      const held = locks ? (await locks.query()).held : [];
      open = new Set((held ?? []).flatMap((lock) => lock.name ?? []));
    } catch {
      this.markDurableUpdatesFailed();
      return;
    }
    // A refused connection keeps nothing new; the one rebuilt from it adopts
    // what is left.
    if (this.disposed || this.snapshot.updatesRefused) return;
    const stored = this.readStored(
      (key) =>
        key.startsWith(candidatePrefix) &&
        key !== ownKey &&
        key !== this.rebuiltFromKey &&
        !open.has(key),
    );
    if (stored) this.adoptStored(stored);
  }

  private readStored(include: (key: string) => boolean): StoredOutbox[] | null {
    const stored: StoredOutbox[] = [];
    try {
      const storage = window.localStorage;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !include(key)) continue;
        const raw = storage.getItem(key);
        if (raw !== null) stored.push({ key, raw });
      }
    } catch {
      this.markDurableUpdatesFailed();
      return null;
    }
    return stored;
  }

  private adoptStored(stored: StoredOutbox[]): void {
    for (const entry of stored) {
      try {
        Y.applyUpdate(this.ydoc, base64ToUint8Array(entry.raw), OUTBOX_ORIGIN);
        // Kept nowhere else while this connection cannot keep its own.
        if (this.snapshot.durableUpdatesFailed) continue;
      } catch {
        // An entry that cannot be applied never will be; it is reported,
        // then removed so it is not reported on every open.
        this.markDurableUpdatesFailed();
      }
      try {
        if (window.localStorage.getItem(entry.key) === entry.raw) {
          window.localStorage.removeItem(entry.key);
        }
      } catch {
        this.markDurableUpdatesFailed();
      }
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
      this.retirePendingUpdates();
      this.pendingUpdates = [];
      this.updateAbortController?.abort();
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.updateErrors = 0;
      this.updateBatchLimit = Infinity;
      if (this.snapshot.updatesRefused) {
        this.setSnapshot({ updatesRefused: false });
      }
      // Kept updates are per account.
      this.unsentUpdatesRestored = false;
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
    this.storeUnsentUpdates();
    this.restoreUnsentUpdates();
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
    let hasVisibleHuman = false;
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.ydoc.clientID) return;
      if (state.user) {
        users.push(state.user as CollabUser);
        if ((state.user as CollabUser).email === "agent@system") {
          hasAgent = true;
        } else if (state.visible !== false) {
          hasVisibleHuman = true;
        }
      }
    });
    this.setCollabPollBoost(hasVisibleHuman);
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

  // Presence is discovered by this connection's own ~12 s poll, which is also
  // what ends the boost: a collaborator who leaves drops out of awareness after
  // the server's 30 s row TTL.
  private setCollabPollBoost(othersPresent: boolean): void {
    const want = othersPresent && this.syncActive && !this.disposed;
    if (want && !this.releaseCollabPollBoost) {
      this.releaseCollabPollBoost = acquireCollabPollBoost();
    } else if (!want && this.releaseCollabPollBoost) {
      this.releaseCollabPollBoost();
      this.releaseCollabPollBoost = null;
    }
  }

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
    fetch(`${this.baseUrl}/${this.docId}/state`, {
      headers: { "X-Agent-Native-Poll-Baseline": "1" },
    }).then(
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
          activityBaseline?: {
            status?: unknown;
            version?: unknown;
            cursor?: unknown;
          };
        } | null;
        if (this.disposed) return;
        if (typeof data?.state !== "string" || data.state.length === 0) {
          this.markInitializationFailed("invalid-payload");
          return;
        }
        const baseline = data.activityBaseline;
        if (
          baseline?.status === "ready" &&
          Number.isSafeInteger(baseline.version) &&
          (baseline.version as number) >= 0 &&
          typeof baseline.cursor === "string" &&
          baseline.cursor.length > 0
        ) {
          this.pollVersion = baseline.version as number;
          this.lastPolledVersion = baseline.version as number;
          this.pollCursor = baseline.cursor;
          this.pollActivityBaselineReady = true;
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
        this.restoreUnsentUpdates();
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

  flushUpdates = async (): Promise<boolean> => {
    while (!this.disposed && this.pendingUpdates.length > 0) {
      if (this.updateInFlight) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      await this.flushPendingUpdates();
      if (this.updateErrors > 0 || this.snapshot.updatesRefused) return false;
    }
    return this.pendingUpdates.length === 0;
  };

  rebuild = (
    write: (doc: Y.Doc) => void,
    options: CollabRebuildOptions = {},
  ): Promise<CollabRebuildResult> => {
    if (this.rebuildInFlight) return this.rebuildInFlight;
    if (
      this.disposed ||
      !this.snapshot.updatesRefused ||
      this.snapshot.initialization.status !== "ready"
    ) {
      return Promise.resolve({ status: "unavailable" });
    }
    const request = this.performRebuild(write, options);
    this.rebuildInFlight = request;
    void request.finally(() => {
      if (this.rebuildInFlight === request) this.rebuildInFlight = null;
    });
    return request;
  };

  private async performRebuild(
    write: (doc: Y.Doc) => void,
    options: CollabRebuildOptions,
  ): Promise<CollabRebuildResult> {
    await this.holdCandidateLock();
    this.heldRemoteUpdates = [];
    try {
      let serverState: Uint8Array;
      try {
        serverState = await this.fetchServerState();
      } catch (error) {
        return rebuildFailed(error);
      }
      if (this.disposed || !this.snapshot.updatesRefused) {
        return { status: "unavailable" };
      }
      // Measured first, so content that is still too large starts no doc.
      const measured = this.measureRebuild(serverState, write);
      if (measured.status !== "fits") return measured;

      const next = new CollabDocConnection(this.docId, this.baseUrl);
      next.rebuiltFromKey = this.outboxScope?.candidateKey ?? null;
      const holder = Symbol("rebuild");
      let settle!: (state: CollabInitializationState) => void;
      const initialized = new Promise<CollabInitializationState>((resolve) => {
        settle = resolve;
      });
      next.add(holder, {
        pollInterval: this.effectivePollInterval,
        pollIntervalWithSse: this.effectivePollIntervalWithSse,
        pauseWhenHidden: this.effectivePauseWhenHidden,
        requestSource: this.requestSource,
        durableUpdates: this.keepsUnsentUpdates,
        onSnapshot: (snapshot) => {
          if (snapshot.initialization.status !== "loading") {
            settle(snapshot.initialization);
          }
        },
      });
      if (this.lastSetUser) next.setUser(this.lastSetUser);
      const timeout = setTimeout(
        () => settle({ status: "error", category: "network" }),
        STATE_VECTOR_FETCH_TIMEOUT_MS,
      );
      const initialization = await initialized;
      clearTimeout(timeout);
      let result: CollabRebuildResult;
      if (initialization.status === "error") {
        result = rebuildFailed(
          new Error(`The rebuilt doc did not load: ${initialization.category}`),
        );
      } else if (this.disposed || !this.snapshot.updatesRefused) {
        result = { status: "unavailable" };
      } else {
        result = this.commitRebuild(next, write, options);
      }
      next.remove(holder);
      if (result.status !== "rebuilt") next.dispose();
      return result;
    } finally {
      this.releaseRemoteUpdates();
    }
  }

  /**
   * The update `write` makes to `base`, written after this doc takes `base`
   * so content read from an editor bound to it holds everything `base` does.
   */
  private measureRebuild(
    base: Uint8Array,
    write: (doc: Y.Doc) => void,
  ):
    | { status: "fits"; update: Uint8Array }
    | Exclude<CollabRebuildResult, { status: "rebuilt" }> {
    const scratch = new Y.Doc();
    let update: Uint8Array;
    let stateBytes: number;
    try {
      Y.applyUpdate(scratch, base, "remote");
      Y.applyUpdate(this.ydoc, base, "remote");
      const vector = Y.encodeStateVector(scratch);
      write(scratch);
      update = Y.encodeStateAsUpdate(scratch, vector);
      stateBytes = Y.encodeStateAsUpdate(scratch).length;
    } catch (error) {
      return rebuildFailed(error);
    } finally {
      scratch.destroy();
    }
    if (collabUpdateFits(update.length, stateBytes)) {
      return { status: "fits", update };
    }
    this.keepCandidate(update);
    return { status: "too_large", updateBytes: update.length, stateBytes };
  }

  private commitRebuild(
    next: CollabDocConnection,
    write: (doc: Y.Doc) => void,
    options: CollabRebuildOptions,
  ): CollabRebuildResult {
    // Measured again against the new doc, which may hold more than the state
    // measured first, and read after this tab's latest typing.
    const measured = this.measureRebuild(
      Y.encodeStateAsUpdate(next.ydoc),
      write,
    );
    if (measured.status !== "fits") return measured;
    try {
      options.beforeReplace?.(next.ydoc);
    } catch (error) {
      return rebuildFailed(error);
    }
    Y.applyUpdate(next.ydoc, measured.update, REBUILD_ORIGIN);
    this.removeStored("candidateKey");
    this.pendingUpdates = [];
    collabConnectionRegistry.set(this.registryKey, next);
    for (const sub of Array.from(this.subscribers.values())) {
      sub.onReplaced?.(next);
    }
    return { status: "rebuilt", ydoc: next.ydoc };
  }

  private async fetchServerState(): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      STATE_VECTOR_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetch(`${this.baseUrl}/${this.docId}/state`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Collab state request failed: HTTP ${response.status}`);
      }
      const data = (await response.json()) as { state?: unknown } | null;
      if (typeof data?.state !== "string" || data.state.length === 0) {
        throw new Error("Collab state response did not contain state");
      }
      return base64ToUint8Array(data.state);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** False when a rebuild holds the update until it finishes. */
  private applyRemoteUpdate(update: Uint8Array): boolean {
    if (this.heldRemoteUpdates) {
      this.heldRemoteUpdates.push(update);
      return false;
    }
    Y.applyUpdate(this.ydoc, update, "remote");
    return true;
  }

  private releaseRemoteUpdates(): void {
    const held = this.heldRemoteUpdates;
    this.heldRemoteUpdates = null;
    if (!held?.length || this.disposed) return;
    let unreadable = false;
    for (const update of held) {
      try {
        Y.applyUpdate(this.ydoc, update, "remote");
      } catch {
        unreadable = true;
      }
    }
    // As when one arrives unreadable: the state vector catches up.
    if (unreadable) void this.fetchStateVector();
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === "remote") return;
    this.pendingUpdates.push(update);
    this.storeUnsentUpdates();
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

  // A tab that comes back online sends what it kept without waiting out the
  // retry backoff it built up while offline.
  private handleOnline = (): void => {
    if (!this.keepsUnsentUpdates) return;
    if (this.updateInFlight) {
      this.onlineDuringUpdate = true;
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flushPendingUpdates();
  };

  private attachUpdateHandler(): void {
    if (this.updateHandlerAttached || this.docMissing) return;
    this.updateHandlerAttached = true;
    this.ydoc.on("update", this.handleDocUpdate);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handlePageHide);
      window.addEventListener("online", this.handleOnline);
    }
  }

  private detachUpdateHandler(): void {
    if (!this.updateHandlerAttached) return;
    this.updateHandlerAttached = false;
    this.ydoc.off("update", this.handleDocUpdate);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handlePageHide);
      window.removeEventListener("online", this.handleOnline);
    }
  }

  private async flushPendingUpdates(keepalive = false): Promise<void> {
    if (
      this.snapshot.updatesRefused ||
      (keepalive
        ? this.keepaliveInFlight
        : this.disposed ||
          this.updateInFlight ||
          (this.updateErrors > 0 && this.flushTimer !== null))
    )
      return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingUpdates.length === 0) return;
    const toSend = this.pendingUpdates.slice(0, this.updateBatchLimit);
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
    const ackListeners = Array.from(this.subscribers.values()).flatMap((sub) =>
      sub.onUpdateAcknowledged ? [sub.onUpdateAcknowledged] : [],
    );
    let ack: CollabUpdateAck | null = null;
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
      // The same bytes are refused again, so a refused batch is sent in
      // halves, and a refused single update stops this tab's updates.
      if (response.status === 413) {
        if (toSend.length > 1) {
          this.updateBatchLimit = Math.ceil(toSend.length / 2);
        } else {
          this.setSnapshot({ updatesRefused: true });
          // Kept, they would only be refused again after a reload.
          this.removeStored("key");
          void this.holdCandidateLock();
        }
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (ackListeners.length) ack = readUpdateAck(await response.json());
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
      this.storeUnsentUpdates();
      this.updateErrors = 0;
      if (this.pendingUpdates.length === 0) this.updateBatchLimit = Infinity;
    } catch {
      this.updateErrors++;
    } finally {
      clearTimeout(timeout);
      let online = false;
      if (keepalive) this.keepaliveInFlight = false;
      else {
        this.updateInFlight = false;
        this.updateAbortController = null;
        online = this.onlineDuringUpdate;
        this.onlineDuringUpdate = false;
      }
      if (
        !this.disposed &&
        !this.snapshot.updatesRefused &&
        this.pendingUpdates.length &&
        !this.flushTimer
      ) {
        this.flushTimer = setTimeout(
          () => {
            this.flushTimer = null;
            void this.flushPendingUpdates();
          },
          this.updateErrors && !online
            ? calcBackoff(this.updateErrors)
            : UPDATE_DEBOUNCE_MS,
        );
      }
    }
    // After the bookkeeping, so a listener that throws cannot send an
    // acknowledged update again.
    if (ack) for (const listener of ackListeners) listener(ack);
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
    this.setCollabPollBoost(false);
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
        this.applyRemoteUpdate(base64ToUint8Array(change.update));
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
      if (!this.applyRemoteUpdate(binary)) return { status: "unavailable" };
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
      const pollUrl = this.pollCursor
        ? `/_agent-native/poll?cursor=${encodeURIComponent(this.pollCursor)}`
        : `/_agent-native/poll?since=${this.pollVersion}`;
      const res = await fetch(agentNativePath(pollUrl));
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      if (!this.syncActive || this.disposed) return;
      const hadActivityBaseline = this.pollActivityBaselineReady;
      const { version, events } = data as {
        version: number;
        cursor?: string;
        events: Array<{
          version: number;
          source: string;
          docId?: string;
          update?: string;
          requestSource?: string;
          resourceType?: string;
          resourceId?: string;
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
            this.applyRemoteUpdate(base64ToUint8Array(evt.update));
          } catch {
            await this.fetchStateVector();
          }

          if (evt.requestSource === "agent") {
            this.markAgentActive();
          }
        }
      }

      if (hadActivityBaseline) {
        noteCollabPollActivity(events);
      } else {
        const reconciliation = await this.fetchStateVector();
        if (reconciliation.status !== "synced") {
          throw reconciliation.status === "failed"
            ? reconciliation.error
            : new Error(
                "Could not reconcile state without an activity baseline",
              );
        }
      }
      this.pollActivityBaselineReady = true;
      if (typeof data.cursor === "string") this.pollCursor = data.cursor;
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
// In-memory retention survives component remounts; a connection with durable
// updates also keeps them in localStorage. No retired retry loop.
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
    activityResource,
    durableUpdates = false,
    onUpdateAcknowledged,
  } = options;
  const onUpdateAcknowledgedRef = useRef(onUpdateAcknowledged);
  onUpdateAcknowledgedRef.current = onUpdateAcknowledged;
  const wantsAcks = onUpdateAcknowledged !== undefined;
  useEffect(() => {
    if (!docId || !activityResource) return;
    return registerCollabActivityResource(activityResource);
  }, [activityResource?.resourceId, activityResource?.resourceType, docId]);
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
    let current = conn;
    const subscription: CollabDocSubscription = {
      pollInterval,
      pollIntervalWithSse,
      pauseWhenHidden,
      requestSource,
      durableUpdates,
      ...(wantsAcks
        ? {
            onUpdateAcknowledged: (ack: CollabUpdateAck) =>
              onUpdateAcknowledgedRef.current?.(ack),
          }
        : {}),
      onSnapshot: setSnapshot,
      // Moved before this hook renders again, so the new doc's first update
      // is acknowledged to it.
      onReplaced: (next) => {
        current.remove(id);
        current = next;
        next.add(id, subscription);
        setSnapshot(next.snapshot);
        setGeneration((g) => g + 1);
      },
    };
    conn.add(id, subscription);
    setSnapshot(conn.snapshot);
    return () => {
      current.remove(id);
    };
  }, [
    conn,
    pollInterval,
    pollIntervalWithSse,
    pauseWhenHidden,
    requestSource,
    durableUpdates,
    wantsAcks,
  ]);

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
    flushUpdates: conn ? conn.flushUpdates : flushUpdatesUnavailable,
    rebuild: conn ? conn.rebuild : rebuildUnavailable,
    durableUpdatesFailed: snapshot.durableUpdatesFailed,
    updatesRefused: snapshot.updatesRefused,
    activeUsers: snapshot.activeUsers,
    agentActive: snapshot.agentActive,
    agentPresent: snapshot.agentPresent,
  };
}
