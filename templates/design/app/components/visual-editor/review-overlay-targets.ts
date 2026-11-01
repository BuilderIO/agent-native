import { useSyncExternalStore } from "react";

// The screens whose comment overlay is mounted right now. The board overlay
// draws a screen's threads only while its screen is not in here: a frame too
// small on screen to be a live editor mounts no overlay, and its pins would
// otherwise vanish from the overview.
const EMPTY: ReadonlySet<string> = new Set();
const mounted = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = EMPTY;

function publish() {
  snapshot = mounted.size === 0 ? EMPTY : new Set(mounted.keys());
  for (const listener of listeners) listener();
}

export function registerReviewOverlayTarget(targetId: string): () => void {
  const count = mounted.get(targetId) ?? 0;
  mounted.set(targetId, count + 1);
  if (count === 0) publish();
  return () => {
    const remaining = (mounted.get(targetId) ?? 1) - 1;
    if (remaining > 0) {
      mounted.set(targetId, remaining);
      return;
    }
    mounted.delete(targetId);
    publish();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReviewOverlayTargets(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}
