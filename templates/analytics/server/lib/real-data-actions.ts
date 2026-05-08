export const REAL_DATA_REQUIRED_MARKER = "REAL_DATA_REQUIRED";

export const DATA_QUERY_ACTIONS = new Set([
  "amplitude-events",
  "apollo-search",
  "bigquery",
  "commonroom-members",
  "content-calendar",
  "content-calendar-schema",
  "ga4-report",
  "gcloud",
  "github-prs",
  "gong-calls",
  "grafana",
  "hubspot-deals",
  "hubspot-metrics",
  "hubspot-pipelines",
  "hubspot-records",
  "jira",
  "jira-analytics",
  "jira-search",
  "mixpanel-events",
  "notion-page",
  "onboarding-events",
  "posthog-events",
  "pylon-issues",
  "query-agent-native-analytics",
  "query-inbound-forms",
  "sentry",
  "seo-blog-pages",
  "seo-page-keywords",
  "seo-top-keywords",
  "slack-messages",
  "stripe",
  "top-amplitude-events",
  "twitter-tweets",
]);

const MCP_DATA_SOURCE_TOKENS = [
  "amplitude",
  "apollo",
  "bigquery",
  "commonroom",
  "ga4",
  "github",
  "gong",
  "grafana",
  "hubspot",
  "jira",
  "mixpanel",
  "notion",
  "posthog",
  "postgres",
  "postgresql",
  "pylon",
  "sentry",
  "slack",
  "stripe",
];

function isMcpDataSourceTool(name: string): boolean {
  if (!name.startsWith("mcp__")) return false;
  const normalized = name.toLowerCase();
  return MCP_DATA_SOURCE_TOKENS.some((token) => normalized.includes(token));
}

export function hasDataQueryAttempt(
  toolResults: Array<{ name?: string }> | undefined,
): boolean {
  return (toolResults ?? []).some((result) => {
    const name = String(result.name ?? "");
    return DATA_QUERY_ACTIONS.has(name) || isMcpDataSourceTool(name);
  });
}
