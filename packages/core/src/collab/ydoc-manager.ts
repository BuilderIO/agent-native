/**
 * Server-side Yjs document manager with LRU caching and SQL persistence.
 *
 * Performance notes:
 * - `getDoc()` loads from the DB once on cache miss; subsequent calls return
 *   the cached Y.Doc directly with no DB I/O.
 * - Mutations no longer call `applyStoredState()` unconditionally on every
 *   write. The defensive re-read from the DB happens only inside
 *   `persistMergedState` (needed for the CAS version read), not as a
 *   separate SELECT before applying the new update. This removes the
 *   redundant double-read that the previous implementation performed on
 *   every write even on a hot cache.
 * - Compaction: when the stored blob is >4x the freshly encoded state, the
 *   GC'd encoding is stored instead (removes accumulated Yjs tombstones,
 *   preventing unbounded blob growth without any background jobs).
 */

import * as Y from "yjs";

import { emitCollabUpdate } from "./emitter.js";
import {
  applyJsonDiff,
  applyJsonPatch,
  yDocToJson,
  initYDocWithJson,
  type PatchOp,
} from "./json-to-yjs.js";
import {
  loadYDocRecord,
  loadYDocState,
  saveYDocState,
  trySaveYDocState,
} from "./storage.js";
import { uint8ArrayToBase64 } from "./storage.js";
import { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";
import { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";

const DEFAULT_FIELD = "content";
const MAX_CACHE = 50;

/**
 * Auto-presence: any agent-sourced write produces visible presence and
 * lingering edit attribution without the calling action having to wire
 * agentEnterDocument/agentLeaveDocument itself. Dynamic import avoids a
 * static cycle (agent-presence.ts imports searchAndReplace from this module).
 */
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

/**
 * Compute a small "what changed" descriptor from a text diff by trimming the
 * common prefix/suffix. Used for lingering edit highlights client-side.
 */
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

/**
 * Compaction ratio threshold. When the stored state byte count exceeds
 * COMPACTION_RATIO × the freshly encoded state, write the compact form
 * (strips accumulated tombstones). A value of 4 means: compact when the
 * stored blob is 4× larger than necessary.
 */
const COMPACTION_RATIO = 4;

interface CacheEntry {
  doc: Y.Doc;
  lastAccess: number;
}

const _cache = new Map<string, CacheEntry>();
const _writeLocks = new Map<string, Promise<void>>();
// Coalesces concurrent cache-miss loads for the same docId. Without this, two
// simultaneous getDoc() callers both miss the cache, both build a Y.Doc and
// apply stored state, and the second _cache.set silently orphans the first
// doc (a memory leak that grows with concurrent read traffic).
const _loadLocks = new Map<string, Promise<Y.Doc>>();

function evictIfNeeded(): void {
  if (_cache.size <= MAX_CACHE) return;
  // Evict least-recently-accessed entry
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

/**
 * Build state to persist. If the stored blob is significantly larger than
 * the freshly encoded state, store the compact (GC'd) form instead to
 * prevent unbounded blob growth from accumulated tombstones.
 */
function buildStateToStore(doc: Y.Doc, storedByteCount: number): Uint8Array {
  const encoded = Y.encodeStateAsUpdate(doc);
  if (
    storedByteCount > 0 &&
    storedByteCount > encoded.length * COMPACTION_RATIO
  ) {
    // Stored blob is much larger than needed — return the GC'd encoding.
    return encoded;
  }
  return encoded;
}

/**
 * Persist the merged doc state with CAS retry on conflict.
 *
 * REMOVED: the unconditional `applyStoredState()` that was called on every
 * write path before this function. The only DB read is the `loadYDocRecord`
 * call here — needed to get the CAS version and merge any concurrent writes
 * from OTHER processes. Within this process, the in-memory doc is already
 * up-to-date because mutations are serialized by withDocWriteLock.
 */
async function persistMergedState(
  docId: string,
  doc: Y.Doc,
  getTextSnapshot: () => string,
  validateTextSnapshot?: (snapshot: string) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // One DB read per persist attempt. On first attempt this is the only read
    // on the write path (previously there was an unconditional second read
    // before the update was applied). On retry attempts it re-reads to get the
    // latest version after a CAS conflict.
    const latest = await loadYDocRecord(docId);
    if (latest?.state && latest.state.length > 0) {
      Y.applyUpdate(doc, latest.state);
    }

    const stateToStore = buildStateToStore(doc, latest?.state?.length ?? 0);
    const textSnapshot = getTextSnapshot();
    validateTextSnapshot?.(textSnapshot);
    const saved = await trySaveYDocState(
      docId,
      stateToStore,
      textSnapshot,
      latest?.version ?? null,
    );
    if (saved) return;
  }

  // All CAS attempts failed — fall back to unconditional save.
  const textSnapshot = getTextSnapshot();
  validateTextSnapshot?.(textSnapshot);
  await saveYDocState(docId, Y.encodeStateAsUpdate(doc), textSnapshot);
}

/**
 * Get or load a Yjs document by ID. Creates a new empty doc if none exists.
 */
export async function getDoc(docId: string): Promise<Y.Doc> {
  const cached = _cache.get(docId);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.doc;
  }

  const inFlight = _loadLocks.get(docId);
  if (inFlight) return inFlight;

  const load = (async () => {
    // Re-check the cache: a concurrent writer (or loader) may have populated it
    // between our miss above and acquiring this load slot.
    const reCached = _cache.get(docId);
    if (reCached) {
      reCached.lastAccess = Date.now();
      return reCached.doc;
    }

    const doc = new Y.Doc();
    const stored = await loadYDocState(docId);
    if (stored && stored.length > 0) {
      Y.applyUpdate(doc, stored);
    }

    evictIfNeeded();
    _cache.set(docId, { doc, lastAccess: Date.now() });
    return doc;
  })();

  _loadLocks.set(docId, load);
  try {
    return await load;
  } finally {
    _loadLocks.delete(docId);
  }
}

/**
 * Apply a binary Yjs update (from a client) to a document.
 * Persists the result and emits a change event.
 */
export async function applyUpdate(
  docId: string,
  update: Uint8Array,
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
    // The cached doc is already up-to-date from the initial load or a previous
    // write in this process. No redundant applyStoredState() here — cross-
    // process writes are merged inside persistMergedState when needed.
    Y.applyUpdate(doc, update);

    await persistMergedState(docId, doc, () =>
      doc.getText(DEFAULT_FIELD).toString(),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
  });
}

