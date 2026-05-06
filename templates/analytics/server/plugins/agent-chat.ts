import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";
import {
  listScopedSettingRecords,
  resolveSettingsScope,
} from "../lib/scoped-settings";
import {
  hasDataQueryAttempt,
  REAL_DATA_REQUIRED_MARKER,
} from "../lib/real-data-actions";

const SQL_DASHBOARD_PREFIX = "sql-dashboard-";
const DATA_DICT_PREFIX = "data-dict-";

function latestUserText(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part.text ?? ""))
      .join("\n");
    if (text.trim()) return text;
  }
  return "";
}

function looksLikeAnalyticsDataRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(REAL_DATA_REQUIRED_MARKER.toLowerCase())) return true;
  if (
    /\b(open|navigate|go to|rename|delete|share|favorite|unfavorite)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  if (
    /\b(fix|bug|layout|style|component|route|code|source code|integration|connect|configure|settings)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  return /\b(analy[sz]e|analysis|dashboard|panel|metric|metrics|count|total|trend|breakdown|conversion|funnel|revenue|traffic|pageviews?|signups?|events?|users?|sessions?|retention|churn|pipeline|deals?)\b/.test(
    lower,
  );
}

function realDataFinalGuard(context: AgentLoopFinalResponseGuardContext) {
  const userText = latestUserText(context.messages ?? []);
  if (!looksLikeAnalyticsDataRequest(userText)) return null;
  if (hasDataQueryAttempt(context.toolResults)) return null;

  return {
    retryMessage:
      "This analytics request requires real data before the answer can be final. Run at least one data-source query action now (for example `query-agent-native-analytics`, `bigquery`, `ga4-report`, `hubspot-deals`, `sentry`, or the relevant provider action). `data-source-status`, `list-data-dictionary`, `update-dashboard`, `save-analysis`, and `generate-chart` do not count as real data queries. If no source can answer, call the most relevant source action and report its exact unavailable/error result instead of inventing data.",
    fallbackMessage:
      "I stopped before finalizing because this analytics request requires a real data-source query, and no data-source query action ran. I won't invent analytics results.",
  };
}

/**
 * Render the data-dictionary entries available to this request as a
 * compact prompt block. Lets the agent pick the right table / column
 * names up front instead of hallucinating them and hitting a data-source
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
    "Canonical metric/table/column definitions for this organization. " +
    "Use the data source, table, and column names below verbatim when querying configured sources. " +
    "If the metric you need isn't here, call `list-data-dictionary` / `save-data-dictionary-entry`, inspect configured schemas, or ask the user before guessing.\n\n" +
    lines.join("\n") +
    "\n</data-dictionary>"
  );
}

export default createAgentChatPlugin({
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  finalResponseGuard: realDataFinalGuard,
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  extraContext: async (event) => {
    // Always inject source guidance, even if the data-dictionary lookup throws.
    // The generic template can ship provider actions without every deployment
    // having credentials or workspace-specific schemas configured.
    const sourceGuidance =
      "<data-source-guidance>\n" +
      "Use configured data sources and actions only. Call `data-source-status` when you need to know which providers are connected, and treat provider actions as unavailable for analysis if they return missing credentials, permission, syntax, quota, or network errors. " +
      "If a provider action fails, stop using that provider for the turn, surface the actual error, and wait for the user to choose whether to fix SQL, use another source, or retry. Do not loop through more queries after a failed provider call. " +
      "For ordinary ad-hoc data questions, answer the explicit question after the first relevant successful query instead of continuing into suggested follow-up investigations. " +
      "For schema questions, prefer data-dictionary entries and configured warehouse schemas over assumptions. " +
      "Never substitute fabricated numbers for a failed query or unavailable provider.\n" +
      "</data-source-guidance>";

    try {
      const scope = await resolveSettingsScope(event);
      const all = await listScopedSettingRecords(scope, DATA_DICT_PREFIX);
      const entries = Object.values(all) as Array<Record<string, unknown>>;
      const dict = renderDataDictionary(entries);
      return dict ? `${sourceGuidance}\n\n${dict}` : sourceGuidance;
    } catch (err) {
      console.warn(
        "[analytics] data dictionary context failed:",
        err instanceof Error ? err.message : err,
      );
      return sourceGuidance;
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
