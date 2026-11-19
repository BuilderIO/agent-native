import type { SourceHydrationState } from "./source-hydration";
import type { DesignFile, DesignFileMetadata } from "./types";

export type IdentityCache<T> = Map<
  string,
  { inputs: readonly unknown[]; value: T }
>;

/**
 * Builds one value per item and returns the cached value while every input is
 * `===` its previous value. Editor memos, layer-model caches and frame-type
 * WeakMaps key on file object identity, so rebuilding unchanged files turns one
 * arriving source into a full-editor recompute.
 */
export function buildById<I extends { id: string }, T>(
  cache: IdentityCache<T>,
  items: readonly I[],
  inputs: (item: I) => readonly unknown[],
  build: (item: I) => T,
): T[] {
  const seen = new Set<string>();
  const values = items.map((item) => {
    seen.add(item.id);
    const next = inputs(item);
    const cached = cache.get(item.id);
    if (
      cached &&
      cached.inputs.length === next.length &&
      cached.inputs.every((value, index) => value === next[index])
    )
      return cached.value;
    const value = build(item);
    cache.set(item.id, { inputs: next, value });
    return value;
  });
  for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
  return values;
}

export function reuseIdenticalList<T>(
  previous: readonly T[] | undefined,
  next: T[],
): T[] {
  return previous &&
    previous.length === next.length &&
    previous.every((value, index) => value === next[index])
    ? (previous as T[])
    : next;
}

/** Joins metadata with loaded sources; files whose source isn't ready are left out. */
export function hydrateDesignFiles(
  cache: IdentityCache<DesignFile | null>,
  previous: readonly DesignFile[] | undefined,
  metadata: readonly DesignFileMetadata[],
  sourceState: (id: string) => SourceHydrationState | undefined,
  dependencyStatus: (id: string) => DesignFile["sourceState"] | undefined,
): DesignFile[] {
  const files = buildById(
    cache,
    metadata,
    (file) => {
      const state = sourceState(file.id);
      if (state?.status !== "ready") return [file, null];
      return [
        file,
        state.content,
        state.updatedAt,
        state.refreshError ? "error" : (dependencyStatus(file.id) ?? "ready"),
      ];
    },
    (file) => {
      const state = sourceState(file.id);
      if (state?.status !== "ready") return null;
      return {
        ...file,
        content: state.content,
        updatedAt: state.updatedAt,
        sourceState: state.refreshError
          ? ("error" as const)
          : (dependencyStatus(file.id) ?? "ready"),
      };
    },
  ).filter((file): file is DesignFile => file !== null);
  return reuseIdenticalList(previous, files);
}