/**
 * Apply a text change to a document. Computes the minimal diff and
 * converts it to Yjs operations.
 *
 * Returns the text snapshot after the update.
 */
export async function applyText(
  docId: string,
  newText: string,
  fieldName: string = DEFAULT_FIELD,
  requestSource?: string,
  options: {
    /**
     * Validate the fully converged text after cross-process Yjs updates have
     * merged, but before the state is persisted or broadcast. A rejected
     * candidate is discarded from this process's cache so the next read
     * reloads the last durable state instead of leaking an uncommitted merge.
     */
    validateSnapshot?: (snapshot: string) => void;
  } = {},
): Promise<string> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
    const oldText = doc.getText(fieldName).toString();
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
      );
    } catch (error) {
      if (options.validateSnapshot) {
        // The target diff and any cross-process state merged during the CAS
        // read now live only in this cached Y.Doc. Destroy it before throwing:
        // neither the rejected update nor a compensating rollback should ever
        // be persisted/emitted to connected clients.
        releaseDoc(docId);
      }
      throw error;
    }

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
    touchAgentPresence(docId, requestSource, {
      descriptor: computeTextEditDescriptor(oldText, newText),
    });
    return doc.getText(fieldName).toString();
  });
}

/**
 * Search-and-replace text within a Y.XmlFragment (ProseMirror tree).
 * Produces minimal Yjs operations for cursor-preserving updates.
 *
 * Returns whether the text was found and the binary update.
 */
