export type ItemsScope = "needs_you" | "parked" | "dismissed" | "all";

export interface ItemsFilterState {
  scope: ItemsScope;
  workflowId: string | null;
  source: string | null;
  search: string;
}

export const DEFAULT_ITEMS_FILTERS: ItemsFilterState = {
  scope: "needs_you",
  workflowId: null,
  source: null,
  search: "",
};

/** The action caps a search at this many characters. */
const SEARCH_MAX_CHARS = 100;
const ITEMS_PAGE_SIZE = 25;

/** The input of `list-workflow-items` for what the filters say. */
export function itemsQueryParams(
  factoryId: string,
  filters: ItemsFilterState,
): Record<string, unknown> {
  const search = filters.search.trim().slice(0, SEARCH_MAX_CHARS);
  return {
    factoryId,
    limit: ITEMS_PAGE_SIZE,
    ...(filters.scope === "needs_you" ? { needsYou: true } : {}),
    ...(filters.scope === "parked" ? { parked: true } : {}),
    ...(filters.scope === "dismissed" ? { status: ["dismissed"] } : {}),
    ...(filters.workflowId ? { workflowId: filters.workflowId } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(search ? { search } : {}),
  };
}

/** Anything beyond the segment: those are what "Clear filters" resets. */
export function hasNarrowingFilters(filters: ItemsFilterState): boolean {
  return (
    filters.workflowId !== null ||
    filters.source !== null ||
    filters.search.trim() !== ""
  );
}

export function clearNarrowingFilters(
  filters: ItemsFilterState,
): ItemsFilterState {
  return { ...filters, workflowId: null, source: null, search: "" };
}

export function parseItemsScope(value: string): ItemsScope | null {
  return value === "needs_you" ||
    value === "parked" ||
    value === "dismissed" ||
    value === "all"
    ? value
    : null;
}
