import { useSyncExternalStore } from "react";

import { getCrossScreenGhostStyle } from "./cross-screen-drop";
import type { Point } from "./types";

export interface CrossScreenDragGhost {
  boardX: number;
  boardY: number;
  width?: number;
  height?: number;
  dimmed?: boolean;
  background?: string;
  borderRadius?: string;
}

export interface CrossScreenGhostStore {
  get: () => CrossScreenDragGhost | null;
  set: (ghost: CrossScreenDragGhost | null) => void;
  subscribe: (listener: () => void) => () => void;
}

function sameGhost(
  a: CrossScreenDragGhost | null,
  b: CrossScreenDragGhost | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.boardX === b.boardX &&
    a.boardY === b.boardY &&
    a.width === b.width &&
    a.height === b.height &&
    a.dimmed === b.dimmed &&
    a.background === b.background &&
    a.borderRadius === b.borderRadius
  );
}

export function createCrossScreenGhostStore(): CrossScreenGhostStore {
  let ghost: CrossScreenDragGhost | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => ghost,
    set: (next) => {
      if (sameGhost(ghost, next)) return;
      ghost = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function CrossScreenDragGhostLayer({
  store,
  pan,
  scale,
}: {
  store: CrossScreenGhostStore;
  pan: Point;
  scale: number;
}) {
  const ghost = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (!ghost) return null;
  return (
    <span
      data-cross-screen-drag-ghost
      className="pointer-events-none absolute z-40 rounded border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]/20 shadow"
      style={{
        ...getCrossScreenGhostStyle({ ghost, pan, scale }),
        opacity: ghost.dimmed ? 0.75 : 1,
        background: ghost.background,
        borderRadius: ghost.borderRadius,
      }}
    />
  );
}
