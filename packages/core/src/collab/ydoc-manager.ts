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
import {
  applyLiveCopyUpdate,
  assertLiveCopy,
  assertOnlyField,
  commitLiveCopy,
  deriveLiveCopyText,
  encodeLiveCopyState,
  fieldHasContent,
  liveCopyBindingFor,
  LiveCopyError,
  readClassifiedLiveCopy,
  refuseLiveCopyWrite,
  runLiveCopyUpdateTask,
  type LiveCopyBinding,
} from "./live-copy.js";
import {
  ensureTable,
  loadYDocRecord,
  loadYDocRecordWithClient,
  loadYDocVersion,
  trySaveYDocState,
  trySaveYDocStateWithClient,
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
  await refuseLiveCopyWrite(docId, "withPreparedYDocMutation");
  return withDocWriteLock(docId, async () => {
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
  });
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

export async function getDocForWrite(docId: string): Promise<Y.Doc> {
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

export async function getDoc(docId: string): Promise<Y.Doc> {
  await awaitPendingWrite(docId);
  const liveCopy = await liveCopyBindingFor(docId);
  if (liveCopy) return getLiveCopyDoc(liveCopy, docId);
  const cached = _cache.get(docId);
  if (cached) {
    cached.lastAccess = Date.now();
    await mergeNewerStoredState(docId, cached);
    return cached.doc;
  }

  return loadDoc(docId);
}

export async function applyUpdate(
  docId: string,
  update: Uint8Array,
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const liveCopy = await liveCopyBindingFor(docId);
    if (liveCopy) {
      await commitLiveCopyUpdate(liveCopy, docId, update, requestSource);
      return;
    }
    const doc = await getDocForWrite(docId);
    Y.applyUpdate(doc, update);

    await persistMergedState(docId, doc, () =>
      doc.getText(DEFAULT_FIELD).toString(),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
  });
}

const LIVE_COPY_COMMIT_ATTEMPTS = 5;

function cacheCommittedLiveCopy(
  docId: string,
  doc: Y.Doc,
  version: number | null,
): void {
  const previous = _cache.get(docId);
  if (previous && previous.doc !== doc) previous.doc.destroy();
  _cache.set(docId, { doc, lastAccess: Date.now(), syncedVersion: version });
  evictIfNeeded();
}

async function commitLiveCopyUpdate(
  binding: LiveCopyBinding,
  docId: string,
  update: Uint8Array,
  requestSource: string | undefined,
): Promise<void> {
  await ensureTable();
  for (let attempt = 0; attempt < LIVE_COPY_COMMIT_ATTEMPTS; attempt += 1) {
    const stored = await readClassifiedLiveCopy(binding, getDbExec(), docId);
    const doc = stored.doc;
    let committed = false;
    try {
      if (!applyLiveCopyUpdate(binding, docId, doc, update)) return;
      const state = encodeLiveCopyState(binding, docId, doc);
      const text = await deriveLiveCopyText(binding, docId, state);
      const previousVersion = stored.kind === "absent" ? null : stored.version;
      const version = previousVersion === null ? 0 : previousVersion + 1;
      committed = await commitLiveCopy(binding, {
        docId,
        origin: "update",
        previousVersion,
        version,
        text,
        state,
        ...(requestSource ? { requestSource } : {}),
      });
      if (!committed) continue;
      cacheCommittedLiveCopy(docId, doc, version);
      emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
      return;
    } catch (error) {
      releaseDoc(docId);
      throw error;
    } finally {
      if (!committed) doc.destroy();
    }
  }
  releaseDoc(docId);
  throw new LiveCopyError(
    "version_conflict",
    docId,
    `Live copy ${docId} kept changing while the update was being committed; it was not saved.`,
    { reason: String(LIVE_COPY_COMMIT_ATTEMPTS) },
  );
}

/**
 * The lenient loader decodes unreadable base64 as zero bytes, which would
 * serve a malformed live copy as an empty document; read it strictly.
 */
async function getLiveCopyDoc(
  binding: LiveCopyBinding,
  docId: string,
): Promise<Y.Doc> {
  await ensureTable();
  const cached = _cache.get(docId);
  if (cached && cached.syncedVersion === (await loadYDocVersion(docId))) {
    cached.lastAccess = Date.now();
    return cached.doc;
  }
  const stored = await readClassifiedLiveCopy(binding, getDbExec(), docId);
  cacheCommittedLiveCopy(
    docId,
    stored.doc,
    stored.kind === "absent" ? null : stored.version,
  );
  return stored.doc;
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
  const stored = await readClassifiedLiveCopy(binding, getDbExec(), docId);
  try {
    if (stored.kind === "absent") return { kind: "absent" };
    if (stored.kind === "unseeded") {
      return {
        kind: "unseeded",
        version: stored.version,
        state: Y.encodeStateAsUpdate(stored.doc),
      };
    }
    const state = encodeLiveCopyState(binding, docId, stored.doc);
    const text = await deriveLiveCopyText(binding, docId, state);
    return { kind: "live", version: stored.version, state, text };
  } finally {
    stored.doc.destroy();
  }
}

export type LiveCopyEdit =
  | ((doc: Y.Doc) => void | Promise<void>)
  | { task: string; input?: unknown };

export interface MutateLiveCopyOptions {
  /**
   * The change, re-run against fresh state after each version conflict. A
   * function runs on this thread and must stay cheap; heavy work (parsing,
   * diffing large trees) belongs in a task, which gets
   * `{ state, field, input }` and returns `{ kind: "update", update }`,
   * `{ kind: "unchanged" }` or `{ kind: "refused", reason }`.
   */
  edit: LiveCopyEdit;
  requestSource?: string;
  maxAttempts?: number;
}

export interface LiveCopyMutationResult {
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
 * Applies an edit to a seeded live copy and commits it with its derived
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
  await assertLiveCopy(binding, docId);
  await ensureTable();
  return withDocWriteLock(docId, async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const stored = await readClassifiedLiveCopy(binding, getDbExec(), docId);
      const doc = stored.doc;
      let committed = false;
      try {
        if (stored.kind !== "live") {
          throw new LiveCopyError(
            "not_seeded",
            docId,
            `Live copy ${docId} is ${stored.kind}; seed it before editing.`,
            { reason: stored.kind },
          );
        }
        const baseVector = Y.encodeStateVector(doc);
        const baseState = Y.encodeStateAsUpdate(doc);
        let changed = false;
        if (typeof options.edit === "function") {
          const onUpdate = () => {
            changed = true;
          };
          doc.on("update", onUpdate);
          try {
            await options.edit(doc);
          } finally {
            doc.off("update", onUpdate);
          }
          if (changed) assertOnlyField(binding, docId, doc);
        } else {
          const update = await runLiveCopyUpdateTask(
            binding,
            docId,
            options.edit.task,
            {
              state: baseState,
              field: binding.field,
              input: options.edit.input,
            },
            true,
          );
          changed =
            update !== null && applyLiveCopyUpdate(binding, docId, doc, update);
        }
        if (changed && !fieldHasContent(doc, binding.field)) {
          throw new LiveCopyError(
            "build_refused",
            docId,
            `The edit would leave live copy ${docId} with an empty "${binding.field}".`,
            { reason: "empty" },
          );
        }
        const state = changed
          ? encodeLiveCopyState(binding, docId, doc)
          : baseState;
        const text = await deriveLiveCopyText(binding, docId, state);
        if (!changed) {
          return {
            changed: false,
            version: stored.version,
            state,
            text,
            update: new Uint8Array(0),
            attempts: attempt,
          };
        }
        const version = stored.version + 1;
        committed = await commitLiveCopy(binding, {
          docId,
          origin: "mutation",
          previousVersion: stored.version,
          version,
          text,
          state,
          ...(options.requestSource
            ? { requestSource: options.requestSource }
            : {}),
        });
        if (!committed) continue;
        const update = Y.encodeStateAsUpdate(doc, baseVector);
        cacheCommittedLiveCopy(docId, doc, version);
        emitCollabUpdate(
          docId,
          uint8ArrayToBase64(update),
          options.requestSource,
        );
        touchAgentPresence(docId, options.requestSource, {
          descriptor: { kind: "doc" },
        });
        return {
          changed: true,
          version,
          state,
          text,
          update,
          attempts: attempt,
        };
      } catch (error) {
        releaseDoc(docId);
        throw error;
      } finally {
        if (!committed) doc.destroy();
      }
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
  /** Passed to the task as `{ source, field }`. */
  source: string;
  /** Returns `{ kind: "update", update }` or `{ kind: "refused", reason }`. Default "seed". */
  task?: string;
  requestSource?: string;
}

export interface LiveCopySeedResult {
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
  await ensureTable();
  return withDocWriteLock(docId, async () => {
    let seedUpdate: Uint8Array | null = null;
    for (let attempt = 0; attempt < LIVE_COPY_COMMIT_ATTEMPTS; attempt += 1) {
      const stored = await readClassifiedLiveCopy(binding, getDbExec(), docId);
      const doc = stored.doc;
      let committed = false;
      try {
        if (stored.kind === "live") {
          const state = encodeLiveCopyState(binding, docId, doc);
          const text = await deriveLiveCopyText(binding, docId, state);
          return { seeded: false, version: stored.version, state, text };
        }
        seedUpdate ??= await buildLiveCopySeed(binding, docId, options);
        const beforeVector = Y.encodeStateVector(doc);
        applyLiveCopyUpdate(binding, docId, doc, seedUpdate);
        const state = encodeLiveCopyState(binding, docId, doc);
        const text = await deriveLiveCopyText(binding, docId, state);
        const previousVersion =
          stored.kind === "absent" ? null : stored.version;
        const version = previousVersion === null ? 0 : previousVersion + 1;
        committed = await commitLiveCopy(binding, {
          docId,
          origin: "seed",
          previousVersion,
          version,
          text,
          state,
          ...(options.requestSource
            ? { requestSource: options.requestSource }
            : {}),
        });
        if (!committed) continue;
        cacheCommittedLiveCopy(docId, doc, version);
        emitCollabUpdate(
          docId,
          uint8ArrayToBase64(Y.encodeStateAsUpdate(doc, beforeVector)),
          options.requestSource,
        );
        return { seeded: true, version, state, text };
      } catch (error) {
        releaseDoc(docId);
        throw error;
      } finally {
        if (!committed) doc.destroy();
      }
    }
    throw new LiveCopyError(
      "version_conflict",
      docId,
      `Live copy ${docId} kept changing while its seed was being committed.`,
      { reason: String(LIVE_COPY_COMMIT_ATTEMPTS) },
    );
  });
}

async function buildLiveCopySeed(
  binding: LiveCopyBinding,
  docId: string,
  options: SeedLiveCopyOptions,
): Promise<Uint8Array> {
  const update = (await runLiveCopyUpdateTask(
    binding,
    docId,
    options.task ?? "seed",
    { source: options.source, field: binding.field },
    false,
  ))!;
  let deletions: number;
  try {
    deletions = Y.decodeUpdate(update).ds.clients.size;
  } catch (error) {
    throw new LiveCopyError(
      "build_failed",
      docId,
      `The seed task for ${docId} returned bytes that are not a Yjs update.`,
      { reason: "invalid_update", cause: error },
    );
  }
  if (deletions > 0) {
    throw new LiveCopyError(
      "build_failed",
      docId,
      `The seed task for ${docId} returned an update with deletions.`,
      { reason: "seed_has_deletions" },
    );
  }
  const check = new Y.Doc();
  try {
    applyLiveCopyUpdate(binding, docId, check, update);
    if (!fieldHasContent(check, binding.field)) {
      throw new LiveCopyError(
        "build_refused",
        docId,
        `The seed task for ${docId} produced an empty "${binding.field}".`,
        { reason: "empty" },
      );
    }
  } finally {
    check.destroy();
  }
  return update;
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
  await refuseLiveCopyWrite(docId, "seedXmlFragmentIfEmpty");
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

  return withDocWriteLock(docId, async () => {
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
        const committedUpdate = Y.encodeStateAsUpdate(committed, beforeVector);
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
  });
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
  await refuseLiveCopyWrite(docId, "applyText");
  return withDocWriteLock(docId, async () => {
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
  });
}

export async function searchAndReplace(
  docId: string,
  find: string,
  replace: string,
  requestSource?: string,
): Promise<{ found: boolean; update: Uint8Array }> {
  await refuseLiveCopyWrite(docId, "searchAndReplace");
  return withDocWriteLock(docId, async () => {
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
  });
}

export async function getText(
  docId: string,
  fieldName: string = DEFAULT_FIELD,
): Promise<string> {
  const doc = await getDoc(docId);
  return doc.getText(fieldName).toString();
}

export async function getState(docId: string): Promise<Uint8Array> {
  const doc = await getDoc(docId);
  return Y.encodeStateAsUpdate(doc);
}

export async function getIncUpdate(
  docId: string,
  clientStateVector: Uint8Array,
): Promise<Uint8Array> {
  const doc = await getDoc(docId);
  return Y.encodeStateAsUpdate(doc, clientStateVector);
}

export async function seedFromText(
  docId: string,
  text: string,
  fieldName: string = DEFAULT_FIELD,
  client?: DbExec,
): Promise<void> {
  await refuseLiveCopyWrite(docId, "seedFromText");
  return withDocWriteLock(docId, async () => {
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
  });
}

export async function applyJson(
  docId: string,
  newJson: any,
  fieldName: string = "data",
  _type: "map" | "array" = "map",
  requestSource?: string,
): Promise<void> {
  await refuseLiveCopyWrite(docId, "applyJson");
  return withDocWriteLock(docId, async () => {
    const doc = await getDocForWrite(docId);
    const update = applyJsonDiff(doc, fieldName, newJson, "server");

    if (update.length === 0) return;

    await persistMergedState(docId, doc, () =>
      JSON.stringify(yDocToJson(doc, fieldName)),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
    touchAgentPresence(docId, requestSource, { descriptor: { kind: "doc" } });
  });
}

export async function applyPatchOps(
  docId: string,
  ops: PatchOp[],
  fieldName: string = "data",
  requestSource?: string,
): Promise<void> {
  await refuseLiveCopyWrite(docId, "applyPatchOps");
  return withDocWriteLock(docId, async () => {
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
  });
}

export async function getJson(
  docId: string,
  fieldName: string = "data",
): Promise<any> {
  const doc = await getDoc(docId);
  return yDocToJson(doc, fieldName);
}

export async function seedFromJson(
  docId: string,
  json: any,
  fieldName: string = "data",
  type: "map" | "array" = "map",
  client?: DbExec,
): Promise<void> {
  await refuseLiveCopyWrite(docId, "seedFromJson");
  return withDocWriteLock(docId, async () => {
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
  });
}

export function releaseDoc(docId: string): void {
  const entry = _cache.get(docId);
  if (entry) {
    entry.doc.destroy();
    _cache.delete(docId);
  }
}
