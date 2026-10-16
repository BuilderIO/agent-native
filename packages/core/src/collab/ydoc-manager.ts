import * as Y from "yjs";

import { getDbExec, type DbExec } from "../db/client.js";
import { emitCollabUpdate } from "./emitter.js";
import {
  applyJsonDiff,
  applyJsonPatch,
  yDocToJson,
  initYDocWithJson,
  type PatchOp,
} from "./json-to-yjs.js";
import type { LiveCopyCatchUp } from "./live-copy-tasks.js";
import {
  applyLiveCopyUpdate,
  assertLiveCopy,
  assertOwnTransaction,
  commitLiveCopy,
  editLiveCopyState,
  liveCopiesDefined,
  liveCopyBindingFor,
  LiveCopyError,
  persistLiveCopyCall,
  readLiveCopyState,
  readStoredLiveCopy,
  refuseLiveCopyWrite,
  seedLiveCopyState,
  type LiveCopyBinding,
  type LiveCopyOutcome,
  type StoredLiveCopy,
} from "./live-copy.js";
import {
  collabStateDigest,
  ensureTable,
  loadYDocRecord,
  loadYDocRecordWithClient,
  loadYDocStamp,
  loadYDocVersion,
  saveYDocState as saveStoredYDocState,
  trySaveYDocState,
  trySaveYDocStateWithClient,
  type YDocStamp,
} from "./storage.js";
import { uint8ArrayToBase64 } from "./storage.js";
import { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";
import { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";

const DEFAULT_FIELD = "content";

export class CollabBaseVersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollabBaseVersionConflictError";
  }
}

const MAX_CACHE = 50;

function touchAgentPresence(
  docId: string,
  requestSource: string | undefined,
  edit: { descriptor: Record<string, unknown>; label?: string } | null,
): void {
  if (requestSource !== "agent") return;
  import("./agent-presence.js")
    .then((mod) => {
      mod.agentTouchDocument(docId, edit ? { edit: edit as any } : undefined);
    })
    .catch(() => {
      // Presence is best-effort; never fail the write for it.
    });
}

export function computeTextEditDescriptor(
  oldText: string,
  newText: string,
): { kind: "text"; quote: string } | { kind: "doc" } {
  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;

  let endOld = oldText.length;
  let endNew = newText.length;
  while (
    endOld > start &&
    endNew > start &&
    oldText[endOld - 1] === newText[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }

  const inserted = newText.slice(start, endNew).trim();
  if (inserted.length > 0) {
    return { kind: "text", quote: inserted.slice(0, 120) };
  }
  return { kind: "doc" };
}

const COMPACTION_RATIO = 4;

interface CacheEntry {
  doc: Y.Doc;
  lastAccess: number;
  syncedVersion: number | null;
}

const _cache = new Map<string, CacheEntry>();
const _writeLocks = new Map<string, Promise<void>>();
const _refreshLocks = new Map<string, Promise<void>>();
const _loadLocks = new Map<string, Promise<Y.Doc>>();

export interface PreparedYDocMutationLease {
  doc: Y.Doc;
  baseVersion: number | null;
  persist(transaction: DbExec, textSnapshot: string): Promise<void>;
}

function evictIfNeeded(): void {
  if (_cache.size <= MAX_CACHE) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [id, entry] of _cache) {
    if (entry.lastAccess < oldestTime) {
      oldestTime = entry.lastAccess;
      oldest = id;
    }
  }
  if (oldest) {
    const entry = _cache.get(oldest);
    entry?.doc.destroy();
    _cache.delete(oldest);
  }
}

async function withDocWriteLock<T>(
  docId: string,
  fn: () => Promise<T>,
  refusePath?: string,
): Promise<T> {
  const previous = _writeLocks.get(docId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => {}).then(() => current);
  _writeLocks.set(docId, chained);

  await previous.catch(() => {});
  try {
    // Checked under the lock so a refused write never changes who goes next.
    if (refusePath !== undefined) {
      const refusal = refuseLiveCopyWrite(docId, refusePath);
      if (refusal) await refusal;
    }
    return await fn();
  } finally {
    release();
    if (_writeLocks.get(docId) === chained) {
      _writeLocks.delete(docId);
    }
  }
}

