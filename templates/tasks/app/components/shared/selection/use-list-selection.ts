import { setClientAppState } from "@agent-native/core/client/application-state";
import { type ListSelectionAppState } from "@shared/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { TAB_ID } from "@/lib/tab-id";

function useSelectionAppStateSync(
  appStateKey: string | null,
  selectionMode: boolean,
  selectedIds: Set<string>,
) {
  const selectedIdsArray = Array.from(selectedIds);

  useEffect(() => {
    if (appStateKey === null) return;

    const hasSelection = selectionMode || selectedIdsArray.length > 0;
    const value: ListSelectionAppState | null = hasSelection
      ? { selectionMode, selectedIds: selectedIdsArray }
      : null;

    void setClientAppState(appStateKey, value, {
      requestSource: TAB_ID,
    });
  }, [appStateKey, selectionMode, selectedIdsArray.join("\0")]);
}

export type ListSelectionState<T extends { id: string }> = {
  selectionMode: boolean;
  selectedItems: T[];
};

export type ListSelectionActions = {
  clearSelection: () => void;
  setSelectionModeFromHeader: (next: boolean) => void;
  selectRow: (id: string, event: MouseEvent<Element>) => void;
  startSelection: (id: string) => void;
  selectAll: () => void;
};

export type ListSelection<T extends { id: string }> = {
  state: ListSelectionState<T>;
  actions: ListSelectionActions;
};

export function useListSelection<T extends { id: string }>(
  items: T[],
  appStateKey: string | null,
): ListSelection<T> {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastSelectedIndexRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  useSelectionAppStateSync(appStateKey, selectionMode, selectedIds);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(items.map((item) => item.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
    lastSelectedIndexRef.current = null;
  }, []);

  const setSelectionModeFromHeader = useCallback((next: boolean) => {
    if (!next) {
      setSelectedIds(new Set());
      lastSelectedIndexRef.current = null;
    }
    setSelectionMode(next);
  }, []);

  const selectRow = useCallback((id: string, event: MouseEvent<Element>) => {
    const visibleItems = itemsRef.current;
    const index = visibleItems.findIndex((item) => item.id === id);
    if (index < 0) return;

    if (event.shiftKey && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      const rangeIds = visibleItems
        .slice(start, end + 1)
        .map((item) => item.id);
      setSelectedIds((prev) => new Set([...prev, ...rangeIds]));
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastSelectedIndexRef.current = index;
  }, []);

  const startSelection = useCallback((id: string) => {
    const visibleItems = itemsRef.current;
    const index = visibleItems.findIndex((item) => item.id === id);
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
    lastSelectedIndexRef.current = index >= 0 ? index : null;
  }, []);

  const selectAll = useCallback(() => {
    const visibleItems = itemsRef.current;
    setSelectedIds((prev) => {
      const allVisibleSelected =
        visibleItems.length > 0 &&
        visibleItems.every((item) => prev.has(item.id));
      if (allVisibleSelected) {
        return new Set();
      }
      return new Set(visibleItems.map((item) => item.id));
    });
  }, []);

  const actions = useMemo(
    () => ({
      clearSelection,
      setSelectionModeFromHeader,
      selectRow,
      startSelection,
      selectAll,
    }),
    [
      clearSelection,
      setSelectionModeFromHeader,
      selectRow,
      startSelection,
      selectAll,
    ],
  );

  useEffect(() => {
    if (!selectionMode) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA")
        ) {
          return;
        }
        event.preventDefault();
        selectAll();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectionMode, clearSelection, selectAll]);

  return {
    state: {
      selectionMode,
      selectedItems,
    },
    actions,
  };
}
