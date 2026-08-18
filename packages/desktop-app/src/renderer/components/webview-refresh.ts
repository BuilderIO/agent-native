export function shouldReloadActiveWebview({
  previousRefreshKey,
  refreshKey,
  isActive,
  isPlaceholder,
}: {
  previousRefreshKey: number;
  refreshKey: number;
  isActive: boolean;
  isPlaceholder: boolean;
}): boolean {
  return (
    refreshKey > 0 &&
    refreshKey !== previousRefreshKey &&
    isActive &&
    !isPlaceholder
  );
}
