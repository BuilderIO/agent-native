import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import {
  listScopedSettingRecords,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const SQL_DASHBOARD_PREFIX = "sql-dashboard-";

export default createAgentChatPlugin({
  actions: () => autoDiscoverActions(import.meta.url),
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  mentionProviders: {
    dashboards: {
      label: "Dashboards",
      icon: "deck",
      search: async (query: string, event?: any) => {
        if (!event) return [];
        try {
          const scope = await resolveSettingsScope(event);
          const all = await listScopedSettingRecords(
            scope,
            SQL_DASHBOARD_PREFIX,
          );
          const items = Object.entries(all)
            .map(([key, data]) => {
              const id = key.slice(SQL_DASHBOARD_PREFIX.length);
              const rawName = (data as { name?: unknown })?.name;
              const name =
                typeof rawName === "string" && rawName.trim().length > 0
                  ? rawName.trim()
                  : undefined;
              return { id, name };
            })
            .filter((d) => d.id.length > 0);

          const q = (query || "").toLowerCase().trim();
          const filtered = q
            ? items.filter(
                (d) =>
                  (d.name || "").toLowerCase().includes(q) ||
                  d.id.toLowerCase().includes(q),
              )
            : items;

          return filtered.slice(0, 20).map((d) => ({
            id: `dashboard:${d.id}`,
            label: d.name || "Untitled dashboard",
            description: `/adhoc/${d.id}`,
            icon: "deck",
            refType: "dashboard",
            refId: d.id,
            refPath: `/adhoc/${d.id}`,
          }));
        } catch (err) {
          console.error("[analytics] Dashboard mention provider failed:", err);
          return [];
        }
      },
    },
  },
});