export async function withPreparedYDocMutation<T>(
  docId: string,
  requestSource: string | undefined,
  run: (lease: PreparedYDocMutationLease) => Promise<T>,
): Promise<T> {
  return withDocWriteLock(
    docId,
    async () => {
      const current = await getDocForWrite(docId);
      const latest = await loadYDocRecord(docId);
      if (latest?.state.length) Y.applyUpdate(current, latest.state);

      const candidate = new Y.Doc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(current));
      const baseVector = Y.encodeStateVector(candidate);
      const baseVersion = latest?.version ?? null;
      let persisted = false;
      const lease: PreparedYDocMutationLease = {
        doc: candidate,
        baseVersion,
        persist: async (transaction, textSnapshot) => {
          if (persisted) {
            throw new Error("Prepared Yjs mutation was already persisted");
          }
          const saved = await trySaveYDocStateWithClient(
            transaction,
            docId,
            Y.encodeStateAsUpdate(candidate),
            textSnapshot,
            baseVersion,
          );
          if (!saved) {
            throw new CollabBaseVersionConflictError(
              `Document ${docId} changed while the prepared mutation was committing.`,
            );
          }
          persisted = true;
        },
      };

      try {
        const result = await run(lease);
        if (!persisted) {
          candidate.destroy();
          return result;
        }
        const update = Y.encodeStateAsUpdate(candidate, baseVector);
        const previous = _cache.get(docId);
        previous?.doc.destroy();
        _cache.set(docId, {
          doc: candidate,
          lastAccess: Date.now(),
          syncedVersion: baseVersion === null ? 0 : baseVersion + 1,
        });
        evictIfNeeded();
        if (update.length > 0) {
          emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
        }
        return result;
      } catch (error) {
        candidate.destroy();
        throw error;
      }
    },
    "withPreparedYDocMutation",
  );
}

function buildStateToStore(doc: Y.Doc, storedByteCount: number): Uint8Array {
  const encoded = Y.encodeStateAsUpdate(doc);
  if (
    storedByteCount > 0 &&
    storedByteCount > encoded.length * COMPACTION_RATIO
  ) {
    return encoded;
  }
  return encoded;
}

async function persistMergedState(
  docId: string,
  doc: Y.Doc,
  getTextSnapshot: () => string,
  validateTextSnapshot?: (snapshot: string) => void,
  validatedBaseVersion?: number | null,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const latest = await loadYDocRecord(docId);
    if (validatedBaseVersion !== undefined) {
      const currentVersion = latest?.version ?? null;
      if (currentVersion !== validatedBaseVersion) {
        throw new CollabBaseVersionConflictError(
          `Document ${docId} moved from version ${String(validatedBaseVersion)} to ${String(currentVersion)} while the edit was being applied.`,
        );
      }
    }
    if (latest?.state && latest.state.length > 0) {
      Y.applyUpdate(doc, latest.state);
    }

    const stateToStore = buildStateToStore(doc, latest?.state?.length ?? 0);
    const textSnapshot = getTextSnapshot();
    validateTextSnapshot?.(textSnapshot);
    const expectedVersion = latest?.version ?? null;
    const saved = await trySaveYDocState(
      docId,
      stateToStore,
      textSnapshot,
      expectedVersion,
    );
    if (saved) {
      noteCachedVersion(
        docId,
        doc,
        expectedVersion === null ? 0 : expectedVersion + 1,
      );
      return;
    }
  }

  throw new CollabBaseVersionConflictError(
    `Document ${docId} kept changing while the edit was being applied; the write was not saved.`,
  );
}

function cachedVersionFor(
  docId: string,
  doc: Y.Doc,
): number | null | undefined {
  const entry = _cache.get(docId);
  if (entry?.doc !== doc) return undefined;
  return entry.syncedVersion ?? undefined;
}

function noteCachedVersion(
  docId: string,
  doc: Y.Doc,
  version: number | null,
): void {
  const entry = _cache.get(docId);
  if (entry?.doc === doc) entry.syncedVersion = version;
}

async function mergeNewerStoredState(
  docId: string,
  entry: CacheEntry,
): Promise<void> {
  const inFlight = _refreshLocks.get(docId);
  if (inFlight) return inFlight;

  const refresh = (async () => {
    const storedVersion = await loadYDocVersion(docId);
    if (storedVersion === null) return;
    if (entry.syncedVersion === storedVersion) return;

    const record = await loadYDocRecord(docId);
    if (record === null) return;
    if (record.state.length > 0) Y.applyUpdate(entry.doc, record.state);
    entry.syncedVersion = record.version;
  })();

  _refreshLocks.set(docId, refresh);
  try {
    await refresh;
  } finally {
    if (_refreshLocks.get(docId) === refresh) _refreshLocks.delete(docId);
  }
}

async function loadDoc(docId: string): Promise<Y.Doc> {
  const inFlight = _loadLocks.get(docId);
  if (inFlight) return inFlight;

  const load = (async () => {
    const reCached = _cache.get(docId);
    if (reCached) {
      reCached.lastAccess = Date.now();
      return reCached.doc;
    }

    const doc = new Y.Doc();
    let record = await loadYDocRecord(docId);
    if (record && record.state.length > 0) {
      Y.applyUpdate(doc, record.state);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const storedVersion = await loadYDocVersion(docId);
      if (storedVersion === (record?.version ?? null)) break;
      record = await loadYDocRecord(docId);
      if (record && record.state.length > 0) {
        Y.applyUpdate(doc, record.state);
      }
    }

    evictIfNeeded();
    _cache.set(docId, {
      doc,
      lastAccess: Date.now(),
      syncedVersion: record?.version ?? null,
    });
    return doc;
  })();

  _loadLocks.set(docId, load);
  try {
    return await load;
  } finally {
    _loadLocks.delete(docId);
  }
}

