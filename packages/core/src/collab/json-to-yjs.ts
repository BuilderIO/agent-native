/**
 * Bidirectional JSON <-> Yjs conversion and diffing.
 *
 * Converts plain JSON objects/arrays into Y.Map/Y.Array structures and back,
 * with minimal-diff application for collaborative editing of structured data
 * (timelines, dashboards, design objects, etc.).
 */

import * as Y from "yjs";

// ─── Types ──────────────────────────────────────────────────────────

export type PatchOp =
  | { op: "set"; path: string; value: any }
  | { op: "insert"; path: string; index: number; value: any }
  | { op: "delete"; path: string }
  | { op: "move"; path: string; from: number; to: number };

// ─── JSON → Yjs Seeding ────────────────────────────────────────────

/**
 * Recursively convert a plain JS value into a Yjs shared type.
 * Objects become Y.Map, arrays become Y.Array, primitives stay as-is.
 */
function jsonToYType(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const yarray = new Y.Array();
    const items = value.map((item) => jsonToYType(item));
    yarray.push(items);
    return yarray;
  }
  if (typeof value === "object") {
    const ymap = new Y.Map();
    for (const [k, v] of Object.entries(value)) {
      ymap.set(k, jsonToYType(v));
    }
    return ymap;
  }
  // Primitive (string, number, boolean)
  return value;
}

/**
 * Populate a Y.Map or Y.Array from plain JSON on a Y.Doc.
 * Recursive: objects become nested Y.Map, arrays become nested Y.Array.
 * Primitives (string, number, boolean, null) stay as-is.
 */
export function seedYDocFromJson(
  doc: Y.Doc,
  fieldName: string,
  json: any,
  type: "map" | "array",
): void {
  doc.transact(() => {
    if (type === "map") {
      const ymap = doc.getMap(fieldName);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        for (const [k, v] of Object.entries(json)) {
          ymap.set(k, jsonToYType(v));
        }
      }
    } else {
      const yarray = doc.getArray(fieldName);
      if (Array.isArray(json)) {
        const items = json.map((item) => jsonToYType(item));
        yarray.push(items);
      }
    }
  });
}

// ─── Yjs → JSON Serialization ──────────────────────────────────────

/**
 * Serialize a Y.Map to a plain JS object.
 * Recurses into nested Y.Map/Y.Array.
 */
export function yMapToJson(ymap: Y.Map<any>): Record<string, any> {
  const result: Record<string, any> = {};
  ymap.forEach((value, key) => {
    result[key] = yTypeToJson(value);
  });
  return result;
}

/**
 * Serialize a Y.Array to a plain JS array.
 * Recurses into nested Y.Map/Y.Array.
 */
export function yArrayToJson(yarray: Y.Array<any>): any[] {
  const result: any[] = [];
  for (let i = 0; i < yarray.length; i++) {
    result.push(yTypeToJson(yarray.get(i)));
  }
  return result;
}

/** Convert any Yjs type to its plain JS equivalent. */
function yTypeToJson(value: any): any {
  if (value instanceof Y.Map) return yMapToJson(value);
  if (value instanceof Y.Array) return yArrayToJson(value);
  return value;
}

/**
 * Get the shared type by name from a Y.Doc and serialize it to JSON.
 * Returns the plain JS object or array.
 */
export function yDocToJson(doc: Y.Doc, fieldName: string): any {
  const existing = doc.share.get(fieldName);
  if (existing instanceof Y.Array) return yArrayToJson(existing);
  if (existing instanceof Y.Map) return yMapToJson(existing);
  return {};
}

// ─── JSON Diff → Yjs Operations ────────────────────────────────────

/**
 * Diff new JSON against current Y.Map/Y.Array state, apply minimal
 * Yjs operations in a transaction. Returns the binary update captured
 * from the transaction.
 *
 * For arrays, matches items by `id` field if present (stable identity),
 * falls back to index matching.
 */
export function applyJsonDiff(
  doc: Y.Doc,
  fieldName: string,
  newJson: any,
  origin?: string,
): Uint8Array {
  let update: Uint8Array = new Uint8Array(0);
  const handler = (u: Uint8Array) => {
    update = u;
  };
  doc.on("update", handler);

  doc.transact(() => {
    if (Array.isArray(newJson)) {
      const yarray = doc.getArray(fieldName);
      diffArray(yarray, newJson);
    } else if (newJson && typeof newJson === "object") {
      const ymap = doc.getMap(fieldName);
      diffMap(ymap, newJson);
    }
  }, origin);

  doc.off("update", handler);
  return update;
}

/** Recursively diff a Y.Map against a plain object, applying minimal ops. */
function diffMap(ymap: Y.Map<any>, newObj: Record<string, any>): void {
  // Remove keys that no longer exist
  const keysToDelete: string[] = [];
  ymap.forEach((_value, key) => {
    if (!(key in newObj)) {
      keysToDelete.push(key);
    }
  });
  for (const key of keysToDelete) {
    ymap.delete(key);
  }

  // Set new/changed keys
  for (const [key, newValue] of Object.entries(newObj)) {
    const existing = ymap.get(key);

    if (existing instanceof Y.Map && isPlainObject(newValue)) {
      // Recurse into nested map
      diffMap(existing, newValue);
    } else if (existing instanceof Y.Array && Array.isArray(newValue)) {
      // Recurse into nested array
      diffArray(existing, newValue);
    } else if (!deepEqual(yTypeToJson(existing), newValue)) {
      // Value changed or type changed — set the new value
      ymap.set(key, jsonToYType(newValue));
    }
  }
}

