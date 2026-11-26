import { createCoreRoutesPlugin } from "@agent-native/core/server";

export function resolveAnalyticsOpenPath({
  view,
  params,
}: {
  view?: string | undefined;
  params: Record<string, string>;
}): string | null {
  if (params.dashboardId) return `/dashboards/${params.dashboardId}`;
  if (params.analysisId) return `/analyses/${params.analysisId}`;
  if (params.reportId) {
    return `/sessions/reports/${encodeURIComponent(params.reportId)}`;
  }
  if (view === "analyses") return "/dashboards";
  if (view === "adhoc") return "/home";
  return null;
}

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  extensionTools: true,
  resolveOpenPath: resolveAnalyticsOpenPath,
});
