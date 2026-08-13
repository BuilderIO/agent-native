export const INITIAL_TOOL_NAMES = [
  // Analytics runs with the compact production surface, but company knowledge
  // and Slack context belong to the sibling Brain app. Keep the handoff tools
  // on turn one so the model cannot mistake Brain for an Analytics extension.
  "describe-workspace-apps",
  "call-agent",
  "view-screen",
  "data-source-status",
  // Keep the first-party observability workflow on the initial surface so a
  // named user's session/error question does not depend on an indirect
  // tool-search round before the agent can inspect its evidence.
  "get-error-issue",
  "create-session-replay-agent-link",
  "get-session-replay-events",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "list-error-issues",
  "list-session-recordings",
  "list-analyses",
  "get-analysis",
  // Keep the complete dashboard build path on the initial surface. An explicit
  // build request should not stop at inspection or an empty extension shell
  // while the agent lazily discovers the next mutating action.
  "get-sql-dashboard",
  "get-explorer-dashboard",
  "list-sql-dashboards",
  "list-extensions",
  "get-extension",
  "update-dashboard",
  "mutate-dashboard",
  "compose-dashboard",
  "create-extension",
  "update-extension",
  "extension-data-set",
  "generate-chart",
  "search-analytics-query-catalog",
  "search-dashboard-references",
  "query-agent-native-analytics",
  "bigquery",
  "search-bigquery-schema",
  "list-data-dictionary",
  // Bulk/cohort readers. Without these on the first surface a "list X excluding Y"
  // question cannot reach any tool that answers it in one call, so the agent pays a
  // tool-search round trip (~15 KB of results) before it can even start — or worse,
  // enumerates the cohort page by page through whatever it can already see.
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "hubspot-records",
  "navigate",
];
