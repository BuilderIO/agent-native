import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";

export type SidebarCollapsePersistenceStatus =
  | "available"
  | "invalid"
  | "unavailable";

export interface UsePersistentSidebarCollapsedOptions {
  storageKey: string;
  defaultCollapsed?: boolean;
}

export interface PersistentSidebarCollapsedState {
  collapsed: boolean;
  persistenceStatus: SidebarCollapsePersistenceStatus;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
}

interface StoredSidebarState {
  collapsed: boolean;
  persistenceStatus: SidebarCollapsePersistenceStatus;
}

function readStoredSidebarState(
  storageKey: string,
  defaultCollapsed: boolean,
): StoredSidebarState {
  if (typeof window === "undefined") {
    return { collapsed: defaultCollapsed, persistenceStatus: "unavailable" };
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) {
      return { collapsed: defaultCollapsed, persistenceStatus: "available" };
    }
    if (stored === "true") {
      return { collapsed: true, persistenceStatus: "available" };
    }
    if (stored === "false") {
      return { collapsed: false, persistenceStatus: "available" };
    }
    return { collapsed: defaultCollapsed, persistenceStatus: "invalid" };
  } catch {
    return { collapsed: defaultCollapsed, persistenceStatus: "unavailable" };
  }
}

export function usePersistentSidebarCollapsed({
  storageKey,
  defaultCollapsed = false,
}: UsePersistentSidebarCollapsedOptions): PersistentSidebarCollapsedState {
  const [state, setState] = useState<StoredSidebarState>(() =>
    readStoredSidebarState(storageKey, defaultCollapsed),
  );
  const collapsedRef = useRef(state.collapsed);

  const setCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>(
    (next) => {
      const collapsed =
        typeof next === "function" ? next(collapsedRef.current) : next;
      collapsedRef.current = collapsed;

      let persistenceStatus: SidebarCollapsePersistenceStatus = "available";
      try {
        if (typeof window === "undefined") {
          persistenceStatus = "unavailable";
        } else {
          window.localStorage.setItem(storageKey, String(collapsed));
        }
      } catch {
        persistenceStatus = "unavailable";
      }

      setState({ collapsed, persistenceStatus });
    },
    [storageKey],
  );

  return { ...state, setCollapsed };
}