async function getDocForWrite(docId: string): Promise<Y.Doc> {
  const cached = _cache.get(docId);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.doc;
  }
  return loadDoc(docId);
}

async function awaitPendingWrite(docId: string): Promise<void> {
  const pending = _writeLocks.get(docId);
  if (pending) await pending.catch(() => {});
}

type ReadTarget =
  | { kind: "doc"; doc: Y.Doc }
  | { kind: "live"; binding: LiveCopyBinding };

async function readTarget(docId: string): Promise<ReadTarget> {
  await awaitPendingWrite(docId);
  const binding = await liveCopyBindingFor(docId);
  if (binding) return { kind: "live", binding };
  const cached = _cache.get(docId);
  if (cached) {
    cached.lastAccess = Date.now();
    await mergeNewerStoredState(docId, cached);
    return { kind: "doc", doc: cached.doc };
  }
  return { kind: "doc", doc: await loadDoc(docId) };
}

/** The cached document, for callers that only read it. */
async function readDoc(docId: string, path: string): Promise<Y.Doc> {
  const target = await readTarget(docId);
  if (target.kind === "doc") return target.doc;
  throw new LiveCopyError(
    "read_refused",
    docId,
    `Document ${docId} is a live copy, which is never decoded on the request thread, so ${path} cannot read it; use readLiveCopy or getState.`,
    { reason: path },
  );
}

/** Refuses live copies with `read_refused`; read those with `readLiveCopy`. */
export async function getDoc(docId: string): Promise<Y.Doc> {
  return readDoc(docId, "getDoc");
}

/**
 * Commits a client update. Once any live copy is defined, the result says
 * whether the app's rows were derived from it; with none defined it is
 * undefined, as before live copies existed.
 */
export async function applyUpdate(
  docId: string,
  update: Uint8Array,
  requestSource?: string,
): Promise<LiveCopyOutcome | undefined> {
  return withDocWriteLock(docId, async () => {
    const liveCopy = await liveCopyBindingFor(docId);
    if (liveCopy) {
      return commitLiveCopyUpdate(liveCopy, docId, update, requestSource);
    }
    const doc = await getDocForWrite(docId);
    Y.applyUpdate(doc, update);

    await persistMergedState(docId, doc, () =>
      doc.getText(DEFAULT_FIELD).toString(),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
    return liveCopiesDefined()
      ? { liveCopy: "not_derived", liveCopyReason: "not_live_copy" }
      : undefined;
  });
}

const LIVE_COPY_COMMIT_ATTEMPTS = 5;

// An empty Yjs update: no structs, no deletions.
const EMPTY_STATE = new Uint8Array([0, 0]);
const EMPTY_CATCH_UP: LiveCopyCatchUp = {
  stateVector: new Uint8Array([0]),
  deletions: EMPTY_STATE,
};

interface LiveCopyCacheEntry {
  /** Bytes are valid only for the binding that checked them. */
  binding: LiveCopyBinding;
  state: Uint8Array;
  catchUp: LiveCopyCatchUp;
  /** The row the bytes came from; null when the copy was absent. */
  stamp: YDocStamp | null;
  lastAccess: number;
}

// Live copies are cached as validated bytes, never as a Y.Doc.
const _liveCopyCache = new Map<string, LiveCopyCacheEntry>();

/** Caches the bytes `stored` holds; null caches an absent copy. */
async function cacheLiveCopyState(
  binding: LiveCopyBinding,
  docId: string,
  stored: { state: Uint8Array; version: number } | null,
  catchUp: LiveCopyCatchUp,
): Promise<LiveCopyCacheEntry> {
  const entry: LiveCopyCacheEntry = {
    binding,
    state: stored && stored.state.length > 0 ? stored.state : EMPTY_STATE,
    catchUp,
    stamp: stored && {
      version: stored.version,
      digest: await collabStateDigest(stored.state),
    },
    lastAccess: Date.now(),
  };
  const stale = _cache.get(docId);
  if (stale) {
    stale.doc.destroy();
    _cache.delete(docId);
  }
  _liveCopyCache.set(docId, entry);
  evictLiveCopyCache();
  return entry;
}

function evictLiveCopyCache(): void {
  if (_liveCopyCache.size <= MAX_CACHE) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [id, entry] of _liveCopyCache) {
    if (entry.lastAccess < oldestTime) {
      oldestTime = entry.lastAccess;
      oldest = id;
    }
  }
  if (oldest) _liveCopyCache.delete(oldest);
}

