/**
 * The deliberately small authenticated MCP surface for Analytics.
 *
 * Keep this list read-only and incident-focused. In particular, do not add
 * replay-event/blob actions or dashboard/data mutation actions here.
 */
export const ANALYTICS_CONNECTOR_CATALOG = [
  "list-session-recordings",
  "query-agent-native-analytics",
  "list-error-issues",
  "get-error-issue",
] as const;
