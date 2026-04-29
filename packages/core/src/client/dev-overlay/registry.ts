/**
 * Client-side registry for dev-overlay panels.
 *
 * Panels register at module load (or via React effect) and the overlay reads
 * from this registry on each render. Re-registering the same id replaces the
 * previous panel — templates can override framework defaults.
 */

import type { DevPanel } from "./types.js";

const panels = new Map<string, DevPanel>();
const listeners = new Set<() => void>();
// Cache the sorted snapshot so useSyncExternalStore receives a stable
// reference between unrelated renders. Recomputed lazily on the next read
// after `emit()`.
let cachedSnapshot: DevPanel[] | null = [];

function invalidateSnapshot() {
  cachedSnapshot = null;
}

function emit() {
  invalidateSnapshot();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // listeners are UI subscribers — never let one break the others
    }
  }
}

export function registerDevPanel(panel: DevPanel): () => void {
  if (!panel || typeof panel.id !== "string" || !panel.id) {
    throw new Error("registerDevPanel: panel.id is required");
  }
  panels.set(panel.id, panel);
  emit();
  return () => {
    if (panels.get(panel.id) === panel) {
      panels.delete(panel.id);
      emit();
    }
  };
}

export function unregisterDevPanel(id: string): void {
  if (panels.delete(id)) emit();
}

export function listDevPanels(): DevPanel[] {
  if (cachedSnapshot) return cachedSnapshot;
  cachedSnapshot = Array.from(panels.values()).sort((a, b) => {
    const aOrder = a.order ?? 100;
    const bOrder = b.order ?? 100;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.label.localeCompare(b.label);
  });
  return cachedSnapshot;
}

export function subscribeDevPanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