function servedState(state: Uint8Array): Uint8Array {
  return state.length > 0 ? state.slice() : EMPTY_STATE.slice();
}

/**
 * The cached entry while the row still holds the bytes it was cached from.
 * The digest matters as much as the version: a row deleted and inserted
 * again, by any instance, starts back at version 0.
 */
async function cachedLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
): Promise<LiveCopyCacheEntry | undefined> {
  const cached = _liveCopyCache.get(docId);
  if (cached?.binding !== binding) return undefined;
  const stamp = await loadYDocStamp(docId);
  if (
    stamp?.version !== cached.stamp?.version ||
    stamp?.digest !== cached.stamp?.digest
  ) {
    return undefined;
  }
  cached.lastAccess = Date.now();
  return cached;
}

/**
 * The stored copy to change. When this instance cached the stored row, its
 * bytes are used instead of re-reading it; the tasks get a copy, so a
 * refused or conflicting attempt never touches the cache.
 */
async function loadLiveCopyState(
  binding: LiveCopyBinding,
  docId: string,
): Promise<StoredLiveCopy> {
  const cached = await cachedLiveCopy(binding, docId);
  if (cached) {
    return cached.stamp === null
      ? { kind: "absent" }
      : { kind: "stored", state: cached.state, ...cached.stamp };
  }
  return readStoredLiveCopy(binding, getDbExec(), docId);
}

function stampOf(stored: StoredLiveCopy): YDocStamp | null {
  return stored.kind === "absent"
    ? null
    : { version: stored.version, digest: stored.digest };
}

/**
 * The bytes a live copy serves to editors. A version this instance has not
 * seen is checked in the runner first, so malformed state fails here instead
 * of reaching an editor as an empty or broken document.
 */
async function liveCopyStateForRead(
  binding: LiveCopyBinding,
  docId: string,
): Promise<{ state: Uint8Array; catchUp: LiveCopyCatchUp }> {
  await ensureTable();
  const cached = await cachedLiveCopy(binding, docId);
  if (cached) return cached;
  const stored = await readStoredLiveCopy(binding, getDbExec(), docId);
  if (stored.kind === "absent") {
    return cacheLiveCopyState(binding, docId, null, EMPTY_CATCH_UP);
  }
  const { catchUp } = await readLiveCopyState(
    binding,
    docId,
    stored.state,
    false,
  );
  return cacheLiveCopyState(binding, docId, stored, catchUp);
}

async function commitLiveCopyUpdate(
  binding: LiveCopyBinding,
  docId: string,
  update: Uint8Array,
  requestSource: string | undefined,
): Promise<LiveCopyOutcome> {
  assertOwnTransaction(docId, "applyUpdate");
  await ensureTable();
  for (let attempt = 0; attempt < LIVE_COPY_COMMIT_ATTEMPTS; attempt += 1) {
    const stored = await loadLiveCopyState(binding, docId);
    const result = await applyLiveCopyUpdate(
      binding,
      docId,
      stored.kind === "absent" ? null : stored.state,
      update,
    );
    if (result.kind === "unchanged") return { liveCopy: "unchanged" };
    const previousVersion = stored.kind === "absent" ? null : stored.version;
    const version = previousVersion === null ? 0 : previousVersion + 1;
    const outcome = await commitLiveCopy(
      binding,
      {
        docId,
        origin: "update",
        previousVersion,
        version,
        text: result.text,
        state: result.state,
        ...(requestSource ? { requestSource } : {}),
      },
      stampOf(stored),
    );
    if (!outcome) continue;
    await cacheLiveCopyState(
      binding,
      docId,
      { state: result.state, version },
      result.catchUp,
    );
    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
    return outcome;
  }
  throw new LiveCopyError(
    "version_conflict",
    docId,
    `Live copy ${docId} kept changing while the update was being committed; it was not saved.`,
    { reason: String(LIVE_COPY_COMMIT_ATTEMPTS) },
  );
}

export type LiveCopyRead =
  | { kind: "absent" }
  | { kind: "unseeded"; version: number; state: Uint8Array }
  | { kind: "live"; version: number; state: Uint8Array; text: string };

/**
 * The stored live copy and derive(state). Absent (no row), unseeded (a row
 * with nothing in the field, including a zero-byte state) and malformed
 * (throws `malformed_state`) are never conflated.
 */
export async function readLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
): Promise<LiveCopyRead> {
  await ensureTable();
  const stored = await loadLiveCopyState(binding, docId);
  if (stored.kind === "absent") return { kind: "absent" };
  const result = await readLiveCopyState(binding, docId, stored.state, true);
  const state = servedState(stored.state);
  if (result.kind === "unseeded") {
    return { kind: "unseeded", version: stored.version, state };
  }
  return {
    kind: "live",
    version: stored.version,
    state,
    text: result.text as string,
  };
}

