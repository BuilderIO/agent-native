import type { AgentChatMcpOptions } from "@agent-native/core/server";

// External agents get the actions that declare `mcpTool: true`, plus the
// framework's cross-app builtins. `mcp-action-contract.spec.ts` serves this
// config through the real MCP handler and pins the resulting tools/list.
export const ANALYTICS_MCP = {
  externalAgents: { writes: "allowlisted" },
  keyToolNames: [
    "list-sql-dashboards",
    "get-sql-dashboard",
    "find-data",
    "data-source-status",
    "builder-blog-articles",
    "list-session-recordings",
    "list-error-issues",
  ],
  instructions:
    "Find metric definitions, saved SQL, and generated source metadata with find-data. Use connected provider tools for exact schema and live values because this MCP server exposes reference metadata, not warehouse row queries. Find saved dashboards with list-sql-dashboards or search-dashboard-references and read one with get-sql-dashboard; saved analyses with list-analyses and get-analysis. Call data-source-status to see which providers are connected. List published blog articles with builder-blog-articles. CRM and calls: hubspot-deals, hubspot-records, hubspot-metrics, hubspot-pipelines, gong-calls, account-deep-dive; gong-native-insights lists Gong's paid synthesis operations. Product behavior: list-session-recordings, get-session-replay-summary, get-session-replay-timeline, list-error-issues, get-error-issue, match-error-issues. Onboarding funnel tree with drop-off and example replays: get-onboarding-journey.",
} satisfies AgentChatMcpOptions;
