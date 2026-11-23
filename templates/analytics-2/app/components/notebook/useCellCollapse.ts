import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Which half of a cell a collapse preference applies to. */
export type CellCollapseTarget = "source" | "output";

/** The part of a cell's identity a collapse preference is remembered under. */
export interface CellCollapseIdentity {
  cellId: string;
  projectId?: string | null | undefined;
  workspaceId?: string | null | undefined;
}

/** The slice of Web Storage this module needs; tests pass an in-memory stand-in. */
export type CollapseStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type CollapseStorageResolver = () => CollapseStorage | null;

const STORAGE_PREFIX = "notebook";

function scopeSegment(value: string | null | undefined): string {
  return encodeURIComponent(value ?? "");
}

/**
 * The storage key for one cell's source or output collapse preference.
 *
 * Scoping by workspace and project keeps two cells with a recycled id apart in
 * different projects. Returns null for an identity that has no usable cell id,
 * in which case the preference stays in memory for this page's lifetime.
 */
export function cellCollapseStorageKey(
  identity: CellCollapseIdentity,
  target: CellCollapseTarget,
): string | null {
  if (identity.cellId.trim() === "") return null;
  return [
    STORAGE_PREFIX,
    "workspace",
    scopeSegment(identity.workspaceId),
    "project",
    scopeSegment(identity.projectId),
    "cell",
    scopeSegment(identity.cellId),
    target,
    "collapsed",
  ].join(":");
}

/**
 * Resolve storage without writing during a render. Reads and writes each handle
 * unavailable storage and fall back to the page's presentation state.
 */
export const resolveWebCollapseStorage: CollapseStorageResolver = () => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

export interface CollapseStore {
  /** False whenever the preference was never set, or cannot be read. */
  get: (key: string | null) => boolean;
  /** Persists where possible, falling back to memory, then notifies readers. */
  set: (key: string | null, collapsed: boolean) => void;
  subscribe: (key: string | null, listener: () => void) => () => void;
}

/**
 * Per-key collapse preferences backed by Web Storage, with an in-memory
 * fallback so the control still toggles where storage is unavailable or a
 * stored value is malformed.
 *
 * Values are stored as JSON booleans, matching how the rest of the surface
 * remembers simple preferences, and an unreadable value is treated as unset
 * instead of as "collapsed".
 */
export function createCollapseStore(
  resolveStorage: CollapseStorageResolver = resolveWebCollapseStorage,
): CollapseStore {
  const memory = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();

  const readStored = (storage: CollapseStorage | null, key: string) => {
    if (storage == null) return null;
    try {
      const raw = storage.getItem(key);
      if (raw == null) return null;
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "boolean" ? parsed : null;
    } catch {
      return null;
    }
  };

  return {
    get(key) {
      if (key == null) return false;
      // The latest page-local toggle remains usable even if storage reads fail.
      const remembered = memory.get(key);
      if (remembered != null) return remembered;
      return readStored(resolveStorage(), key) ?? false;
    },
    set(key, collapsed) {
      if (key == null) return;
      const storage = resolveStorage();
      if (storage != null) {
        try {
          storage.setItem(key, JSON.stringify(collapsed));
        } catch {
          // The preference still works for this page when persistence fails.
        }
      }
      memory.set(key, collapsed);
      for (const listener of listeners.get(key) ?? []) listener();
    },
    subscribe(key, listener) {
      if (key == null) return () => {};
      let keyListeners = listeners.get(key);
      if (keyListeners == null) {
        keyListeners = new Set();
        listeners.set(key, keyListeners);
      }
      keyListeners.add(listener);
      return () => {
        keyListeners.delete(listener);
        if (keyListeners.size === 0) listeners.delete(key);
      };
    },
  };
}

/** The store every cell on the page shares. */
export const cellCollapseStore: CollapseStore = createCollapseStore();

export type SetCollapsed = (
  next: boolean | ((previous: boolean) => boolean),
) => void;

export interface CellCollapsedState {
  sourceCollapsed: boolean;
  outputCollapsed: boolean;
  setSourceCollapsed: SetCollapsed;
  setOutputCollapsed: SetCollapsed;
  toggleSourceCollapsed: () => void;
  toggleOutputCollapsed: () => void;
}

function useCollapsedValue(key: string | null): [boolean, SetCollapsed] {
  const subscribe = useCallback(
    (listener: () => void) => cellCollapseStore.subscribe(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => cellCollapseStore.get(key), [key]);
  // The first paint has no storage to read, so it renders expanded and React
  // re-reads after hydration instead of mismatching the server markup.
  const getServerSnapshot = useCallback(() => false, []);

  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setCollapsed = useCallback<SetCollapsed>(
    (next) => {
      const previous = cellCollapseStore.get(key);
      const value = typeof next === "function" ? next(previous) : next;
      if (value === previous) return;
      cellCollapseStore.set(key, value);
    },
    [key],
  );

  return [collapsed, setCollapsed];
}

/**
 * Independent source and output collapse preferences for one cell.
 *
 * Each cell id gets its own pair of keys, so collapsing one cell's code does
 * not touch its result, its neighbour, or any other project.
 */
export function useCellCollapsed(
  identity: CellCollapseIdentity,
): CellCollapsedState {
  const { cellId, projectId, workspaceId } = identity;
  const sourceKey = useMemo(
    () => cellCollapseStorageKey({ cellId, projectId, workspaceId }, "source"),
    [cellId, projectId, workspaceId],
  );
  const outputKey = useMemo(
    () => cellCollapseStorageKey({ cellId, projectId, workspaceId }, "output"),
    [cellId, projectId, workspaceId],
  );

  const [sourceCollapsed, setSourceCollapsed] = useCollapsedValue(sourceKey);
  const [outputCollapsed, setOutputCollapsed] = useCollapsedValue(outputKey);

  const toggleSourceCollapsed = useCallback(() => {
    setSourceCollapsed((previous) => !previous);
  }, [setSourceCollapsed]);
  const toggleOutputCollapsed = useCallback(() => {
    setOutputCollapsed((previous) => !previous);
  }, [setOutputCollapsed]);

  return {
    sourceCollapsed,
    outputCollapsed,
    setSourceCollapsed,
    setOutputCollapsed,
    toggleSourceCollapsed,
    toggleOutputCollapsed,
  };
}
