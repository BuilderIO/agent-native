import { FILTER_PARAM_PREFIX } from "./filter-vars";

export interface DashboardFilterRestore {
  filters: Record<string, string>;
  viewId?: string;
  source: "dashboard-default" | "personal";
}

export type DashboardFilterRestoreProgress =
  | { status: "pending" }
  | {
      status: "fallback-applied";
      filters: Record<string, string>;
      viewId?: string;
    }
  | {
      status: "views-failed";
      filters: Record<string, string>;
      viewId?: string;
    }
  | { status: "complete" };

export interface DashboardFilterPreferenceSaveGuard {
  filters: Record<string, string>;
  viewId?: string;
  previousFilters: Record<string, string>;
  previousViewId?: string;
}

export interface DashboardFilterRestoreStep {
  progress: DashboardFilterRestoreProgress;
  restore: DashboardFilterRestore | null;
}

export function canPersistDashboardFilterPreference(
  progress: DashboardFilterRestoreProgress,
  currentFilters: Record<string, string>,
  currentViewId: string | undefined,
): boolean {
  if (progress.status === "complete") return true;
  if (progress.status !== "views-failed") return false;
  return (
    !sameDashboardFilterMap(progress.filters, currentFilters) ||
    progress.viewId !== currentViewId
  );
}

export function dashboardFilterPreferenceSaveState(
  guard: DashboardFilterPreferenceSaveGuard | null,
  currentFilters: Record<string, string>,
  currentViewId: string | undefined,
): "none" | "pending" | "applied" | "changed" {
  if (!guard) return "none";
  if (
    sameDashboardFilterMap(guard.filters, currentFilters) &&
    guard.viewId === currentViewId
  ) {
    return "applied";
  }
  if (
    sameDashboardFilterMap(guard.previousFilters, currentFilters) &&
    guard.previousViewId === currentViewId
  ) {
    return "pending";
  }
  return "changed";
}

export function dashboardFilterParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  const filters: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (key.startsWith(FILTER_PARAM_PREFIX)) filters[key] = value;
  });
  return filters;
}

export function sameDashboardFilterMap(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const aKeys = Object.keys(a ?? {});
  if (aKeys.length !== Object.keys(b ?? {}).length) return false;
  return aKeys.every((key) => a![key] === b![key]);
}

export function matchesDashboardFilterRestoreState(
  searchParams: URLSearchParams,
  filters: Record<string, string>,
  viewId: string | undefined,
): boolean {
  return (
    sameDashboardFilterMap(filters, dashboardFilterParams(searchParams)) &&
    (searchParams.get("view") ?? undefined) === viewId
  );
}

function hasExplicitFilterState(searchParams: URLSearchParams): boolean {
  return (
    searchParams.has("view") ||
    Array.from(searchParams.keys()).some((key) =>
      key.startsWith(FILTER_PARAM_PREFIX),
    )
  );
}

function nonEmptyFilters(
  filters: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters ?? {}).filter(([, value]) => value),
  );
}

export function resolveDashboardFilterRestoreStep({
  searchParams,
  defaultView,
  savedFilters,
  viewsState,
  savedFiltersState,
  progress,
}: {
  searchParams: URLSearchParams;
  defaultView: { id: string; filters: Record<string, string> } | undefined;
  savedFilters: Record<string, string> | undefined;
  viewsState: "loading" | "error" | "success";
  savedFiltersState: "loading" | "error" | "success";
  progress: DashboardFilterRestoreProgress;
}): DashboardFilterRestoreStep {
  if (progress.status === "complete") return { progress, restore: null };

  if (
    progress.status === "fallback-applied" ||
    progress.status === "views-failed"
  ) {
    if (
      !matchesDashboardFilterRestoreState(
        searchParams,
        progress.filters,
        progress.viewId,
      )
    ) {
      return { progress: { status: "complete" }, restore: null };
    }
  } else if (hasExplicitFilterState(searchParams)) {
    return { progress: { status: "complete" }, restore: null };
  }

  if (viewsState === "loading") return { progress, restore: null };

  if (viewsState === "error") {
    if (progress.status === "fallback-applied") {
      return { progress, restore: null };
    }
    const failedProgress =
      progress.status === "views-failed"
        ? progress
        : {
            status: "views-failed" as const,
            filters: dashboardFilterParams(searchParams),
            viewId: searchParams.get("view") ?? undefined,
          };
    if (savedFiltersState !== "success") {
      return { progress: failedProgress, restore: null };
    }
    const filters = nonEmptyFilters(savedFilters);
    if (Object.keys(filters).length === 0) {
      return { progress: failedProgress, restore: null };
    }
    return {
      progress: { status: "fallback-applied", filters },
      restore: { filters, source: "personal" },
    };
  }

  if (defaultView) {
    return {
      progress: { status: "complete" },
      restore: {
        filters: nonEmptyFilters(defaultView.filters),
        viewId: defaultView.id,
        source: "dashboard-default",
      },
    };
  }

  if (savedFiltersState !== "success") return { progress, restore: null };

  const filters = nonEmptyFilters(savedFilters);
  return {
    progress: { status: "complete" },
    restore:
      Object.keys(filters).length > 0 ? { filters, source: "personal" } : null,
  };
}
