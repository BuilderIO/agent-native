import type { AgentChatMcpOptions } from "@agent-native/core/server";

import {
  WRITE_RECEIPT_RETENTION_DAYS,
  WRITE_RECEIPT_RETRY_WINDOW_DAYS,
} from "./guarded-writes";

// External agents get the actions that declare `mcpTool: true`, plus the
// framework's cross-app builtins. `mcp-action-contract.spec.ts` serves this
// config through the real MCP handler and pins the resulting tools/list.
export const ANALYTICS_MCP = {
  connectorCatalog: [],
  externalAgents: { writes: "allowlisted" },
  keyToolNames: [
    "list-sql-dashboards",
    "get-sql-dashboard",
    "estimate-dashboard-cost",
    "find-data",
    "query-dbt-semantic-metric",
    "search-warehouse-schema",
    "query-warehouse",
    "data-source-status",
    "builder-blog-articles",
    "list-session-recordings",
    "list-error-issues",
  ],
  instructions:
    "For a data question, go in this order. First find metric definitions, saved SQL, and generated source metadata with find-data; use search-analytics-query-catalog for ranked dashboard and dictionary references, and list-data-dictionary when the user asks to browse entries. For an exact owner-defined dbt metric name, use query-dbt-semantic-metric; use dbt as definition and grain truth, with Sigma and Amplitude as examples or cross-checks. If dbt is connected but has no definition for a metric the user asks about, say so; do not compute that metric yourself from warehouse data unless the user asks. Next, find saved dashboards with list-sql-dashboards or search-dashboard-references and read one with get-sql-dashboard; saved analyses with list-analyses and get-analysis. Only when neither answers, find exact tables and columns with search-warehouse-schema, then run one bounded query-warehouse SELECT that aggregates in SQL (GROUP BY, COUNT, SUM) instead of pulling raw rows; start from saved SQL when there is some. query-warehouse reads only Analytics' reviewed datasets, counts against your daily BigQuery budget, and asks you once before today's spend passes what you can spend without being asked ($1 by default; an admin can change it); dryRun estimates it for free. Use estimate-dashboard-cost with saved dashboard/panel IDs and filters for a free cost estimate without executing the query; raw SQL is not accepted. capture-dashboard-panel runs one saved panel as the user and returns its numbers (rows capped) for a chart kept in a page; get-dashboard-panel-status reads a dashboard's sharing and panel fingerprints without running anything. Call data-source-status to see which providers are connected. List published blog articles with builder-blog-articles. CRM and calls: hubspot-deals, hubspot-records, hubspot-metrics, hubspot-pipelines, gong-calls, account-deep-dive; gong-native-insights lists Gong's paid synthesis operations. Product behavior: list-session-recordings, get-session-replay-summary, get-session-replay-timeline, list-error-issues, get-error-issue, match-error-issues. Onboarding journey tree with window-bounded later-activity counts, observation cutoff, right-censoring, and example replays: get-onboarding-journey. " +
    // Write tools stay unnamed here: a read-only connection receives this text too.
    "With write access, dashboard and analysis edits are guarded. Read the record first (get-sql-dashboard or get-analysis) and keep its updatedAt; send it back as expectedUpdatedAt with a new unique idempotencyKey on every write (a create sends only the key). A 409 conflict means the record changed after your read and nothing was written: read it again, redo the edit on that version, and resend with expectedUpdatedAt set to details.currentRevision. " +
    `Resending a key with the same arguments returns the first write's receipt (replayed: true) instead of writing twice, so read the record for its current state; the same key with different arguments fails with a 409 saying the key was already used. Retries replay for ${WRITE_RECEIPT_RETRY_WINDOW_DAYS} days, and receipts are deleted after ${WRITE_RECEIPT_RETENTION_DAYS} days. ` +
    "There is no hard delete over MCP: archive or hide a dashboard, or hide an analysis, instead. Archiving, hiding and folder moves are undone by their opposite (archived: false, hidden: false, or moving the dashboard back). Every other edit leaves a revision; list-dashboard-revisions and list-analysis-revisions show them, and restoring one undoes the edit. " +
    "Sending a dashboard report now, saving a report subscription, exporting a panel to Google Sheets and running alert or monitor checks each ask the user to approve the call first, and a declined call does nothing. A report send and a subscription save also take a new idempotencyKey; resending the same key returns the first receipt instead of sending twice.",
} satisfies AgentChatMcpOptions;
