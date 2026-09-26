// in-process, globalThis-keyed promise chain per scope key. This only

const LOCK_KEY = "__contentPositionLocks" as const;
type GlobalWithLocks = typeof globalThis & {
  [LOCK_KEY]?: Map<string, Promise<unknown>>;
};
const globalRef = globalThis as GlobalWithLocks;
if (!globalRef[LOCK_KEY]) {
  globalRef[LOCK_KEY] = new Map<string, Promise<unknown>>();
}
const positionLocks: Map<string, Promise<unknown>> = globalRef[LOCK_KEY]!;

const MAX_DATABASE_POSITION = 2_147_483_647;

export function nextAppendPosition(max: unknown): number {
  const raw = max ?? -1;
  const normalized = typeof raw === "string" ? raw.trim() : raw;
  const value =
    typeof normalized === "number"
      ? normalized
      : typeof normalized === "string" && /^-?\d+$/.test(normalized)
        ? Number(normalized)
        : Number.NaN;

  if (!Number.isSafeInteger(value)) {
    throw new Error("Database position is outside the supported range.");
  }
  if (value < 0) return 0;

  const next = value + 1;
  if (!Number.isSafeInteger(next) || next > MAX_DATABASE_POSITION) {
    throw new Error("Database position is outside the supported range.");
  }
  return next;
}

export function createAppendPositionAllocator(max: unknown): () => number {
  let previous = max;
  return () => {
    const next = nextAppendPosition(previous);
    previous = next;
    return next;
  };
}

export function withPositionLock<T>(
  scopeKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = positionLocks.get(scopeKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  positionLocks.set(scopeKey, next);
  next
    .finally(() => {
      if (positionLocks.get(scopeKey) === next) positionLocks.delete(scopeKey);
    })
    .catch(() => {});
  return next;
}

export function documentsPositionScope(
  ownerEmail: string,
  parentId: string | null | undefined,
): string {
  return `documents:${ownerEmail}:${parentId ?? "root"}`;
}

export function databaseItemsPositionScope(databaseId: string): string {
  return `contentDatabaseItems:${databaseId}`;
}

export function propertyDefinitionsPositionScope(databaseId: string): string {
  return `documentPropertyDefinitions:${databaseId}`;
}
