import type { ActionEntry } from "@agent-native/core/server";

export const PLAN_MODE_ACT_ONLY_TOOLS = new Set([
  "query-agent-native-analytics",
  "bigquery",
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "account-deep-dive",
  "hubspot-deals",
  "hubspot-records",
  "gong-calls",
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
