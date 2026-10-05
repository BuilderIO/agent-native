import { FILTER_PARAM_PREFIX } from "./filter-vars";

export interface DashboardFilterRestore {
  filters: Record<string, string>;
  viewId?: string;
}

export function resolveDashboardFilterRestore(
  searchParams: URLSearchParams,
  defaultView: { id: string; filters: Record<string, string> } | undefined,
  savedFilters: Record<string, string> | undefined,
): DashboardFilterRestore | null {
  if (
    searchParams.has("view") ||
    Array.from(searchParams.keys()).some((key) =>
      key.startsWith(FILTER_PARAM_PREFIX),
    )
  ) {
    return null;
  }

  if (defaultView) {
    return { filters: defaultView.filters, viewId: defaultView.id };
  }

  if (savedFilters && Object.keys(savedFilters).length > 0) {
    return { filters: savedFilters };
  }

  return null;
}
