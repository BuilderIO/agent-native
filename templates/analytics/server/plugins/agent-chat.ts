import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  getRequestRunContext,
  loadActionsFromStaticRegistry,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { renderDataDictionary } from "../lib/data-dictionary-context";
import {
  failedDataQueryAttemptMessage,
  hasExplicitPartialDisclosure,
  hasFailedCorpusWorkflowEvidence,
  hasDataQueryAttempt,
  hasIncompleteDataEvidence,
  isSafeNoDataAnalyticsResponse,
  hasOverstatedCoverageConfidenceClaim,
  looksLikeCoverageSensitiveAnalyticsRequest,
  looksLikeStrongCoverageClaim,
  looksLikeAnalyticsDataRequest,
  needsCorpusWorkflowForCoverageSensitiveRequest,
  needsSourceRecordBodyWorkflowForCoverageSensitiveRequest,
} from "../lib/real-data-actions";
import {
  listScopedSettingRecords,
  resolveSettingsScope,
} from "../lib/scoped-settings";

const DATA_DICT_PREFIX = "data-dict-";
const ANALYTICS_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "data-source-status",
  "list-analyses",
  "get-analysis",
  "save-analysis",
  "rename-analysis",
  "delete-analysis",
  "get-sql-dashboard",
  "mutate-dashboard",
  "generate-chart",
  "query-agent-native-analytics",
  "bigquery",
  "search-bigquery-schema",
  "bigquery-table-info",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "provider-corpus-job",
  "provider-corpus-jobs",
  "query-staged-dataset",
  "list-staged-datasets",
  "delete-staged-dataset",
  "account-deep-dive",
  "hubspot-deals",
  "hubspot-records",
  "gong-calls",
  "jira-search",
  "slack-messages",
  "sentry",
  "list-data-dictionary",
  "save-data-dictionary-entry",
  "navigate",
];

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
  if ((context as { executionMode?: string }).executionMode === "plan") {
    return null;
  }
  const userText = latestUserText(context.messages ?? []);
  if (!looksLikeAnalyticsDataRequest(userText)) return null;
  const incompleteEvidence = hasIncompleteDataEvidence(context.toolResults);
  if (
    hasFailedCorpusWorkflowEvidence(context.toolResults) &&
    looksLikeCoverageSensitiveAnalyticsRequest(userText) &&
    hasOverstatedCoverageConfidenceClaim(context.text)
  ) {
    return {
      retryMessage:
        "A corpus-capable workflow such as provider-corpus-job, provider-api-request, query-staged-dataset, or run-code failed, but the draft still makes a confident all/any/full-corpus or defensible absence claim. Do not use failed code/API paths plus shortcut searches to support exhaustive coverage. Retry the provider API/code workflow if possible; otherwise finalize as explicitly partial, avoid full-corpus/defensible absence wording, and state the failed tools plus the exact inspected counts and gaps.",
      fallbackMessage:
        "I can't make a confident full-corpus or absence claim because the corpus/code path failed. The answer must be partial unless that provider API/code coverage is recovered.",
    };
  }
  if (
    needsCorpusWorkflowForCoverageSensitiveRequest({
      userText,
      finalText: context.text,
      toolResults: context.toolResults,
    })
  ) {
    return {
      retryMessage:
        "The user asked a coverage-sensitive provider question, but the draft only used bounded convenience data actions. Do not finalize an exhaustive, all-records, or absence-sensitive answer from shortcut actions alone. Use the broad provider API/MCP surface and a corpus workflow now: provider-api-catalog/provider-api-docs when needed, provider-corpus-job for durable paginated or batched corpus scans, provider-api-request with fetchAllPages/stageAs/saveToFile for the exact provider endpoint/filter/body/pagination, then run-code or query-staged-dataset to join, grep, classify, and aggregate. If full coverage is not possible in this turn, finalize with explicit partial-coverage wording, inspected counts, filters, and remaining gaps.",
      fallbackMessage:
        "I can't make a confident coverage-sensitive provider claim from bounded shortcut actions alone. I need a provider API/corpus workflow, or I need to label the answer as partial with exact inspected counts and gaps.",
    };
  }
  if (
    needsSourceRecordBodyWorkflowForCoverageSensitiveRequest({
      userText,
      finalText: context.text,
      toolResults: context.toolResults,
    })
  ) {
    return {
      retryMessage:
        "The user asked to search source-record body text such as transcripts, messages, tickets, issues, notes, documents, or conversation logs, but the draft's corpus evidence does not show that the requested body records were actually searched. A parent/container metadata scan, title search, summary search, or call/ticket/message list is not enough for an absence-sensitive body-text claim. Retry with the provider's raw body endpoint or native search for the requested record type, using provider-corpus-job batch-search/paginated-search, provider-api-request with staging, or run-code over staged raw records. Then report source path/body field, inspected record count, hit count, and gaps.",
      fallbackMessage:
        "I can't make a confident source-record body-text claim because the corpus evidence does not show that the requested raw records were searched.",
    };
  }
  if (
    incompleteEvidence &&
    (looksLikeStrongCoverageClaim(context.text) ||
      looksLikeCoverageSensitiveAnalyticsRequest(userText)) &&
    !hasExplicitPartialDisclosure(context.text)
  ) {
    return {
      retryMessage:
        "Some source evidence for this analytics answer was aborted, truncated, timed out, or indicated more pages. The user asked a coverage-sensitive provider question, or the draft makes a strong zero/all/exhaustive claim. Recover coverage with provider-corpus-job/provider-api-request/run-code/workspace staging if possible; otherwise finalize with explicit partial-coverage wording, the inspected sample size, and the missing coverage.",
      fallbackMessage:
        "I can't make a confident exhaustive analytics claim yet because part of the source evidence was aborted, truncated, or still paginated. I need to recover the missing coverage or state the answer as partial with the inspected sample size.",
    };
  }
  if (hasDataQueryAttempt(context.toolResults)) return null;
  if (isSafeNoDataAnalyticsResponse(context.text)) return null;
  const failedQueryMessage = failedDataQueryAttemptMessage(context.toolResults);
  if (failedQueryMessage) {
    return {
      retryMessage: failedQueryMessage,
      fallbackMessage: failedQueryMessage,
    };
  }

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
  initialToolNames: INITIAL_TOOL_NAMES,
  finalResponseGuard: realDataFinalGuard,
  // Enable sandboxed JavaScript execution for analytics data processing.
  // Code runs in an isolated Node.js child process with no access to app
  // source, secrets, or DB. It can call provider-api-request, web-request,
  // and Resources-backed workspace file helpers via the bridge.
  //
  // Operators deploying to trusted internal environments can set
  // AGENT_PROD_CODE_EXECUTION=trusted to also enable bash/read/edit/write.
  codeExecution: { production: "sandboxed" },
  durableBackgroundRuns: true,
  runSoftTimeoutMs: ANALYTICS_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
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
      "SURFACE DIFFERENTIATION — You are the analytics assistant for definitions, deep-dive analysis, and action. For questions about what a metric, model, or table means, use the Data Dictionary and configured schema tools first. For trends, comparisons, anomalies, current data, or anything that requires querying live data, answer directly in chat with the relevant provider query, dashboard analysis, and inline charts when useful. " +
      "DASHBOARD CREATION RULE — You may create dashboards, analyses, SQL panels, or other resources only when the user explicitly asks you to (e.g. 'build me a dashboard for...', 'create a new analysis', 'add a chart for...'). Never create any resource proactively during research, trend analysis, or answering questions. If you think a dashboard would be useful, suggest it and wait for explicit confirmation before creating anything. Never add new items to the sidebar or modify existing dashboards without an explicit user directive. " +
      "DASHBOARD MUTATION RULE — For dashboard edits, default to `mutate-dashboard` with the typed `dashboard.*` script API so the main payload is a string and avoids native-array serialization traps. It can move panels by id, edit titles/SQL/config, insert, duplicate, remove, and patch dashboard fields in one atomic save. The script API is constrained: no variables/imports/loops/functions, only JSON-compatible arguments on documented dashboard methods. Do not count shifting `/panels/<index>` positions for ordinary dashboard edits unless the user specifically asks for low-level JSON-pointer operations. " +
      "DASHBOARD READ RULE — `get-sql-dashboard` is compact by default: use its `panels` summaries plus `layout.panelOrder`, `layout.firstPanelIds`, and `layout.groups[].rows[].rowNumber/panelIds` for orientation and verification. Pass `includeConfig: true` only when you truly need full panel SQL/config. " +
      'DASHBOARD REORDER RULE — For simple chart/section moves, use `mutate-dashboard` code such as `dashboard.panels(["panel-a","panel-b"]).moveToTop();`. For visible placement requests like "second row" or "next to return rates", use row-aware placement such as `dashboard.insertPanel({...}).nextTo("retention-over-time")`, `.atRow(2)`, or `dashboard.panel("panel-a").moveNextTo("panel-b")`; these keep panels in the intended rendered row and expand/rebalance that row when needed. Never count shifting `/panels/<index>` positions for ordinary \'move this chart\' requests. Use `get-sql-dashboard.layout.groups[].rows` as proof of visible row placement, not only flat `panelOrder`. ' +
      "Use configured data sources and actions only. Call `data-source-status` when you need to know which providers are connected, and treat provider actions as unavailable for analysis if they return missing credentials, permission, syntax, quota, or network errors. " +
      "The built-in `demo` dashboard source is a demo-environment Prometheus source reserved for the Node Exporter demo. It must never satisfy REAL_DATA_REQUIRED or be cited as user analytics evidence unless the user explicitly asks to inspect the demo dashboard. " +
      "When the user names a provider or tool such as Jira, Pylon, HubSpot, Gong, Slack, Sentry, GA4, or BigQuery, that named source is authoritative for the turn: use that provider's real tool/API surface, not a warehouse or different-provider substitute, unless the user explicitly asks for the copy/fallback. For bounded lookups where a first-class action fully models the requested source, object, filter, and pagination need, that shortcut is fine. For broad provider searches, cross-source joins, corpus-wide counts, exact cohort coverage, or any answer where absence matters, do not start and stop with shortcuts; use the broad provider API/MCP and corpus/code workflow as the primary path. " +
      "Provider-specific actions are shortcuts, not limits. If a first-class action cannot express the exact endpoint, object type, filters, request body, pagination mode, API version, or corpus coverage needed, call `provider-api-catalog` and `provider-api-docs` as needed, then call `provider-api-request` against the provider's real HTTP API. Use this raw provider API escape hatch instead of weakening the analysis, broadening filters, sampling default pages, or claiming the integration cannot do something the underlying API can do. " +
      "When one provider cohort becomes the input to a second provider search, join, or exhaustive corpus scan, stage the upstream cohort with `provider-api-request`/`stageAs` (or a native provider API/MCP bulk primitive) before the downstream search. Avoid starting such workflows with convenience list/search actions that return display-shaped pages or can time out before the corpus path is established. " +
      'For broad unstructured provider records such as transcripts, messages, tickets, issues, notes, events, documents, or conversation logs, prefer `provider-corpus-job` so the scan has durable checkpoints, stored snippets, coverage counts, and provider quota pause/resume. Use mode="paginated-search" for any provider endpoint that already pages over the target records; use mode="batch-search" when a staged upstream cohort of ids/records must feed a second provider endpoint by `itemBodyPath` or `itemQueryParam`. Continue paused jobs until completed or quota_wait, then read results. Use `run-code` with `providerSearchAll`, `providerFetch`, `appAction`, `workspaceRead`, and Resources-backed workspace files for shorter reductions, joins, classification, and aggregation after the corpus path is established. Convenience actions are bounded shortcuts for common checks, not the ceiling for what the underlying provider API can answer. ' +
      "When the user asks to search source-record body text, use the raw body endpoint or native provider search for that record type. Parent/container metadata such as call lists, titles, summaries, briefs, channel lists, ticket lists, or issue lists can discover scope but cannot support a complete body-text absence claim. " +
      "For source-record mention searches, phrase searches, and absence checks across transcripts/messages/tickets/issues, prefer provider-side search, `provider-corpus-job`, staged corpus, `providerSearchAll`, or action-side search arguments that return counts, coverage, and snippets instead of loading raw full records into chat. Use full transcripts/messages only for selected evidence after the search narrows the corpus, and state whether the search covered every matching record or only a bounded sample. " +
      "For complex provider questions, broad searches, corpus-wide counts, cross-source joins, or any answer where absence matters, prefer a corpus-first workflow: inspect the provider API, fetch every relevant page or an explicitly bounded cohort, stage large responses with `saveToFile`/`stageAs`/`fetchAllPages`, use `provider-corpus-job` for durable long-running searches, and use `run-code` with `providerSearchAll`, `providerFetch`, `appAction`, and Resources-backed workspace files to join, search, classify, and aggregate. Use `scratch/` for temporary staging and durable folder names only for files the user should keep. Do not infer no results from sampled records, default limits, truncated excerpts, or aborted calls. If full coverage is not possible in the turn, say exactly what was inspected and what remains uncovered. " +
      'For HubSpot deal cohorts, structured `hubspot-deals` filters can enumerate a bounded cohort for direct deal-list answers: `product` for the `products` field, `pipeline` for pipeline label/id, `closedStatus` for won/lost/open/closed, and `closedDateFrom`/`closedDateTo` for close-date windows. The `query` argument is full-text deal search and is not proof that a specific property matched; do not use `query: "Publish"` when the user asked for products field = Publish. If the cohort feeds transcript/message/ticket search, a cross-source join, or exhaustive/absence-sensitive coverage, use `provider-api-request` with HubSpot search and `stageAs` for the cohort first, then continue with the provider API/corpus workflow. Report the returned filter values and cohort count in the methodology. ' +
      "For named deal, account, renewal, churn-risk, or customer deep dives that need HubSpot and Gong context, `account-deep-dive` can provide a bounded evidence bundle. Use it when the user asks for a targeted entity deep dive, then use the broad provider API/corpus workflow for any requested exhaustive transcript/message/ticket search or absence claim. Do not answer a requested transcript deep dive from call metadata alone. " +
      "When the user refers to the current analysis, this analysis, this project, or asks to spin off, adapt, modify, or reuse a saved analysis, call `view-screen` first and use the returned analysis details; if an analysis id or @mention is provided, call `get-analysis` before responding. " +
      "If a provider action fails, stop using that provider for the turn, surface the actual error, and wait for the user to choose whether to fix SQL, use another source, or retry. Do not loop through more queries after a failed provider call. " +
      "For ordinary ad-hoc, non-coverage-sensitive data questions, answer the explicit question after the first relevant successful query or bounded evidence batch instead of continuing into suggested follow-up investigations. " +
      "If the user challenges coverage, asks why more records were not included, or asks for the updated answer, rerun the relevant source query or revise from the corrected cohort and provide the updated deliverable directly. Do not claim an analysis was revised unless the revised answer is included in the response or saved with `save-analysis`. " +
      "Unstructured source records are valid analytics evidence: Pylon tickets, Jira issues, Gong calls/transcripts, Slack messages, and similar text records may be coded for themes, mention counts, sentiment, objections, and qualitative patterns as long as the answer states the inspected sample size and does not imply unsupported statistical certainty. " +
      "For schema questions, prefer data-dictionary entries and configured warehouse schemas over assumptions; use `search-bigquery-schema` for BigQuery metadata before inventing datasets, tables, or columns. " +
      "Before finalizing any analytics answer, make the evidence trail explicit enough to audit: answer the user's question, name the source(s), time window, sample size or row count, filters, join/match method, caveats/gaps, and recommended next action when useful. Never substitute fabricated numbers for a failed query or unavailable provider. It is fine to ask a clarifying question, provide a plan, or say exactly which source is unavailable as long as you do not present metrics or source-record conclusions without evidence.\n" +
      "</data-source-guidance>";
    const artifactGuidance =
      "<analytics-artifact-guidance>\n" +
      "Native Analytics dashboards and saved analyses are constrained artifacts: dashboards are JSON configs rendered by the built-in dashboard components, and analyses are Markdown reports with generated chart images plus structured resultData. " +
      "If the user's requested dashboard, analysis surface, visualization, interaction model, custom layout, or bespoke workflow cannot be faithfully represented within those native components/config fields, do not hand-wave, force an approximate JSON dashboard, or route to source-code changes. In production mode, automatically create a sandboxed extension with `create-extension` instead, using Alpine.js HTML and the available app/data helpers. " +
      "After creating the extension, briefly tell the user that the request needed bespoke UI/code beyond the native Analytics dashboard or analysis format, so you built it as an extension.\n" +
      "</analytics-artifact-guidance>";

    // In the durable background-function worker, skip the data-dictionary read
    // + render. That settings read + synchronous render is the heaviest, most
    // hang-prone part of worker setup on a cold bg-fn instance, and it runs
    // EAGERLY while the system prompt is built (before any pre-send timeout can
    // arm), so a stall here is what kept the analytics worker from ever claiming
    // its run. The agent can still pull dictionary entries on demand via
    // `list-data-dictionary` / `search-bigquery-schema`; the static guidance is
    // what it needs to know they exist. Foreground requests keep the full dict.
    if (getRequestRunContext()?.isBackgroundWorker) {
      return `${sourceGuidance}\n\n${artifactGuidance}`;
    }

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
            { kind: "sql", hidden: query ? "all" : "visible" },
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
            description: `/dashboards/${d.id}`,
            icon: "deck",
            refType: "dashboard",
            refId: d.id,
            refPath: `/dashboards/${d.id}`,
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
