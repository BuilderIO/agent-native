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
  "bigquery",
  "content-calendar",
  "content-calendar-schema",
  "gcloud",
  "gong-calls",
  "grafana",
  "hubspot-deals",
  "hubspot-metrics",
  "hubspot-pipelines",
  "hubspot-records",
  "jira",
  "jira-search",
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
  "query-agent-native-analytics",
  "query-inbound-forms",
  "sentry",
  "seo-blog-pages",
  "seo-page-keywords",
  "seo-top-keywords",
  "slack-messages",
  "stripe",
]);

export const CORPUS_SOURCE_ACTIONS = new Set([
  "provider-api-request",
  "provider-corpus-job",
  "query-staged-dataset",
]);

export const CORPUS_REDUCTION_ACTIONS = new Set(["run-code"]);

const RUN_CODE_BRIDGE_TOOLS_USED = /^bridgeToolsUsed:\s*(.+)$/im;

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

function normalizeActionToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function isToolName(name: string, expected: string): boolean {
  return normalizeActionToolName(name) === expected;
}

function isDataQueryActionName(name: string): boolean {
  return DATA_QUERY_ACTIONS.has(normalizeActionToolName(name));
}

function isCorpusSourceActionName(name: string): boolean {
  return CORPUS_SOURCE_ACTIONS.has(normalizeActionToolName(name));
}

function isCorpusReductionActionName(name: string): boolean {
  return CORPUS_REDUCTION_ACTIONS.has(normalizeActionToolName(name));
}

function isMcpDataSourceTool(name: string): boolean {
  const normalized = name.toLowerCase();
  if (!normalized.startsWith("mcp__")) return false;
  return MCP_DATA_SOURCE_TOKENS.some((token) => normalized.includes(token));
}

function isCorpusCapableMcpTool(name: string): boolean {
  if (!isMcpDataSourceTool(name)) return false;
  const normalizedMcpName = name.replace(/[^a-z0-9]+/gi, " ");
  return /\b(?:api|request|fetch|list|search|query|read|calls?|records?|messages?|tickets?|issues?|transcripts?)\b/i.test(
    normalizedMcpName,
  );
}

function getRunCodeBridgeToolNames(content: string | undefined): string[] {
  const match = RUN_CODE_BRIDGE_TOOLS_USED.exec(String(content ?? ""));
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function hasRunCodeDataQueryAttempt(content: string | undefined): boolean {
  return getRunCodeBridgeToolNames(content).some(
    (name) => isDataQueryActionName(name) || isMcpDataSourceTool(name),
  );
}

function hasRunCodeCorpusWorkflowAttempt(content: string | undefined): boolean {
  return getRunCodeBridgeToolNames(content).some(
    (name) => isCorpusSourceActionName(name) || isCorpusCapableMcpTool(name),
  );
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

const SOURCE_SEARCH_INTENT_TERMS =
  /\b(find|surface|search|scan|grep|review|inspect|check|look through|go find)\b/;

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
    ) &&
    !ANALYTICS_INTENT_TERMS.test(lower) &&
    !SOURCE_SEARCH_INTENT_TERMS.test(lower)
  ) {
    return false;
  }
  if (
    /\b(fix|bug|layout|style|component|route|code|source code)\b/.test(lower)
  ) {
    return false;
  }
  if (
    /\b(integration|connect|configure|settings)\b/.test(lower) &&
    !ANALYTICS_RESULT_TERMS.test(lower)
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
  /\b(?:i can't|i cannot|can't retrieve|cannot retrieve|couldn't retrieve|unable to retrieve|don't have access|do not have access|not configured|missing credentials?|need (?:a|the)? ?data source|need to know which source|which source|which data source|clarify|can you|once (?:that'?s|it is) (?:connected|configured|available)|no data source|without a successful|query failed|source query failed|sql failed|error running|before (?:i|we) can (?:calculate|report|answer|analyze)|i need to query)\b/i;

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

function valueHasIncompleteDataFlag(value: unknown, parentKey = ""): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => valueHasIncompleteDataFlag(entry, parentKey));
  }

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
        normalizedKey === "ok" &&
        candidate === false &&
        ["response", "result"].includes(parentKey)
      ) {
        return true;
      }
      if (
        normalizedKey === "status" &&
        typeof candidate === "number" &&
        candidate >= 400 &&
        ["response", "result"].includes(parentKey)
      ) {
        return true;
      }
      if (
        [
          "nextoffset",
          "nextcursor",
          "cursor",
          "nextpage",
          "nexttoken",
          "next",
        ].includes(normalizedKey) &&
        candidate !== null &&
        candidate !== undefined &&
        candidate !== "" &&
        candidate !== false
      ) {
        if (
          normalizedKey === "cursor" &&
          !["records", "paging", "pagination", "page", "meta"].includes(
            parentKey,
          )
        ) {
          return false;
        }
        return true;
      }
      return valueHasIncompleteDataFlag(candidate, normalizedKey);
    },
  );
}

