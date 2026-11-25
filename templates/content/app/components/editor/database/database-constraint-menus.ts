import { useSyncExternalStore } from "react";

/** Which of the active-constraints bar's menus is open. */
export type ConstraintMenusState = {
  sortIndex: number | null;
};

const ALL_CLOSED: ConstraintMenusState = {
  sortIndex: null,
};

export function createConstraintMenus() {
  let state = ALL_CLOSED;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ConstraintMenusState>) => {
    const next = { ...state, ...patch };
    if (next.sortIndex === state.sortIndex) return;
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
