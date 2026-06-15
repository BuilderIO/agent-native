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
  "account-deep-dive",
  "amplitude-events",
  "apollo-search",
  "bigquery",
  "commonroom-members",
  "content-calendar",
  "content-calendar-schema",
  "ga4-report",
  "gcloud",
  "github-code",
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
  "provider-api-request",
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

const ANALYTICS_RESULT_TERMS =
  /\b(conversion|conversions|funnel|revenue|traffic|pageviews?|signups?|events?|active users?|sessions?|retention|churn|pipeline|deals?|calls?|transcripts?|sentiment|themes?|objections?|cohorts?|segments?|accounts?|customers?|tickets?|issues?|leads?|opportunities|mrr|arr|ctr|cvr|cac|ltv)\b/;

const ANALYTICS_INTENT_TERMS =
  /\b(analy[sz]e|measure|calculate|query|report|summari[sz]e|break ?down|compare|rank|segment|forecast|trend|count|total|average|median|percent(?:age)?|rate|top|bottom|highest|lowest|how many|how much|what (?:is|are|was|were)|which|why)\b/;

const ARTIFACT_TERMS = /\b(analysis|dashboard|panel|chart|metric|metrics)\b/;

const ARTIFACT_DATA_INTENT =
  /\b(build|create|make|show|visuali[sz]e|plot|chart|query|calculate|report)\b/;

// Questions about schema, metadata, or available sources — these do NOT require
// a live provider data call. They should be answered from the data dictionary,
// schema introspection tools, or the agent's knowledge of configured sources.
const METADATA_ONLY_TERMS =
  /\b(what (?:tables?|columns?|fields?|sources?|datasets?|metrics?|schema) (?:are|is|exist|available|do (?:we|you|i) have)|which (?:sources?|tables?|providers?|integrations?) (?:are|is) (?:connected|configured|available|set up)|list (?:the )?(?:tables?|columns?|fields?|sources?|datasets?|schemas?)|show (?:me )?(?:available|the) (?:sources?|tables?|schemas?)|what does .+ (?:mean|measure|represent|track)|how is .+ (?:defined|calculated|computed|measured)|definition of|describe (?:the )?(?:\w+\s+)?(?:table|column|schema|metric|field)|list (?:the )?columns?\s+in|what (?:is|are) (?:the )?(?:data (?:dictionary|schema)|available (?:sources?|tables?))|what (?:source|provider|table) (?:has|stores|contains))\b/;

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

  // Metadata/data-dictionary questions do not need a live provider query.
  // Checking what's available, what a metric means, or what schema exists
  // should be answered from the dictionary and schema tools, not a data fetch.
  if (METADATA_ONLY_TERMS.test(lower)) return false;

  if (ANALYTICS_RESULT_TERMS.test(lower)) return true;
  if (
    ANALYTICS_INTENT_TERMS.test(lower) &&
    /\b(data|source|table|sql)\b/.test(lower)
  ) {
    return true;
  }
  return (
    ARTIFACT_TERMS.test(lower) &&
    ARTIFACT_DATA_INTENT.test(lower) &&
    ANALYTICS_RESULT_TERMS.test(lower)
  );
}

const UNSUPPORTED_RESULT_CLAIM =
  /(?:\b\d[\d,.]*(?:\.\d+)?\s*(?:%|percent|users?|customers?|accounts?|sessions?|events?|deals?|tickets?|issues?|calls?|messages?|signups?|pageviews?)\b|\$\s*\d|\b(?:data|query|results?)\s+(?:shows?|showed|indicates?|returned|found)\b|\b(?:i found|the top|the bottom|highest|lowest|increased|decreased|grew|declined|converted|churned|retained|averaged|total(?:ed)?|count(?:ed)?)\b)/i;

const SAFE_NO_DATA_RESPONSE =
  /\b(?:i can't|i cannot|can't retrieve|cannot retrieve|couldn't retrieve|unable to retrieve|don't have access|do not have access|not configured|missing credentials?|need (?:a|the)? ?data source|need to know which source|which source|which data source|clarify|can you|once (?:that'?s|it is) (?:connected|configured|available)|no data source|without a successful|before (?:i|we) can (?:calculate|report|answer|analyze)|i need to query)\b/i;

export function isSafeNoDataAnalyticsResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (UNSUPPORTED_RESULT_CLAIM.test(trimmed)) return false;
  if (SAFE_NO_DATA_RESPONSE.test(trimmed)) return true;
  return /\?\s*$/.test(trimmed) && !UNSUPPORTED_RESULT_CLAIM.test(trimmed);
}

function tryParseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function hasEvidencePayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  const evidenceKeys = [
    "accounts",
    "calls",
    "contacts",
    "deals",
    "emails",
    "events",
    "issues",
    "messages",
    "notes",
    "records",
    "results",
    "rows",
    "tickets",
    "transcripts",
  ];
  return Object.entries(record).some(([key, candidate]) => {
    if (evidenceKeys.includes(key)) {
      return Array.isArray(candidate) ? candidate.length > 0 : !!candidate;
    }
    return hasEvidencePayload(candidate);
  });
}