const INCOMPLETE_DATA_TEXT =
  /\b(?:error running|run aborted|tool call timed out|timed out|inactivity timeout|stale_run|connection_error|fetch failed|network error|rate limit|rate-limited|too many requests|http\s*429|\b429\b|unhandled error|exitcode:\s*[1-9]\d*|interrupted before this tool returned|truncated|coverage gap|provider page cap|hit the .* page cap|has more content|call again with offset|full result was|default limit|duplicate skipped|only first)\b/i;

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
      !isDataQueryActionName(name) &&
      !isMcpDataSourceTool(name) &&
      !isToolName(name, "run-code") &&
      !isToolName(name, "provider-api-request")
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

const EXPLICIT_FULL_COVERAGE_CONFIDENCE_CLAIM =
  /\b(?:defensible|confident|confidence|full available|available corpus|full corpus|entire corpus|complete corpus|all available|any (?:available )?(?:calls?|records?|transcripts?|deals?|accounts?|customers?|tickets?|issues?|messages?)|every (?:available )?(?:calls?|records?|transcripts?|deals?|accounts?|customers?|tickets?|issues?|messages?))\b/i;

const GENERIC_FULL_COVERAGE_CLAIM = /\b(?:exhaustive|complete)\b/i;

const EXPLICIT_PARTIAL_DISCLOSURE =
  /\b(?:partial|partially|sample|sampled|subset|not exhaustive|non-exhaustive|incomplete|truncated|aborted|timed out|coverage gap|could not inspect|only inspected|only searched|only reviewed|first \d+|top \d+|returned \d+|remaining|unsearched|uninspected|unreviewed|not covered|uncovered|missing coverage)\b|\b(?:bounded|limited)\s+(?:coverage|sample|results?|records?|calls?|transcripts?|cohort|dataset|evidence|inspection|search|review)\b|\b(?:coverage|inspection|search|review|sample)\s+(?:was|is|remains|looks)?\s*(?:bounded|limited)\b|\b(?:inspected|searched|reviewed|analy[sz]ed)\s+\d+\s+(?:of|out of)\s+\d+\b/i;

const COVERAGE_SENSITIVE_ANALYTICS_REQUEST =
  /\b(?:all|every|each|entire|complete|full|exhaustive)\b[^.?!]{0,220}\b(?:calls?|records?|transcripts?|deals?|accounts?|customers?|tickets?|issues?|messages?|source records?|cohort|dataset|results?)\b|\b(?:find|surface|search|scan|grep|review|inspect|check|look through)\b[^.?!]{0,220}\b(?:any|all|every|each|mentions?|matches?|examples?|source records?|calls?|records?|transcripts?|deals?|accounts?|customers?|tickets?|issues?|messages?)\b|\b(?:let me know if you surface anything|surface anything|anything around|absence matters|where (?:the )?lack thereof|lack thereof is impacting|no mentions?|zero mentions?)\b/i;

export function looksLikeStrongCoverageClaim(text: string): boolean {
  return STRONG_COVERAGE_OR_ABSENCE_CLAIM.test(text);
}

export function hasExplicitPartialDisclosure(text: string): boolean {
  return EXPLICIT_PARTIAL_DISCLOSURE.test(text);
}

export function hasOverstatedCoverageConfidenceClaim(text: string): boolean {
  if (!looksLikeStrongCoverageClaim(text)) return false;
  if (hasExplicitPartialDisclosure(text)) return false;
  if (EXPLICIT_FULL_COVERAGE_CONFIDENCE_CLAIM.test(text)) return true;
  return GENERIC_FULL_COVERAGE_CLAIM.test(text);
}

