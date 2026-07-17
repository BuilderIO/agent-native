import type { ActionEntry } from "@agent-native/core/server";

export const INITIAL_TOOL_NAMES = [
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
  "save-analysis",
  // Dashboard/extension INSPECTION stays on the initial surface so a
  // template-clone request can resolve and inspect the source on the first
  // turn. The MUTATING writers (update-dashboard, mutate-dashboard,
  // create-extension, update-extension) are intentionally left off: the
  // dashboard-construction final-response guard retries with
  // `expandToolSurface: true` (see server/plugins/agent-chat.ts), which opens
  // the full run registry exactly when a save is needed, and tool-search can
  // surface them otherwise. This keeps the first-request surface under the
  // 40-tool ceiling enforced by scripts/guard-agent-chat-context.ts.
  "get-sql-dashboard",
  "list-sql-dashboards",
  "list-dashboard-templates",
  "list-extensions",
  "get-extension",
  "generate-chart",
  "query-agent-native-analytics",
  "bigquery",
  "search-bigquery-schema",
  "provider-api-catalog",
  "provider-api-docs",
  "provider-api-request",
  "run-code",
  "get-code-execution",
  "provider-corpus-job",
  "query-staged-dataset",
  "list-staged-datasets",
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
