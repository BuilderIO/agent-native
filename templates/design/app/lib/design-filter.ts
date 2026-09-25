export const DESIGN_FILTER_STORAGE_KEY = "design:design-filter";

export type DesignFilter = "recent" | "shared";

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    // coercion-ok: unavailable browser storage intentionally falls back to the default filter.
    return null;
  }
}

export function readStoredDesignFilter(
  storage: Pick<Storage, "getItem"> | null | undefined = getLocalStorage(),
): DesignFilter | undefined {
  if (!storage) return undefined;

  try {
    const stored = storage.getItem(DESIGN_FILTER_STORAGE_KEY);
    if (stored === "recent" || stored === "shared") return stored;
    if (stored === "mine") return "recent";
    if (stored === "all") return "shared";
    return undefined;
  } catch {
    // coercion-ok: localStorage failures intentionally fall back to the default filter.
    return undefined;
  }
}

export function writeStoredDesignFilter(
  filter: DesignFilter,
  storage: Pick<Storage, "setItem"> | null | undefined = getLocalStorage(),
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(DESIGN_FILTER_STORAGE_KEY, filter);
    return true;
  } catch {
    // coercion-ok: a non-persisted filter is an acceptable browser-storage fallback.
    return false;
  }
}