export interface MutateLiveCopyOptions {
  /**
   * The name of an edit in the runner's module
   * (`defineLiveCopyTasks({ edits })`). It runs in the runner and is re-run
   * against fresh state after each version conflict.
   */
  edit: string;
  /** Passed to the edit. */
  input?: unknown;
  requestSource?: string;
  maxAttempts?: number;
  /**
   * Writes this call's own rows (say, claiming the suggestion the edit
   * applies) in the transaction that commits the edit, after the binding's
   * persist and before `_collab_docs`, so they commit or roll back together.
   * When the edit changes nothing it runs in a transaction of its own. A
   * throw reaches the caller and nothing is published. Re-run on each
   * version-conflict attempt.
   */
  persist?(tx: DbExec, change: LiveCopyCallChange): Promise<void>;
}

export interface LiveCopyCallChange {
  changed: boolean;
  /** The version this call leaves stored. */
  version: number;
  /** derive(state) at that version. */
  text: string;
}

export interface LiveCopyMutationResult extends LiveCopyOutcome {
  changed: boolean;
  /** The stored version after the call; an unchanged edit leaves it as is. */
  version: number;
  state: Uint8Array;
  /** derive(state). */
  text: string;
  /** What this call added to the state it edited. Empty when unchanged. */
  update: Uint8Array;
  attempts: number;
}

/**
 * Applies a named edit to a seeded live copy and commits it with its derived
 * text, retrying on `_collab_docs.version` conflicts. Throws `not_seeded`
 * for an absent or unseeded copy; seed it with `seedLiveCopy` first.
 */
export async function mutateLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
  options: MutateLiveCopyOptions,
): Promise<LiveCopyMutationResult> {
  const maxAttempts = options.maxAttempts ?? LIVE_COPY_COMMIT_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      "mutateLiveCopy maxAttempts must be a positive integer",
    );
  }
  if (typeof options.edit !== "string") {
    throw new TypeError(
      "mutateLiveCopy edit must name an edit in the runner's module",
    );
  }
  const callPersist = options.persist;
  if (callPersist !== undefined && typeof callPersist !== "function") {
    throw new TypeError("mutateLiveCopy persist must be a function");
  }
  await assertLiveCopy(binding, docId);
  assertOwnTransaction(docId, "mutateLiveCopy");
  await ensureTable();
  return withDocWriteLock(docId, async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const stored = await loadLiveCopyState(binding, docId);
      if (stored.kind === "absent") {
        throw new LiveCopyError(
          "not_seeded",
          docId,
          `Live copy ${docId} is absent; seed it before editing.`,
          { reason: "absent" },
        );
      }
      const result = await editLiveCopyState(
        binding,
        docId,
        stored.state,
        options.edit,
        options.input,
      );
      if (result.kind === "unchanged") {
        if (
          callPersist &&
          !(await persistLiveCopyCall(
            docId,
            { version: stored.version, digest: stored.digest },
            (tx) =>
              callPersist(tx, {
                changed: false,
                version: stored.version,
                text: result.text,
              }),
          ))
        ) {
          continue;
        }
        return {
          changed: false,
          liveCopy: "unchanged",
          version: stored.version,
          state: servedState(stored.state),
          text: result.text,
          update: new Uint8Array(0),
          attempts: attempt,
        };
      }
      const version = stored.version + 1;
      const outcome = await commitLiveCopy(
        binding,
        {
          docId,
          origin: "mutation",
          previousVersion: stored.version,
          version,
          text: result.text,
          state: result.state,
          ...(options.requestSource
            ? { requestSource: options.requestSource }
            : {}),
        },
        stampOf(stored),
        callPersist &&
          ((tx) =>
            callPersist(tx, { changed: true, version, text: result.text })),
      );
      if (!outcome) continue;
      await cacheLiveCopyState(
        binding,
        docId,
        { state: result.state, version },
        result.catchUp,
      );
      emitCollabUpdate(
        docId,
        uint8ArrayToBase64(result.update),
        options.requestSource,
      );
      touchAgentPresence(docId, options.requestSource, {
        descriptor: { kind: "doc" },
      });
      return {
        ...outcome,
        changed: true,
        version,
        state: result.state.slice(),
        text: result.text,
        update: result.update,
        attempts: attempt,
      };
    }
    throw new LiveCopyError(
      "version_conflict",
      docId,
      `Live copy ${docId} kept changing during ${maxAttempts} edit attempts; the edit was not saved.`,
      { reason: String(maxAttempts) },
    );
  });
}

