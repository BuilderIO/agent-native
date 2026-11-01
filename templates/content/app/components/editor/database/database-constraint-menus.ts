import { useSyncExternalStore } from "react";

/** Which of the active-constraints bar's menus is open. */
export type ConstraintMenusState = {
  addFilter: boolean;
  advancedFilter: boolean;
  filterIndex: number | null;
  sortIndex: number | null;
};

const ALL_CLOSED: ConstraintMenusState = {
  addFilter: false,
  advancedFilter: false,
  filterIndex: null,
  sortIndex: null,
};

/**
 * Holds the bar's open menus outside the table's React state: opening or
 * closing a filter or sort chip then re-renders only the bar, not every column
 * header and row of a large table.
 */
export function createConstraintMenus() {
  let state = ALL_CLOSED;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ConstraintMenusState>) => {
    const next = { ...state, ...patch };
    if (
      next.addFilter === state.addFilter &&
      next.advancedFilter === state.advancedFilter &&
      next.filterIndex === state.filterIndex &&
      next.sortIndex === state.sortIndex
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    set,
    closeAll: () => set(ALL_CLOSED),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type ConstraintMenus = ReturnType<typeof createConstraintMenus>;

export function useConstraintMenusState(menus: ConstraintMenus) {
  return useSyncExternalStore(menus.subscribe, menus.get, menus.get);
}