/** Recursively diff a Y.Array against a plain array, applying minimal ops. */
function diffArray(yarray: Y.Array<any>, newArr: any[]): void {
  // Check if items have `id` fields for stable identity matching
  const hasIds =
    newArr.length > 0 &&
    newArr.every((item) => item && typeof item === "object" && "id" in item);

  if (hasIds) {
    diffArrayById(yarray, newArr);
  } else {
    diffArrayByIndex(yarray, newArr);
  }
}

/** Diff array items using `id` field for stable matching. */
function diffArrayById(yarray: Y.Array<any>, newArr: any[]): void {
  // Build map of existing items by id
  const existingMap = new Map<string, { index: number; yitem: any }>();
  for (let i = 0; i < yarray.length; i++) {
    const item = yarray.get(i);
    if (item instanceof Y.Map) {
      const id = item.get("id");
      if (id !== undefined) {
        existingMap.set(String(id), { index: i, yitem: item });
      }
    }
  }

  // Build new id set
  const newIds = new Set(newArr.map((item) => String(item.id)));

  // Remove items no longer present (iterate in reverse to preserve indices)
  const toRemove: number[] = [];
  for (let i = 0; i < yarray.length; i++) {
    const item = yarray.get(i);
    if (item instanceof Y.Map) {
      const id = item.get("id");
      if (id !== undefined && !newIds.has(String(id))) {
        toRemove.push(i);
      }
    }
  }
  for (let i = toRemove.length - 1; i >= 0; i--) {
    yarray.delete(toRemove[i], 1);
  }

  // Now rebuild the array to match the new order, diffing matched items
  // and inserting new ones
  for (let i = 0; i < newArr.length; i++) {
    const newItem = newArr[i];
    const newId = String(newItem.id);
    const currentItem = i < yarray.length ? yarray.get(i) : null;
    const currentId =
      currentItem instanceof Y.Map ? currentItem.get("id") : undefined;

    if (currentId !== undefined && String(currentId) === newId) {
      // Same item at same index — diff in place
      if (currentItem instanceof Y.Map && isPlainObject(newItem)) {
        diffMap(currentItem, newItem);
      }
    } else {
      // Check if the item exists elsewhere in the array
      const existingEntry = existingMap.get(newId);
      if (existingEntry && existingEntry.yitem instanceof Y.Map) {
        // Item exists but at wrong position — find its current index and move
        let currentIdx = -1;
        for (let j = 0; j < yarray.length; j++) {
          const candidate = yarray.get(j);
          if (
            candidate instanceof Y.Map &&
            String(candidate.get("id")) === newId
          ) {
            currentIdx = j;
            break;
          }
        }
        if (currentIdx !== -1 && currentIdx !== i) {
          // Move by delete + insert
          const itemJson = yTypeToJson(yarray.get(currentIdx));
          yarray.delete(currentIdx, 1);
          const insertIdx = Math.min(i, yarray.length);
          yarray.insert(insertIdx, [jsonToYType(itemJson)]);
          // Diff the moved item
          const movedItem = yarray.get(insertIdx);
          if (movedItem instanceof Y.Map && isPlainObject(newItem)) {
            diffMap(movedItem, newItem);
          }
        } else if (currentIdx === -1) {
          // Not found — insert new
          const insertIdx = Math.min(i, yarray.length);
          yarray.insert(insertIdx, [jsonToYType(newItem)]);
        }
      } else {
        // New item — insert at position
        const insertIdx = Math.min(i, yarray.length);
        yarray.insert(insertIdx, [jsonToYType(newItem)]);
      }
    }
  }

  // Trim excess items at the end
  while (yarray.length > newArr.length) {
    yarray.delete(yarray.length - 1, 1);
  }
}

/** Diff array items by index (no stable identity). */
function diffArrayByIndex(yarray: Y.Array<any>, newArr: any[]): void {
  // Update existing items in place
  const minLen = Math.min(yarray.length, newArr.length);
  for (let i = 0; i < minLen; i++) {
    const existing = yarray.get(i);
    const newValue = newArr[i];

    if (existing instanceof Y.Map && isPlainObject(newValue)) {
      diffMap(existing, newValue);
    } else if (existing instanceof Y.Array && Array.isArray(newValue)) {
      diffArray(existing, newValue);
    } else if (!deepEqual(yTypeToJson(existing), newValue)) {
      yarray.delete(i, 1);
      yarray.insert(i, [jsonToYType(newValue)]);
    }
  }

  // Remove trailing items
  if (yarray.length > newArr.length) {
    yarray.delete(newArr.length, yarray.length - newArr.length);
  }

  // Append new items
  if (newArr.length > yarray.length) {
    const toAdd = newArr.slice(yarray.length).map((item) => jsonToYType(item));
    yarray.push(toAdd);
  }
}

