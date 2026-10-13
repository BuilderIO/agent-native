import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  googleOAuthManagedConnection: "not_applicable",
  extensionTools: true,
  resolveOpenPath: ({ view, params }) => {
    if (params.dashboardId) return `/dashboards/${params.dashboardId}`;
    if (params.analysisId) return `/analyses/${params.analysisId}`;
    if (view === "analyses") return "/dashboards";
    if (view === "adhoc") return "/home";
    return null;
  },
});