export function looksLikeCoverageSensitiveAnalyticsRequest(
  text: string,
): boolean {
  const requestText = stripInjectedAnalyticsGuardContext(text);
  if (!looksLikeAnalyticsDataRequest(requestText)) return false;
  return COVERAGE_SENSITIVE_ANALYTICS_REQUEST.test(requestText);
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
    if (isToolName(name, "run-code")) {
      return hasRunCodeDataQueryAttempt(result.content);
    }
    return isDataQueryActionName(name) || isMcpDataSourceTool(name);
  });
}

function isFailedDataQueryAttempt(result: {
  name?: string;
  isError?: boolean;
  content?: string;
}): boolean {
  const name = String(result.name ?? "");
  const isDataQuery =
    isDataQueryActionName(name) ||
    isMcpDataSourceTool(name) ||
    (isToolName(name, "run-code") &&
      hasRunCodeDataQueryAttempt(result.content));
  if (!isDataQuery) return false;
  return result.isError === true || isProviderErrorOnlyContent(result.content);
}

function compactToolFailure(content: string | undefined): string {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return "the tool returned an error result without details";
  const max = 900;
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

export function failedDataQueryAttemptMessage(
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined,
): string | null {
  const failed = (toolResults ?? []).find(isFailedDataQueryAttempt);
  if (!failed) return null;
  const name = String(failed.name ?? "data-source query");
  return (
    `I did try \`${name}\`, but it did not return a successful data result: ` +
    compactToolFailure(failed.content) +
    "\n\nI need to fix and rerun that query, or report that exact source error instead of giving numbers."
  );
}

export function hasCorpusWorkflowAttempt(
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined,
): boolean {
  return (toolResults ?? []).some((result) => {
    if (result.isError) return false;
    if (isProviderErrorOnlyContent(result.content)) return false;
    const name = String(result.name ?? "");
    if (isCorpusSourceActionName(name)) return true;
    if (isToolName(name, "run-code")) {
      return hasRunCodeCorpusWorkflowAttempt(result.content);
    }

    // Connected provider MCP tools can expose broad search/list/request
    // primitives directly. Treat those as corpus-capable when they succeed so
    // apps are not forced through provider-api-request if a native MCP source
    // already provides the right general API surface.
    return isCorpusCapableMcpTool(name);
  });
}

export function hasFailedCorpusWorkflowEvidence(
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined,
): boolean {
  return (toolResults ?? []).some((result) => {
    const name = String(result.name ?? "");
    if (!isCorpusSourceActionName(name) && !isCorpusReductionActionName(name)) {
      return false;
    }
    if (result.isError) return true;
    const content = String(result.content ?? "");
    if (INCOMPLETE_DATA_TEXT.test(content)) return true;
    const parsed = tryParseJsonContent(content);
    return valueHasIncompleteDataFlag(parsed);
  });
}

type SourceRecordKind =
  | "transcript"
  | "message"
  | "ticket"
  | "issue"
  | "document"
  | "note"
  | "conversation";

const SOURCE_RECORD_KINDS: Array<{
  kind: SourceRecordKind;
  request: RegExp;
  evidence: RegExp;
}> = [
  {
    kind: "transcript",
    request: /\b(?:transcripts?|call transcripts?)\b/i,
    evidence:
      /\b(?:transcripts?|calltranscripts?|transcriptsearch)\b|\/calls\/transcript\b/i,
  },
  {
    kind: "message",
    request: /\b(?:messages?|slack messages?|chat messages?)\b/i,
    evidence: /\b(?:messages?|message_id|messageid|search\.messages)\b/i,
  },
  {
    kind: "ticket",
    request: /\b(?:tickets?|support tickets?)\b/i,
    evidence: /\b(?:tickets?|ticket_id|ticketid)\b/i,
  },
  {
    kind: "issue",
    request: /\b(?:issues?|jira issues?|pylon issues?)\b/i,
    evidence: /\b(?:issues?|issue_id|issueid)\b/i,
  },
  {
    kind: "document",
    request: /\b(?:documents?|docs?|pages?)\b/i,
    evidence: /\b(?:documents?|document_id|documentid|pages?)\b/i,
  },
  {
    kind: "note",
    request: /\b(?:notes?)\b/i,
    evidence: /\b(?:notes?|note_id|noteid)\b/i,
  },
  {
    kind: "conversation",
    request: /\b(?:conversations?|conversation logs?)\b/i,
    evidence: /\b(?:conversations?|conversation_id|conversationid)\b/i,
  },
];

function requestedSourceRecordKinds(text: string): SourceRecordKind[] {
  const requestText = stripInjectedAnalyticsGuardContext(text);
  return SOURCE_RECORD_KINDS.filter(({ request }) =>
    request.test(requestText),
  ).map(({ kind }) => kind);
}

function sourceRecordEvidenceRegexes(kinds: SourceRecordKind[]): RegExp[] {
  return SOURCE_RECORD_KINDS.filter(({ kind }) => kinds.includes(kind)).map(
    ({ evidence }) => evidence,
  );
}

function textHasAnyEvidenceTerm(text: string, kinds: SourceRecordKind[]) {
  return sourceRecordEvidenceRegexes(kinds).some((regex) => regex.test(text));
}

function corpusJobSourceEvidenceText(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const record = parsed as Record<string, unknown>;
  return JSON.stringify({
    source: record.source,
    hits: record.hits,
    sampleHits: record.sampleHits,
  });
}

function providerRequestEvidenceText(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const record = parsed as Record<string, unknown>;
  return JSON.stringify({
    request: record.request,
    responseJson:
      (record.response as Record<string, unknown> | undefined)?.json ?? null,
    dataset: record.dataset,
    columns: record.columns,
    sampleRows: record.sampleRows,
  });
}

function queryStagedDatasetEvidenceText(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const record = parsed as Record<string, unknown>;
  return JSON.stringify({
    rows: record.rows,
    columns: record.columns,
    aggregate: record.aggregate,
    groups: record.groups,
    sampleRows: record.sampleRows,
  });
}

function actionEvidenceTextForSourceRecords(result: {
  name?: string;
  content?: string;
}): string {
  const name = String(result.name ?? "");
  const normalizedName = normalizeActionToolName(name);
  const content = String(result.content ?? "");
  const parsed = tryParseJsonContent(content);

  if (normalizedName === "provider-corpus-job") {
    return corpusJobSourceEvidenceText(parsed);
  }
  if (normalizedName === "provider-api-request") {
    return providerRequestEvidenceText(parsed);
  }
  if (normalizedName === "query-staged-dataset") {
    return queryStagedDatasetEvidenceText(parsed);
  }
  if (normalizedName === "gong-calls") {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "";
    }
    const record = parsed as Record<string, unknown>;
    return JSON.stringify({
      transcript: record.transcript,
      transcriptText: record.transcriptText,
      transcriptSearch: record.transcriptSearch,
      transcripts: record.transcripts,
    });
  }
  if (normalizedName === "run-code") {
    return content;
  }
  if (isCorpusCapableMcpTool(name)) {
    return `${name}\n${content}`;
  }
  return content;
}

