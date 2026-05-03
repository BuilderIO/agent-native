import { useEffect, useSyncExternalStore, type ReactNode } from "react";

/**
 * External store for the page's header title + actions used by the
 * "standard layout" (settings, team, tools, draft-queue). The inbox
 * view has its own bespoke header and ignores this store.
 *
 * We use an external store (not React context) so that pages can mount
 * ReactNode without subscribing — subscribing would re-render and create
 * new JSX every render, which would update the store again, infinite-looping.
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

export function useHeaderTitle(): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => currentTitle,
    () => currentTitle,
  );
}

export function useHeaderActions(): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => currentActions,
    () => currentActions,
  );
}

export function useSetPageTitle(node: ReactNode) {
  useEffect(() => {
    currentTitle = node;
    notify();
    return () => {
      currentTitle = null;
      notify();
    };
  });
}

export function useSetHeaderActions(node: ReactNode) {
  useEffect(() => {
    currentActions = node;
    notify();
    return () => {
      currentActions = null;
      notify();
    };
  });
}
