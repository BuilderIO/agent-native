export const DECK_FILTER_STORAGE_KEY = "slides:deck-filter";

export type DeckFilter = "all" | "mine";

export function resolveDeckFilter(
  createdByParam: string | null,
  storedFilter: DeckFilter | undefined,
): DeckFilter {
  if (createdByParam === "me") return "mine";
  if (createdByParam !== null) return "all";
  return storedFilter ?? "mine";
}

export function readStoredDeckFilter(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof window ===
  "undefined"
    ? null
    : window.localStorage,
): DeckFilter | undefined {
  if (!storage) return undefined;

  try {
    const stored = storage.getItem(DECK_FILTER_STORAGE_KEY);
    return stored === "all" || stored === "mine" ? stored : undefined;
  } catch {
    // coercion-ok: localStorage failures intentionally fall back to the default filter.
    return undefined;
  }
}

export function writeStoredDeckFilter(
  filter: DeckFilter,
  storage: Pick<Storage, "setItem"> | null | undefined = typeof window ===
  "undefined"
    ? null
    : window.localStorage,
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(DECK_FILTER_STORAGE_KEY, filter);
    return true;
  } catch {
    // coercion-ok: a non-persisted filter is an acceptable browser-storage fallback.
    return false;
  }
}
