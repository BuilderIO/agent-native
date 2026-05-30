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
import { renderDataDictionary } from "../lib/data-dictionary-context";

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

export default createAgentChatPlugin({
  appId: "analytics",
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
      "For schema questions, prefer data-dictionary entries and configured warehouse schemas over assumptions; use `search-bigquery-schema` for BigQuery metadata before inventing datasets, tables, or columns. " +
      "Never substitute fabricated numbers for a failed query or unavailable provider. It is fine to ask a clarifying question, provide a plan, or say exactly which source is unavailable as long as you do not present metrics or source-record conclusions without evidence.\n" +
      "</data-source-guidance>";
    const artifactGuidance =
      "<analytics-artifact-guidance>\n" +
      "Native Analytics dashboards and saved analyses are constrained artifacts: dashboards are JSON configs rendered by the built-in dashboard components, and analyses are Markdown reports with generated chart images plus structured resultData. " +
      "If the user's requested dashboard, analysis surface, visualization, interaction model, custom layout, or bespoke workflow cannot be faithfully represented within those native components/config fields, do not hand-wave, force an approximate JSON dashboard, or route to source-code changes. In production mode, automatically create a sandboxed extension with `create-extension` instead, using Alpine.js HTML and the available app/data helpers. " +
      "After creating the extension, briefly tell the user that the request needed bespoke UI/code beyond the native Analytics dashboard or analysis format, so you built it as an extension.\n" +
      "</analytics-artifact-guidance>";

    try {
      const scope = await resolveSettingsScope(event);
      const all = await listScopedSettingRecords(scope, DATA_DICT_PREFIX);
      const entries = Object.values(all) as Array<Record<string, unknown>>;
      const dict = renderDataDictionary(entries);
      return dict
        ? `${sourceGuidance}\n\n${artifactGuidance}\n\n${dict}`
        : `${sourceGuidance}\n\n${artifactGuidance}`;
    } catch (err) {
      console.warn(
        "[analytics] data dictionary context failed:",
        err instanceof Error ? err.message : err,
      );
      return `${sourceGuidance}\n\n${artifactGuidance}`;
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