export interface SeedLiveCopyOptions {
  /** Passed to the seed handler in the runner's module. */
  source: string;
  requestSource?: string;
}

export interface LiveCopySeedResult extends LiveCopyOutcome {
  seeded: boolean;
  version: number;
  state: Uint8Array;
  /** derive(state). */
  text: string;
}

/**
 * Seeds an absent or unseeded live copy from `source`. A live copy that
 * already has content comes back unchanged with `seeded: false`; malformed
 * stored state throws `malformed_state` and is never overwritten.
 */
export async function seedLiveCopy(
  binding: LiveCopyBinding,
  docId: string,
  options: SeedLiveCopyOptions,
): Promise<LiveCopySeedResult> {
  await assertLiveCopy(binding, docId);
  assertOwnTransaction(docId, "seedLiveCopy");
  await ensureTable();
  return withDocWriteLock(docId, async () => {
    for (let attempt = 0; attempt < LIVE_COPY_COMMIT_ATTEMPTS; attempt += 1) {
      const stored = await loadLiveCopyState(binding, docId);
      const result = await seedLiveCopyState(
        binding,
        docId,
        stored.kind === "absent" ? null : stored.state,
        options.source,
      );
      if (result.kind === "live") {
        if (stored.kind === "absent") {
          throw new LiveCopyError(
            "build_failed",
            docId,
            `The seed task for ${docId} called an absent copy live.`,
            { reason: "invalid_output" },
          );
        }
        return {
          seeded: false,
          liveCopy: "unchanged",
          version: stored.version,
          state: servedState(stored.state),
          text: result.text,
        };
      }
      const previousVersion = stored.kind === "absent" ? null : stored.version;
      const version = previousVersion === null ? 0 : previousVersion + 1;
      const outcome = await commitLiveCopy(
        binding,
        {
          docId,
          origin: "seed",
          previousVersion,
          version,
          text: result.text,
          state: result.state,
          ...(options.requestSource
            ? { requestSource: options.requestSource }
            : {}),
        },
        stampOf(stored),
      );
      if (!outcome) continue;
      await cacheLiveCopyState(
        binding,
        docId,
        { state: result.state, version },
        result.catchUp,
      );
      emitCollabUpdate(
        docId,
        uint8ArrayToBase64(result.update),
        options.requestSource,
      );
      return {
        ...outcome,
        seeded: true,
        version,
        state: result.state.slice(),
        text: result.text,
      };
    }
    throw new LiveCopyError(
      "version_conflict",
      docId,
      `Live copy ${docId} kept changing while its seed was being committed.`,
      { reason: String(LIVE_COPY_COMMIT_ATTEMPTS) },
    );
  });
}

function assertXmlFragmentSeed(seedUpdate: Uint8Array): void {
  const candidate = new Y.Doc();
  try {
    const decoded = Y.decodeUpdate(seedUpdate);
    if (decoded.ds.clients.size > 0) {
      throw new Error("Initial XmlFragment seed cannot contain deletions");
    }
    Y.applyUpdate(candidate, seedUpdate);
    const fragment = candidate.getXmlFragment("default");
    if (
      candidate.share.size !== 1 ||
      !candidate.share.has("default") ||
      isEmptyXmlSeedTarget(fragment)
    ) {
      throw new Error(
        "Initial XmlFragment seed must contain only a nonempty default fragment",
      );
    }
  } finally {
    candidate.destroy();
  }
}

function isEmptyXmlSeedTarget(fragment: Y.XmlFragment): boolean {
  if (fragment.length === 0) return true;
  if (fragment.length !== 1) return false;
  const first = fragment.get(0);
  if (!(first instanceof Y.XmlElement) || first.nodeName !== "paragraph") {
    return false;
  }
  for (let index = 0; index < first.length; index += 1) {
    const child = first.get(index);
    if (!(child instanceof Y.XmlText) || child.toString().length > 0) {
      return false;
    }
  }
  return true;
}

