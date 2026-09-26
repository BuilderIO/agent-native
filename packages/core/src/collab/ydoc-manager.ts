
import * as Y from "yjs";

import type { DbExec } from "../db/client.js";
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
    const doc = await getDocForWrite(docId);
    Y.applyUpdate(doc, update);

    await persistMergedState(docId, doc, () =>
      doc.getText(DEFAULT_FIELD).toString(),
    );

    emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
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

/**
 * Seed a document from existing text content (for migration).
 * Only seeds if no collab state exists yet.
 */
export async function seedFromText(
  docId: string,
  text: string,
  fieldName: string = DEFAULT_FIELD,
  client?: DbExec,
): Promise<void> {
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

/**
 * Seed a document from existing JSON content (for migration).
 * Only seeds if no collab state exists yet.
 */
export async function seedFromJson(
  docId: string,
  json: any,
  fieldName: string = "data",
  type: "map" | "array" = "map",
  client?: DbExec,
): Promise<void> {
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