// ─── JSON Patch Operations ─────────────────────────────────────────

/**
 * Apply surgical patch operations to a Y.Doc's shared data.
 * Path strings use "/" as separator (e.g. "tracks/0/endFrame").
 *
 * Returns the binary update captured from the transaction.
 */
export function applyJsonPatch(
  doc: Y.Doc,
  fieldName: string,
  ops: PatchOp[],
  origin?: string,
): Uint8Array {
  let update: Uint8Array = new Uint8Array(0);
  const handler = (u: Uint8Array) => {
    update = u;
  };
  doc.on("update", handler);

  doc.transact(() => {
    for (const patchOp of ops) {
      applyOnePatch(doc, fieldName, patchOp);
    }
  }, origin);

  doc.off("update", handler);
  return update;
}

function applyOnePatch(doc: Y.Doc, fieldName: string, patchOp: PatchOp): void {
  const segments = patchOp.path ? patchOp.path.split("/") : [];

  switch (patchOp.op) {
    case "set": {
      if (segments.length === 0) return;
      const { parent, key } = navigateToParent(doc, fieldName, segments);
      if (!parent || key === undefined) return;
      if (parent instanceof Y.Map) {
        parent.set(key as string, jsonToYType(patchOp.value));
      } else if (parent instanceof Y.Array) {
        const idx = parseInt(key as string, 10);
        if (!isNaN(idx) && idx >= 0 && idx < parent.length) {
          parent.delete(idx, 1);
          parent.insert(idx, [jsonToYType(patchOp.value)]);
        }
      }
      break;
    }
    case "insert": {
      const target = navigateToTarget(doc, fieldName, segments);
      if (target instanceof Y.Array) {
        const idx = Math.min(patchOp.index, target.length);
        target.insert(idx, [jsonToYType(patchOp.value)]);
      }
      break;
    }
    case "delete": {
      if (segments.length === 0) return;
      const { parent, key } = navigateToParent(doc, fieldName, segments);
      if (!parent || key === undefined) return;
      if (parent instanceof Y.Map) {
        parent.delete(key as string);
      } else if (parent instanceof Y.Array) {
        const idx = parseInt(key as string, 10);
        if (!isNaN(idx) && idx >= 0 && idx < parent.length) {
          parent.delete(idx, 1);
        }
      }
      break;
    }
    case "move": {
      const target = navigateToTarget(doc, fieldName, segments);
      if (target instanceof Y.Array) {
        const { from, to } = patchOp;
        if (from < 0 || from >= target.length) return;
        const clampedTo = Math.min(Math.max(0, to), target.length - 1);
        if (from === clampedTo) return;
        const itemJson = yTypeToJson(target.get(from));
        target.delete(from, 1);
        const insertIdx = Math.min(clampedTo, target.length);
        target.insert(insertIdx, [jsonToYType(itemJson)]);
      }
      break;
    }
  }
}

/**
 * Navigate the Y.Map/Y.Array tree to the parent of the final segment.
 * Returns the parent and the last key/index segment.
 */
function navigateToParent(
  doc: Y.Doc,
  fieldName: string,
  segments: string[],
): { parent: Y.Map<any> | Y.Array<any> | null; key: string | undefined } {
  if (segments.length === 0) return { parent: null, key: undefined };

  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1];
  const parent = navigateToTarget(doc, fieldName, parentSegments);

  if (parent instanceof Y.Map || parent instanceof Y.Array) {
    return { parent, key };
  }
  return { parent: null, key };
}

/**
 * Navigate the Y.Map/Y.Array tree to the target at the given path segments.
 */
function navigateToTarget(
  doc: Y.Doc,
  fieldName: string,
  segments: string[],
): any {
  // Start with the root shared type — try map first, then array
  let current: any = doc.getMap(fieldName);
  if (current.size === 0) {
    const arr = doc.getArray(fieldName);
    if (arr.length > 0) {
      current = arr;
    }
  }

  for (const segment of segments) {
    if (current instanceof Y.Map) {
      current = current.get(segment);
    } else if (current instanceof Y.Array) {
      const idx = parseInt(segment, 10);
      if (isNaN(idx) || idx < 0 || idx >= current.length) return null;
      current = current.get(idx);
    } else {
      return null;
    }
  }
  return current;
}

// ─── Init Helper ────────────────────────────────────────────────────

/**
 * Create a new Y.Doc pre-populated with JSON data.
 * Returns the doc and its full state as a Uint8Array.
 */
export function initYDocWithJson(
  fieldName: string,
  json: any,
  type: "map" | "array",
): { doc: Y.Doc; state: Uint8Array } {
  const doc = new Y.Doc();
  seedYDocFromJson(doc, fieldName, json, type);
  const state = Y.encodeStateAsUpdate(doc);
  return { doc, state };
}

// ─── Utility ────────────────────────────────────────────────────────

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}
