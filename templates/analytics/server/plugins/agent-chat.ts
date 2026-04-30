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
    // Always inject the warehouse-tool reminder, even if the data-dictionary
    // lookup throws. Katya hit a recurring issue where the agent hallucinated
    // that `bigquery` wasn't registered (Slack #product-agent-native-feedback,
    // 2026-04-27 + 2026-04-30) — in reality the tool is always present and
    // either succeeds, returns a structured credentials-missing payload, or
    // returns a BigQuery API error. None of those are "tool not registered".
    const toolAssertion =
      "<warehouse-tools>\n" +
      "Your native tool registry ALWAYS includes `bigquery(sql)` for warehouse queries (dbt_analytics.*, dbt_mart.*, builder-3b0a2.*, etc.) plus `ga4-report`, `hubspot-deals`, `hubspot-metrics`, `hubspot-pipelines`, `amplitude-events`, `posthog-events`, `mixpanel-events`, `jira-search`, `jira-analytics`, `pylon-issues`, `gong-calls`, `apollo-search`, `commonroom-members`, `github-prs`, and `seo-*`. Do NOT tell the user that any of these are unregistered or unavailable in your session — they are part of every analytics deploy. " +
      'If `bigquery` returns `{ error: "bigquery_not_configured", message, settingsPath }`, surface that message and the settings path to the user. ' +
      "If it returns a BigQuery API error (unknown column, permission, syntax), show that error and offer to fix the SQL. " +
      "Never substitute fabricated numbers for a failed query.\n" +
      "</warehouse-tools>";

    try {
      const scope = await resolveSettingsScope(event);
      const all = await listScopedSettingRecords(scope, DATA_DICT_PREFIX);
      const entries = Object.values(all) as Array<Record<string, unknown>>;
      const dict = renderDataDictionary(entries);
      return dict ? `${toolAssertion}\n\n${dict}` : toolAssertion;
    } catch (err) {
      console.warn(
        "[analytics] data dictionary context failed:",
        err instanceof Error ? err.message : err,
      );
      return toolAssertion;
    }
  },
  mentionProviders: {
    dashboards: {
      label: "Dashboards",
      icon: "deck",
      search: async (query: string, event?: any) => {
        if (!event) return [];
        try {
          const { getOrgContext } = await import("@agent-native/core/org");
          const { listDashboards } = await import("../lib/dashboards-store.js");
          const ctx = await getOrgContext(event);
          const rows = await listDashboards(
            { email: ctx.email, orgId: ctx.orgId ?? null },
            { kind: "sql" },
          );
          const items = rows.map((d) => ({ id: d.id, name: d.title }));

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
