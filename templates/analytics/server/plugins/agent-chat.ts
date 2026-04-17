import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";
import {
  listScopedSettingRecords,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const SQL_DASHBOARD_PREFIX = "sql-dashboard-";
const DATA_DICT_PREFIX = "data-dict-";

/**
 * Render the data-dictionary entries available to this request as a
 * compact prompt block. Lets the agent pick the right table / column
 * names up front instead of hallucinating them and hitting a BigQuery
 * error after save. Only includes fields that are actually useful for
 * SQL generation (metric / definition / table / columnsUsed / query
 * template / gotchas) — the full entry is still fetchable via
 * `list-data-dictionary` when the agent wants more.
 */
function renderDataDictionary(entries: Array<Record<string, unknown>>): string {
  if (!entries.length) return "";
  const lines: string[] = [];
  for (const e of entries) {
    const metric = String(e.metric ?? "").trim();
    const definition = String(e.definition ?? "").trim();
    if (!metric) continue;
    lines.push(`- **${metric}**${definition ? ` — ${definition}` : ""}`);
    const table = String(e.table ?? "").trim();
    if (table) lines.push(`  - table: ${table}`);
    const columns = String(e.columnsUsed ?? "").trim();
    if (columns) lines.push(`  - columns: ${columns}`);
    const template = String(e.queryTemplate ?? "").trim();
    if (template) {
      const oneLine = template.replace(/\s+/g, " ").slice(0, 240);
      lines.push(`  - query: ${oneLine}${template.length > 240 ? "…" : ""}`);
    }
    const gotchas = String(e.knownGotchas ?? "").trim();
    if (gotchas) lines.push(`  - gotchas: ${gotchas}`);
  }
  if (!lines.length) return "";
  return (
    "<data-dictionary>\n" +
    "Canonical metric/table/column definitions for this workspace. " +
    "Use the table and column names below verbatim when writing SQL — they are what actually exist in BigQuery. " +
    "If the metric you need isn't here, call `list-data-dictionary` / `save-data-dictionary-entry` before guessing.\n\n" +
    lines.join("\n") +
    "\n</data-dictionary>"
  );
}

export default createAgentChatPlugin({
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  extraContext: async (event) => {
    try {
      const scope = await resolveSettingsScope(event);
      const all = await listScopedSettingRecords(scope, DATA_DICT_PREFIX);
      const entries = Object.values(all) as Array<Record<string, unknown>>;
      return renderDataDictionary(entries);
    } catch (err) {
      console.warn(
        "[analytics] data dictionary context failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
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
