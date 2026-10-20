import { useEffect, useSyncExternalStore } from "react";

let mountedSurfaces = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setMountedSurfaces(next: number): void {
  mountedSurfaces = next;
  for (const listener of listeners) listener();
}

export function useRegisterAgentChatSurface(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    setMountedSurfaces(mountedSurfaces + 1);
    return () => setMountedSurfaces(mountedSurfaces - 1);
  }, [enabled]);
}

export function useHasAgentChat(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mountedSurfaces > 0,
    () => false,
  );
}
