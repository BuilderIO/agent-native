export const LEFT_SIDEBAR_WIDTH_STORAGE_KEY = "design.editor.leftSidebarWidth";
export const INSPECTOR_WIDTH_STORAGE_KEY = "design.editor.inspectorWidth";

/**
 * The remembered column width, or null when none is stored or storage cannot
 * be read. Callers clamp it: a width stored under older limits must not
 * render outside the current ones.
 */
export function readStoredSidebarWidth(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredSidebarWidth(key: string, width: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(width));
  } catch {
    // Storage unavailable or full: the width is a UI preference, so the
    // column keeps working at its current width for this session.
  }
}
