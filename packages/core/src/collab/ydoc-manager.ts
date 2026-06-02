/**
 * Server-side Yjs document manager with LRU caching and SQL persistence.
 */

import * as Y from "yjs";
import {
  loadYDocRecord,
  loadYDocState,
  saveYDocState,
  trySaveYDocState,
} from "./storage.js";
import { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";
import { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";
import {
  applyJsonDiff,
  applyJsonPatch,
  yDocToJson,
  initYDocWithJson,
  type PatchOp,
} from "./json-to-yjs.js";
import { emitCollabUpdate } from "./emitter.js";
import { uint8ArrayToBase64 } from "./storage.js";

const DEFAULT_FIELD = "content";
const MAX_CACHE = 50;

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

async function applyStoredState(docId: string, doc: Y.Doc): Promise<void> {
  const stored = await loadYDocState(docId);
  if (stored && stored.length > 0) {
    Y.applyUpdate(doc, stored);
  }
}

async function persistMergedState(
  docId: string,
  doc: Y.Doc,
  getTextSnapshot: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const latest = await loadYDocRecord(docId);
    if (latest?.state && latest.state.length > 0) {
      Y.applyUpdate(doc, latest.state);
    }

    const saved = await trySaveYDocState(
      docId,
      Y.encodeStateAsUpdate(doc),
      getTextSnapshot(),
      latest?.version ?? null,
    );
    if (saved) return;
  }

  await applyStoredState(docId, doc);
  await saveYDocState(docId, Y.encodeStateAsUpdate(doc), getTextSnapshot());
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
    await applyStoredState(docId, doc);
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
): Promise<string> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
    await applyStoredState(docId, doc);
    const update = applyTextToYDoc(doc, fieldName, newText, "server");

    if (update.length === 0) {
      return doc.getText(fieldName).toString();
    }

    await persistMergedState(docId, doc, () =>
      doc.getText(fieldName).toString(),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
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
    await applyStoredState(docId, doc);
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
  await applyStoredState(docId, doc);
  return doc.getText(fieldName).toString();
}

/**
 * Get the full document state as a Uint8Array.
 */
export async function getState(docId: string): Promise<Uint8Array> {
  const doc = await getDoc(docId);
  await applyStoredState(docId, doc);
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
  await applyStoredState(docId, doc);
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
  type: "map" | "array" = "map",
  requestSource?: string,
): Promise<void> {
  return withDocWriteLock(docId, async () => {
    const doc = await getDoc(docId);
    await applyStoredState(docId, doc);
    const update = applyJsonDiff(doc, fieldName, newJson, "server");

    if (update.length === 0) return;

    // Snapshot the doc's actual post-merge state, not the caller-supplied
    // `newJson` — persistMergedState may re-apply newer DB state to resolve
    // concurrent writes, so `newJson` can be stale. Matches applyPatchOps.
    await persistMergedState(docId, doc, () =>
      JSON.stringify(yDocToJson(doc, fieldName)),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
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
    await applyStoredState(docId, doc);
    const update = applyJsonPatch(doc, fieldName, ops, "server");

    if (update.length === 0) return;

    await persistMergedState(docId, doc, () =>
      JSON.stringify(yDocToJson(doc, fieldName)),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
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
  await applyStoredState(docId, doc);
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
