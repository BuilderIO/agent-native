import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

export { useSyncExternalStore };

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | undefined,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const instRef = useRef<{ hasValue: boolean; value: Selection } | null>(null);
  if (instRef.current === null) {
    instRef.current = { hasValue: false, value: null as Selection };
  }
  const inst = instRef.current;
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const currentSelection = memoizedSelection;
      if (Object.is(memoizedSnapshot, nextSnapshot)) {
        return currentSelection;
      }
      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(currentSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return currentSelection;
      }
      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    return [
      () => memoizedSelector(getSnapshot()),
      getServerSnapshot === undefined
        ? undefined
        : () => memoizedSelector(getServerSnapshot()),
    ] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual, inst]);

  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection,
  );
  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [inst, value]);
  useDebugValue(value);
  return value;
}

// The upstream package is CommonJS. ESM consumers such as Zustand import its
// namespace through a default binding, while other consumers use named
// exports. Preserve both shapes so Rolldown can replace either entry without
// synthesizing CommonJS interop at runtime.
export default {
  useSyncExternalStore,
  useSyncExternalStoreWithSelector,
};
