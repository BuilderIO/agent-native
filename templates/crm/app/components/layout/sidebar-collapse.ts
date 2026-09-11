export const CRM_SIDEBAR_COLLAPSE_KEY = "crm.sidebar.collapsed";

/** The slice of `window.localStorage` the sidebar depends on. */
export interface CollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getCollapseStorage(): CollapseStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage can be disabled outright (private mode, blocked cookies).
    return null;
  }
}

export function readSidebarCollapsed(
  storage: CollapseStorage | null | undefined,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(CRM_SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(
  storage: CollapseStorage | null | undefined,
  collapsed: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(CRM_SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // Quota or a blocked store — the preference simply does not persist.
  }
}
