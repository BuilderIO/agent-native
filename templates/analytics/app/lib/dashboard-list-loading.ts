export type DashboardSortMode = "most-used" | "alphabetical" | "manual";

export type DashboardListLoadingArgs = {
  sqlDashboardsLoading: boolean;
  sqlDashboardsPlaceholder: boolean;
  isInitialLoad: boolean;
  favoritesLoading: boolean;
  popularityReady: boolean;
  sortMode: DashboardSortMode;
};

export function shouldRenderDashboardList({
  sqlDashboardsLoading,
  sqlDashboardsPlaceholder,
  isInitialLoad,
  favoritesLoading,
  popularityReady,
  sortMode,
}: DashboardListLoadingArgs): boolean {
  if (sqlDashboardsLoading || (isInitialLoad && sqlDashboardsPlaceholder)) {
    return false;
  }
  if (sortMode !== "most-used") return true;
  return favoritesLoading === false && popularityReady;
}
