import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
  type FC,
} from "react";

/**
 * External store for the page's header title + actions. We use an external
 * store (not React context) so that pages can inject ReactNode without
 * subscribing to the header state themselves — subscribing would trigger a
 * re-render on every update, which in turn creates new JSX, which updates
 * the store again, which re-renders… an infinite loop.
 *
 * Only <Header /> reads the store via useSyncExternalStore; pages only write.
 */

type Listener = () => void;

let currentTitle: ReactNode = null;
let currentActions: ReactNode = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Consumed only by <Header /> — returns the current title. */
export function useHeaderTitle(): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => currentTitle,
    () => currentTitle,
  );
}

/** Consumed only by <Header /> — returns the current actions slot. */
export function useHeaderActions(): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => currentActions,
    () => currentActions,
  );
}

/**
 * Provider is now a no-op wrapper for backwards compatibility — the state
 * lives in the module-level store above. Kept as a component so callers of
 * <HeaderActionsProvider> don't need to change.
 */
export const HeaderActionsProvider: FC<{ children: ReactNode }> = ({
  children,
}) => <>{children}</>;

/**
 * Mount a custom title into the app header. Cleans up on unmount.
 *
 * Pass a memoised node (useMemo / stable reference) to avoid triggering
 * notify() on every render. Inline JSX creates a new reference each render
 * which defeats the identity guard and can cause update loops.
 */
export function useSetPageTitle(node: ReactNode) {
  useEffect(() => {
    currentTitle = node;
    notify();
    return () => {
      if (currentTitle === node) {
        currentTitle = null;
        notify();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}

/** Mount ReactNode into the header's actions slot. Cleans up on unmount. */
export function useSetHeaderActions(node: ReactNode) {
  useEffect(() => {
    currentActions = node;
    notify();
    return () => {
      if (currentActions === node) {
        currentActions = null;
        notify();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}
