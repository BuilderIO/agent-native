export function dashboardExtensionSlotId(
  dashboardId: string,
  panelId: string,
): string {
  return `analytics.dashboard.${encodeURIComponent(dashboardId)}.panel.${encodeURIComponent(panelId)}`;
}
