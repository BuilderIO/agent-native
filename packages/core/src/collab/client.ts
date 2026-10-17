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
   * email scopes what is kept. When that email changes, even in case only,
   * the doc starts over from the server's copy: `ydoc` is null until the new
   * doc loads, and a different doc after.
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
   * place of the refused ones, or `failed` when storage refuses it. Once `rebuilt`, `ydoc` and `awareness` are
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
// so unlike an unsent update it is not idempotent: two candidates made from
// one edit put it in twice.
const REBUILD_CANDIDATE_MARK = "rebuild:";
// A connection writes its entries only while it holds the Web Lock named for
// it, and another adopts them only while holding that lock, so never from a
// tab that is still open with them: two open tabs refused with the same edit
// would each keep a candidate for it.
const OUTBOX_OWNER_LOCK_PREFIX = "agent-native-collab-outbox-owner:";

function outboxPrefix(docKey: string, email: string): string {
  return `${OUTBOX_PREFIX}${encodeURIComponent(docKey)}:${encodeURIComponent(email)}:`;
}

function webLocks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

interface StoredOutbox {
  key: string;
  raw: string;
}

// A candidate names the entries it was made from, in the one write that
// stores it. It holds their content under another client id, so a page that
// opens skips an entry a stored candidate names rather than apply that
// content twice.
interface StoredCandidate {
  replaces: Array<[key: string, digest: string]>;
  update: string;
}

function readStoredCandidate(raw: string): StoredCandidate {
  const candidate = JSON.parse(raw) as Partial<StoredCandidate> | null;
  if (
    typeof candidate?.update !== "string" ||
    !Array.isArray(candidate.replaces) ||
    !candidate.replaces.every(
      (entry) =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string",
    )
  ) {
    throw new Error("Unreadable rebuild candidate");
  }
  return candidate as StoredCandidate;
}

