/**
 * Client-side React hooks for collaborative structured data (JSON)
 * editing via Yjs Y.Map and Y.Array.
 *
 * Composes on the existing useCollaborativeDoc() hook for transport/sync.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import * as Y from "yjs";
import {
  useCollaborativeDoc,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
  type CollabUser,
} from "./client.js";

// ─── Client-side Y.Map/Y.Array → JSON converters ───────────────────
// Duplicated from json-to-yjs.ts since this is a client module and
// cannot import server modules.

function yMapToJson(ymap: Y.Map<any>): Record<string, any> {
  const result: Record<string, any> = {};
  ymap.forEach((value, key) => {
    result[key] = yTypeToJson(value);
  });
  return result;
}

function yArrayToJson(yarray: Y.Array<any>): any[] {
  const result: any[] = [];
  for (let i = 0; i < yarray.length; i++) {
    result.push(yTypeToJson(yarray.get(i)));
  }
  return result;
}

function yTypeToJson(value: any): any {
  if (value instanceof Y.Map) return yMapToJson(value);
  if (value instanceof Y.Array) return yArrayToJson(value);
  return value;
}

/** Recursively convert a plain JS value into a Yjs shared type. */
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
  return value;
}

// ─── useCollaborativeMap ────────────────────────────────────────────

export interface UseCollaborativeMapOptions extends UseCollaborativeDocOptions {
  /** Name of the shared Y.Map field. Default: "data" */
  fieldName?: string;
}

export interface UseCollaborativeMapResult<
  T extends Record<string, any>,
> extends UseCollaborativeDocResult {
  /** Reactive plain JS snapshot of the Y.Map state. Null until loaded. */
  data: T | null;
  /** Replace the full map state via diff. */
  update: (newData: T) => void;
  /** Set a single value at a "/" separated path. */
  patch: (path: string, value: any) => void;
}

export function useCollaborativeMap<T extends Record<string, any>>(
  options: UseCollaborativeMapOptions,
): UseCollaborativeMapResult<T> {
  const { fieldName = "data", ...docOptions } = options;
  const collabResult = useCollaborativeDoc(docOptions);
  const { ydoc } = collabResult;

  const [data, setData] = useState<T | null>(null);

  // Get the Y.Map and observe deep changes
  useEffect(() => {
    if (!ydoc) {
      setData(null);
      return;
    }

    const ymap = ydoc.getMap(fieldName);

    const syncState = () => {
      if (ymap.size > 0) {
        setData(yMapToJson(ymap) as T);
      } else {
        setData(null);
      }
    };

    // Initial sync
    syncState();

    // Observe deep changes (nested maps/arrays)
    const handler = () => syncState();
    ymap.observeDeep(handler);

    return () => {
      ymap.unobserveDeep(handler);
    };
  }, [ydoc, fieldName]);

  const update = useCallback(
    (newData: T) => {
      if (!ydoc) return;
      const ymap = ydoc.getMap(fieldName);
      ydoc.transact(() => {
        // Remove keys not in newData
        const keysToDelete: string[] = [];
        ymap.forEach((_v, k) => {
          if (!(k in newData)) keysToDelete.push(k);
        });
        for (const k of keysToDelete) ymap.delete(k);

        // Set changed values
        for (const [k, v] of Object.entries(newData)) {
          const existing = ymap.get(k);
          const existingJson = yTypeToJson(existing);
          if (!deepEqual(existingJson, v)) {
            ymap.set(k, jsonToYType(v));
          }
        }
      });
    },
    [ydoc, fieldName],
  );

  const patch = useCallback(
    (path: string, value: any) => {
      if (!ydoc) return;
      const segments = path.split("/");
      if (segments.length === 0) return;

      ydoc.transact(() => {
        let current: any = ydoc.getMap(fieldName);
        // Navigate to parent
        for (let i = 0; i < segments.length - 1; i++) {
          const seg = segments[i];
          if (current instanceof Y.Map) {
            current = current.get(seg);
          } else if (current instanceof Y.Array) {
            const idx = parseInt(seg, 10);
            if (isNaN(idx) || idx < 0 || idx >= current.length) return;
            current = current.get(idx);
          } else {
            return;
          }
        }

        const lastSeg = segments[segments.length - 1];
        if (current instanceof Y.Map) {
          current.set(lastSeg, jsonToYType(value));
        } else if (current instanceof Y.Array) {
          const idx = parseInt(lastSeg, 10);
          if (!isNaN(idx) && idx >= 0 && idx < current.length) {
            current.delete(idx, 1);
            current.insert(idx, [jsonToYType(value)]);
          }
        }
      });
    },
    [ydoc, fieldName],
  );

  return { ...collabResult, data, update, patch };
}

