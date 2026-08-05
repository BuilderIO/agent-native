/**
 * The deliberately small authenticated MCP surface for Analytics.
 *
 * Keep this list read-only and bounded. It includes optional semantic read
 * contracts for callers that already know the exact operation and complete
 * input. Natural-language ask_app/A2A remains the default. Do not add raw SQL,
 * replay blobs, or dashboard/data mutation actions here.
 */
export const ANALYTICS_CONNECTOR_CATALOG = [
  "account-deep-dive",
  "gong-calls",
  "gong-native-insights",
  "hubspot-deals",
  "hubspot-records",
  "list-session-recordings",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "list-error-issues",
  "get-error-issue",
] as const;
