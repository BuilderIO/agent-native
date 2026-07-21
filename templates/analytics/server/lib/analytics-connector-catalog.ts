/**
 * The deliberately small authenticated MCP surface for Analytics.
 *
 * Keep this list read-only and bounded. It includes incident evidence plus
 * the narrow Gong deep-dive/synthesis/evidence operations used by sibling
 * apps. Do not add raw replay blobs or dashboard/data mutation actions here.
 */
export const ANALYTICS_CONNECTOR_CATALOG = [
  "account-deep-dive",
  "gong-calls",
  "gong-native-insights",
  "list-session-recordings",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "query-agent-native-analytics",
  "list-error-issues",
  "get-error-issue",
] as const;