export function hasRequestedSourceRecordEvidence(
  userText: string,
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined,
): boolean {
  const kinds = requestedSourceRecordKinds(userText);
  if (!kinds.length) return true;
  return (toolResults ?? []).some((result) => {
    if (result.isError) return false;
    if (isProviderErrorOnlyContent(result.content)) return false;
    const evidenceText = actionEvidenceTextForSourceRecords(result);
    return textHasAnyEvidenceTerm(evidenceText, kinds);
  });
}

export function needsCorpusWorkflowForCoverageSensitiveRequest({
  userText,
  finalText,
  toolResults,
}: {
  userText: string;
  finalText: string;
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined;
}): boolean {
  if (!looksLikeCoverageSensitiveAnalyticsRequest(userText)) return false;
  if (!hasDataQueryAttempt(toolResults)) return false;
  if (hasCorpusWorkflowAttempt(toolResults)) return false;
  if (hasExplicitPartialDisclosure(finalText)) return false;
  return true;
}

export function needsSourceRecordBodyWorkflowForCoverageSensitiveRequest({
  userText,
  finalText,
  toolResults,
}: {
  userText: string;
  finalText: string;
  toolResults:
    | Array<{ name?: string; isError?: boolean; content?: string }>
    | undefined;
}): boolean {
  if (!looksLikeCoverageSensitiveAnalyticsRequest(userText)) return false;
  if (!requestedSourceRecordKinds(userText).length) return false;
  if (!looksLikeStrongCoverageClaim(finalText)) return false;
  if (hasExplicitPartialDisclosure(finalText)) return false;
  if (!hasCorpusWorkflowAttempt(toolResults)) return false;
  return !hasRequestedSourceRecordEvidence(userText, toolResults);
}