function isProviderErrorOnlyContent(content: string | undefined): boolean {
  if (!content) return false;
  const lower = content.trim().toLowerCase();
  if (!lower) return false;
  if (
    lower.startsWith("error ") ||
    lower.startsWith("error:") ||
    lower.includes('"error":"missing_api_key"') ||
    lower.includes('"error": "missing_api_key"')
  ) {
    return true;
  }

  const parsed = tryParseJsonContent(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const record = parsed as Record<string, unknown>;
  if (!("error" in record)) return false;
  return !hasEvidencePayload(record);
}

function valueHasIncompleteDataFlag(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(valueHasIncompleteDataFlag);

  return Object.entries(value as Record<string, unknown>).some(
    ([key, candidate]) => {
      const normalizedKey = key.toLowerCase();
      if (
        [
          "truncated",
          "coveragetruncated",
          "hasmore",
          "has_more",
          "moreavailable",
        ].includes(normalizedKey) &&
        candidate === true
      ) {
        return true;
      }
      if (
        ["nextoffset", "nextcursor", "nextpage", "nexttoken", "next"].includes(
          normalizedKey,
        ) &&
        candidate !== null &&
        candidate !== undefined &&
        candidate !== "" &&
        candidate !== false
      ) {
        return true;
      }
      return valueHasIncompleteDataFlag(candidate);
    },
  );
}

const INCOMPLETE_DATA_TEXT =
  /\b(?:error running|run aborted|tool call timed out|stale_run|connection_error|interrupted before this tool returned|truncated|coverage gap|provider page cap|hit the .* page cap|has more content|call again with offset|full result was|only first)\b/i;

export function hasIncompleteDataEvidence(
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined,
): boolean {
  return (toolResults ?? []).some((result) => {
    if (!result.content && !result.isError) return false;
    const name = String(result.name ?? "");
    if (
      name &&
      !DATA_QUERY_ACTIONS.has(name) &&
      !isMcpDataSourceTool(name) &&
      name !== "run-code" &&
      name !== "provider-api-request"
    ) {
      return false;
    }
    if (result.isError) return true;
    const content = String(result.content ?? "");
    if (INCOMPLETE_DATA_TEXT.test(content)) return true;
    const parsed = tryParseJsonContent(content);
    return valueHasIncompleteDataFlag(parsed);
  });
}

const STRONG_COVERAGE_OR_ABSENCE_CLAIM =
  /\b(?:no|zero|0)\s+(?:mentions?|matches?|results?|records?|calls?|tickets?|issues?|deals?|accounts?|customers?|transcripts?|examples?)\b|\b(?:none|nothing)\b[^.?!]*(?:found|matched|mentioned|returned|showed|surfaced)\b|\b(?:all|every|entire|complete|full|exhaustive)\b[^.?!]*(?:calls?|records?|transcripts?|deals?|accounts?|customers?|dataset|cohort|results?|search)\b|\b(?:did not|didn't|does not|doesn't)\s+(?:mention|include|contain|show|surface)\b/i;

const EXPLICIT_PARTIAL_DISCLOSURE =
  /\b(?:partial|partially|sample|sampled|subset|bounded|limited|not exhaustive|non-exhaustive|incomplete|truncated|aborted|timed out|coverage gap|could not inspect|only inspected|first \d+|top \d+|returned \d+)\b/i;

export function looksLikeStrongCoverageClaim(text: string): boolean {
  return STRONG_COVERAGE_OR_ABSENCE_CLAIM.test(text);
}

export function hasExplicitPartialDisclosure(text: string): boolean {
  return EXPLICIT_PARTIAL_DISCLOSURE.test(text);
}

export function hasDataQueryAttempt(
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined,
): boolean {
  return (toolResults ?? []).some((result) => {
    if (result.isError) return false;
    if (isProviderErrorOnlyContent(result.content)) return false;
    const name = String(result.name ?? "");
    return DATA_QUERY_ACTIONS.has(name) || isMcpDataSourceTool(name);
  });
}
