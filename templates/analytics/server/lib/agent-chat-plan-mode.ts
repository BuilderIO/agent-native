import type { ActionEntry } from "@agent-native/core/server";

export const INITIAL_TOOL_NAMES = [
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
  "run-code",
  "get-code-execution",
  "provider-corpus-job",
  "provider-corpus-jobs",
  "query-staged-dataset",
  "list-staged-datasets",
  "delete-staged-dataset",
  "account-deep-dive",
  "hubspot-deals",
  "hubspot-records",
  "hubspot-pipelines",
  "gong-calls",
  "github-repo-files",
  "jira-search",
  "slack-messages",
  "sentry",
  "list-data-dictionary",
  "save-data-dictionary-entry",
  "navigate",
];

export const PLAN_MODE_ACT_ONLY_TOOLS = new Set([
  "query-agent-native-analytics",
  "bigquery",
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "account-deep-dive",
  "hubspot-deals",
  "hubspot-records",
  "hubspot-pipelines",
  "gong-calls",
  "github-repo-files",
  "jira-search",
  "slack-messages",
  "sentry",
]);

export function applyAnalyticsPlanModePolicy(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, entry]) => [
      name,
      PLAN_MODE_ACT_ONLY_TOOLS.has(name)
        ? { ...entry, allowInPlanMode: false }
        : entry,
    ]),
  );
}
