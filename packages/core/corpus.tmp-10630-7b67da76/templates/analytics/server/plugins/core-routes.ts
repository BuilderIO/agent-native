import { createCoreRoutesPlugin } from "@agent-native/core/server";

// Land external-agent deep links straight on the real SPA route. Without
// this, `/_agent-native/open?app=analytics&view=adhoc&dashboardId=…` falls
// back to `/<view>` = `/adhoc`, which has no matching route (the dashboard
// route is `dashboards.$id.tsx` → `/dashboards/:id`) and 404s — so an "Open
// in Analytics" link produced by `update-dashboard` / `save-analysis` for a
// connected Claude Code / Codex / Cowork never opened the record.
export default createCoreRoutesPlugin({
  resolveOpenPath: ({ view, params }) => {
    if (params.dashboardId) return `/dashboards/${params.dashboardId}`;
    if (params.analysisId) return `/analyses/${params.analysisId}`;
    if (view === "analyses") return "/analyses";
    // `adhoc`/unknown with no id: there is no bare `/dashboards` record route —
    // send to the app root rather than 404 (the polled `navigate` command
    // still applies any record focus once the SPA is loaded).
    if (view === "adhoc") return "/";
    return null;
  },
});
