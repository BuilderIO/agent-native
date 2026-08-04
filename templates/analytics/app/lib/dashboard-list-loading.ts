export type DashboardSortMode =
  | "most-used"
  | "alphabetical"
  | "manual"
  | "favorites";

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
  const needsFavorites = sortMode === "most-used" || sortMode === "favorites";
  if (needsFavorites && favoritesLoading) return false;
  if (sortMode === "most-used" && !popularityReady) return false;
  return true;
}
