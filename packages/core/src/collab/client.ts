import { useEffect, useMemo, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { agentNativePath } from "../client/api-path.js";
import { useAvatarUrl } from "../client/use-avatar.js";
import {
  acquireCollabPollBoost,
  noteCollabPollActivity,
  registerCollabActivityResource,
  registerOwnCollabSource,
  subscribeSyncEvents,
  type SyncEvent,
} from "../client/use-db-sync.js";
import { registerBeforeSignOutCleanup } from "../client/use-session.js";
import {
  REALTIME_CAP_NO_AWARENESS,
  REALTIME_CAP_POLL_LIVE,
} from "../realtime-protocol.js";
import {
  forgetAwarenessClientSequence,
  postAwarenessState,
} from "./awareness-post.js";
import {
  clearCollabLocalCopies,
  collabLocalCopyKey,
  deleteCollabLocalCopy,
  peekCollabLocalCopy,
  readCollabLocalCopy,
  saveCollabLocalCopy,
} from "./local-store.js";
import {
  dropCollabStatePrefetches,
  requestCollabState,
  takeCollabStatePrefetch,
  type CollabStateRequest,
  type TakenCollabStatePrefetch,
} from "./state-prefetch.js";
import { dedupeCollabUsersByEmail, type CollabUser } from "./types.js";
export {
  dedupeCollabUsersByEmail,
  emailToColor,
  emailToName,
  type CollabUser,
} from "./types.js";
export { isReconcileLeadClient } from "./lead-client.js";

export interface UseCollaborativeDocOptions {
  docId: string | null;
  pollInterval?: number;
  pollIntervalWithSse?: number;
  pauseWhenHidden?: boolean;
  baseUrl?: string;
  requestSource?: string;
  user?: CollabUser;
  activityResource?: { resourceType: string; resourceId: string };
  /** Application events received alongside document updates on the existing transport. */
  onEvent?: (event: SyncEvent) => void;
  /**
   * Keeps this tab's unacknowledged updates in localStorage until the server
   * acknowledges them, and sends the ones a closed or reloaded tab left
   * behind when the doc next opens for the same user. Needs `user`, whose
   * email scopes what is kept.
   */
  durableUpdates?: boolean;
  /** New updates need a known live-copy outcome handled by a current strict subscriber. */
  requireLiveCopyOutcome?: boolean;
  /**
   * Called for each update the server acknowledged, with the live-copy
   * outcome it reported. With it, an acknowledgment whose body cannot be read
   * counts as undelivered and the update is sent again.
   */
  onUpdateAcknowledged?: (ack: CollabUpdateAck) => void;
  /**
   * Keeps the doc's acknowledged state in this browser, per account, and opens
   * the doc from it next time: the doc is ready at once, takes edits, and
   * catches up with the server behind it. Needs `user`, whose email scopes
   * the copy. `fromLocalCopy` is true and `isSynced` false until the server
   * has answered. What is typed meanwhile is sent once the server's state
   * covers the copy; typing that state leaves out goes to `onEditsDisplaced`.
   */
  localCopy?: CollabLocalCopyOptions;
}

/**
 * Typing made on a doc opened from a saved copy, before the server answered,
 * that the server's state left out.
 */
export interface DisplacedCollabEdits {
  /** The doc as it stood with that typing, as a whole Yjs state. */
  state: Uint8Array;
  /**
   * `superseded`: the server's doc no longer holds the saved copy, so the doc
   * opens again from the server's state alone. `deleted`: the server had
   * since deleted the part of the doc the typing went into. `unavailable`:
   * the server no longer has the doc, or this account cannot open it.
   */
  reason: "superseded" | "deleted" | "unavailable";
}

export interface CollabLocalCopyOptions {
  /**
   * Called at once, before the doc lets the typing go. The server's state
   * stays as it is: keep the typing where the user can find it, and never
   * write it back into the doc.
   */
  onEditsDisplaced: (edits: DisplacedCollabEdits) => void;
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

export interface UseCollaborativeDocResult {
  ydoc: Y.Doc | null;
  awareness: Awareness | null;
  isLoading: boolean;
  isSynced: boolean;
  /**
   * True while the doc shows this browser's saved copy and the server has not
   * answered yet. The doc is ready and takes edits meanwhile.
   */
  fromLocalCopy: boolean;
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
   * Resending it cannot succeed, so this tab stops sending updates; they stay
   * unacknowledged, and kept with `durableUpdates`.
   */
  updatesRefused: boolean;
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

// A poll that never settles would hold the in-flight guard and stop polling.
const POLL_FETCH_TIMEOUT_MS = 15_000;

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
    void postAwarenessState(baseUrl, docId, clientId, state).catch(() => {});
  }, 150);

  _awarenessThrottleTimers.set(key, timer);
}

interface CollabDocSnapshot {
  isLoading: boolean;
  isSynced: boolean;
  fromLocalCopy: boolean;
  /** This connection gave its doc up; subscribers open a new one. */
  superseded: boolean;
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
  localCopy?: boolean;
  onLocalCopyEditsDisplaced?: (edits: DisplacedCollabEdits) => void;
  requireLiveCopyOutcome: () => boolean;
  canAcknowledge: () => boolean;
  onUpdateAcknowledged?: (ack: CollabUpdateAck) => void;
  onSnapshot: (snapshot: CollabDocSnapshot) => void;
  onEvent: (event: SyncEvent) => void;
}