// ─── useCollaborativeArray ──────────────────────────────────────────

export interface UseCollaborativeArrayOptions extends UseCollaborativeDocOptions {
  /** Name of the shared Y.Array field. Default: "data" */
  fieldName?: string;
}

export interface UseCollaborativeArrayResult<
  T,
> extends UseCollaborativeDocResult {
  /** Reactive plain JS snapshot of the Y.Array state. */
  data: T[];
  /** Append an item to the end. */
  push: (item: T) => void;
  /** Insert an item at a specific index. */
  insert: (index: number, item: T) => void;
  /** Remove an item at a specific index. */
  remove: (index: number) => void;
  /** Move an item from one index to another. */
  move: (from: number, to: number) => void;
  /** Update fields on the Y.Map at a specific array index. */
  updateItem: (index: number, patch: Partial<T>) => void;
  /** Replace the entire array contents. */
  replace: (items: T[]) => void;
}

export function useCollaborativeArray<T>(
  options: UseCollaborativeArrayOptions,
): UseCollaborativeArrayResult<T> {
  const { fieldName = "data", ...docOptions } = options;
  const collabResult = useCollaborativeDoc(docOptions);
  const { ydoc } = collabResult;

  const [data, setData] = useState<T[]>([]);

  // Get the Y.Array and observe deep changes
  useEffect(() => {
    if (!ydoc) {
      setData([]);
      return;
    }

    const yarray = ydoc.getArray(fieldName);

    const syncState = () => {
      setData(yArrayToJson(yarray) as T[]);
    };

    // Initial sync
    syncState();

    // Observe deep changes
    const handler = () => syncState();
    yarray.observeDeep(handler);

    return () => {
      yarray.unobserveDeep(handler);
    };
  }, [ydoc, fieldName]);

  const push = useCallback(
    (item: T) => {
      if (!ydoc) return;
      const yarray = ydoc.getArray(fieldName);
      yarray.push([jsonToYType(item)]);
    },
    [ydoc, fieldName],
  );

  const insert = useCallback(
    (index: number, item: T) => {
      if (!ydoc) return;
      const yarray = ydoc.getArray(fieldName);
      const idx = Math.min(Math.max(0, index), yarray.length);
      yarray.insert(idx, [jsonToYType(item)]);
    },
    [ydoc, fieldName],
  );

  const remove = useCallback(
    (index: number) => {
      if (!ydoc) return;
      const yarray = ydoc.getArray(fieldName);
      if (index >= 0 && index < yarray.length) {
        yarray.delete(index, 1);
      }
    },
    [ydoc, fieldName],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (!ydoc) return;
      const yarray = ydoc.getArray(fieldName);
      if (from < 0 || from >= yarray.length) return;
      const clampedTo = Math.min(Math.max(0, to), yarray.length - 1);
      if (from === clampedTo) return;

      ydoc.transact(() => {
        const itemJson = yTypeToJson(yarray.get(from));
        yarray.delete(from, 1);
        const insertIdx = Math.min(clampedTo, yarray.length);
        yarray.insert(insertIdx, [jsonToYType(itemJson)]);
      });
    },
    [ydoc, fieldName],
  );

  const updateItem = useCallback(
    (index: number, patchData: Partial<T>) => {
      if (!ydoc) return;
      const yarray = ydoc.getArray(fieldName);
      if (index < 0 || index >= yarray.length) return;

      const item = yarray.get(index);
      if (item instanceof Y.Map) {
        ydoc.transact(() => {
          for (const [k, v] of Object.entries(patchData as any)) {
            item.set(k, jsonToYType(v));
          }
        });
      }
    },
    [ydoc, fieldName],
  );

  const replace = useCallback(
    (items: T[]) => {
      if (!ydoc) return;
      const yarray = ydoc.getArray(fieldName);
      ydoc.transact(() => {
        yarray.delete(0, yarray.length);
        const yItems = items.map((item) => jsonToYType(item));
        yarray.push(yItems);
      });
    },
    [ydoc, fieldName],
  );

  return {
    ...collabResult,
    data,
    push,
    insert,
    remove,
    move,
    updateItem,
    replace,
  };
}

// ─── Utility ────────────────────────────────────────────────────────

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

// Re-export types from client.ts for convenience
export type {
  CollabUser,
  UseCollaborativeDocOptions,
  UseCollaborativeDocResult,
};