// A candidate replaces the bytes it was made from, not whatever its key
// holds later: without Web Locks the tab that kept them may still be open,
// and what it writes after is content no candidate holds.
function entryDigest(raw: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${raw.length}:${(h2 >>> 0).toString(36)}:${(h1 >>> 0).toString(36)}`;
}

function readStoredEntry(key: string): StoredOutbox | null {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : { key, raw };
}

// The candidates under `prefix` by key, with `stored` null for one that
// cannot be read.
function readStoredCandidates(
  prefix: string,
): Map<string, { raw: string; stored: StoredCandidate | null }> {
  const storage = window.localStorage;
  const candidates = new Map<
    string,
    { raw: string; stored: StoredCandidate | null }
  >();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix + REBUILD_CANDIDATE_MARK)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    let stored: StoredCandidate | null = null;
    try {
      stored = readStoredCandidate(raw);
    } catch {
      // coercion-ok: null marks it unreadable, which its own adoption
      // reports; it replaces nothing meanwhile.
    }
    candidates.set(key, { raw, stored });
  }
  return candidates;
}

interface HeldSource {
  entries: StoredOutbox[];
  release: () => void;
  covering: Set<Uint8Array>;
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
  // The refused connection this one was rebuilt from, whose entries it never
  // adopts: what that one kept is what this one sends.
  private rebuiltFromOwner: string | null = null;
  private restoreAfterRebuild = false;
  private replaced = false;
  private rebuildInFlight: Promise<CollabRebuildResult> | null = null;
  // Held only while this connection keeps something, so an idle tab holds no
  // lock that keeps a browser from freezing or caching it.
  private ownerLock: Promise<void> | null = null;
  private releaseOwnerLock: (() => void) | null = null;
  private ownsKeys = false;
  private ownerLockPins = 0;
  // This connection's entries in storage, by key.
  private readonly storedEntries = new Map<string, string>();
  // Set when an account change replaces this doc. Its queue was emptied, not
  // acknowledged, so a reply that arrives after must leave its entries to
  // that account rather than clear them as sent.
  private leftToAccount = false;
  // Other connections' entries this doc applied, by owner, with what lets go
  // of that owner's lock and the unsent updates that carry their content.
  // Held until the server acknowledges those updates or a candidate of this
  // doc replaces them, so no other page adopts the same edits meanwhile. A
  // candidate comes after the entries it replaces, and is removed after them.
  private readonly heldSources = new Map<string, HeldSource>();
  private adoptionAbort: AbortController | null = null;
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
    this.adoptionAbort?.abort();
    this.adoptionAbort = null;
    this.releaseHeldSources();
    this.releaseOwnerLock?.();
    this.releaseOwnerLock = null;
    this.ownsKeys = false;
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

  // Refused updates a kept candidate replaces are held back for good, so
  // retired they would only be sent again beside it.
  private retirePendingUpdates(): void {
    if (
      this.pendingUpdates.length &&
      this.retiredUpdatesKey &&
      !(this.snapshot.updatesRefused && this.keepsUnsentUpdates)
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
    if (!this.keepsUnsentUpdates || this.leftToAccount) return;
    this.writeUnsentUpdates();
    this.retireAcknowledgedSources();
  }

  private writeUnsentUpdates(): void {
    if (this.snapshot.updatesRefused) return;
    const scope = this.outboxScope;
    if (!scope) return;
    if (this.pendingUpdates.length === 0) {
      this.removeStoredKey(scope.key);
      return;
    }
    // Kept once the lock is held, which stores them then.
    if (!this.ownsKeys) {
      void this.holdOwnerLock();
      if (!this.ownsKeys) return;
    }
    try {
      const raw = uint8ArrayToBase64(
        this.pendingUpdates.length === 1
          ? this.pendingUpdates[0]
          : Y.mergeUpdates(this.pendingUpdates),
      );
      window.localStorage.setItem(scope.key, raw);
      this.storedEntries.set(scope.key, raw);
    } catch {
      this.markDurableUpdatesFailed();
    }
  }

  private removeStoredKey(key: string): void {
    try {
      window.localStorage.removeItem(key);
      this.storedEntries.delete(key);
    } catch {
      this.markDurableUpdatesFailed();
    }
    this.releaseOwnerLockIfIdle();
  }

  // Replaces the candidate this connection keeps; call only while it holds
  // its owner lock. False, with storage as it was, when it could not be kept.
  private keepCandidate(update: Uint8Array): boolean {
    if (!this.keepsUnsentUpdates) return true;
    const scope = this.outboxScope;
    if (!scope) return true;
    const own = this.storedEntries.get(scope.key);
    const replaced = Array.from(
      this.heldSources.values(),
      ({ entries }) => entries,
    ).flat();
    if (own !== undefined) replaced.push({ key: scope.key, raw: own });
    const stored: StoredCandidate = {
      replaces: replaced.map(({ key, raw }) => [key, entryDigest(raw)]),
      update: uint8ArrayToBase64(update),
    };
    const raw = JSON.stringify(stored);
    try {
      window.localStorage.setItem(scope.candidateKey, raw);
      this.storedEntries.set(scope.candidateKey, raw);
    } catch {
      this.markDurableUpdatesFailed();
      return false;
    }
    // A candidate holds this doc's whole content.
    this.retireHeldSources(() => true);
    if (own !== undefined) this.removeStoredKey(scope.key);
    return true;
  }

  // Removes the held entries `covered` says are kept elsewhere, each owner's
  // in order, then lets go of that owner's lock.
  private retireHeldSources(covered: (source: HeldSource) => boolean): void {
    for (const [owner, source] of this.heldSources) {
      if (!covered(source)) continue;
      if (!source.entries.every((entry) => this.removeIfUnchanged(entry))) {
        continue;
      }
      this.heldSources.delete(owner);
      source.release();
    }
  }

  // Held entries whose content the server has acknowledged are removed.
  private retireAcknowledgedSources(): void {
    this.retireHeldSources(
      ({ covering }) =>
        !this.pendingUpdates.some((update) => covering.has(update)),
    );
  }

  // The entries stay, for the next page that opens the doc.
  private releaseHeldSources(): void {
    for (const { release } of this.heldSources.values()) release();
    this.heldSources.clear();
  }

  /** Resolves once this connection may write under its own keys. */
  private holdOwnerLock(): Promise<void> {
    if (this.ownerLock) return this.ownerLock;
    const locks = webLocks();
    if (!locks || this.disposed) {
      this.ownsKeys = !this.disposed;
      this.ownerLock = Promise.resolve();
      return this.ownerLock;
    }
    this.ownerLock = new Promise<void>((held) => {
      locks
        .request(
          OUTBOX_OWNER_LOCK_PREFIX + this.outboxOwnerId,
          () =>
            new Promise<void>((release) => {
              held();
              if (this.disposed) {
                release();
                return;
              }
              this.releaseOwnerLock = release;
              this.ownsKeys = true;
              this.storeUnsentUpdates();
              this.releaseOwnerLockIfIdle();
            }),
        )
        // coercion-ok: a browser that refuses the lock keeps this tab's
        // entries as one without Web Locks does, and another tab may adopt
        // them while this one is open.
        .catch(() => {
          held();
          if (this.disposed) return;
          this.ownsKeys = true;
          this.storeUnsentUpdates();
        });
    });
    return this.ownerLock;
  }

  private releaseOwnerLockIfIdle(): void {
    if (
      !this.releaseOwnerLock ||
      this.ownerLockPins > 0 ||
      this.storedEntries.size > 0 ||
      this.pendingUpdates.length > 0 ||
      this.snapshot.updatesRefused
    ) {
      return;
    }
    const release = this.releaseOwnerLock;
    this.releaseOwnerLock = null;
    this.ownerLock = null;
    this.ownsKeys = false;
    release();
  }

  private async withOwnerLock<T>(write: () => T): Promise<T> {
    if (!this.keepsUnsentUpdates) return write();
    this.ownerLockPins++;
    try {
      await this.holdOwnerLock();
      return write();
    } finally {
      this.ownerLockPins--;
      this.releaseOwnerLockIfIdle();
    }
  }

  /**
   * Sends what other connections for this doc and user kept: a tab that
   * closed or reloaded before its updates were acknowledged. Applying them
   * queues what the doc lacks as this connection's own unsent updates; the
   * other entry stays, held with its lock, until the server acknowledges them
   * or a candidate replaces it. Each connection's entries are adopted
   * while holding its lock, so for a tab that is still open with them, once
   * it closes; until then it sends them itself. A refused connection adopts
   * nothing; the one rebuilt from it does.
   */
  private restoreUnsentUpdates(): void {
    if (
      this.unsentUpdatesRestored ||
      this.restoreAfterRebuild ||
      !this.keepsUnsentUpdates ||
      !this.updateHandlerAttached ||
      this.disposed
    ) {
      return;
    }
    const scope = this.outboxScope;
    if (!scope) return;
    this.unsentUpdatesRestored = true;
    const owners = this.readStoredOwners(scope.prefix);
    if (!owners) return;
    const locks = webLocks();
    if (!locks) {
      // An open tab's entries are adopted too, so its edits are sent twice,
      // which changes nothing, and two refused tabs can each keep a
      // candidate for one edit.
      for (const owner of owners) {
        const kept = this.adoptOwnerEntries(scope.prefix, owner);
        if (kept.length) this.holdSource(owner, kept, () => {});
      }
      return;
    }
    const signal = (this.adoptionAbort ??= new AbortController()).signal;
    for (const owner of owners) {
      locks
        .request(OUTBOX_OWNER_LOCK_PREFIX + owner, { signal }, () =>
          this.adoptFromHeldOwner(scope.prefix, owner),
        )
        .catch(() => {
          // Aborted when this connection closes first.
          if (!signal.aborted) this.markDurableUpdatesFailed();
        });
    }
  }

  private mayAdopt(prefix: string): boolean {
    return (
      !this.disposed &&
      !this.replaced &&
      !this.snapshot.updatesRefused &&
      this.outboxScope?.prefix === prefix
    );
  }

  private async adoptFromHeldOwner(
    prefix: string,
    owner: string,
  ): Promise<void> {
    // Adopting writes this connection's own entry, so its lock is asked for
    // only once there is something to adopt.
    const entries = this.mayAdopt(prefix)
      ? this.readOwnerEntries(prefix, owner)
      : null;
    if (!entries?.ordinary && !entries?.candidate) return;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await this.withOwnerLock(() => {
      const kept = this.mayAdopt(prefix)
        ? this.adoptOwnerEntries(prefix, owner)
        : [];
      if (kept.length) this.holdSource(owner, kept, release);
      else release();
    });
    await held;
  }

  // Applying the entries queued what this doc lacked; with nothing queued,
  // the server holds what they do once the updates already queued are sent.
  private holdSource(
    owner: string,
    entries: StoredOutbox[],
    release: () => void,
  ): void {
    this.heldSources.set(owner, {
      entries,
      release,
      covering: new Set(this.pendingUpdates),
    });
    this.retireAcknowledgedSources();
  }

  /** The other connections with entries under `prefix`. */
  private readStoredOwners(prefix: string): Set<string> | null {
    const owners = new Set<string>();
    try {
      const storage = window.localStorage;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const owner = rest.startsWith(REBUILD_CANDIDATE_MARK)
          ? rest.slice(REBUILD_CANDIDATE_MARK.length)
          : rest;
        if (
          owner &&
          owner !== this.outboxOwnerId &&
          owner !== this.rebuiltFromOwner &&
          !this.heldSources.has(owner)
        ) {
          owners.add(owner);
        }
      }
    } catch {
      this.markDurableUpdatesFailed();
      return null;
    }
    return owners;
  }

  private readOwnerEntries(
    prefix: string,
    owner: string,
  ): { ordinary: StoredOutbox | null; candidate: StoredOutbox | null } | null {
    try {
      return {
        ordinary: readStoredEntry(prefix + owner),
        candidate: readStoredEntry(prefix + REBUILD_CANDIDATE_MARK + owner),
      };
    } catch {
      this.markDurableUpdatesFailed();
      return null;
    }
  }

  // Returns the entries left in storage whose content this doc now holds, a
  // candidate after the ones it replaces. An entry a stored candidate
  // replaces is left to the page that adopts that candidate, which removes
  // it first; so the candidates are read before the entries, and an entry
  // read after its candidate is gone is gone too.
  private adoptOwnerEntries(prefix: string, owner: string): StoredOutbox[] {
    const candidateKey = prefix + REBUILD_CANDIDATE_MARK + owner;
    let candidates: Map<
      string,
      { raw: string; stored: StoredCandidate | null }
    >;
    let ordinary: StoredOutbox | null;
    let replaces: StoredOutbox[];
    try {
      candidates = readStoredCandidates(prefix);
      ordinary = readStoredEntry(prefix + owner);
      replaces = (candidates.get(candidateKey)?.stored?.replaces ?? []).flatMap(
        ([key, digest]) => {
          const entry = readStoredEntry(key);
          return entry && entryDigest(entry.raw) === digest ? [entry] : [];
        },
      );
    } catch {
      this.markDurableUpdatesFailed();
      return [];
    }
    const replaced = new Set<string>();
    for (const { stored } of candidates.values()) {
      for (const [key, digest] of stored?.replaces ?? []) {
        replaced.add(`${key}\0${digest}`);
      }
    }
    const adoptable = (entry: StoredOutbox | null): entry is StoredOutbox =>
      entry !== null &&
      !replaced.has(`${entry.key}\0${entryDigest(entry.raw)}`);
    const kept: StoredOutbox[] = [];
    if (
      adoptable(ordinary) &&
      this.adoptStored(ordinary, ordinary.raw) === "kept"
    ) {
      kept.push(ordinary);
    }
    const read = candidates.get(candidateKey);
    const candidate = read ? { key: candidateKey, raw: read.raw } : null;
    if (!read || !adoptable(candidate)) return kept;
    const adopted = read.stored
      ? this.adoptStored(candidate, read.stored.update)
      : this.discardUnreadable(candidate);
    return adopted === "kept" ? [...kept, ...replaces, candidate] : kept;
  }

  private adoptStored(
    entry: StoredOutbox,
    update: string,
  ): "kept" | "unreadable" {
    try {
      Y.applyUpdate(this.ydoc, base64ToUint8Array(update), OUTBOX_ORIGIN);
      return "kept";
    } catch {
      return this.discardUnreadable(entry);
    }
  }

  // An entry that cannot be applied never will be; it is reported, then
  // removed so it is not reported on every open.
  private discardUnreadable(entry: StoredOutbox): "kept" | "unreadable" {
    this.markDurableUpdatesFailed();
    return this.removeIfUnchanged(entry) ? "unreadable" : "kept";
  }

  private removeIfUnchanged(entry: StoredOutbox): boolean {
    try {
      if (window.localStorage.getItem(entry.key) === entry.raw) {
        window.localStorage.removeItem(entry.key);
      }
      return true;
    } catch {
      this.markDurableUpdatesFailed();
      return false;
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
      if (this.keepsUnsentUpdates) {
        this.replaceForAccount(user);
        return;
      }
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

  // A doc that keeps its updates starts over from the server's copy under a
  // new account: what it holds or was refused under the last one stays that
  // account's, and its queue goes back to that account, not to this session.
  private replaceForAccount(user: CollabUser): void {
    this.retirePendingUpdates();
    this.pendingUpdates = [];
    this.leftToAccount = true;
    const next = new CollabDocConnection(this.docId, this.baseUrl);
    this.replaced = true;
    collabConnectionRegistry.set(this.registryKey, next);
    for (const sub of Array.from(this.subscribers.values())) {
      sub.onReplaced?.(next);
    }
    this.dispose();
    next.setUser(user);
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
      this.replaced ||
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
    if (this.keepsUnsentUpdates) await this.holdOwnerLock();
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
      next.rebuiltFromOwner = this.outboxOwnerId;
      // Until it replaces this doc: an update it adopted first, the content
      // written onto it would remove.
      next.restoreAfterRebuild = true;
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
      } else {
        result = await next.withOwnerLock(() =>
          this.disposed || !this.snapshot.updatesRefused
            ? { status: "unavailable" as const }
            : this.commitRebuild(next, write, options),
        );
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
    if (!this.keepCandidate(update)) {
      return rebuildFailed(
        new Error("The rebuild could not be kept in storage"),
      );
    }
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
    // What this doc keeps becomes the update the new doc keeps and sends, in
    // one write, so a copy an interrupted handoff leaves repeats that doc's
    // own entry. While it cannot, this doc and what it keeps stay.
    if (
      (this.storedEntries.size > 0 || this.heldSources.size > 0) &&
      !this.keepCandidate(measured.update)
    ) {
      return rebuildFailed(
        new Error("The kept rebuild could not be replaced in storage"),
      );
    }
    try {
      options.beforeReplace?.(next.ydoc);
    } catch (error) {
      return rebuildFailed(error);
    }
    Y.applyUpdate(next.ydoc, measured.update, REBUILD_ORIGIN);
    this.handOverKept(next);
    this.pendingUpdates = [];
    this.replaced = true;
    collabConnectionRegistry.set(this.registryKey, next);
    for (const sub of Array.from(this.subscribers.values())) {
      sub.onReplaced?.(next);
    }
    next.restoreAfterRebuild = false;
    next.restoreUnsentUpdates();
    return { status: "rebuilt", ydoc: next.ydoc };
  }

  // The new doc holds what this one kept, with the locks that keep other
  // pages from adopting it, until the server acknowledges the update it
  // sends. A later candidate of the new doc then replaces this doc's, rather
  // than repeating its update under another client id beside it. Entries
  // this doc's candidate replaces but could not remove come before it.
  private handOverKept(next: CollabDocConnection): void {
    const sources = Array.from(this.heldSources.values());
    this.heldSources.clear();
    const entries = sources.flatMap((source) => source.entries);
    const candidateKey = this.outboxScope?.candidateKey;
    let candidate: StoredOutbox | null = null;
    for (const [key, raw] of this.storedEntries) {
      if (key === candidateKey) candidate = { key, raw };
      else entries.push({ key, raw });
    }
    this.storedEntries.clear();
    if (candidate) entries.push(candidate);
    if (entries.length === 0) return;
    const releaseOwn = this.releaseOwnerLock;
    next.heldSources.set(this.outboxOwnerId, {
      entries,
      release: () => {
        for (const source of sources) source.release();
        releaseOwn?.();
      },
      covering: new Set(next.pendingUpdates),
    });
    this.releaseOwnerLock = null;
    this.ownerLock = null;
    this.ownsKeys = false;
    // A rebuild that changes nothing sends nothing to wait for.
    next.retireAcknowledgedSources();
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
      // halves, and a refused single update stops this tab's updates. Their
      // entry stays until a candidate replaces it, so a page that closes
      // first leaves them to the next one, which rebuilds them.
      if (response.status === 413) {
        if (toSend.length > 1) {
          this.updateBatchLimit = Math.ceil(toSend.length / 2);
        } else {
          this.setSnapshot({ updatesRefused: true });
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
