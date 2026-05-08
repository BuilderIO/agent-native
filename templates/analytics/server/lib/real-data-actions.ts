export const REAL_DATA_REQUIRED_MARKER = "REAL_DATA_REQUIRED";

const INJECTED_CONTEXT_BLOCKS = [
  "current-screen",
  "current-url",
  "available-files",
  "available-skills",
  "available-agents",
  "available-jobs",
  "plan-mode-note",
];

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

export function stripInjectedAnalyticsGuardContext(text: string): string {
  let requestText = text;
  for (const tag of INJECTED_CONTEXT_BLOCKS) {
    requestText = requestText.replace(
      new RegExp(`\\n*<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi"),
      "",
    );
  }
  return requestText.trim();
}

function looksLikeWorkflowOrAutomationRequest(lower: string): boolean {
  const hasWorkflowArtifact =
    /\b(github actions?|ya?ml|cron|scheduled job|recurring job|pnpm script)\b|\.(?:ya?ml)\b/.test(
      lower,
    );
  const hasCreationIntent =
    /\b(want|need|create|make|set up|setup|add|migrate|move|port|convert|turn|translate|recreate|build)\b/.test(
      lower,
    );
  const hasAutomationTarget =
    /\b(recurring job|scheduled job|job|automation|automations|workflow|workflows|cron)\b/.test(
      lower,
    );

  return (
    /\brecurring job\b/.test(lower) ||
    (hasWorkflowArtifact && hasCreationIntent) ||
    (hasCreationIntent &&
      hasAutomationTarget &&
      /\bgithub actions?\b/.test(lower))
  );
}

export function looksLikeAnalyticsDataRequest(text: string): boolean {
  const requestText = stripInjectedAnalyticsGuardContext(text);
  const lower = requestText.toLowerCase();
  if (!lower) return false;
  if (lower.includes(REAL_DATA_REQUIRED_MARKER.toLowerCase())) return true;
  if (looksLikeWorkflowOrAutomationRequest(lower)) return false;
  if (
    /\b(open|navigate|go to|rename|delete|share|favorite|unfavorite)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  if (
    /\b(fix|bug|layout|style|component|route|code|source code|integration|connect|configure|settings)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  return /\b(analy[sz]e|analysis|dashboard|panel|metric|metrics|count|total|trend|breakdown|conversion|funnel|revenue|traffic|pageviews?|signups?|events?|users?|sessions?|retention|churn|pipeline|deals?|calls?|transcripts?|messages?|sentiment|themes?|objections?)\b/.test(
    lower,
  );
}

export function hasDataQueryAttempt(
  toolResults: Array<{ name?: string }> | undefined,
): boolean {
  return (toolResults ?? []).some((result) => {
    const name = String(result.name ?? "");
    return DATA_QUERY_ACTIONS.has(name) || isMcpDataSourceTool(name);
  });
}
