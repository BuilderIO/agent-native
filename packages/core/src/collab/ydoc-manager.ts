/**
 * Server-side Yjs document manager with LRU caching and SQL persistence.
 */

import * as Y from "yjs";
import { loadYDocState, saveYDocState } from "./storage.js";
import { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";
import { searchAndReplaceInYXml, extractTextFromYXml } from "./xml-ops.js";
import { emitCollabUpdate } from "./emitter.js";
import { uint8ArrayToBase64 } from "./storage.js";

const DEFAULT_FIELD = "content";
const MAX_CACHE = 50;

interface CacheEntry {
  doc: Y.Doc;
  lastAccess: number;
}

const _cache = new Map<string, CacheEntry>();

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

/**
 * Get or load a Yjs document by ID. Creates a new empty doc if none exists.
 */
export async function getDoc(docId: string): Promise<Y.Doc> {
  const cached = _cache.get(docId);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.doc;
  }

  const doc = new Y.Doc();
  const stored = await loadYDocState(docId);
  if (stored && stored.length > 0) {
    Y.applyUpdate(doc, stored);
  }

  evictIfNeeded();
  _cache.set(docId, { doc, lastAccess: Date.now() });
  return doc;
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
  const doc = await getDoc(docId);
  Y.applyUpdate(doc, update);

  const state = Y.encodeStateAsUpdate(doc);
  const text = doc.getText(DEFAULT_FIELD).toString();
  await saveYDocState(docId, state, text);

  emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
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
  const doc = await getDoc(docId);
  const update = applyTextToYDoc(doc, fieldName, newText, "server");

  if (update.length === 0) {
    return doc.getText(fieldName).toString();
  }

  const state = Y.encodeStateAsUpdate(doc);
  const text = doc.getText(fieldName).toString();
  await saveYDocState(docId, state, text);

  emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);
  return text;
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

  // Persist and emit
  const state = Y.encodeStateAsUpdate(doc);
  const textSnapshot = extractTextFromYXml(fragment);
  await saveYDocState(docId, state, textSnapshot);
  emitCollabUpdate(docId, uint8ArrayToBase64(update), requestSource);

  return { found: true, update };
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
  const existing = await loadYDocState(docId);
  if (existing && existing.length > 0) return; // Already seeded

  const { doc, state } = initYDocWithText(fieldName, text);
  await saveYDocState(docId, state, text);

  // Cache the doc
  evictIfNeeded();
  _cache.set(docId, { doc, lastAccess: Date.now() });
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
