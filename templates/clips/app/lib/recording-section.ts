import { useSyncExternalStore } from "react";

/**
 * Which sidebar section the open recording belongs to.
 *
 * A recording's address is `/r/<id>` whatever it is, so the sidebar cannot
 * tell from the address alone that a screenshot lives under Screenshots or a
 * clip under a space. The recording page knows — it builds the breadcrumb
 * from the same facts — and says so here, so the highlighted section and the
 * breadcrumb always agree.
 */
export type RecordingSection = "library" | "screenshots" | "spaces";

let current: RecordingSection | null = null;
const listeners = new Set<() => void>();

export function setRecordingSection(section: RecordingSection | null): void {
  if (section === current) return;
  current = section;
  listeners.forEach((listener) => listener());
}

export function useRecordingSection(): RecordingSection | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
