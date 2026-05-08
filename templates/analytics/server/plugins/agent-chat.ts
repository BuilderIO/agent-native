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
  isSafeNoDataAnalyticsResponse,
  looksLikeAnalyticsDataRequest,
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

function realDataFinalGuard(context: AgentLoopFinalResponseGuardContext) {
  const userText = latestUserText(context.messages ?? []);
  if (!looksLikeAnalyticsDataRequest(userText)) return null;
  if (hasDataQueryAttempt(context.toolResults)) return null;
  if (isSafeNoDataAnalyticsResponse(context.text)) return null;

  return {
    retryMessage:
      "This looks like an analytics result request, but no real source query ran. If you are making data claims, run one relevant data-source action or connected provider MCP tool now and answer from that result. If the right response is a clarification, plan, or explicit unavailable/credentials-missing message with no metrics or source-record claims, finalize that directly instead.",
    fallbackMessage:
      "I can't provide a grounded analytics result yet because no real data-source query ran successfully. Tell me which source to use or connect the missing source, and I'll run it before giving numbers or source-record conclusions.",
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
      "Apply real-data requirements only when presenting analytics results, source records, or derived metrics. Do not call data-source tools for workflow migration, recurring-job setup, UI/code fixes, settings help, conceptual planning, or other non-data tasks unless the user explicitly asks for data. " +
      "Use configured data sources and actions only. Call `data-source-status` when you need to know which providers are connected, and treat provider actions as unavailable for analysis if they return missing credentials, permission, syntax, quota, or network errors. " +
      "When the user names a provider or tool such as Jira, Pylon, HubSpot, Gong, Slack, Sentry, GA4, or BigQuery, that named source is authoritative for the turn: check that provider and call its action or connected MCP tool first. For HubSpot, call `hubspot-records` or a HubSpot MCP search tool for contacts, companies, tickets, or broad CRM lookup; call `hubspot-deals`, `hubspot-metrics`, or `hubspot-pipelines` for deal pipeline analysis. Do not substitute BigQuery for Pylon, Jira, HubSpot, or another provider unless the user explicitly asks for the warehouse copy or the named provider is unavailable and the user chooses a fallback. " +
      "When the user refers to the current analysis, this analysis, this project, or asks to spin off, adapt, modify, or reuse a saved analysis, call `view-screen` first and use the returned analysis details; if an analysis id or @mention is provided, call `get-analysis` before responding. " +
      "If a provider action fails, stop using that provider for the turn, surface the actual error, and wait for the user to choose whether to fix SQL, use another source, or retry. Do not loop through more queries after a failed provider call. " +
      "For ordinary ad-hoc data questions, answer the explicit question after the first relevant successful query or bounded evidence batch instead of continuing into suggested follow-up investigations. " +
      "Unstructured source records are valid analytics evidence: Pylon tickets, Jira issues, Gong calls/transcripts, Slack messages, and similar text records may be coded for themes, mention counts, sentiment, objections, and qualitative patterns as long as the answer states the inspected sample size and does not imply unsupported statistical certainty. " +
      "For schema questions, prefer data-dictionary entries and configured warehouse schemas over assumptions. " +
      "Never substitute fabricated numbers for a failed query or unavailable provider. It is fine to ask a clarifying question, provide a plan, or say exactly which source is unavailable as long as you do not present metrics or source-record conclusions without evidence.\n" +
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
    analyses: {
      label: "Analyses",
      icon: "document",
      search: async (query: string, event?: any) => {
        if (!event) return [];
        try {
          const { getOrgContext } = await import("@agent-native/core/org");
          const { listAnalyses } = await import("../lib/dashboards-store.js");
          const ctx = await getOrgContext(event);
          const rows = await listAnalyses({
            email: ctx.email,
            orgId: ctx.orgId ?? null,
          });
          const q = (query || "").toLowerCase().trim();
          const filtered = q
            ? rows.filter(
                (analysis) =>
                  (analysis.name || "").toLowerCase().includes(q) ||
                  (analysis.description || "").toLowerCase().includes(q) ||
                  analysis.id.toLowerCase().includes(q),
              )
            : rows;

          return filtered
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
            )
            .slice(0, 20)
            .map((analysis) => ({
              id: `analysis:${analysis.id}`,
              label: analysis.name || "Untitled analysis",
              description: `/analyses/${analysis.id}`,
              icon: "document",
              refType: "analysis",
              refId: analysis.id,
              refPath: `/analyses/${analysis.id}`,
            }));
        } catch (err) {
          console.error("[analytics] Analysis mention provider failed:", err);
          return [];
        }
      },
    },
  },
});