export async function searchAndReplace(
  docId: string,
  find: string,
  replace: string,
  requestSource?: string,
): Promise<{ found: boolean; update: Uint8Array }> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
    const fragment = doc.getXmlFragment("default");

    // Capture the update produced by the transaction
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

/**
 * Get the current text content of a document field.
 */
export async function getText(
  docId: string,
  fieldName: string = DEFAULT_FIELD,
): Promise<string> {
  const doc = await getDoc(docId);
  return doc.getText(fieldName).toString();
}

/**
 * Get the full document state as a Uint8Array.
 */
export async function getState(docId: string): Promise<Uint8Array> {
  const doc = await getDoc(docId);
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Get an incremental update relative to a client's state vector.
 */
export async function getIncUpdate(
  docId: string,
  clientStateVector: Uint8Array,
): Promise<Uint8Array> {
  const doc = await getDoc(docId);
  return Y.encodeStateAsUpdate(doc, clientStateVector);
}

/**
 * Seed a document from existing text content (for migration).
 * Only seeds if no collab state exists yet.
 */
export async function seedFromText(
  docId: string,
  text: string,
  fieldName: string = DEFAULT_FIELD,
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const existing = await loadYDocState(docId);
    if (existing && existing.length > 0) return; // Already seeded

    const { doc, state } = initYDocWithText(fieldName, text);
    await saveYDocState(docId, state, text);

    // Cache the doc
    evictIfNeeded();
    _cache.set(docId, { doc, lastAccess: Date.now() });
  });
}

// ─── Structured JSON Operations ─────────────────────────────────────

/**
 * Apply a full JSON update to a document. Computes the minimal diff
 * and converts it to Yjs operations on Y.Map/Y.Array.
 */
export async function applyJson(
  docId: string,
  newJson: any,
  fieldName: string = "data",
  _type: "map" | "array" = "map",
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
    const update = applyJsonDiff(doc, fieldName, newJson, "server");

    if (update.length === 0) return;

    // Snapshot the doc's actual post-merge state, not the caller-supplied
    // `newJson` — persistMergedState may re-apply newer DB state to resolve
    // concurrent writes, so `newJson` can be stale. Matches applyPatchOps.
    await persistMergedState(docId, doc, () =>
      JSON.stringify(yDocToJson(doc, fieldName)),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
    touchAgentPresence(docId, requestSource, { descriptor: { kind: "doc" } });
  });
}

/**
 * Apply surgical JSON patch operations to a document.
 */
export async function applyPatchOps(
  docId: string,
  ops: PatchOp[],
  fieldName: string = "data",
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
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

/**
 * Get the current JSON state of a document field.
 */
export async function getJson(
  docId: string,
  fieldName: string = "data",
): Promise<any> {
  const doc = await getDoc(docId);
  return yDocToJson(doc, fieldName);
}

/**
 * Seed a document from existing JSON content (for migration).
 * Only seeds if no collab state exists yet.
 */
export async function seedFromJson(
  docId: string,
  json: any,
  fieldName: string = "data",
  type: "map" | "array" = "map",
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const existing = await loadYDocState(docId);
    if (existing && existing.length > 0) return; // Already seeded

    const { doc, state } = initYDocWithJson(fieldName, json, type);
    await saveYDocState(docId, state, JSON.stringify(json));

    // Cache the doc
    evictIfNeeded();
    _cache.set(docId, { doc, lastAccess: Date.now() });
  });
}

/**
 * Release a document from the in-memory cache.
 */
export function releaseDoc(docId: string): void {
  const entry = _cache.get(docId);
  if (entry) {
    entry.doc.destroy();
    _cache.delete(docId);
  }
}