export async function seedXmlFragmentIfEmpty(
  docId: string,
  seedUpdate: Uint8Array,
  requestSource?: string,
): Promise<{ seeded: boolean; state: Uint8Array }> {
  // Once a live copy exists, decode only after the lock's refusal check, so
  // a covered document never integrates a seed on this thread.
  const validateInLock = liveCopiesDefined();
  if (!validateInLock) assertXmlFragmentSeed(seedUpdate);

  return withDocWriteLock(
    docId,
    async () => {
      if (validateInLock) assertXmlFragmentSeed(seedUpdate);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const stored = await loadYDocRecord(docId);
        const committed = new Y.Doc();
        try {
          if (stored?.state.length) Y.applyUpdate(committed, stored.state);
          const fragment = committed.getXmlFragment("default");
          if (!isEmptyXmlSeedTarget(fragment)) {
            return { seeded: false, state: Y.encodeStateAsUpdate(committed) };
          }

          const beforeVector = Y.encodeStateVector(committed);
          if (fragment.length === 1) fragment.delete(0, 1);
          Y.applyUpdate(committed, seedUpdate);
          if (isEmptyXmlSeedTarget(fragment)) {
            throw new Error(
              "Initial XmlFragment seed did not populate the default fragment",
            );
          }
          const state = Y.encodeStateAsUpdate(committed);
          const committedUpdate = Y.encodeStateAsUpdate(
            committed,
            beforeVector,
          );
          const textSnapshot =
            committed.getText(DEFAULT_FIELD).toString() ||
            extractTextFromYXml(fragment);
          const saved = await trySaveYDocState(
            docId,
            state,
            textSnapshot,
            stored?.version ?? null,
          );
          if (!saved) continue;

          releaseDoc(docId);
          emitCollabUpdate(
            docId,
            uint8ArrayToBase64(committedUpdate),
            requestSource,
          );
          return { seeded: true, state };
        } finally {
          committed.destroy();
        }
      }
      throw new CollabBaseVersionConflictError(
        `Document ${docId} kept changing while its initial XmlFragment seed was being committed.`,
      );
    },
    "seedXmlFragmentIfEmpty",
  );
}

export async function applyText(
  docId: string,
  newText: string,
  fieldName: string = DEFAULT_FIELD,
  requestSource?: string,
  options: {
    validateBase?: (base: string) => void;
    validateSnapshot?: (snapshot: string) => void;
  } = {},
): Promise<string> {
  return withDocWriteLock(
    docId,
    async () => {
      const doc = await getDocForWrite(docId);
      const validatedBaseVersion = options.validateBase
        ? cachedVersionFor(docId, doc)
        : undefined;
      const oldText = doc.getText(fieldName).toString();
      if (options.validateBase && validatedBaseVersion === undefined) {
        throw new CollabBaseVersionConflictError(
          `Document ${docId} has no known base version to validate against; re-read the file and retry.`,
        );
      }
      options.validateBase?.(oldText);
      const update = applyTextToYDoc(doc, fieldName, newText, "server");

      if (update.length === 0) {
        const snapshot = doc.getText(fieldName).toString();
        try {
          options.validateSnapshot?.(snapshot);
        } catch (error) {
          releaseDoc(docId);
          throw error;
        }
        return snapshot;
      }

      try {
        await persistMergedState(
          docId,
          doc,
          () => doc.getText(fieldName).toString(),
          options.validateSnapshot,
          validatedBaseVersion,
        );
      } catch (error) {
        releaseDoc(docId);
        throw error;
      }

      emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
      touchAgentPresence(docId, requestSource, {
        descriptor: computeTextEditDescriptor(oldText, newText),
      });
      return doc.getText(fieldName).toString();
    },
    "applyText",
  );
}

export async function searchAndReplace(
  docId: string,
  find: string,
  replace: string,
  requestSource?: string,
): Promise<{ found: boolean; update: Uint8Array }> {
  return withDocWriteLock(
    docId,
    async () => {
      const doc = await getDocForWrite(docId);
      const fragment = doc.getXmlFragment("default");

      let update: Uint8Array = new Uint8Array(0);
      const handler = (u: Uint8Array) => {
        update = u;
      };
      doc.on("update", handler);

      let found = false;
      doc.transact(() => {
        found = searchAndReplaceInYXml(fragment, find, replace);
      }, "agent");

      doc.off("update", handler);

      if (!found || update.length === 0) {
        return { found: false, update: new Uint8Array(0) };
      }

      await persistMergedState(docId, doc, () => extractTextFromYXml(fragment));
      emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
      touchAgentPresence(docId, requestSource, {
        descriptor: {
          kind: "text",
          quote: (replace || find).slice(0, 120),
        },
      });

      return { found: true, update };
    },
    "searchAndReplace",
  );
}

export async function getText(
  docId: string,
  fieldName: string = DEFAULT_FIELD,
): Promise<string> {
  const doc = await readDoc(docId, "getText");
  return doc.getText(fieldName).toString();
}

export async function getState(docId: string): Promise<Uint8Array> {
  const target = await readTarget(docId);
  if (target.kind === "doc") return Y.encodeStateAsUpdate(target.doc);
  return (await liveCopyStateForRead(target.binding, docId)).state.slice();
}

