
import * as Y from "yjs";


export type PatchOp =
  | { op: "set"; path: string; value: any }
  | { op: "insert"; path: string; index: number; value: any }
  | { op: "delete"; path: string }
  | { op: "move"; path: string; from: number; to: number };


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


export function yMapToJson(ymap: Y.Map<any>): Record<string, any> {
  const result: Record<string, any> = {};
  ymap.forEach((value, key) => {
    result[key] = yTypeToJson(value);
  });
  return result;
}

export function yArrayToJson(yarray: Y.Array<any>): any[] {
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

export function yDocToJson(doc: Y.Doc, fieldName: string): any {
  const existing = doc.share.get(fieldName);
  if (existing instanceof Y.Array) return yArrayToJson(existing);
  if (existing instanceof Y.Map) return yMapToJson(existing);
  return {};
}


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

function diffMap(ymap: Y.Map<any>, newObj: Record<string, any>): void {
  const keysToDelete: string[] = [];
  ymap.forEach((_value, key) => {
    if (!(key in newObj)) {
      keysToDelete.push(key);
    }
  });
  for (const key of keysToDelete) {
    ymap.delete(key);
  }

  for (const [key, newValue] of Object.entries(newObj)) {
    const existing = ymap.get(key);

    if (existing instanceof Y.Map && isPlainObject(newValue)) {
      diffMap(existing, newValue);
    } else if (existing instanceof Y.Array && Array.isArray(newValue)) {
      diffArray(existing, newValue);
    } else if (!deepEqual(yTypeToJson(existing), newValue)) {
      ymap.set(key, jsonToYType(newValue));
    }
  }
}

function diffArray(yarray: Y.Array<any>, newArr: any[]): void {
  const hasIds =
    newArr.length > 0 &&
    newArr.every((item) => item && typeof item === "object" && "id" in item);

  if (hasIds) {
    diffArrayById(yarray, newArr);
  } else {
    diffArrayByIndex(yarray, newArr);
  }
}

function diffArrayById(yarray: Y.Array<any>, newArr: any[]): void {
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

  const newIds = new Set(newArr.map((item) => String(item.id)));

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

  for (let i = 0; i < newArr.length; i++) {
    const newItem = newArr[i];
    const newId = String(newItem.id);
    const currentItem = i < yarray.length ? yarray.get(i) : null;
    const currentId =
      currentItem instanceof Y.Map ? currentItem.get("id") : undefined;

    if (currentId !== undefined && String(currentId) === newId) {
      if (currentItem instanceof Y.Map && isPlainObject(newItem)) {
        diffMap(currentItem, newItem);
      }
    } else {
      const existingEntry = existingMap.get(newId);
      if (existingEntry && existingEntry.yitem instanceof Y.Map) {
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
          const itemJson = yTypeToJson(yarray.get(currentIdx));
          yarray.delete(currentIdx, 1);
          const insertIdx = Math.min(i, yarray.length);
          yarray.insert(insertIdx, [jsonToYType(itemJson)]);
          const movedItem = yarray.get(insertIdx);
          if (movedItem instanceof Y.Map && isPlainObject(newItem)) {
            diffMap(movedItem, newItem);
          }
        } else if (currentIdx === -1) {
          const insertIdx = Math.min(i, yarray.length);
          yarray.insert(insertIdx, [jsonToYType(newItem)]);
        }
      } else {
        const insertIdx = Math.min(i, yarray.length);
        yarray.insert(insertIdx, [jsonToYType(newItem)]);
      }
    }
  }

  while (yarray.length > newArr.length) {
    yarray.delete(yarray.length - 1, 1);
  }
}

function diffArrayByIndex(yarray: Y.Array<any>, newArr: any[]): void {
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

  if (yarray.length > newArr.length) {
    yarray.delete(newArr.length, yarray.length - newArr.length);
  }

  if (newArr.length > yarray.length) {
    const toAdd = newArr.slice(yarray.length).map((item) => jsonToYType(item));
    yarray.push(toAdd);
  }
}


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

function navigateToTarget(
  doc: Y.Doc,
  fieldName: string,
  segments: string[],
): any {
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
