import { useEffect, useSyncExternalStore, type ReactNode } from "react";


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
    if (currentActions !== node) {
      currentActions = node;
      notify();
    }
    return () => {
      if (currentActions === node) {
        currentActions = null;
        notify();
      }
    };
  });
}