export async function getIncUpdate(
  docId: string,
  clientStateVector: Uint8Array,
): Promise<Uint8Array> {
  const target = await readTarget(docId);
  if (target.kind === "doc") {
    return Y.encodeStateAsUpdate(target.doc, clientStateVector);
  }
  const { state, catchUp } = await liveCopyStateForRead(target.binding, docId);
  // Diffing against the client's vector would decode the copy on this
  // thread. A client at the same vector lacks at most deletions; any other
  // gets the whole state, which Yjs applies idempotently.
  return sameBytes(clientStateVector, catchUp.stateVector)
    ? catchUp.deletions.slice()
    : state.slice();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export async function seedFromText(
  docId: string,
  text: string,
  fieldName: string = DEFAULT_FIELD,
  client?: DbExec,
): Promise<void> {
  return withDocWriteLock(
    docId,
    async () => {
      const existing = client
        ? await loadYDocRecordWithClient(client, docId)
        : await loadYDocRecord(docId);
      if (existing && existing.state.length > 0) return;
      const expectedVersion = existing ? existing.version : null;

      const { doc, state } = initYDocWithText(fieldName, text);
      let saved: boolean;
      try {
        saved = client
          ? await trySaveYDocStateWithClient(
              client,
              docId,
              state,
              text,
              expectedVersion,
            )
          : await trySaveYDocState(docId, state, text, expectedVersion);
      } catch (error) {
        doc.destroy();
        throw error;
      }
      if (!saved) {
        releaseDoc(docId);
        doc.destroy();
        return;
      }

      releaseDoc(docId);
      if (client) {
        doc.destroy();
        return;
      }

      evictIfNeeded();
      _cache.set(docId, {
        doc,
        lastAccess: Date.now(),
        syncedVersion: existing ? existing.version + 1 : 0,
      });
    },
    "seedFromText",
  );
}

export async function applyJson(
  docId: string,
  newJson: any,
  fieldName: string = "data",
  _type: "map" | "array" = "map",
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(
    docId,
    async () => {
      const doc = await getDocForWrite(docId);
      const update = applyJsonDiff(doc, fieldName, newJson, "server");

      if (update.length === 0) return;

      await persistMergedState(docId, doc, () =>
        JSON.stringify(yDocToJson(doc, fieldName)),
      );

      emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
      touchAgentPresence(docId, requestSource, { descriptor: { kind: "doc" } });
    },
    "applyJson",
  );
}

export async function applyPatchOps(
  docId: string,
  ops: PatchOp[],
  fieldName: string = "data",
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(
    docId,
    async () => {
      const doc = await getDocForWrite(docId);
      const update = applyJsonPatch(doc, fieldName, ops, "server");

      if (update.length === 0) return;

      await persistMergedState(docId, doc, () =>
        JSON.stringify(yDocToJson(doc, fieldName)),
      );

      emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
      touchAgentPresence(docId, requestSource, {
        descriptor: {
          kind: "paths",
          paths: ops.slice(0, 5).map((op) => op.path),
        },
      });
    },
    "applyPatchOps",
  );
}

export async function getJson(
  docId: string,
  fieldName: string = "data",
): Promise<any> {
  const doc = await readDoc(docId, "getJson");
  return yDocToJson(doc, fieldName);
}

export async function seedFromJson(
  docId: string,
  json: any,
  fieldName: string = "data",
  type: "map" | "array" = "map",
  client?: DbExec,
): Promise<void> {
  return withDocWriteLock(
    docId,
    async () => {
      const existing = client
        ? await loadYDocRecordWithClient(client, docId)
        : await loadYDocRecord(docId);
      if (existing && existing.state.length > 0) return;
      const expectedVersion = existing ? existing.version : null;

      const { doc, state } = initYDocWithJson(fieldName, json, type);
      let saved: boolean;
      try {
        saved = client
          ? await trySaveYDocStateWithClient(
              client,
              docId,
              state,
              JSON.stringify(json),
              expectedVersion,
            )
          : await trySaveYDocState(
              docId,
              state,
              JSON.stringify(json),
              expectedVersion,
            );
      } catch (error) {
        doc.destroy();
        throw error;
      }
      if (!saved) {
        releaseDoc(docId);
        doc.destroy();
        return;
      }

      releaseDoc(docId);
      if (client) {
        doc.destroy();
        return;
      }

      evictIfNeeded();
      _cache.set(docId, {
        doc,
        lastAccess: Date.now(),
        syncedVersion: existing ? existing.version + 1 : 0,
      });
    },
    "seedFromJson",
  );
}

/** Overwrites a document's stored state and text. Refuses live copies. */
export function saveYDocState(
  docId: string,
  state: Uint8Array,
  textSnapshot: string,
): Promise<void> {
  const refusal = refuseLiveCopyWrite(docId, "saveYDocState");
  if (!refusal) return saveStoredYDocState(docId, state, textSnapshot);
  return refusal.then(() => saveStoredYDocState(docId, state, textSnapshot));
}

export function releaseDoc(docId: string): void {
  _liveCopyCache.delete(docId);
  const entry = _cache.get(docId);
  if (entry) {
    entry.doc.destroy();
    _cache.delete(docId);
  }
}
