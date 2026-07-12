/**
 * The deliberately small authenticated MCP surface for Analytics.
 *
 * Keep this list read-only and incident-focused. In particular, do not add
 * raw replay-event/blob actions or dashboard/data mutation actions here.
 */
export const ANALYTICS_CONNECTOR_CATALOG = [
  "list-session-recordings",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "query-agent-native-analytics",
  "list-error-issues",
  "get-error-issue",
] as const;