const EMPTY_SNAPSHOT: CollabDocSnapshot = Object.freeze({
  isLoading: false,
  isSynced: false,
  fromLocalCopy: false,
  superseded: false,
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
const VERSIONED_OUTBOX_PREFIX = "agent-native-collab-outbox-v2:";
const OUTBOX_ORIGIN = "collab-outbox";
const OUTBOX_OWNER_LOCK_PREFIX = "agent-native-collab-outbox-owner:";

function outboxPrefix(
  docKey: string,
  email: string,
  prefix = OUTBOX_PREFIX,
): string {
  return `${prefix}${encodeURIComponent(docKey)}:${encodeURIComponent(email)}:`;
}

interface PendingCollabUpdate {
  update: Uint8Array;
  readonly requireLiveCopyOutcome: boolean;
}

interface StoredOutbox {
  key: string;
  raw: string;
  version: 1 | 2;
}

function readStoredUpdates(
  entry: StoredOutbox,
  legacyRequireLiveCopyOutcome: boolean,
): PendingCollabUpdate[] {
  if (entry.version === 1)
    return [
      {
        update: base64ToUint8Array(entry.raw),
        requireLiveCopyOutcome: legacyRequireLiveCopyOutcome,
      },
    ];
  const body = JSON.parse(entry.raw) as {
    version?: unknown;
    updates?: unknown;
  } | null;
  if (
    body?.version !== 2 ||
    !Array.isArray(body.updates) ||
    body.updates.length === 0 ||
    body.updates.length > 2
  )
    throw new Error("The collab outbox has an unreadable update list.");
  return body.updates.map((value: unknown) => {
    const item = value as {
      update?: unknown;
      requireLiveCopyOutcome?: unknown;
    } | null;
    if (
      typeof item?.update !== "string" ||
      typeof item.requireLiveCopyOutcome !== "boolean"
    )
      throw new Error("The collab outbox has an unreadable update.");
    return {
      update: base64ToUint8Array(item.update),
      requireLiveCopyOutcome: item.requireLiveCopyOutcome,
    };
  });
}

const requestSyncUnavailable = (): Promise<CollaborativeDocSyncResult> =>
  Promise.resolve({ status: "unavailable" });

// Nothing is outstanding without a connection.
const flushUpdatesUnavailable = (): Promise<boolean> => Promise.resolve(true);

const DISPOSE_LINGER_MS = 1000;
// A saved local copy is written once the doc has been quiet this long.
const LOCAL_COPY_SAVE_DELAY_MS = 2000;
// A doc opened from its saved copy asks the server again after this, doubling.
const SERVER_STATE_RETRY_MS = 1000;
const SERVER_STATE_RETRY_MAX_MS = 30_000;

type SentCollabStateRequest = Pick<
  CollabStateRequest,
  "response" | "withStateVector"
>;

/** Whether a doc at `server` holds every struct a doc at `local` holds. */
function stateVectorCovers(server: Uint8Array, local: Uint8Array): boolean {
  const held = Y.decodeStateVector(server);
  for (const [client, clock] of Y.decodeStateVector(local)) {
    if ((held.get(client) ?? 0) < clock) return false;
  }
  return true;
}

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
  private pageHidden = false;
  private presenceClear: Promise<Response> | null = null;
  private signedOut = false;
  private keepaliveSnapshots = new Set<readonly PendingCollabUpdate[]>();
  private userGeneration = 0;

  private pendingUpdates: PendingCollabUpdate[] = [];
  private readonly deliveredUpdates = new WeakSet<PendingCollabUpdate>();
  private strictDeliveryVersion = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private updateInFlight = false;
  private updateErrors = 0;
  private updateBatchLimit = Infinity;
  private updateAbortController: AbortController | null = null;
  private updateHandlerAttached = false;
  private keepsUnsentUpdates = false;
  private unsentUpdatesRestored = false;
  private onlineDuringUpdate = false;
  private releaseOutboxOwner: (() => void) | null = null;
  private readonly outboxOwnerId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;

  private syncActive = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollGeneration = 0;
  // An older generation can stay on the network after sync restarts.
  private readonly pollInFlight = new Set<number>();
  private readonly pollRequested = new Set<number>();
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

  // A saved local copy (`localCopy`). The copy is only ever state the server
  // acknowledged; `localCopyVector` is the vector of the one this doc opened
  // from, which the server's answer has to cover.
  private keepsLocalCopy = false;
  private localCopyVector: Uint8Array | null = null;
  private awaitingServerState = false;
  private serverStateRequest: Promise<CollaborativeDocSyncResult> | null = null;
  private serverStateRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private serverStateRetryDelay = SERVER_STATE_RETRY_MS;
  private localCopySaveTimer: ReturnType<typeof setTimeout> | null = null;
  // Set once this doc gave up a copy the server did not cover; nothing it
  // holds is saved again.
  private localCopyRejected = false;
  // Set once the server's state covered the copy this doc opened from.
  private localCopyVerified = false;
  // Until then, the vector past which content in the doc was typed here (or
  // kept unsent from before): the copy's, or null once nothing is tracked.
  private typingBaseline: Map<number, number> | null = null;

  constructor(
    readonly docId: string,
    private readonly baseUrl: string,
    private actorIdentity: string,
    readonly detached = false,
  ) {
    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.snapshot = {
      isLoading: true,
      isSynced: false,
      fromLocalCopy: false,
      superseded: false,
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
    return collabRegistryKey(this.docId, this.baseUrl, this.actorIdentity);
  }

  private get retiredUpdatesKey(): string | null {
    const email = this.lastSetUser?.email.trim().toLowerCase();
    return email
      ? `${this.registryKey}\0${email}\0${this.requestSource ?? ""}`
      : null;
  }

  bindActorIdentity(actorIdentity: string): boolean {
    const identity = actorIdentity.trim().toLowerCase();
    if (!identity || identity === this.actorIdentity) return Boolean(identity);
    const currentUserIdentity = this.lastSetUser?.email.trim().toLowerCase();
    if (
      this.actorIdentity ||
      (currentUserIdentity && currentUserIdentity !== identity)
    ) {
      return false;
    }
    const nextKey = collabRegistryKey(this.docId, this.baseUrl, identity);
    const existing = collabConnectionRegistry.get(nextKey);
    if (existing && existing !== this && !existing.disposed) return false;
    if (
      !this.detached &&
      collabConnectionRegistry.get(this.registryKey) === this
    ) {
      collabConnectionRegistry.delete(this.registryKey);
    }
    this.actorIdentity = identity;
    if (!this.detached) collabConnectionRegistry.set(nextKey, this);
    return true;
  }

  add(id: symbol, sub: CollabDocSubscription, user?: CollabUser): void {
    this.subscribers.set(id, sub);
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    if (!this.requestSource && sub.requestSource) {
      this.requestSource = sub.requestSource;
      registerOwnCollabSource(sub.requestSource);
    }
    if (user) this.setUser(user);
    // Once kept, updates stay kept until acknowledged, even if the caller
    // stops asking.
    if (sub.durableUpdates && !this.keepsUnsentUpdates) {
      this.keepsUnsentUpdates = true;
      this.storeUnsentUpdates();
      this.restoreUnsentUpdates();
    }
    if (sub.localCopy && !this.keepsLocalCopy) {
      this.keepsLocalCopy = true;
      this.ydoc.on("update", this.scheduleLocalCopySave);
    }
    this.deliverDisplacedTyping();
    if (!this.started) {
      this.started = true;
      this.start();
    } else if (!this.syncActive && this.serverStateReady) {
      this.startTransport();
    } else {
      this.resubscribeCollabEventsIfPauseChanged();
      if (this.serverStateReady) this.startSync();
      this.reschedulePoll();
    }
  }

  remove(id: symbol): void {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0) {
      if (this.signedOut) {
        this.dispose();
        return;
      }
      cancelAwarenessPush(this.baseUrl, this.docId, this.ydoc.clientID);
      // A lingering connection may outlive its document (a deleted Screen).
      this.stopSync();
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
    this.saveLocalCopy();
    this.disposed = true;
    if (this.localCopySaveTimer) {
      clearTimeout(this.localCopySaveTimer);
      this.localCopySaveTimer = null;
    }
    if (this.serverStateRetryTimer) {
      clearTimeout(this.serverStateRetryTimer);
      this.serverStateRetryTimer = null;
    }
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
    this.releaseOutboxOwner?.();
    this.releaseOutboxOwner = null;
    if (this.agentTimer) {
      clearTimeout(this.agentTimer);
      this.agentTimer = null;
    }
    this.awareness.off("change", this.handleAwarenessChange);
    const clear = this.clearPresence();
    if (clear) {
      void clear
        .catch(() => {})
        .finally(() => {
          forgetAwarenessClientSequence(
            this.baseUrl,
            this.docId,
            this.ydoc.clientID,
          );
        });
    } else {
      forgetAwarenessClientSequence(
        this.baseUrl,
        this.docId,
        this.ydoc.clientID,
      );
    }
    this.awareness.destroy();
    this.ydoc.destroy();
    if (collabConnectionRegistry.get(this.registryKey) === this) {
      collabConnectionRegistry.delete(this.registryKey);
    }
  }

  async clearPresenceBeforeSignOut(): Promise<void> {
    if (this.disposed) return;
    this.signedOut = true;
    this.stopSync();
    const clear = this.clearPresence();
    this.awareness.setLocalState(null);
    if (collabConnectionRegistry.get(this.registryKey) === this) {
      collabConnectionRegistry.delete(this.registryKey);
    }
    if (this.subscribers.size === 0) this.dispose();
    if (!clear) return;
    const response = await clear;
    if (!response.ok) {
      throw new Error(`Awareness clear returned HTTP ${response.status}`);
    }
  }

  private clearPresence(): Promise<Response> | null {
    cancelAwarenessPush(this.baseUrl, this.docId, this.ydoc.clientID);
    if (!this.presenceClear && this.awareness.getLocalState()) {
      this.presenceClear = postAwarenessState(
        this.baseUrl,
        this.docId,
        this.ydoc.clientID,
        null,
        true,
      );
    }
    return this.presenceClear;
  }

  private get canPublishPresence(): boolean {
    return (
      !this.disposed &&
      !this.signedOut &&
      !this.pageHidden &&
      this.presenceClear === null
    );
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

  private get hasStrictSubscriber(): boolean {
    return Array.from(this.subscribers.values()).some((sub) =>
      sub.requireLiveCopyOutcome(),
    );
  }

  private get outboxScope(): {
    prefix: string;
    key: string;
    versionedPrefix: string;
    versionedKey: string;
  } | null {
    const email = this.lastSetUser?.email.trim().toLowerCase();
    if (!email || typeof window === "undefined") return null;
    const prefix = outboxPrefix(this.registryKey, email);
    const versionedPrefix = outboxPrefix(
      this.registryKey,
      email,
      VERSIONED_OUTBOX_PREFIX,
    );
    return {
      prefix,
      key: prefix + this.outboxOwnerId,
      versionedPrefix,
      versionedKey: versionedPrefix + this.outboxOwnerId,
    };
  }

  private markDurableUpdatesFailed(): void {
    if (!this.snapshot.durableUpdatesFailed) {
      this.setSnapshot({ durableUpdatesFailed: true });
    }
  }

  private holdOutboxOwner(key: string): void {
    if (this.disposed || this.releaseOutboxOwner) return;
    const locks =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    if (typeof locks?.request !== "function") {
      this.markDurableUpdatesFailed();
      return;
    }
    // Queue the owner lock before publishing bytes an adopting tab can read.
    const held = new Promise<void>((release) => {
      this.releaseOutboxOwner = release;
    });
    void locks
      .request(OUTBOX_OWNER_LOCK_PREFIX + key, () => held)
      .catch(() => {
        if (!this.disposed) this.markDurableUpdatesFailed();
      });
  }

  private storeUnsentUpdates(): void {
    if (!this.keepsUnsentUpdates) return;
    const scope = this.outboxScope;
    if (!scope) return;
    this.holdOutboxOwner(scope.key);
    try {
      if (this.pendingUpdates.length === 0) {
        window.localStorage.removeItem(scope.key);
        window.localStorage.removeItem(scope.versionedKey);
      } else {
        const encode = (items: PendingCollabUpdate[]) =>
          uint8ArrayToBase64(Y.mergeUpdates(items.map((item) => item.update)));
        const updates = [true, false].flatMap((requireLiveCopyOutcome) => {
          const items = this.pendingUpdates.filter(
            (item) => item.requireLiveCopyOutcome === requireLiveCopyOutcome,
          );
          return items.length
            ? [{ update: encode(items), requireLiveCopyOutcome }]
            : [];
        });
        // Older clients only understand v1's bare Yjs bytes and must not
        // adopt or delete a versioned custody record.
        window.localStorage.setItem(
          scope.versionedKey,
          JSON.stringify({ version: 2, updates }),
        );
        window.localStorage.removeItem(scope.key);
      }
    } catch {
      this.markDurableUpdatesFailed();
    }
  }

  /**
   * Sends what other connections for this doc and user kept: a tab that
   * closed or reloaded before its updates were acknowledged. Applying them
   * queues what the doc lacks as this connection's own unsent updates, which
   * are kept before the other entry is removed. A live or frozen tab keeps
   * its owner lock, so another connection leaves its entry untouched.
   */
  private restoreUnsentUpdates(): void {
    if (
      this.unsentUpdatesRestored ||
      !this.keepsUnsentUpdates ||
      !this.updateHandlerAttached ||
      this.awaitingServerState ||
      this.disposed
    ) {
      return;
    }
    const scope = this.outboxScope;
    if (!scope) return;
    this.unsentUpdatesRestored = true;
    const stored: StoredOutbox[] = [];
    try {
      const storage = window.localStorage;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (
          !key ||
          (!key.startsWith(scope.prefix) &&
            !key.startsWith(scope.versionedPrefix)) ||
          key === scope.key ||
          key === scope.versionedKey
        )
          continue;
        const raw = storage.getItem(key);
        if (raw !== null)
          stored.push({
            key,
            raw,
            version: key.startsWith(scope.versionedPrefix) ? 2 : 1,
          });
      }
    } catch {
      this.markDurableUpdatesFailed();
      return;
    }
    const locks =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    if (typeof locks?.request !== "function") {
      this.markDurableUpdatesFailed();
      return;
    }
    for (const entry of stored) {
      const ownerKey = entry.key.startsWith(scope.versionedPrefix)
        ? scope.prefix + entry.key.slice(scope.versionedPrefix.length)
        : entry.key;
      void locks
        .request(
          OUTBOX_OWNER_LOCK_PREFIX + ownerKey,
          { ifAvailable: true },
          (lock) => {
            if (
              !lock ||
              this.disposed ||
              this.outboxScope?.prefix !== scope.prefix
            )
              return;
            try {
              const raw = window.localStorage.getItem(entry.key);
              if (raw !== null) this.adoptStoredOutbox({ ...entry, raw });
            } catch {
              this.markDurableUpdatesFailed();
            }
          },
        )
        .catch(() => {
          if (!this.disposed) this.markDurableUpdatesFailed();
        });
    }
  }

  private adoptStoredOutbox(entry: StoredOutbox): void {
    try {
      for (const item of readStoredUpdates(entry, this.hasStrictSubscriber)) {
        if (entry.version === 2 || item.requireLiveCopyOutcome) {
          Y.applyUpdate(this.ydoc, item.update, "remote");
          // Applying one custody group can integrate another's pending
          // dependencies without emitting a separate update event.
          this.enqueueUpdate(item.update, item.requireLiveCopyOutcome);
        } else {
          Y.applyUpdate(this.ydoc, item.update, OUTBOX_ORIGIN);
        }
      }
      // Kept nowhere else while this connection cannot keep its own.
      if (this.snapshot.durableUpdatesFailed) return;
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
    if (!this.bindActorIdentity(user.email)) return;
    const prev = this.lastSetUser;
    if (prev?.email !== user.email) this.userGeneration++;
    if (prev && prev.email !== user.email) {
      if (this.pendingUpdates.length && this.retiredUpdatesKey) {
        retiredCollabUpdates.set(this.retiredUpdatesKey, this.pendingUpdates);
      }
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
        for (const item of retired)
          Y.applyUpdate(this.ydoc, item.update, "remote");
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
      this.syncActive &&
      this.canPublishPresence
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
    const prefetch = takeCollabStatePrefetch(this.baseUrl, this.docId);
    if (this.keepsLocalCopy && this.actorIdentity && !this.detached) {
      void this.openFromLocalCopy(prefetch);
      return;
    }
    if (!prefetch) {
      this.fetchInitialState();
      return;
    }
    // A prefetched diff is built on a saved copy this connection does not use,
    // and an answer made for another session than the tab's now is another
    // account's.
    void prefetch.request.then(
      (request) => {
        if (this.disposed) return;
        this.fetchInitialState(
          request.localState || !prefetch.isCurrent()
            ? undefined
            : request.response,
        );
      },
      () => {
        if (!this.disposed) this.fetchInitialState();
      },
    );
  }

  // Methods, not fields, so a check after an await reads the value now.
  private isClosed(): boolean {
    return this.disposed;
  }

  private stillAwaitsServerState(): boolean {
    return !this.disposed && this.awaitingServerState;
  }

  /** Whether the server's state is in the doc, so sync can run. */
  private get serverStateReady(): boolean {
    return (
      this.snapshot.initialization.status === "ready" &&
      !this.awaitingServerState
    );
  }

  /**
   * Opens the doc from this browser's saved copy, when there is one: the doc
   * is ready at once, and the server is asked only for what the copy lacks.
   * A copy already in memory opens in this task.
   */
  private async openFromLocalCopy(
    prefetch: TakenCollabStatePrefetch | undefined,
  ): Promise<void> {
    const account = this.actorIdentity;
    const key = collabLocalCopyKey(this.baseUrl, this.docId);
    let request = prefetch
      ? await prefetch.request.then(
          (value): CollabStateRequest | undefined => value,
          () => undefined,
        )
      : undefined;
    if (this.disposed) return;
    // An answer made for another session than the tab's now is another
    // account's, and a copy read before the session was known may be too.
    if (
      request &&
      (!prefetch?.isCurrent() ||
        (request.localState && request.account !== account))
    )
      request = undefined;
    let local = request ? request.localState : null;
    if (!request) {
      const inMemory = peekCollabLocalCopy(account, key);
      if (inMemory) {
        local = inMemory;
      } else {
        const read = await readCollabLocalCopy(account, key);
        if (this.isClosed()) return;
        local = read.status === "hit" ? read.state : null;
      }
    }
    if (rejectedLocalCopies.has(this.registryKey)) local = null;
    if (!local || !this.applyLocalCopy(local)) {
      if (local) deleteCollabLocalCopy(account, key);
      this.fetchInitialState(
        request && !request.localState ? request.response : undefined,
      );
      return;
    }
    void this.requestServerState(request?.localState ? request : undefined);
  }

  /** Applies a saved copy, unless it is not a whole doc. */
  private applyLocalCopy(state: Uint8Array): boolean {
    const validationDoc = new Y.Doc();
    try {
      Y.applyUpdate(validationDoc, state, "remote");
      // Saved only from a whole doc, a copy missing structs it depends on, or
      // holding none, is not one this client wrote.
      if (
        validationDoc.store.pendingStructs ||
        validationDoc.store.pendingDs ||
        validationDoc.store.clients.size === 0
      )
        return false;
      // coercion-ok: a copy Yjs cannot read is not a whole doc; the caller deletes it.
    } catch {
      return false;
    } finally {
      validationDoc.destroy();
    }
    Y.applyUpdate(this.ydoc, state, "remote");
    for (const item of this.pendingUpdates) {
      Y.applyUpdate(this.ydoc, item.update, "remote");
    }
    this.localCopyVector = Y.encodeStateVectorFromUpdate(state);
    this.typingBaseline = Y.decodeStateVector(this.localCopyVector);
    this.awaitingServerState = true;
    // Edits made now wait in the queue until the server's state covers the
    // copy: only then is everything they build on known to be the server's.
    this.attachUpdateHandler();
    this.setSnapshot({
      isLoading: false,
      isSynced: false,
      fromLocalCopy: true,
      initialization: { status: "ready" },
    });
    return true;
  }

  /** Asks the server for what this doc lacks; one request at a time. */
  private requestServerState(
    prefetched?: SentCollabStateRequest,
  ): Promise<CollaborativeDocSyncResult> {
    if (this.serverStateRequest) return this.serverStateRequest;
    if (this.serverStateRetryTimer) {
      clearTimeout(this.serverStateRetryTimer);
      this.serverStateRetryTimer = null;
    }
    const request = this.readServerState(prefetched);
    this.serverStateRequest = request;
    void request.finally(() => {
      if (this.serverStateRequest === request) this.serverStateRequest = null;
    });
    return request;
  }

  private async readServerState(
    prefetched?: SentCollabStateRequest,
  ): Promise<CollaborativeDocSyncResult> {
    // Only a doc opened from a saved copy waits for the server's state.
    const localVector = this.localCopyVector;
    if (!localVector) return { status: "unavailable" };
    const sent =
      prefetched ??
      requestCollabState(
        this.baseUrl,
        this.docId,
        Y.encodeStateVector(this.ydoc),
      );
    let res: Response;
    try {
      res = await sent.response;
    } catch (error) {
      return this.retryServerStateLater(error);
    }
    if (this.disposed || !this.awaitingServerState) {
      return { status: "unavailable" };
    }
    if (res.status === 404 || res.status === 403) {
      this.forgetLocalCopy();
      this.awaitingServerState = false;
      this.releaseTypingOnLocalCopy("unavailable");
      this.markInitializationFailed("forbidden-or-not-found");
      return {
        status: "failed",
        error: new Error(`Collab state request failed: HTTP ${res.status}`),
      };
    }
    if (!res.ok) {
      return this.retryServerStateLater(
        new Error(`Collab state request failed: HTTP ${res.status}`),
      );
    }
    // coercion-ok: an unreadable body fails below as an invalid payload.
    const data = (await res.json().catch(() => null)) as {
      state?: unknown;
      stateVector?: unknown;
      activityBaseline?: unknown;
    } | null;
    if (!this.stillAwaitsServerState()) return { status: "unavailable" };
    let update: Uint8Array;
    let serverVector: Uint8Array | null;
    try {
      if (typeof data?.state !== "string" || data.state.length === 0) {
        throw new Error("The collab state response did not contain state");
      }
      update = base64ToUint8Array(data.state);
      serverVector =
        typeof data.stateVector === "string"
          ? base64ToUint8Array(data.stateVector)
          : sent.withStateVector
            ? null
            : Y.encodeStateVectorFromUpdate(update);
      if (serverVector) Y.decodeStateVector(serverVector);
    } catch (error) {
      // An answer that cannot be read cannot vouch for the copy either.
      return this.supersedeForUnreadableState(error);
    }
    // A server from before diffs carried its vector: ask for the whole state.
    if (!serverVector) {
      return this.readServerState(
        requestCollabState(this.baseUrl, this.docId, null),
      );
    }
    if (!stateVectorCovers(serverVector, localVector)) {
      this.supersede(
        `The saved copy of collab doc ${this.docId} holds state the server does not; opening the server's copy instead.`,
      );
      return { status: "unavailable" };
    }
    // Covering the copy keeps what it holds, but not typing that went inside
    // something the server has deleted since: the deletion stands, and the
    // typing as it was is handed over.
    const typed = this.typedOnLocalCopy();
    const withTyping =
      typed.length > 0 ? Y.encodeStateAsUpdate(this.ydoc) : null;
    try {
      Y.applyUpdate(this.ydoc, update, "remote");
    } catch (error) {
      // A failed apply can leave part of the server's state in the doc, so
      // the typing goes over as it stood before.
      if (withTyping) this.handOffDisplacedTyping(withTyping, "superseded");
      this.typingBaseline = null;
      return this.supersedeForUnreadableState(error);
    }
    if (withTyping && typed.some((item) => item.deleted)) {
      this.handOffDisplacedTyping(withTyping, "deleted");
    }
    this.typingBaseline = null;
    this.localCopyVerified = true;
    this.takeActivityBaseline(data.activityBaseline);
    this.awaitingServerState = false;
    this.serverStateRetryDelay = SERVER_STATE_RETRY_MS;
    this.setSnapshot({ isSynced: true, fromLocalCopy: false });
    this.startTransport();
    this.restoreUnsentUpdates();
    this.scheduleLocalCopySave();
    // What was typed on the copy waited for this.
    void this.flushPendingUpdates();
    return { status: "synced" };
  }

  /**
   * The server answered, but not with state this doc can take: the copy is
   * given up as when the server does not hold it, and the new connection
   * reads the server's state from scratch, failing there as any doc would.
   */
  private supersedeForUnreadableState(
    error: unknown,
  ): CollaborativeDocSyncResult {
    this.supersede(
      `The server's state for collab doc ${this.docId} could not be read over the saved copy (${error instanceof Error ? error.message : String(error)}); opening the server's copy instead.`,
    );
    return { status: "unavailable" };
  }

  /** The saved copy stays open and takes edits; the server is asked again. */
  private retryServerStateLater(error: unknown): CollaborativeDocSyncResult {
    if (this.disposed || !this.awaitingServerState) {
      return { status: "unavailable" };
    }
    if (this.serverStateRetryTimer) clearTimeout(this.serverStateRetryTimer);
    this.serverStateRetryTimer = setTimeout(() => {
      this.serverStateRetryTimer = null;
      void this.requestServerState();
    }, this.serverStateRetryDelay);
    this.serverStateRetryDelay = Math.min(
      this.serverStateRetryDelay * 2,
      SERVER_STATE_RETRY_MAX_MS,
    );
    return {
      status: "failed",
      error:
        error instanceof Error
          ? error
          : new Error("The collab state request failed"),
    };
  }

  private forgetLocalCopy(): void {
    if (!this.keepsLocalCopy || !this.actorIdentity) return;
    deleteCollabLocalCopy(
      this.actorIdentity,
      collabLocalCopyKey(this.baseUrl, this.docId),
    );
  }

  /**
   * Content the doc shows that was added since it opened from its saved copy:
   * typed here, or kept unsent from before. Only content in a sequence (text,
   * blocks); attribute and format changes are not typing.
   */
  private typedOnLocalCopy(): Y.Item[] {
    const baseline = this.typingBaseline;
    if (!baseline) return [];
    const typed: Y.Item[] = [];
    for (const [client, structs] of this.ydoc.store.clients) {
      const from = baseline.get(client) ?? 0;
      // Structs are in clock order, so walk back from the newest.
      for (let index = structs.length - 1; index >= 0; index--) {
        const struct = structs.at(index);
        if (!struct || struct.id.clock + struct.length <= from) break;
        if (
          struct instanceof Y.Item &&
          struct.countable &&
          !struct.deleted &&
          struct.parentSub === null
        )
          typed.push(struct);
      }
    }
    return typed;
  }

  /** Hands typing on the saved copy over, if there is any; then stops looking. */
  private releaseTypingOnLocalCopy(
    reason: DisplacedCollabEdits["reason"],
  ): void {
    if (this.typedOnLocalCopy().length > 0) {
      this.handOffDisplacedTyping(Y.encodeStateAsUpdate(this.ydoc), reason);
    }
    this.typingBaseline = null;
  }

  private handOffDisplacedTyping(
    state: Uint8Array,
    reason: DisplacedCollabEdits["reason"],
  ): void {
    const queue = displacedTyping.get(this.registryKey) ?? [];
    queue.push({ state, reason });
    displacedTyping.set(this.registryKey, queue);
    this.deliverDisplacedTyping();
  }

  /** Gives displaced typing to the newest subscriber that keeps it. */
  private deliverDisplacedTyping(): void {
    const queue = displacedTyping.get(this.registryKey);
    if (!queue) return;
    const keep = Array.from(this.subscribers.values())
      .reverse()
      .find((sub) => sub.onLocalCopyEditsDisplaced)?.onLocalCopyEditsDisplaced;
    if (!keep) return;
    displacedTyping.delete(this.registryKey);
    for (const edits of queue) {
      try {
        keep(edits);
      } catch (error) {
        console.error("Displaced typing could not be kept", error);
      }
    }
  }

  /**
   * Gives this doc up for a new connection that reads the server's state from
   * scratch: a doc opened from a saved copy can never drop what the copy put
   * in it. Edits made on it since go with it, since the server could not take
   * them on top of state it does not have; typing among them is handed over
   * first.
   */
  private supersede(warning?: string): void {
    if (warning) console.warn(warning);
    this.releaseTypingOnLocalCopy("superseded");
    rejectedLocalCopies.add(this.registryKey);
    this.forgetLocalCopy();
    this.localCopyRejected = true;
    this.awaitingServerState = false;
    if (this.serverStateRetryTimer) {
      clearTimeout(this.serverStateRetryTimer);
      this.serverStateRetryTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.updateAbortController?.abort();
    this.pendingUpdates = [];
    this.storeUnsentUpdates();
    this.detachUpdateHandler();
    this.stopSync();
    if (collabConnectionRegistry.get(this.registryKey) === this) {
      collabConnectionRegistry.delete(this.registryKey);
    }
    this.setSnapshot({
      isLoading: true,
      isSynced: false,
      fromLocalCopy: false,
      superseded: true,
      initialization: { status: "loading" },
    });
  }

  private scheduleLocalCopySave = (): void => {
    if (!this.keepsLocalCopy || this.disposed || this.localCopyRejected) return;
    if (this.localCopySaveTimer) clearTimeout(this.localCopySaveTimer);
    this.localCopySaveTimer = setTimeout(() => {
      this.localCopySaveTimer = null;
      if (this.saveLocalCopy()) return;
      // Edits on their way to the server: save once they are acknowledged.
      if (
        this.updateInFlight ||
        (this.pendingUpdates.length > 0 &&
          this.updateErrors === 0 &&
          !this.snapshot.updatesRefused)
      )
        this.scheduleLocalCopySave();
    }, LOCAL_COPY_SAVE_DELAY_MS);
  };

  /**
   * Saves the doc's state as this browser's copy, only while the server holds
   * all of it: synced, and none of this tab's edits waiting for an
   * acknowledgment.
   */
  private saveLocalCopy(): boolean {
    if (
      !this.keepsLocalCopy ||
      this.localCopyRejected ||
      this.disposed ||
      this.signedOut ||
      this.docMissing ||
      !this.actorIdentity ||
      !this.serverStateReady ||
      !this.snapshot.isSynced ||
      this.pendingUpdates.length > 0 ||
      this.updateInFlight ||
      this.snapshot.updatesRefused
    )
      return false;
    saveCollabLocalCopy(
      this.actorIdentity,
      collabLocalCopyKey(this.baseUrl, this.docId),
      Y.encodeStateAsUpdate(this.ydoc),
    );
    return true;
  }

  private takeActivityBaseline(value: unknown): void {
    const baseline = value as
      | { status?: unknown; version?: unknown; cursor?: unknown }
      | undefined;
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
  }

  private startTransport(): void {
    if (this.disposed || this.subscribers.size === 0) return;
    this.attachUpdateHandler();
    this.startSync();

    if (this.unsubscribeAwarenessEvents) return;
    this.unsubscribeAwarenessEvents = subscribeSyncEvents({
      onEvents: (events) => {
        if (this.disposed) return;
        for (const data of events) this.applyAwarenessEvent(data);
      },
    });
  }

  private fetchInitialState(
    response: Promise<Response> = fetch(`${this.baseUrl}/${this.docId}/state`, {
      headers: { "X-Agent-Native-Poll-Baseline": "1" },
    }),
  ): void {
    response.then(
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
        this.takeActivityBaseline(data.activityBaseline);
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
            for (const item of this.pendingUpdates) {
              Y.applyUpdate(this.ydoc, item.update, "remote");
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
        this.scheduleLocalCopySave();
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
    // What a saved copy put in this doc stays in it, so a doc opened from one
    // the server never confirmed starts again from the server's state alone.
    if (this.localCopyVector && !this.localCopyVerified) {
      this.supersede();
      return;
    }
    this.retryInitialization();
  };

  requestSync = (): Promise<CollaborativeDocSyncResult> => {
    if (
      this.awaitingServerState &&
      !this.disposed &&
      this.subscribers.size > 0
    ) {
      return this.requestServerState();
    }
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
      // Edits on a saved copy go out only once the server's state covers it.
      if (this.awaitingServerState) {
        await this.requestServerState();
        if (!this.serverStateReady || this.localCopyRejected) return false;
        continue;
      }
      if (this.updateInFlight) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      const strictDeliveryVersion = this.strictDeliveryVersion;
      await this.flushPendingUpdates();
      if (this.snapshot.updatesRefused) return false;
      if (
        this.updateErrors > 0 &&
        (strictDeliveryVersion === this.strictDeliveryVersion ||
          !this.pendingUpdates.some((item) => !item.requireLiveCopyOutcome))
      )
        return false;
    }
    return this.pendingUpdates.length === 0;
  };

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === "remote") return;
    this.enqueueUpdate(update, this.hasStrictSubscriber);
  };

  private enqueueUpdate(
    update: Uint8Array,
    requireLiveCopyOutcome: boolean,
  ): void {
    this.pendingUpdates.push({ update, requireLiveCopyOutcome });
    this.storeUnsentUpdates();
    if (this.updateErrors && this.flushTimer) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPendingUpdates();
    }, UPDATE_DEBOUNCE_MS);
  }

  private handlePageHide = (): void => {
    this.saveLocalCopy();
    void this.flushPendingUpdates(true);
    this.pageHidden = true;
    void this.clearPresence()?.catch(() => {});
  };

  private handlePageShow = (): void => {
    if (!this.pageHidden || this.disposed || this.signedOut) return;
    this.pageHidden = false;
    // BFCache must retain the doc's sequence/token until it is retired.
    this.presenceClear = null;
    this.publishVisibility(!isDocumentHidden());
    this.pollNow();
  };

  // A tab that comes back online sends what it kept without waiting out the
  // retry backoff it built up while offline.
  private handleOnline = (): void => {
    if (this.awaitingServerState) void this.requestServerState();
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
      window.addEventListener("pageshow", this.handlePageShow);
    }
  }

  private detachUpdateHandler(): void {
    if (!this.updateHandlerAttached) return;
    this.updateHandlerAttached = false;
    this.ydoc.off("update", this.handleDocUpdate);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handlePageHide);
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("pageshow", this.handlePageShow);
    }
  }

  private async flushPendingUpdates(keepalive = false): Promise<void> {
    // They wait for the server's state to cover the saved copy they build on.
    if (this.awaitingServerState) return;
    if (
      this.snapshot.updatesRefused ||
      (!keepalive &&
        (this.disposed ||
          this.updateInFlight ||
          (this.updateErrors > 0 && this.flushTimer !== null)))
    )
      return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingUpdates.length === 0) return;
    const ordinary = this.pendingUpdates.filter(
      (item) => !item.requireLiveCopyOutcome,
    );
    // Ordinary successors may depend on retained strict bytes. Transport
    // acceptance does not release those bytes' outcome custody.
    const predecessors = ordinary.length
      ? this.pendingUpdates.filter(
          (item) =>
            item.requireLiveCopyOutcome && !this.deliveredUpdates.has(item),
        )
      : [];
    const toSend = (
      predecessors.length
        ? predecessors
        : ordinary.length
          ? ordinary
          : this.pendingUpdates
    ).slice(0, this.updateBatchLimit);
    if (
      keepalive &&
      [...this.keepaliveSnapshots].some((snapshot) =>
        toSend.every((item) => snapshot.includes(item)),
      )
    )
      return;
    if (keepalive) this.keepaliveSnapshots.add(toSend);
    const retiredKey = this.retiredUpdatesKey;
    const merged = Y.mergeUpdates(toSend.map((item) => item.update));
    const controller = new AbortController();
    if (!keepalive) {
      this.updateInFlight = true;
      this.updateAbortController = controller;
    }
    const timeout = setTimeout(
      () => controller.abort(),
      STATE_VECTOR_FETCH_TIMEOUT_MS,
    );
    const userGeneration = this.userGeneration;
    const requireLiveCopyOutcome = toSend.some(
      (item) => item.requireLiveCopyOutcome,
    );
    const acknowledgedOwners = new Set<CollabDocSubscription>();
    const ordinaryReceiptOwners = Array.from(this.subscribers.values()).filter(
      (sub) => !sub.requireLiveCopyOutcome(),
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
      if (this.keepsUnsentUpdates && response.status === 413) {
        if (userGeneration !== this.userGeneration) return;
        if (
          !toSend.some(
            (item) =>
              this.pendingUpdates.includes(item) &&
              !this.deliveredUpdates.has(item),
          )
        )
          return;
        if (toSend.length > 1) {
          this.updateBatchLimit = Math.ceil(toSend.length / 2);
        } else {
          this.setSnapshot({ updatesRefused: true });
        }
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (userGeneration !== this.userGeneration) return;
      for (const item of toSend) {
        if (!this.deliveredUpdates.has(item)) {
          this.deliveredUpdates.add(item);
          if (item.requireLiveCopyOutcome) this.strictDeliveryVersion++;
        }
      }
      const parsedAck =
        requireLiveCopyOutcome ||
        Array.from(this.subscribers.values()).some(
          (sub) =>
            sub.onUpdateAcknowledged !== undefined && sub.canAcknowledge(),
        )
          ? readUpdateAck(await response.json())
          : null;
      if (userGeneration !== this.userGeneration) return;
      if (requireLiveCopyOutcome) {
        if (!parsedAck?.liveCopy)
          throw new Error(
            "The collab update response omitted its live-copy outcome.",
          );
        for (const sub of this.subscribers.values()) {
          if (this.disposed || userGeneration !== this.userGeneration) break;
          if (
            sub.requireLiveCopyOutcome() &&
            sub.canAcknowledge() &&
            sub.onUpdateAcknowledged
          ) {
            sub.onUpdateAcknowledged(parsedAck);
            acknowledgedOwners.add(sub);
          }
        }
        if (acknowledgedOwners.size === 0)
          throw new Error(
            "The live-copy acknowledgment has no current strict subscriber.",
          );
      }
      ack = parsedAck;
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
      if (userGeneration === this.userGeneration) this.updateErrors++;
    } finally {
      if (keepalive) this.keepaliveSnapshots.delete(toSend);
      clearTimeout(timeout);
      let online = false;
      if (!keepalive) {
        this.updateInFlight = false;
        this.updateAbortController = null;
        online = this.onlineDuringUpdate;
        this.onlineDuringUpdate = false;
      }
      this.schedulePendingFlush(online);
    }
    // Ordinary receipts keep nullable-ACK compatibility. Strict owners have
    // already handled their outcome before its pending bytes were removed.
    if (ack && !this.disposed && userGeneration === this.userGeneration) {
      const receiptOwners = [
        ...ordinaryReceiptOwners.filter((sub) => !sub.requireLiveCopyOutcome()),
        ...Array.from(this.subscribers.values()).filter((sub) =>
          sub.requireLiveCopyOutcome(),
        ),
      ];
      for (const sub of receiptOwners) {
        if (
          userGeneration === this.userGeneration &&
          !acknowledgedOwners.has(sub) &&
          sub.canAcknowledge() &&
          (!sub.requireLiveCopyOutcome() || ack.liveCopy !== null)
        )
          sub.onUpdateAcknowledged?.(ack);
      }
    }
  }

  private schedulePendingFlush(online: boolean): void {
    if (
      this.disposed ||
      this.snapshot.updatesRefused ||
      this.pendingUpdates.length === 0 ||
      this.flushTimer
    )
      return;
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

  private startSync(): void {
    if (
      this.syncActive ||
      this.signedOut ||
      this.docMissing ||
      this.disposed ||
      this.subscribers.size === 0
    ) {
      return;
    }
    this.syncActive = true;
    const pollGeneration = ++this.pollGeneration;

    this.subscribeCollabEvents();

    if (!this.effectivePauseWhenHidden || !isDocumentHidden()) {
      void this.poll(pollGeneration);
    }
    window.addEventListener("focus", this.handleFocus);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private stopSync(): void {
    if (!this.syncActive) return;
    this.syncActive = false;
    this.pollGeneration++;
    this.pollRequested.clear();
    this.setCollabPollBoost(false);
    this.sseActive = false;
    this.sseAwarenessCovered = false;
    this.ssePollLive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.unsubscribeCollabEvents?.();
    this.unsubscribeCollabEvents = null;
    this.unsubscribeAwarenessEvents?.();
    this.unsubscribeAwarenessEvents = null;
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
    if (change.source !== "collab") {
      for (const sub of this.subscribers.values()) sub.onEvent(change);
    }
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

  private isPollCurrent(generation: number): boolean {
    return (
      generation === this.pollGeneration &&
      this.syncActive &&
      !this.disposed &&
      this.subscribers.size > 0
    );
  }

  private schedulePoll(
    generation: number,
    delay = this.getActivePollInterval(),
  ): void {
    if (!this.isPollCurrent(generation)) return;
    if (this.effectivePauseWhenHidden && isDocumentHidden()) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const timer = setTimeout(() => {
      if (this.pollTimer === timer) this.pollTimer = null;
      if (!this.isPollCurrent(generation)) return;
      void this.poll(generation);
    }, delay);
    this.pollTimer = timer;
  }

  private reschedulePoll(): void {
    if (this.pollTimer === null) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.schedulePoll(this.pollGeneration);
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

  private async poll(generation: number): Promise<void> {
    if (!this.isPollCurrent(generation)) return;
    if (this.pollInFlight.has(generation)) {
      this.pollRequested.add(generation);
      return;
    }
    this.pollInFlight.add(generation);
    try {
      await this.pollOnce(generation);
    } finally {
      this.pollInFlight.delete(generation);
    }
    if (this.pollRequested.delete(generation)) {
      if (this.isPollCurrent(generation)) this.pollNow();
    }
  }

  private async pollOnce(generation: number): Promise<void> {
    if (!this.isPollCurrent(generation)) return;

    this.flushPendingUpdates();

    const pollAbort = new AbortController();
    const pollTimeout = setTimeout(
      () => pollAbort.abort(),
      POLL_FETCH_TIMEOUT_MS,
    );
    try {
      const pollUrl = this.pollCursor
        ? `/_agent-native/poll?cursor=${encodeURIComponent(this.pollCursor)}`
        : `/_agent-native/poll?since=${this.pollVersion}`;
      const res = await fetch(agentNativePath(pollUrl), {
        signal: pollAbort.signal,
      });
      if (!this.isPollCurrent(generation)) return;
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      if (!this.isPollCurrent(generation)) return;
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
        if (evt.source !== "collab") {
          for (const sub of this.subscribers.values()) sub.onEvent(evt);
        }
        if (evt.source === "collab" && evt.docId === this.docId && evt.update) {
          if (this.requestSource && evt.requestSource === this.requestSource) {
            continue;
          }
          try {
            Y.applyUpdate(this.ydoc, base64ToUint8Array(evt.update), "remote");
          } catch {
            await this.fetchStateVector();
            if (!this.isPollCurrent(generation)) return;
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
        if (!this.isPollCurrent(generation)) return;
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
        if (!this.isPollCurrent(generation)) return;
      }

      if (!this.isPollCurrent(generation)) return;
      const localState = this.awareness.getLocalState();
      if (
        localState &&
        this.canPublishPresence &&
        this.isPollCurrent(generation)
      ) {
        try {
          const awarenessRes = await postAwarenessState(
            this.baseUrl,
            this.docId,
            this.ydoc.clientID,
            localState,
          );
          if (!this.isPollCurrent(generation)) return;
          if (awarenessRes.ok) {
            const awarenessData = await awarenessRes.json();
            if (!this.isPollCurrent(generation)) return;
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
            if (!this.isPollCurrent(generation)) return;
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
      if (!this.isPollCurrent(generation)) return;
      this.consecutiveErrors++;
      const backoff = calcBackoff(this.consecutiveErrors);
      this.schedulePoll(generation, backoff);
      return;
    } finally {
      clearTimeout(pollTimeout);
    }

    this.schedulePoll(generation);
  }

  private pollNow(): void {
    if (!this.syncActive || this.disposed) return;
    if (this.effectivePauseWhenHidden && isDocumentHidden()) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    void this.poll(this.pollGeneration);
  }

  private publishVisibility(visible: boolean): void {
    if (!this.canPublishPresence || !this.awareness.getLocalState()) return;
    this.awareness.setLocalStateField("visible", visible);
    const localState = this.awareness.getLocalState();
    if (!localState) return;
    void postAwarenessState(
      this.baseUrl,
      this.docId,
      this.ydoc.clientID,
      localState,
      true,
    ).catch(() => {});
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
const retiredCollabUpdates = new Map<string, PendingCollabUpdate[]>();
// Saved copies the server's state did not cover, by registry key: not opened
// again in this page, even if deleting them from storage failed.
const rejectedLocalCopies = new Set<string>();
// Typing the server's state displaced, by registry key, until a subscriber
// that keeps it is attached.
const displacedTyping = new Map<string, DisplacedCollabEdits[]>();

const SIGN_OUT_LOCAL_COPY_CLEAR_MS = 2000;

// Saved copies are one account's; none survive a sign-out.
registerBeforeSignOutCleanup(async () => {
  dropCollabStatePrefetches();
  rejectedLocalCopies.clear();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      clearCollabLocalCopies(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Clearing saved page copies timed out")),
          SIGN_OUT_LOCAL_COPY_CLEAR_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
});

registerBeforeSignOutCleanup(async () => {
  const results = await Promise.allSettled(
    Array.from(new Set(collabConnectionRegistry.values()), (connection) =>
      connection.clearPresenceBeforeSignOut(),
    ),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) {
    throw new AggregateError(
      failures,
      "Some collaboration presence could not be cleared before sign-out",
    );
  }
});

function collabRegistryKey(
  docId: string,
  baseUrl: string,
  actorIdentity: string,
): string {
  return `${baseUrl}\0${docId}\0${actorIdentity}`;
}

function getOrCreateCollabConnection(
  docId: string,
  baseUrl: string,
  actorIdentity: string,
): CollabDocConnection {
  const key = collabRegistryKey(docId, baseUrl, actorIdentity);
  let conn = collabConnectionRegistry.get(key);
  if (!conn && actorIdentity) {
    const anonymousKey = collabRegistryKey(docId, baseUrl, "");
    const anonymous = collabConnectionRegistry.get(anonymousKey);
    if (anonymous && !anonymous.disposed) {
      anonymous.bindActorIdentity(actorIdentity);
      conn = collabConnectionRegistry.get(key);
    }
  }
  if (!conn || conn.disposed) {
    conn = new CollabDocConnection(docId, baseUrl, actorIdentity);
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
  rejectedLocalCopies.clear();
  displacedTyping.clear();
  dropCollabStatePrefetches();
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
    localCopy,
    requireLiveCopyOutcome = false,
    onUpdateAcknowledged,
    onEvent,
  } = options;
  const onUpdateAcknowledgedRef = useRef(onUpdateAcknowledged);
  onUpdateAcknowledgedRef.current = onUpdateAcknowledged;
  const requireLiveCopyOutcomeRef = useRef(requireLiveCopyOutcome);
  requireLiveCopyOutcomeRef.current = requireLiveCopyOutcome;
  const wantsAcks = onUpdateAcknowledged !== undefined;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const keepsLocalCopy = localCopy !== undefined;
  const onEditsDisplacedRef = useRef(localCopy?.onEditsDisplaced);
  onEditsDisplacedRef.current = localCopy?.onEditsDisplaced;
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
  const actorIdentity = resolvedUser?.email.trim().toLowerCase() ?? "";
  const [hasSeenAuthenticatedActor, setHasSeenAuthenticatedActor] = useState(
    () => Boolean(actorIdentity),
  );
  if (actorIdentity && !hasSeenAuthenticatedActor) {
    setHasSeenAuthenticatedActor(true);
  }
  const signedOutAfterAuthentication =
    !actorIdentity && hasSeenAuthenticatedActor;

  const [generation, setGeneration] = useState(0);

  const conn = useMemo(() => {
    void generation;
    if (!docId || signedOutAfterAuthentication) return null;
    if (typeof window === "undefined") {
      return new CollabDocConnection(docId, baseUrl, actorIdentity, true);
    }
    return getOrCreateCollabConnection(docId, baseUrl, actorIdentity);
  }, [docId, baseUrl, actorIdentity, generation, signedOutAfterAuthentication]);
  const previousActorConnection = useRef({ actorIdentity, conn });

  const acknowledgementScope = useMemo(
    () => ({ conn, email: resolvedUser?.email }),
    [conn, resolvedUser?.email],
  );
  const activeAcknowledgementScope = useRef(acknowledgementScope);
  activeAcknowledgementScope.current = acknowledgementScope;

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
    conn.add(
      id,
      {
        pollInterval,
        pollIntervalWithSse,
        pauseWhenHidden,
        ...(requestSource !== undefined ? { requestSource } : {}),
        durableUpdates,
        localCopy: keepsLocalCopy,
        ...(keepsLocalCopy
          ? {
              onLocalCopyEditsDisplaced: (edits: DisplacedCollabEdits) =>
                onEditsDisplacedRef.current?.(edits),
            }
          : {}),
        requireLiveCopyOutcome: () =>
          activeAcknowledgementScope.current === acknowledgementScope &&
          requireLiveCopyOutcomeRef.current,
        canAcknowledge: () =>
          activeAcknowledgementScope.current === acknowledgementScope &&
          onUpdateAcknowledgedRef.current !== undefined,
        ...(wantsAcks
          ? {
              onUpdateAcknowledged: (ack: CollabUpdateAck) => {
                if (activeAcknowledgementScope.current === acknowledgementScope)
                  onUpdateAcknowledgedRef.current?.(ack);
              },
            }
          : {}),
        onSnapshot: setSnapshot,
        onEvent: (event) => onEventRef.current?.(event),
      },
      resolvedUser,
    );
    setSnapshot(conn.snapshot);
    return () => {
      conn.remove(id);
    };
  }, [
    conn,
    pollInterval,
    pollIntervalWithSse,
    pauseWhenHidden,
    requestSource,
    durableUpdates,
    keepsLocalCopy,
    requireLiveCopyOutcome,
    wantsAcks,
    wantsAcks ? acknowledgementScope : null,
  ]);

  // A connection that gave its doc up is replaced by a fresh one.
  const superseded = snapshot.superseded;
  useEffect(() => {
    if (superseded) setGeneration((current) => current + 1);
  }, [superseded]);

  useEffect(() => {
    if (!conn || conn.detached || !resolvedUser) return;
    conn.setUser(resolvedUser);
  }, [conn, resolvedUser]);

  useEffect(() => {
    const previous = previousActorConnection.current;
    if (previous.actorIdentity && !actorIdentity) {
      void previous.conn?.clearPresenceBeforeSignOut().catch((error) => {
        console.error(
          "Unable to clear collaboration presence on sign-out",
          error,
        );
      });
    }
    previousActorConnection.current = { actorIdentity, conn };
  }, [actorIdentity, conn]);

  return {
    ydoc: conn && snapshot.initialization.status === "ready" ? conn.ydoc : null,
    awareness:
      conn && snapshot.initialization.status === "ready"
        ? conn.awareness
        : null,
    isLoading: snapshot.isLoading,
    isSynced: snapshot.isSynced,
    fromLocalCopy: snapshot.fromLocalCopy,
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
    durableUpdatesFailed: snapshot.durableUpdatesFailed,
    updatesRefused: snapshot.updatesRefused,
    activeUsers: snapshot.activeUsers,
    agentActive: snapshot.agentActive,
    agentPresent: snapshot.agentPresent,
  };
}
