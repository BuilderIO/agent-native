import type { AgentChatMcpOptions } from "@agent-native/core/server";

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
    "data-source-status",
    "builder-blog-articles",
    "list-session-recordings",
    "list-error-issues",
  ],
  instructions:
    "Find metric definitions, saved SQL, and generated source metadata with find-data; use search-analytics-query-catalog for ranked dashboard and dictionary references, and list-data-dictionary when the user asks to browse entries. For an exact owner-defined dbt metric name, use query-dbt-semantic-metric; use dbt as definition and grain truth, with Sigma and Amplitude as examples or cross-checks. Use connected provider tools for exact schema and live values because this MCP server exposes reference metadata, not warehouse row queries. Find saved dashboards with list-sql-dashboards or search-dashboard-references and read one with get-sql-dashboard; saved analyses with list-analyses and get-analysis. Use estimate-dashboard-cost with saved dashboard/panel IDs and filters for a free cost estimate without executing the query; raw SQL is not accepted. capture-dashboard-panel runs one saved panel as the user and returns its numbers (rows capped) for a chart kept in a page; get-dashboard-panel-status reads a dashboard's sharing and panel fingerprints without running anything. Call data-source-status to see which providers are connected. List published blog articles with builder-blog-articles. CRM and calls: hubspot-deals, hubspot-records, hubspot-metrics, hubspot-pipelines, gong-calls, account-deep-dive; gong-native-insights lists Gong's paid synthesis operations. Product behavior: list-session-recordings, get-session-replay-summary, get-session-replay-timeline, list-error-issues, get-error-issue, match-error-issues. Onboarding journey tree with window-bounded later-activity counts, observation cutoff, right-censoring, and example replays: get-onboarding-journey.",
} satisfies AgentChatMcpOptions;
