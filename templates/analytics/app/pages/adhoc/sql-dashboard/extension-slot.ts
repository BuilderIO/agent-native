/**
 * Stable extension-point name for a dashboard box. The dashboard and panel ids
 * are encoded independently so arbitrary saved ids cannot collapse into one
 * slot or add path separators to the slots API.
 */
export function dashboardExtensionSlotId(
  dashboardId: string,
  panelId: string,
): string {
  return `analytics.dashboard.${encodeURIComponent(dashboardId)}.panel.${encodeURIComponent(panelId)}`;
}
