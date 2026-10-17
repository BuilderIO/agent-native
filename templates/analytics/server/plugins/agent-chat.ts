import "../register-secrets.js";
import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  buildDeepLink,
  getRequestContext,
  getRequestOrgId,
  getRequestRunContext,
  getRequestUserEmail,
  loadActionsFromStaticRegistry,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { PANEL_RENDERED_PREFIX } from "../../shared/panel-rendered-prefix";
import { INITIAL_TOOL_NAMES } from "../lib/agent-chat-plan-mode";
import {
  retrieveAnalyticsPromptReferences,
  summarizeAnalyticsRun,
} from "../lib/analytics-agent-context";
import { ANALYTICS_MCP } from "../lib/analytics-mcp";
import { enqueueAnalyticsMemoryCapture } from "../lib/analytics-memory-capture.js";
import "../lib/sigma-setup-secret-sweep.js";
import { credentialProviderConfigs } from "../lib/credential-keys";
import { isProductionServerlessRuntime } from "../lib/production-serverless-runtime.js";
import {
  deriveGroundingActionNames,
  draftClaimsAnalyticsMetrics,
  draftRestatesPriorEvidence,
  failedDataQueryAttemptMessage,
  hasCatalogSearchAttempt,
  hasFailedDbtSemanticMetricQuery,
  hasDashboardConstructionAttempt,
  hasPartialBigQueryResult,
  hasBigQueryPartialDisclosure,
  hasExplicitPartialDisclosure,
  hasFailedCorpusWorkflowEvidence,
  hasDataQueryAttempt,
  hasIncompleteDataEvidence,
  hasEmptyFindDataResult,
  hasCompleteBigQuerySchemaSearch,
  hasCompleteBigQuerySchemaSearchMatches,
  hasCompleteEmptyBigQuerySchemaSearch,
  hasScopedRosterSourceAbsenceClaim,
  hasUnscopedRosterSourceAbsenceClaim,
  looksLikeRosterSourceDiscoveryRequest,
  isGenericNoDataFallback,
  isSafeNoDataAnalyticsResponse,
  hasOverstatedCoverageConfidenceClaim,
  looksLikeCoverageSensitiveAnalyticsRequest,
  looksLikeDashboardConstructionRequest,
  looksLikeStrongCoverageClaim,
  isNonDataTurn,
  isTrivialTurn,
  needsCorpusWorkflowForCoverageSensitiveRequest,
  needsSourceRecordBodyWorkflowForCoverageSensitiveRequest,
  registerGroundingActions,
  stripInjectedAnalyticsGuardContext,
} from "../lib/real-data-actions";

const GROUNDING_ACTION_NAMES = deriveGroundingActionNames(actionsRegistry);
registerGroundingActions(GROUNDING_ACTION_NAMES);

const ANALYTICS_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;
export const ANALYTICS_BACKGROUND_RUN_NO_PROGRESS_TIMEOUT_MS = 3 * 60_000;

const DASHBOARD_EDIT_TOOLS = new Set([
  "compose-dashboard",
  "mutate-dashboard",
  "rename-dashboard",
  "reorder-dashboard-panels",
  "restore-dashboard-revision",
  "save-explorer-config",
  "save-explorer-dashboard",
  "save-sql-dashboard",
  "update-dashboard",
  "update-dashboard-demo",
  "update-dashboard-summary",
]);
const ANALYSIS_EDIT_TOOLS = new Set([
  "rename-analysis",
  "restore-analysis-revision",
  "save-analysis",
]);

function eventRecord(entry: unknown): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const event = (entry as { event?: unknown }).event;
  return event && typeof event === "object"
    ? (event as Record<string, unknown>)
    : undefined;
}

function inputForCompletedTool(
  events: readonly unknown[],
  index: number,
  completed: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (completed.input && typeof completed.input === "object") {
    return completed.input as Record<string, unknown>;
  }
  const id = typeof completed.id === "string" ? completed.id : undefined;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = eventRecord(events[cursor]);
    if (
      candidate?.type !== "tool_start" ||
      candidate.tool !== completed.tool ||
      (id && candidate.id !== id)
    ) {
      continue;
    }
    return candidate.input && typeof candidate.input === "object"
      ? (candidate.input as Record<string, unknown>)
      : undefined;
  }
  return undefined;
}

function analyticsToolTarget(
  tool: string,
  input: Record<string, unknown> | undefined,
  scopeType: "dashboard" | "analysis",
): unknown {
  if (scopeType === "dashboard") {
    if (
      tool === "compose-dashboard" ||
      tool === "mutate-dashboard" ||
      tool === "reorder-dashboard-panels" ||
      tool === "update-dashboard" ||
      tool === "update-dashboard-demo" ||
      tool === "update-dashboard-summary"
    ) {
      return input?.dashboardId ?? input?.id;
    }
    return input?.id ?? input?.dashboardId;
  }
  return input?.analysisId ?? input?.id;
}

function hasAnalyticsEdit(
  run: { events: readonly unknown[] },
  tools: ReadonlySet<string>,
  scopeType: "dashboard" | "analysis",
  scopeId: string,
): boolean {
  return run.events.some((entry, index) => {
    const record = eventRecord(entry);
    if (!record) return false;
    const input = inputForCompletedTool(run.events, index, record);
    return (
      record.type === "tool_done" &&
      record.completedSideEffect === true &&
      record.isError !== true &&
      typeof record.tool === "string" &&
      tools.has(record.tool) &&
      analyticsToolTarget(record.tool, input, scopeType) === scopeId
    );
  });
}

async function autosaveAnalyticsAfterAgentTurn(
  scope: { type: string; id: string },
  run: {
    events: readonly unknown[];
    threadId?: string;
    runId?: string;
    turnId?: string;
  },
): Promise<void> {
  const email = getRequestUserEmail();
  if (!email) return;
  const ctx = { email, orgId: getRequestOrgId() || null };
  if (
    scope.type === "dashboard" &&
    hasAnalyticsEdit(run, DASHBOARD_EDIT_TOOLS, "dashboard", scope.id)
  ) {
    const { createDashboardRevisionSnapshot } =
      await import("../lib/dashboards-store.js");
    await createDashboardRevisionSnapshot(scope.id, ctx, {
      ...(run.threadId ? { threadId: run.threadId } : {}),
      ...(run.runId ? { runId: run.runId } : {}),
      ...(run.turnId ? { turnId: run.turnId } : {}),
    });
    return;
  }
  if (
    scope.type === "analysis" &&
    hasAnalyticsEdit(run, ANALYSIS_EDIT_TOOLS, "analysis", scope.id)
  ) {
    const { createAnalysisRevisionSnapshot } =
      await import("../lib/dashboards-store.js");
    await createAnalysisRevisionSnapshot(scope.id, ctx, {
      ...(run.threadId ? { threadId: run.threadId } : {}),
      ...(run.runId ? { runId: run.runId } : {}),
      ...(run.turnId ? { turnId: run.turnId } : {}),
    });
  }
}

const ANALYTICS_DATA_SOURCES_LINK = buildDeepLink({
  app: "analytics",
  view: "data-sources",
  to: "/data-sources",
});

const DASHBOARD_BUILD_PAUSE_PATTERN =
  /\b(?:want me to|would you like me to|shall i|should i|can i|may i|do you want me to)\b[\s\S]{0,160}\b(?:proceed|continue|seed|populate|save|embed|finish|run|apply|create|build)\b/i;

function hasSuccessfulExtensionCreation(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): boolean {
  return (toolResults ?? []).some(
    (result) =>
      !result.isError &&
      String(result.name ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-") === "create-extension",
  );
}

function hasSuccessfulDashboardSave(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): boolean {
  const saveActions = new Set([
    "update-dashboard",
    "mutate-dashboard",
    "compose-dashboard",
    "update-extension",
  ]);
  return (toolResults ?? []).some((result) => {
    if (result.isError) return false;
    const name = String(result.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (!saveActions.has(name)) return false;
    if (result.receipt) return result.receipt.changed;
    // mutate-dashboard reports every write through a receipt; none means a dry run.
    if (name === "mutate-dashboard") return false;
    const content = String(result.content ?? "").trim();
    if (!content.startsWith("{")) return true;
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed.saved === false) return false;
      if (name === "compose-dashboard" && parsed.changed === false) {
        return false;
      }
      // coercion-ok: malformed structured action output fails closed below.
    } catch {
      return false;
    }
    return true;
  });
}

function hasPartialDashboardBuild(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): boolean {
  const partialBuildActions = new Set([
    "create-extension",
    "extension-data-set",
  ]);
  return (toolResults ?? []).some((result) => {
    if (result.isError) return false;
    const name = String(result.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    return partialBuildActions.has(name);
  });
}

export const NON_ANALYTICS_FALLBACK_RETRY_MESSAGE =
  "<non-analytics-retry>\nThe user's latest message is ordinary conversation. Reply to it directly and naturally. Never answer it with the no-grounded-data disclaimer.\n</non-analytics-retry>";

export const NON_ANALYTICS_FALLBACK_FINAL_MESSAGE =
  "I got stuck generating a reply to that message. Please try again or rephrase it.";

export interface AnalyticsPromptRule {
  id: string;
  text: string;
}

/** The always-on Analytics prompt: hard invariants plus a router to the skills
 *  that own each procedure. Procedures live in skills, not here; the baseline
 *  budget spec counts this list. */
export const ANALYTICS_PROMPT_RULES: readonly AnalyticsPromptRule[] = [
  {
    id: "real-data",
    text: "REAL DATA — Present metrics, counts, trends, or source-record conclusions only from a live data-source query that ran this turn; a catalog or dictionary hit, `data-source-status`, `get-sql-dashboard`, and dry-run validation are not data queries. Never substitute a fabricated number for a failed query or unavailable provider; report the exact gap. Matching totals do not prove exclusions. Verify them in the model or metric definition, tests, or saved SQL; label unsupported claims. Non-data tasks (greetings, general knowledge, math, writing, coding, workflow or settings help, conceptual planning) need no data call and never get the no-grounded-data fallback.",
  },
  {
    id: "references",
    text: 'REFERENCES — The system may preload bounded dictionary entries and saved dashboard panels in `<resource scope="analytics-catalog">`. They supply definitions and query examples, never current values. Approved entries are canonical, unreviewed human entries unverified, AI-generated unapproved entries suggestions. If nothing fits, call `find-data` once for ranked definitions, saved query examples, and generated source metadata. Call `search-bigquery-schema` next only when exact live columns or partition metadata are still needed. The words all, total, or exact do not by themselves make a question a corpus investigation.',
  },
  {
    id: "failed-calls",
    text: "FAILED CALLS — Correct invalid arguments once; never repeat an identical failed call. For credential, permission, quota, network, or repeated schema failures, stop using that source for the turn and surface the actual error rather than trying unrelated providers. `find-data` searches definitions, saved query examples, and generated source metadata together; `search-bigquery-schema` checks exact live warehouse metadata.",
  },
  {
    id: "understand-the-ask",
    text: 'UNDERSTAND THE ASK — "this", "that", and "it" mean the open dashboard or selected panel (`<current-screen>`, `selected-object`). When a preloaded or catalog reference fits, keep its source and business logic and change only filters and window; prefer certified over favorite over unmarked. An unqualified "active users" request may mean Builder product activity, Builder.io organization membership, or Agent-Native app opens. Ask which population they mean before querying; never combine or silently substitute them. If ambiguity could change results, ask exactly one `ask-question` with a recommended default; otherwise pick the default and label it. Open a data answer per AGENTS.md "Data questions"; otherwise one line, "Reading this as: <metric definition>, <window>, <filters>, <source>"; open an edit with "Changing <panel title> on <dashboard>". A source the user names wins. Never ask the user for dataset, table, column, or SQL identifiers; look them up.',
  },
  {
    id: "sources",
    text:
      "SOURCES — A provider the user names is authoritative for the turn: use its first-class query action, or `tool-search` for it when it is not loaded, instead of loading unrelated catalogs. `query-agent-native-analytics` is the always-available built-in first-party source (product events, signups, session recordings): never call it disconnected because an external provider is, and keep the event semantics of a first-party dashboard definition the catalog returns. For a named dbt metric, use `tool-search` to load `query-dbt-semantic-metric`. When reporting connection status, load `data-source-status` and distinguish `connectionHealth` (stored workspace state), `credentialsConfigured` (required local keys), and `ready` (configured query-path hint, not a live health check). When a live request needs an unavailable external provider, explain what is missing in context and link [Connect data sources](" +
      ANALYTICS_DATA_SOURCES_LINK +
      ") rather than a canned no-data sentence. A connected provider tool does not prove the workspace connection is healthy. Load provider API, corpus, staging, or code tools (`provider-api-request`, `provider-corpus-job`, `query-staged-dataset`, `run-code`) only for explicit cross-source work, exhaustive unstructured-record coverage, an absence claim the first-class action cannot support, or a durable export.",
  },
  {
    id: "workspace-routing",
    text: 'WORKSPACE ROUTING — Analytics owns first-party product usage, app/template events, agent-native signups, and conversions; when another app delegates one with `call-agent`, answer here from the built-in source and query catalog. Builder.io or AI credit spend, LLM usage by workspace member or month, and workspace app or Builder branch creation history are Dispatch-owned: your first call is `call-agent` with agent `dispatch`, action `list-dispatch-usage-metrics`, and input `{ sinceDays, scope: "workspace" }` (add `userEmail` only when the user narrows to one person), then read `monthlyByUser` and `workspaceAppCreationsByUserMonth`. Do not ask for a user export or BigQuery schema on that path. A request scoped to a named customer or account keeps that scope and uses the catalog, dictionary, schema, and one bounded query; never substitute workspace metrics, and resolve the account identity before attributing rows to it. Company knowledge, decisions, meeting context, and Slack context belong to the Brain app: `call-agent` with agent `brain` and a narrow natural-language question (Brain is not in `list-extensions`; do not use `provider-api-request` for it), and report its access or source errors verbatim.',
  },
  {
    id: "dashboard-builds",
    text: "DASHBOARD BUILDS — An explicit request to build, create, save, or adapt a dashboard authorizes every non-destructive in-app step to finish it in the same turn: query or scaffold, seed extension data, save, embed, navigate. Do not ask 'want me to proceed?' or stop at an empty shell; ask one question only when metric scope or grain changes the result, and pause for destructive changes or external side effects such as sending email or outreach. An approved action with concrete input runs exactly as given, and its dashboard id is authoritative: do not reinterpret an edit as a template clone.",
  },
  {
    id: "skills",
    text: 'SKILLS — Read the owning skill with `docs-search --slug "skill-<name>"` before the work: `dashboard-management` to create a dashboard or to move, reorder, lay out, or file panels (a small edit of one existing panel needs no skill: `get-sql-dashboard` with `panelIds`, then `mutate-dashboard`); `custom-blocks` for extension panels, which are a one-off exception to native panels; `account-health` for a named customer, QBR, or renewal; `incident-investigation` for a named user\'s sessions, errors, stuck runs, or replay evidence; `analysis-workspace` for CSV, XLSX, or file delivery. Deliver a CSV or file in chat with Download CSV on compact tables; for a durable export load `show-workspace-file`; never finish with only a path. Deferred tools load with one `tool-search` call: `update-dashboard`, `compose-dashboard`, `generate-chart`, `show-workspace-file`, `provider-api-request`.',
  },
  {
    id: "acknowledgments",
    text: "Give at most one brief acknowledgment. Avoid stacked compliments; address the feedback directly.",
  },
];

export function analyticsExtraContext(): string {
  return `<data-source-guidance>\n${ANALYTICS_PROMPT_RULES.map((rule) => rule.text).join("\n")}\n</data-source-guidance>`;
}

// A request stays inside one sentence or one bulleted list: a summary of the
// agent's own work ("tell me if something else is off. ... 43 rows in the
// table") is not a request, and a cross-sentence match discards a correct
// answer. "I need" is the agent narrating ("I need the table to reload")
// unless it names an identifier to supply or asks which one, so it has its own
// pattern instead of a bare alternative.
const SCHEMA_DETAILS_MAX_RETRIES = 2;
const SCHEMA_DETAILS_NOUN =
  "\\b(?:bigquery\\s+)?(?:dataset(?: name)?s?|table(?: name)?s?|column(?: name)?s?|field(?: name)?s?|schema|sql query)\\b";
// Bare provide/share/send count only as an imperative opening a sentence or
// line; mid-sentence they are the agent offering its answer ("I can provide a
// table of the results").
const SCHEMA_DETAILS_IMPERATIVE =
  "(?:^|[.?!:]\\s+|\\n\\s*)(?:provide|share|send(?: me)?)\\b";
// "Would you like me to show ..." is an offer, and verification or feedback
// ("tell me if ...", "could you confirm the table has 43 rows", "can you share
// anything else that's off") is never a request for details. A denylist of
// those verbs, not an allowlist of ask verbs: "could you let me know which
// table" and "would you mind providing" are real asks. "Confirm", "verify",
// "check", "see" and "look" are feedback only when they do not ask for an
// identifier ("could you confirm which table holds usage" is an ask; "confirm
// the table has 43 rows" is not).
const SCHEMA_DETAILS_OBJECT =
  "(?:bigquery\\s+)?(?:dataset|table|column|field)s?";
const SCHEMA_DETAILS_HOLDS =
  "(?:holds?|contains?|stores?|tracks?|records?|has|have)";
// What each feedback verb may go on to ask for before it is an identifier ask:
// confirm/verify/check/see/look: "which"/"what" or "the <object> name";
// show/display/open: "the <object> name" or "which <object> holds ...", but not
// "which table this came from"; explain/describe: "which" or "what the
// <object> name is", but not "what the table represents".
const SCHEMA_DETAILS_FEEDBACK_VERB = `(?!(?:\\s+please)?\\s+(?:(?:(?:double-)?confirm|verify|check|see|look)(?!\\s+(?:which|what)\\b|\\s+the\\s+${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?|details)\\b)|(?:show|display|pull up|open|bring up)(?!\\s+(?:me\\s+)?(?:the\\s+${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?|details)\\b|which\\s+${SCHEMA_DETAILS_OBJECT}\\s+${SCHEMA_DETAILS_HOLDS}\\b))|(?:explain|describe)(?!\\s+(?:which\\b|what\\s+(?:is\\s+)?the\\s+${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?)\\b|the\\s+${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?|details)\\b))|summari[sz]e|walk me through|share anything|let me know (?:if|whether|what else|anything)|tell me (?:if|whether|what else|anything|how|why))\\b)`;
const SCHEMA_DETAILS_FEEDBACK =
  "(?! (?:if|whether|what else|anything|how|why)\\b)";
const SCHEMA_DETAILS_ASK = `(?:\\b(?:(?:could|can|would) you(?! like)${SCHEMA_DETAILS_FEEDBACK_VERB}|do you know|please\\s+(?:provide|share(?! anything)|send|tell me${SCHEMA_DETAILS_FEEDBACK})|tell me${SCHEMA_DETAILS_FEEDBACK}|i need you to${SCHEMA_DETAILS_FEEDBACK_VERB})\\b|${SCHEMA_DETAILS_IMPERATIVE})`;
// A list lead-in must ask to be given something: "Can you tell me what else is
// off:" followed by a summary bullet that mentions a table is feedback.
const SCHEMA_DETAILS_LIST_ASK = `(?:\\b(?:(?:could|can|would) you(?! like)${SCHEMA_DETAILS_FEEDBACK_VERB}(?: please)? (?:provide|share|send|give|specify|list)|please\\s+(?:provide|share(?! anything)|send)|i need you to${SCHEMA_DETAILS_FEEDBACK_VERB})\\b|${SCHEMA_DETAILS_IMPERATIVE})`;
// "I need <identifier>" is narration when the agent goes on to say it found it
// ("so I re-ran it", "I looked it up"). The narration has to be tied to the
// need: in the same sentence, or opening the very next one ("I need the table
// name. I checked the catalog and it is usage_monthly."), so an unrelated
// "Separately, I ran the revenue query" does not clear an earlier ask. Only a
// closed list of discovery verbs counts: "so I can write the query" and "so I
// cannot continue" are still asks. An attempt that reports it failed ("I
// searched the catalog, but nothing matched") resolved nothing either.
const SCHEMA_DETAILS_SENTENCE = "(?:[^.?!\\n]|[.?!](?=\\S))*";
const SCHEMA_DETAILS_RESOLUTION =
  "\\bi(?:['’]ve|\\s+have)?\\s+(?:(?:just|then|already)\\s+)?(?:(?:re-?)?(?:ran(?!\\s+into)|run(?!\\s+into)|queried|checked)|looked|searched|found|pulled|fetched|verified|confirmed|opened|inspected|used|listed|read|identified|discovered|resolved)\\b";
const SCHEMA_DETAILS_FAILED =
  "(?:\\b(?:but\\s+(?:nothing|none|no)|nothing\\s+(?:matched|came|turned|was|found|there)|found\\s+(?:nothing|none|no\\s+(?!(?:other|more|additional|further|duplicate)\\b))|no\\s+(?:match(?:es|ing)?|results?|luck|such|hits?)|not\\s+found|cannot|could\\s+not|unable|did\\s+not|failed|came\\s+up\\s+empty|returned\\s+(?:nothing|no|zero|0)|(?:was|were|is|are)\\s+empty)|n['’]t\\s+(?:able|find|found|match|see|exist|return|show|work|locate|surface|turn|there))\\b";
const SCHEMA_DETAILS_FOLLOW_ON =
  "(?:(?:so|then|and|but|luckily|fortunately|however|instead|first|now)\\b,?\\s+)?";
const SCHEMA_DETAILS_DISCOVERED = `${SCHEMA_DETAILS_RESOLUTION}(?!${SCHEMA_DETAILS_SENTENCE}${SCHEMA_DETAILS_FAILED}|${SCHEMA_DETAILS_SENTENCE}[.?!]+\\s+${SCHEMA_DETAILS_SENTENCE}${SCHEMA_DETAILS_FAILED})`;
const SCHEMA_DETAILS_RESOLVED = `(?!${SCHEMA_DETAILS_SENTENCE}${SCHEMA_DETAILS_DISCOVERED}|${SCHEMA_DETAILS_SENTENCE}[.?!]+\\s+${SCHEMA_DETAILS_FOLLOW_ON}${SCHEMA_DETAILS_DISCOVERED})`;
// Up to three descriptive words may sit between the interrogative and the noun
// ("which source table", "which warehouse table"); prepositions and articles
// may not, so "which row in the table is wrong?" is not an identifier ask.
const SCHEMA_DETAILS_MODIFIERS =
  "(?:(?!(?:in|of|on|at|from|by|with|to|for|the|a|an|this|that|these|those|each|every|any|your|our|my|their|is|are|does|do|did|should|would|can|has|have)\\b)[\\w-]+\\s+){0,3}";
const SCHEMA_DETAILS_REQUEST_PATTERN = new RegExp(
  `${SCHEMA_DETAILS_ASK}[^.?!:,\\n]{0,200}${SCHEMA_DETAILS_NOUN}|\\bi need (?:to know )?(?:(?:the|an?|your) (?:schema|sql query)\\b|(?:(?:the|an?|your) )?(?:bigquery )?(?:dataset|table|column|field)s? (?:names?|identifiers?|details)\\b|(?:the|an?|your) (?:bigquery )?(?:dataset|table|column|field)s? (?:that|which) (?:holds?|contains?|stores?|tracks?|records?)\\b|(?:the|an?|your) (?:names?|identifiers?) (?:of|for) (?:the|your|this) (?:bigquery )?(?:dataset|table|column|field)\\b|(?<=to know )(?:which\\b[^.?!\\n]{0,120}${SCHEMA_DETAILS_NOUN}|what\\s+(?:is|are)\\s+the\\s+(?:${SCHEMA_DETAILS_MODIFIERS}${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?)|(?:names?|identifiers?)\\s+(?:of|for)\\s+(?:the\\s+)?${SCHEMA_DETAILS_MODIFIERS}${SCHEMA_DETAILS_OBJECT})\\b|what\\s+the\\s+${SCHEMA_DETAILS_MODIFIERS}${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?)\\s+(?:is|are)\\b|what\\s+${SCHEMA_DETAILS_MODIFIERS}${SCHEMA_DETAILS_OBJECT}\\s+${SCHEMA_DETAILS_HOLDS}\\b))${SCHEMA_DETAILS_RESOLVED}`,
  "i",
);
const SCHEMA_DETAILS_LIST_REQUEST_PATTERN = new RegExp(
  `${SCHEMA_DETAILS_LIST_ASK}[^.?!\\n]{0,80}[:?][ \\t]*\\n(?:[ \\t]*\\n)*((?:[ \\t]*(?:[-*•]|\\d+[.)])[^\\n]*\\n?){1,6})`,
  "i",
);
// The interrogative must open the sentence or a framing clause ("For this
// metric, which table ...?"): "Want me to show which table this came from?" is
// an offer, not a request for an identifier. It must also ask for the
// identifier itself: "which table holds usage?", "which table for monthly
// usage?" and "what is the table name?" do, "which table rows were excluded?"
// and "what is the table size?" are answer-shaped questions that only mention a
// table.
const SCHEMA_DETAILS_QUESTION_PATTERN = new RegExp(
  `(?:^|[.?!:,]\\s+|\\n\\s*)(?:what\\s+(?:is|are)\\s+the\\s+${SCHEMA_DETAILS_MODIFIERS}${SCHEMA_DETAILS_OBJECT}\\s+(?:names?|identifiers?)\\b|what\\s+(?:is|are)\\s+the\\s+(?:names?|identifiers?)\\s+(?:of|for)\\s+(?:the\\s+)?${SCHEMA_DETAILS_MODIFIERS}${SCHEMA_DETAILS_OBJECT}\\b|what\\s+(?:is|are)\\s+(?:the|your)\\s+(?:schema|sql\\s+quer(?:y|ies))\\b|(?:which|what)\\s+${SCHEMA_DETAILS_MODIFIERS}(?:(?:dataset|table|column|field|schema)s?|sql\\s+quer(?:y|ies))\\s+(?:${SCHEMA_DETAILS_HOLDS}|is|are|does|do|should|would|can|name|for|to)\\b)[^.?!\\n]*\\?`,
  "i",
);

function looksLikeSchemaDetailsRequest(text: string): boolean {
  const draft = stripInjectedAnalyticsGuardContext(String(text ?? ""));
  const listItems = SCHEMA_DETAILS_LIST_REQUEST_PATTERN.exec(draft)?.[1];
  return (
    SCHEMA_DETAILS_REQUEST_PATTERN.test(draft) ||
    SCHEMA_DETAILS_QUESTION_PATTERN.test(draft) ||
    (listItems !== undefined &&
      new RegExp(SCHEMA_DETAILS_NOUN, "i").test(listItems))
  );
}

export { INITIAL_TOOL_NAMES } from "../lib/agent-chat-plan-mode";

function latestUserText(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part.text ?? ""))
      .join("\n");
    if (text.trim()) return text;
  }
  return "";
}

const UNVERIFIED_DRAFT_RETRY_INSTRUCTION =
  ' If you cannot run a query, restate every number, count, or trend in the draft as explicitly unverified (prefix the sentence with "Unverified:") rather than asserting it.';

function sourceStatusDescription(summary: DataSourceStatusSummary): string {
  const healthyWorkspaceConnections = summary.workspaceConnectedSourceLabels;
  const healthyLabels = new Set(healthyWorkspaceConnections);
  const configuredWithoutHealthyGrant = summary.configuredSourceLabels.filter(
    (label) => !healthyLabels.has(label),
  );
  const details = [
    healthyWorkspaceConnections.length
      ? `healthy workspace connections: ${healthyWorkspaceConnections.join(", ")}`
      : "",
    configuredWithoutHealthyGrant.length
      ? `configured sources without a healthy workspace connection: ${configuredWithoutHealthyGrant.join(", ")}`
      : "",
  ].filter(Boolean);
  return details.join("; ");
}

function exhaustedDraftPrefixFor({
  toolResults,
  setupMarkdown,
  includeConnectOption,
}: {
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"];
  setupMarkdown: string;
  includeConnectOption: boolean;
}): string {
  const sourceStatus = dataSourceStatusSummary(toolResults);
  const sourceStatusDetails = sourceStatusDescription(sourceStatus);
  const sourceStatusSentence = sourceStatusDetails
    ? ` Data-source status reports ${sourceStatusDetails}; it does not verify a query result.`
    : "";
  const nextOptions = [
    "ask me to query an existing dashboard (I'll search certified ones first)",
    "narrow the question to one metric and time range",
  ];
  if (includeConnectOption) {
    nextOptions.push(`connect the missing source: ${setupMarkdown}`);
  }
  return (
    "Unverified — no live data query ran for this answer, so every figure and trend below is unconfirmed." +
    sourceStatusSentence +
    ` Next options: ${nextOptions.join(", ")}.`
  );
}

function isRealUserTextMessage(message: {
  role?: string;
  content?: unknown;
}): boolean {
  if (message?.role !== "user" || !Array.isArray(message.content)) {
    return false;
  }
  const parts = message.content as Array<{ type?: string }>;
  return (
    parts.some((part) => part?.type === "text") &&
    !parts.some((part) => part?.type === "tool-result")
  );
}

function priorTurnEvidence(
  messages: AgentLoopFinalResponseGuardContext["messages"],
): {
  toolResults: Array<{ name?: string; isError?: boolean; content?: string }>;
  text: string;
} {
  const collected: Array<{
    name?: string;
    isError?: boolean;
    content?: string;
  }> = [];
  const textParts: string[] = [];
  let turnBoundariesCrossed = 0;
  for (let i = messages.length - 2; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (isRealUserTextMessage(message)) {
      turnBoundariesCrossed += 1;
      if (turnBoundariesCrossed >= 2) break;
      continue;
    }
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content as Array<{
      type?: string;
      text?: string;
      input?: unknown;
      toolName?: string;
      isError?: boolean;
      content?: string;
    }>) {
      if (part?.type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
      } else if (part?.type === "tool-call") {
        textParts.push(
          typeof part.input === "string"
            ? part.input
            : JSON.stringify(part.input ?? ""),
        );
      } else if (part?.type === "tool-result") {
        collected.push({
          name: part.toolName,
          isError: part.isError,
          content: part.content,
        });
        textParts.push(String(part.content ?? ""));
      }
    }
  }
  return { toolResults: collected, text: textParts.join("\n") };
}

interface DataSourceStatusSummary {
  checked: boolean;
  configuredSourceLabels: string[];
  workspaceConnectedSourceLabels: string[];
  availableExternalSources: Array<{
    aliases: string[];
    configured: boolean | null;
    workspaceGrantState?: string;
    credentialsConfigured?: boolean | null;
    label?: string;
    setupLink?: string;
  }>;
  setupLink: string;
}

function inferRequiredCredentialsConfigured(
  providerId: unknown,
  record: Record<string, unknown>,
  configured: boolean | null,
  workspaceGrantState: string | undefined,
): boolean | null {
  if (typeof record.credentialsConfigured === "boolean") {
    return record.credentialsConfigured;
  }

  const rawMissingRequiredKeys = record.missingRequiredKeys;
  if (
    Array.isArray(rawMissingRequiredKeys) &&
    rawMissingRequiredKeys.every((key) => typeof key === "string")
  ) {
    return rawMissingRequiredKeys.length === 0;
  }

  const configuredKeys = Array.isArray(record.configuredKeys)
    ? record.configuredKeys.filter(
        (key): key is string => typeof key === "string",
      )
    : null;
  if (configuredKeys && typeof providerId === "string") {
    const providerConfig = credentialProviderConfigs.find(
      (provider) => provider.provider === providerId,
    );
    if (providerConfig) {
      const configuredKeySet = new Set(
        configuredKeys.map((key) => key.trim().toUpperCase()),
      );
      const requiredMode = providerConfig.requiredMode ?? "all";
      return requiredMode === "any"
        ? providerConfig.requiredKeys.some((key) =>
            configuredKeySet.has(key.toUpperCase()),
          )
        : providerConfig.requiredKeys.every((key) =>
            configuredKeySet.has(key.toUpperCase()),
          );
    }
  }

  if (
    workspaceGrantState === "granted" ||
    workspaceGrantState === "connected"
  ) {
    return null;
  }
  return configured === true ? true : null;
}

const GENERIC_EXTERNAL_SOURCE_REQUEST_TERMS = /\b(warehouse|crm|payments?)\b/i;

const EXTERNAL_SOURCE_PROVIDER_ALIASES = [
  ...credentialProviderConfigs.map(({ provider, label }) => ({
    terms:
      provider === "builder" ? [label, "Builder content"] : [provider, label],
    aliases: [provider, label],
  })),
  { terms: ["ga4"], aliases: ["ga4", "google analytics"] },
  { terms: ["twitter/x", "x/twitter"], aliases: ["twitter", "x/twitter"] },
];

function looksLikeExternalSourceRequest(userText: string): boolean {
  return (
    GENERIC_EXTERNAL_SOURCE_REQUEST_TERMS.test(userText) ||
    EXTERNAL_SOURCE_PROVIDER_ALIASES.some(({ terms }) =>
      terms.some((term) => containsNormalizedPhrase(userText, term)),
    )
  );
}

function normalizeSourceLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedText = normalizeSourceLabel(text);
  const normalizedPhrase = normalizeSourceLabel(phrase);
  return Boolean(
    normalizedPhrase &&
    (normalizedText === normalizedPhrase ||
      normalizedText.startsWith(`${normalizedPhrase} `) ||
      normalizedText.endsWith(` ${normalizedPhrase}`) ||
      normalizedText.includes(` ${normalizedPhrase} `)),
  );
}

function sourceAliasesOverlap(left: string[], right: string[]): boolean {
  return left.some((leftAlias) =>
    right.some((rightAlias) => {
      const normalizedLeft = normalizeSourceLabel(leftAlias);
      const normalizedRight = normalizeSourceLabel(rightAlias);
      return (
        normalizedLeft === normalizedRight ||
        normalizedLeft.startsWith(`${normalizedRight} `) ||
        normalizedLeft.endsWith(` ${normalizedRight}`) ||
        normalizedLeft.includes(` ${normalizedRight} `) ||
        normalizedRight.startsWith(`${normalizedLeft} `) ||
        normalizedRight.endsWith(` ${normalizedLeft}`) ||
        normalizedRight.includes(` ${normalizedLeft} `)
      );
    }),
  );
}

function hasMissingRequestedExternalSource(
  userText: string,
  configuredSourceLabels: string[],
  availableExternalSources: DataSourceStatusSummary["availableExternalSources"] = [],
): boolean {
  const configuredAliases = [
    ...configuredSourceLabels.map((label) => [label]),
    ...availableExternalSources
      .filter(({ configured }) => configured === true)
      .map(({ aliases }) => aliases),
  ];
  const sourceAliases = [
    ...EXTERNAL_SOURCE_PROVIDER_ALIASES,
    ...availableExternalSources.map(({ aliases }) => ({
      terms: aliases,
      aliases,
    })),
  ];
  return sourceAliases
    .filter(({ terms }) =>
      terms.some((term) => containsNormalizedPhrase(userText, term)),
    )
    .some(({ aliases }) => {
      const matchingStatuses = availableExternalSources.filter((source) =>
        sourceAliasesOverlap(source.aliases, aliases),
      );
      if (
        matchingStatuses.some(
          (source) =>
            source.workspaceGrantState === "granted" &&
            source.credentialsConfigured !== true,
        )
      ) {
        return true;
      }
      if (
        matchingStatuses.some(
          (source) =>
            source.workspaceGrantState === "needs_grant" &&
            source.credentialsConfigured === false,
        )
      ) {
        return true;
      }
      if (
        matchingStatuses.some(
          ({ configured }) => configured === true || configured === null,
        )
      ) {
        return false;
      }
      return !configuredAliases.some((configured) =>
        sourceAliasesOverlap(configured, aliases),
      );
    });
}

function dataSourceStatusSummary(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): DataSourceStatusSummary {
  const configuredSourceLabels = new Set<string>();
  const workspaceConnectedSourceLabels = new Set<string>();
  const availableExternalSources = new Map<
    string,
    DataSourceStatusSummary["availableExternalSources"][number]
  >();
  let checked = false;
  let setupLink = ANALYTICS_DATA_SOURCES_LINK;

  const addAvailableExternalSource = (
    provider: unknown,
    label: unknown,
    configured: boolean | null,
    providerSetupLink?: unknown,
    details?: {
      workspaceGrantState?: string;
      credentialsConfigured?: boolean | null;
    },
  ) => {
    const aliases = [provider, label]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    const key = normalizeSourceLabel(aliases[0] ?? aliases[1] ?? "");
    if (!key) return;
    const existing = availableExternalSources.get(key);
    if (existing) {
      existing.configured =
        existing.configured === true || configured === true
          ? true
          : existing.configured === null || configured === null
            ? null
            : false;
      if (details?.workspaceGrantState) {
        existing.workspaceGrantState = details.workspaceGrantState;
      }
      if (details?.credentialsConfigured !== undefined) {
        // The compact configuredDataSources entry is only a hint: its `via`
        // value can include optional credentials. The provider record carries
        // the authoritative required-credential result and must be allowed to
        // correct that inference in either direction.
        existing.credentialsConfigured = details.credentialsConfigured;
      }
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
      if (!existing.label && typeof label === "string" && label.trim()) {
        existing.label = label.trim();
      }
      if (
        !existing.setupLink &&
        typeof providerSetupLink === "string" &&
        providerSetupLink.trim()
      ) {
        existing.setupLink = providerSetupLink.trim();
      }
      return;
    }
    availableExternalSources.set(key, {
      aliases,
      configured,
      ...(details?.workspaceGrantState
        ? { workspaceGrantState: details.workspaceGrantState }
        : {}),
      ...(details?.credentialsConfigured !== undefined
        ? { credentialsConfigured: details.credentialsConfigured }
        : {}),
      ...(typeof label === "string" && label.trim()
        ? { label: label.trim() }
        : {}),
      ...(typeof providerSetupLink === "string" && providerSetupLink.trim()
        ? { setupLink: providerSetupLink.trim() }
        : {}),
    });
  };

  for (const result of toolResults ?? []) {
    const normalizedName = String(result.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (normalizedName !== "data-source-status" || result.isError) continue;

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(String(result.content ?? ""));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }

    const workspaceConnections =
      parsed.workspaceConnections &&
      typeof parsed.workspaceConnections === "object" &&
      !Array.isArray(parsed.workspaceConnections)
        ? (parsed.workspaceConnections as Record<string, unknown>)
        : null;
    if (!parsed.error && workspaceConnections?.available !== false) {
      checked = true;
    }

    let foundSetupLink = false;
    for (const candidate of [
      parsed.dataSourcesSetupLink,
      parsed.dataSourcesLink,
      parsed.setupLink,
    ]) {
      const url =
        typeof candidate === "string"
          ? candidate
          : candidate &&
              typeof candidate === "object" &&
              !Array.isArray(candidate)
            ? (candidate as Record<string, unknown>).url
            : undefined;
      if (typeof url === "string" && url.trim()) {
        setupLink = url.trim();
        foundSetupLink = true;
        break;
      }
    }
    if (
      !foundSetupLink &&
      typeof parsed.settingsPath === "string" &&
      parsed.settingsPath.trim()
    ) {
      setupLink = parsed.settingsPath.trim();
    }

    const compactSources = Array.isArray(parsed.configuredDataSources)
      ? parsed.configuredDataSources
      : [];
    for (const source of compactSources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        continue;
      }
      const record = source as Record<string, unknown>;
      const provider = (
        typeof record.provider === "string"
          ? record.provider
          : (JSON.stringify(record.provider) ?? "")
      )
        .trim()
        .toLowerCase();
      const via = (
        typeof record.via === "string"
          ? record.via
          : (JSON.stringify(record.via) ?? "")
      )
        .trim()
        .toLowerCase();
      if (provider === "first-party" || via === "built-in") continue;
      const label = record.label ?? record.provider;
      if (typeof label === "string" && label.trim()) {
        configuredSourceLabels.add(label.trim());
        if (via === "workspace" || via === "credentials-and-workspace") {
          workspaceConnectedSourceLabels.add(label.trim());
        }
      }
      const workspaceGrantState =
        via === "workspace-grant" || via === "credentials-and-workspace-grant"
          ? "granted"
          : via === "workspace" || via === "credentials-and-workspace"
            ? "connected"
            : undefined;
      // `credentials-and-workspace-grant` is not evidence that required keys
      // are present: the compact summary can include optional-only keys.
      // Leave required-credential readiness unknown until the provider detail
      // supplies its explicit result (or enough required-key metadata).
      const credentialsConfigured = via === "credentials" ? true : undefined;
      addAvailableExternalSource(
        record.provider,
        label,
        true,
        record.setupLink,
        { workspaceGrantState, credentialsConfigured },
      );
    }

    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    for (const provider of providers) {
      if (
        !provider ||
        typeof provider !== "object" ||
        Array.isArray(provider)
      ) {
        continue;
      }
      const record = provider as Record<string, unknown>;
      const providerId = (
        typeof record.provider === "string"
          ? record.provider
          : (JSON.stringify(record.provider) ?? "")
      )
        .trim()
        .toLowerCase();
      if (providerId === "first-party") continue;
      const label = record.label ?? record.provider;
      const configured =
        typeof record.configured === "boolean" ? record.configured : null;
      const workspaceConnection =
        record.workspaceConnection &&
        typeof record.workspaceConnection === "object" &&
        !Array.isArray(record.workspaceConnection)
          ? (record.workspaceConnection as Record<string, unknown>)
          : null;
      const workspaceGrantState =
        typeof workspaceConnection?.grantState === "string"
          ? workspaceConnection.grantState
          : undefined;
      const credentialsConfigured = inferRequiredCredentialsConfigured(
        record.provider,
        record,
        configured,
        workspaceGrantState,
      );
      const requiredCredentialsMissingWithoutGrant =
        workspaceGrantState === "needs_grant" &&
        credentialsConfigured === false;
      const effectiveConfigured = requiredCredentialsMissingWithoutGrant
        ? false
        : configured;
      addAvailableExternalSource(
        record.provider,
        label,
        effectiveConfigured,
        record.setupLink,
        { workspaceGrantState, credentialsConfigured },
      );
      if (
        effectiveConfigured === true &&
        typeof label === "string" &&
        label.trim()
      ) {
        configuredSourceLabels.add(label.trim());
      } else if (
        effectiveConfigured === false &&
        typeof label === "string" &&
        label.trim()
      ) {
        configuredSourceLabels.delete(label.trim());
      }
      if (
        workspaceConnection?.grantState === "connected" &&
        typeof label === "string" &&
        label.trim()
      ) {
        workspaceConnectedSourceLabels.add(label.trim());
      }
    }

    const workspaceProviders = Array.isArray(workspaceConnections?.providers)
      ? workspaceConnections.providers
      : [];
    for (const provider of workspaceProviders) {
      if (
        !provider ||
        typeof provider !== "object" ||
        Array.isArray(provider)
      ) {
        continue;
      }
      const record = provider as Record<string, unknown>;
      const providerId = record.id ?? record.provider;
      const label = record.label ?? providerId;
      const grantState =
        typeof record.grantState === "string" ? record.grantState : null;
      const configured =
        record.configured === true ||
        grantState === "connected" ||
        grantState === "granted"
          ? true
          : record.configured === false ||
              grantState === "needs_grant" ||
              grantState === "not_connected"
            ? false
            : null;
      addAvailableExternalSource(providerId, label, configured, undefined, {
        ...(grantState ? { workspaceGrantState: grantState } : {}),
      });
      if (configured && typeof label === "string" && label.trim()) {
        configuredSourceLabels.add(label.trim());
      }
      if (
        grantState === "connected" &&
        typeof label === "string" &&
        label.trim()
      ) {
        workspaceConnectedSourceLabels.add(label.trim());
      }
    }
  }

  return {
    checked,
    configuredSourceLabels: [...configuredSourceLabels],
    workspaceConnectedSourceLabels: [...workspaceConnectedSourceLabels],
    availableExternalSources: [...availableExternalSources.values()],
    setupLink,
  };
}

function requestedExternalSourceSetup(
  userText: string,
  summary: DataSourceStatusSummary,
): { label: string; setupLink: string; kind: "connect" | "review" } | null {
  let source:
    | DataSourceStatusSummary["availableExternalSources"][number]
    | undefined;
  let kind: "connect" | "review" = "connect";
  let bestMatchLength = -1;
  for (const candidate of summary.availableExternalSources) {
    const needsReview =
      candidate.workspaceGrantState === "granted" &&
      candidate.credentialsConfigured !== true;
    const needsConnect =
      candidate.workspaceGrantState === "needs_grant" &&
      candidate.credentialsConfigured === false;
    if (
      (candidate.configured !== false && !needsReview && !needsConnect) ||
      !candidate.setupLink
    )
      continue;
    const matchLength = Math.max(
      -1,
      ...candidate.aliases
        .filter((alias) => containsNormalizedPhrase(userText, alias))
        .map((alias) => normalizeSourceLabel(alias).length),
    );
    if (matchLength > bestMatchLength) {
      source = candidate;
      kind = needsReview ? "review" : "connect";
      bestMatchLength = matchLength;
    }
  }
  if (!source?.setupLink) return null;
  return {
    label: source.label ?? source.aliases[0] ?? "data source",
    setupLink: source.setupLink,
    kind,
  };
}

function includesDataSourcesLink(text: string, setupLink: string): boolean {
  const normalizedSetupLink = setupLink.trim().replace(/&amp;/g, "&");
  if (!normalizedSetupLink) return false;
  const normalizedText = text.replace(/&amp;/g, "&");
  const linkPattern = /\[[^\]]+\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g;
  return [...normalizedText.matchAll(linkPattern)].some((match) => {
    const destination = match[1]?.replace(/^<|>$/g, "");
    return destination === normalizedSetupLink;
  });
}

type DbtMetricTimeRange = {
  startDate: string;
  endDate: string;
};

function analyticsActionName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

type ActionSummaryRecordResult =
  | { kind: "record"; record: Record<string, unknown> }
  | { kind: "invalid" }
  | { kind: "absent" };

function actionSummaryRecord(value: unknown): ActionSummaryRecordResult {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { kind: "record", record: value as Record<string, unknown> };
  }
  if (typeof value !== "string") return { kind: "absent" };
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "record", record: parsed as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function metricTimeRange(value: unknown): DbtMetricTimeRange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const range = value as Record<string, unknown>;
  return typeof range.startDate === "string" &&
    typeof range.endDate === "string"
    ? { startDate: range.startDate, endDate: range.endDate }
    : null;
}

function boundedPeriodRequest(userText: string): boolean {
  return (
    /\b(?:today|yesterday)\b/i.test(userText) ||
    /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/.test(userText) ||
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)\d{2}\b/i.test(
      userText,
    ) ||
    /\b(?:today|yesterday|this|last|past|previous|prior|rolling|within(?: the last)?|over the last|over the past)\s+(?:\d+\s+)?(?:second|minute|hour|day|week|month|quarter|year)s?\b/i.test(
      userText,
    ) ||
    /\brecent(?:ly)?\b/i.test(userText) ||
    /\b(?:since|after)\s+(?:\d{4}-\d{2}-\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2})\b/i.test(
      userText,
    ) ||
    /\b(?:between|from|compare|compared\s+to)\s+\d{4}-\d{2}-\d{2}\s+(?:to|through|until|and|against)\s+\d{4}-\d{2}-\d{2}\b/i.test(
      userText,
    ) ||
    /\b(?:year|quarter|month|week|day)\s+to\s+date\b|\b(?:ytd|qtd|mtd)\b|\b(?:in|during)\s+(?:19|20)\d{2}\b/i.test(
      userText,
    ) ||
    /\b(?:q[1-4]|[1-4](?:st|nd|rd|th)\s+quarter|quarter\s+[1-4])\s+(?:of\s+)?(?:19|20)\d{2}\b/i.test(
      userText,
    )
  );
}

function requestedExplicitDateRanges(userText: string): DbtMetricTimeRange[] {
  return [
    ...userText.matchAll(
      /\b(?:(?:from|between|compare|compared\s+to)\s+)?(\d{4}-\d{2}-\d{2})\s+(?:to|through|until|and|against)\s+(\d{4}-\d{2}-\d{2})\b/gi,
    ),
  ].flatMap((match) => {
    const startDate = match[1];
    const endDate = match[2];
    if (!startDate || !endDate) return [];
    const parsedStart = parseUtcDateOnly(startDate);
    const parsedEnd = parseUtcDateOnly(endDate);
    return parsedStart && parsedEnd && parsedStart <= parsedEnd
      ? [{ startDate, endDate }]
      : [];
  });
}

function requestedExplicitDateRange(
  userText: string,
): DbtMetricTimeRange | null {
  return requestedExplicitDateRanges(userText)[0] ?? null;
}

function dateRange(start: Date, end: Date): DbtMetricTimeRange {
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function parseUtcDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function equivalentYearAgoRange(
  currentRange: DbtMetricTimeRange,
): DbtMetricTimeRange | null {
  const start = parseUtcDateOnly(currentRange.startDate);
  const end = parseUtcDateOnly(currentRange.endDate);
  if (!start || !end || start > end) return null;
  return dateRange(addUtcMonths(start, -12), addUtcMonths(end, -12));
}

function addUtcDays(date: Date, count: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + count,
    ),
  );
}

function addUtcMonths(date: Date, count: number): Date {
  const firstOfTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth(),
      Math.min(date.getUTCDate(), lastDayOfTargetMonth),
    ),
  );
}

function requestedCalendarRange(
  userText: string,
  now = new Date(),
): DbtMetricTimeRange | null {
  const explicitRange = requestedExplicitDateRange(userText);
  if (explicitRange) return explicitRange;

  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const todayString = today.toISOString().slice(0, 10);
  const rollingWindow = userText.match(
    /\b(?:(?:most\s+)?recent(?:ly)?|last|past|previous|prior|rolling|over the (?:last|past)|within(?: the)? (?:last|past))\s+(\d+)\s+(days?|weeks?|months?|quarters?|years?)\b/i,
  );
  if (rollingWindow?.[1] && rollingWindow[2]) {
    const count = Number(rollingWindow[1]);
    if (!Number.isSafeInteger(count) || count < 1) return null;
    const unit = rollingWindow[2].toLowerCase();
    if (unit.startsWith("day") || unit.startsWith("week")) {
      const days = count * (unit.startsWith("week") ? 7 : 1);
      return dateRange(addUtcDays(today, 1 - days), today);
    }
    const months =
      count *
      (unit.startsWith("quarter") ? 3 : unit.startsWith("year") ? 12 : 1);
    return dateRange(addUtcMonths(today, -months), today);
  }
  const unnumberedRollingWindow = userText.match(
    /\b(?:past|over the past|within(?: the)? past)\s+(week|month|quarter|year)\b/i,
  );
  if (unnumberedRollingWindow?.[1]) {
    const unit = unnumberedRollingWindow[1].toLowerCase();
    if (unit === "week") return dateRange(addUtcDays(today, -6), today);
    const months = unit === "quarter" ? 3 : unit === "year" ? 12 : 1;
    return dateRange(addUtcMonths(today, -months), today);
  }
  const includesLargerCalendarPeriod =
    /\b(?:week|month|quarter|year|ytd|qtd|mtd|wtd)\b/i.test(userText);
  if (/\byesterday\b/i.test(userText) && !includesLargerCalendarPeriod) {
    const yesterday = addUtcDays(today, -1);
    return dateRange(yesterday, yesterday);
  }
  if (/\btoday\b/i.test(userText) && !includesLargerCalendarPeriod) {
    return dateRange(today, today);
  }

  const namedMonth = userText.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+((?:19|20)\d{2})\b/i,
  );
  if (namedMonth?.[1] && namedMonth[2]) {
    const month = new Date(`${namedMonth[1]} 1, ${namedMonth[2]} UTC`);
    if (Number.isFinite(month.getTime())) {
      return dateRange(
        new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)),
        new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)),
      );
    }
  }

  const namedQuarter = userText.match(
    /\b(?:q([1-4])|([1-4])(?:st|nd|rd|th)\s+quarter|quarter\s+([1-4]))\s+(?:of\s+)?((?:19|20)\d{2})\b/i,
  );
  const quarterNumber = Number(
    namedQuarter?.[1] ?? namedQuarter?.[2] ?? namedQuarter?.[3],
  );
  if (namedQuarter?.[4] && quarterNumber >= 1 && quarterNumber <= 4) {
    const year = Number(namedQuarter[4]);
    const startMonth = (quarterNumber - 1) * 3;
    return dateRange(
      new Date(Date.UTC(year, startMonth, 1)),
      new Date(Date.UTC(year, startMonth + 3, 0)),
    );
  }

  const namedYear = userText.match(
    /\b(?:in|during|for|year)\s+((?:19|20)\d{2})\b/i,
  );
  if (namedYear?.[1]) {
    const year = Number(namedYear[1]);
    return dateRange(
      new Date(Date.UTC(year, 0, 1)),
      new Date(Date.UTC(year, 11, 31)),
    );
  }

  const currentWeekday = (today.getUTCDay() + 6) % 7;
  const currentWeekStart = addUtcDays(today, -currentWeekday);
  if (/\b(?:last|previous|prior)\s+week\b/i.test(userText)) {
    const start = addUtcDays(currentWeekStart, -7);
    return dateRange(start, addUtcDays(start, 6));
  }
  if (
    /\b(?:this|current)\s+week\b|\bweek\s+to\s+date\b|\bwtd\b/i.test(userText)
  ) {
    return dateRange(currentWeekStart, today);
  }

  const currentMonthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  if (/\b(?:last|previous|prior)\s+month\b/i.test(userText)) {
    return dateRange(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)),
      addUtcDays(currentMonthStart, -1),
    );
  }
  if (
    /\b(?:this|current)\s+month\b|\bmonth\s+to\s+date\b|\bmtd\b/i.test(userText)
  ) {
    return dateRange(currentMonthStart, today);
  }

  const currentQuarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
  const currentQuarterStart = new Date(
    Date.UTC(today.getUTCFullYear(), currentQuarterStartMonth, 1),
  );
  if (/\b(?:last|previous|prior)\s+quarter\b/i.test(userText)) {
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), currentQuarterStartMonth - 3, 1),
    );
    return dateRange(start, addUtcDays(currentQuarterStart, -1));
  }
  if (
    /\b(?:this|current)\s+quarter\b|\bquarter\s+to\s+date\b|\bqtd\b/i.test(
      userText,
    )
  ) {
    return dateRange(currentQuarterStart, today);
  }

  if (/\b(?:last|previous|prior)\s+year\b/i.test(userText)) {
    const year = today.getUTCFullYear() - 1;
    return dateRange(
      new Date(Date.UTC(year, 0, 1)),
      new Date(Date.UTC(year, 11, 31)),
    );
  }
  if (
    /\b(?:this|current)\s+year\b|\byear\s+to\s+date\b|\bytd\b/i.test(userText)
  ) {
    return dateRange(new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), today);
  }

  const sinceDate = userText.match(
    /\b(?:since|from|after)\s+(\d{4}-\d{2}-\d{2})\b/i,
  );
  if (sinceDate?.[1] && sinceDate[1] <= todayString) {
    return { startDate: sinceDate[1], endDate: todayString };
  }
  const sinceNamedDate = userText.match(
    /\b(?:since|from|after)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+((?:19|20)\d{2}))?\b/i,
  );
  if (sinceNamedDate?.[1] && sinceNamedDate[2]) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const month = monthNames.indexOf(
      sinceNamedDate[1].slice(0, 3).toLowerCase(),
    );
    const day = Number(sinceNamedDate[2]);
    let year = Number(sinceNamedDate[3] ?? today.getUTCFullYear());
    const start = new Date(Date.UTC(year, month, day));
    if (
      month < 0 ||
      start.getUTCMonth() !== month ||
      start.getUTCDate() !== day
    ) {
      return null;
    }
    if (!sinceNamedDate[3] && start > today) {
      year -= 1;
    }
    const resolvedStart = new Date(Date.UTC(year, month, day));
    if (resolvedStart <= today) {
      return {
        startDate: resolvedStart.toISOString().slice(0, 10),
        endDate: todayString,
      };
    }
  }
  const singleDate = userText.match(/\b((?:19|20)\d{2}-\d{2}-\d{2})\b/);
  if (singleDate?.[1]) {
    return { startDate: singleDate[1], endDate: singleDate[1] };
  }
  return null;
}

function requestedFirstComparisonRange(
  userText: string,
  now: Date,
): DbtMetricTimeRange | null {
  const comparisonConnector = requestedComparisonConnector(userText);
  if (comparisonConnector?.index === undefined) return null;
  return requestedCalendarRange(
    userText.slice(0, comparisonConnector.index),
    now,
  );
}

function requestedComparisonConnector(
  userText: string,
): RegExpMatchArray | null {
  const explicitConnector = userText.match(
    /\b(?:vs\.?|versus|against|compared\s+to)\b/i,
  );
  if (explicitConnector) return explicitConnector;
  for (const connector of userText.matchAll(/\bwith\b/gi)) {
    const suffix = userText.slice((connector.index ?? 0) + connector[0].length);
    if (
      /^\s+(?:(?:the\s+)?(?:same|equivalent|comparable)\s+period\b|(?:one|1)\s+year\s+ago\b|(?:this|current|last|previous|prior)\s+(?:week|month|quarter|year)\b|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)\d{2}\b|(?:q[1-4]|[1-4](?:st|nd|rd|th)\s+quarter|quarter\s+[1-4])\s+(?:of\s+)?(?:19|20)\d{2}\b|(?:19|20)\d{2}-\d{2}-\d{2}\b)/i.test(
        suffix,
      )
    ) {
      return connector;
    }
  }
  return null;
}

function requestedNamedPeriodRanges(
  userText: string,
  now: Date,
): DbtMetricTimeRange[] {
  const matches = [
    ...userText.matchAll(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(?:19|20)\d{2}\b/gi,
    ),
    ...userText.matchAll(
      /\b(?:q[1-4]|[1-4](?:st|nd|rd|th)\s+quarter|quarter\s+[1-4])\s+(?:of\s+)?(?:19|20)\d{2}\b/gi,
    ),
  ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  return matches.flatMap(([phrase]) => {
    const range = requestedCalendarRange(phrase, now);
    return range ? [range] : [];
  });
}

function requestedComparisonCalendarRanges(
  userText: string,
  now: Date,
): DbtMetricTimeRange[] | null {
  if (!/\b(?:compare|compared|versus|vs\.?|against)\b/i.test(userText)) {
    return null;
  }
  const periodPhrases = [
    ...userText.matchAll(
      /\b(?:this|current|last|previous|prior)\s+(?:week|month|quarter|year)\b/gi,
    ),
  ].map(([phrase]) => phrase);
  const namedPeriodRanges = requestedNamedPeriodRanges(userText, now);
  const ranges = periodPhrases.flatMap((phrase) => {
    const range = requestedCalendarRange(phrase, now);
    return range ? [range] : [];
  });
  const uniqueRanges = [
    ...new Map(
      ranges.map((range) => [`${range.startDate}/${range.endDate}`, range]),
    ).values(),
  ];
  const rollingWindows = [
    ...userText.matchAll(
      /\b(last|past|previous|prior)\s+(\d+)\s+(days?|weeks?|months?|quarters?|years?)\b/gi,
    ),
  ].map((match) => ({
    phrase: match[0],
    modifier: match[1]?.toLowerCase(),
    count: Number(match[2]),
    unit: match[3]?.toLowerCase().replace(/s$/, ""),
  }));
  const explicitDateRanges = requestedExplicitDateRanges(userText);
  const equivalentYearAgo =
    /\b(?:(?:(?:same|equivalent|comparable)\s+period\s+(?:(?:from|of)\s+)?)?(?:one|1)\s+year\s+ago|(?:same|equivalent|comparable)\s+period\s+last\s+year)\b/i.test(
      userText,
    );
  const additionalCalendarPhrases = periodPhrases.filter(
    (phrase) => !(equivalentYearAgo && /^last year$/i.test(phrase)),
  );
  if (
    namedPeriodRanges.length > 0 &&
    (additionalCalendarPhrases.length > 0 ||
      rollingWindows.length > 0 ||
      /\b(?:today|yesterday)\b/i.test(userText) ||
      explicitDateRanges.length > 0)
  ) {
    return [];
  }
  if (uniqueRanges.length > 1) return uniqueRanges;
  const currentWindows = rollingWindows.filter(
    (window) => window.modifier === "last" || window.modifier === "past",
  );
  const previousWindows = rollingWindows.filter(
    (window) => window.modifier === "previous" || window.modifier === "prior",
  );
  const [currentWindow] = currentWindows;
  const [previousWindow] = previousWindows;
  if (rollingWindows.length >= 2) {
    if (
      rollingWindows.length !== 2 ||
      currentWindows.length !== 1 ||
      previousWindows.length !== 1 ||
      !currentWindow ||
      !previousWindow ||
      currentWindow.count !== previousWindow.count ||
      currentWindow.unit !== previousWindow.unit ||
      !Number.isSafeInteger(currentWindow.count) ||
      currentWindow.count < 1
    ) {
      return [];
    }

    const currentRange = requestedCalendarRange(currentWindow.phrase, now);
    if (!currentRange) return [];
    const currentStart = new Date(`${currentRange.startDate}T00:00:00.000Z`);
    const currentEnd = new Date(`${currentRange.endDate}T00:00:00.000Z`);
    const inclusiveDays =
      Math.floor((currentEnd.getTime() - currentStart.getTime()) / 86_400_000) +
      1;
    const previousRange = dateRange(
      addUtcDays(currentStart, -inclusiveDays),
      addUtcDays(currentStart, -1),
    );
    const ranges = [currentRange, previousRange];
    if (equivalentYearAgo) {
      const priorYearRange = equivalentYearAgoRange(currentRange);
      if (!priorYearRange) return [];
      ranges.push(priorYearRange);
    }
    return ranges;
  }

  if (equivalentYearAgo) {
    const currentRange = requestedFirstComparisonRange(userText, now);
    if (!currentRange) return [];
    const priorYearRange = equivalentYearAgoRange(currentRange);
    return priorYearRange ? [currentRange, priorYearRange] : [];
  }

  if (explicitDateRanges.length > 1) {
    if (namedPeriodRanges.length > 0) return [];
    const distinctRanges = new Map(
      explicitDateRanges.map((range) => [
        `${range.startDate}/${range.endDate}`,
        range,
      ]),
    );
    return distinctRanges.size === explicitDateRanges.length
      ? explicitDateRanges
      : [];
  }

  if (namedPeriodRanges.length > 1) {
    const distinctRanges = new Map(
      namedPeriodRanges.map((range) => [
        `${range.startDate}/${range.endDate}`,
        range,
      ]),
    );
    return distinctRanges.size === namedPeriodRanges.length
      ? namedPeriodRanges
      : [];
  }

  const comparisonConnector = requestedComparisonConnector(userText);
  const comparisonSuffix =
    comparisonConnector?.index !== undefined
      ? userText.slice(
          comparisonConnector.index + comparisonConnector[0].length,
        )
      : "";
  if (
    /\b(?:today|yesterday|ago|earlier|before|ytd|qtd|mtd)\b|\b(?:last|past|previous|prior|current|this|same|equivalent|comparable)\s+(?:\d+\s+)?(?:day|week|month|quarter|year|period)s?\b|\b(?:19|20)\d{2}\b/i.test(
      comparisonSuffix,
    )
  ) {
    return [];
  }

  return null;
}

function dbtMetricTimeScopeMismatch(
  userText: string,
  context: AgentLoopFinalResponseGuardContext,
): boolean {
  if (!boundedPeriodRequest(userText)) return false;

  const expectedRange = requestedCalendarRange(
    userText,
    new Date(context.runStartedAt ?? Date.now()),
  );
  const expectedComparisonRanges = requestedComparisonCalendarRanges(
    userText,
    new Date(context.runStartedAt ?? Date.now()),
  );
  if (expectedComparisonRanges?.length === 0) return true;
  const toolCalls = context.toolCalls ?? [];
  const toolResults = context.toolResults ?? [];
  const queryResultIndexes = toolResults.flatMap((result, index) =>
    !result.isError &&
    analyticsActionName(result.name) === "query-dbt-semantic-metric"
      ? [index]
      : [],
  );
  if (queryResultIndexes.length === 0) return false;
  const successfulResultIndexes = queryResultIndexes.filter((index) => {
    const parsed = actionSummaryRecord(toolResults[index]?.content);
    return (
      parsed.kind === "record" &&
      (parsed.record.status === "success" || parsed.record.status === "pending")
    );
  });
  if (successfulResultIndexes.length === 0) return false;
  const normalizedGroupBy = (value: unknown) => {
    if (!Array.isArray(value)) return null;
    return value
      .map((item) => {
        const group = actionSummaryRecord(item);
        if (group.kind !== "record" || typeof group.record.name !== "string") {
          return null;
        }
        return `${group.record.name.toLowerCase()}:${String(group.record.grain ?? "").toUpperCase()}`;
      })
      .filter((item): item is string => item !== null)
      .sort();
  };
  const normalizeMetricName = (value: unknown) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const pairedCallForResult = (index: number) => {
    const result = toolResults[index];
    const resultToolCallId = result?.toolCallId;
    const matchingCalls = toolCalls.filter(
      (call) =>
        analyticsActionName(call.name) === "query-dbt-semantic-metric" &&
        (resultToolCallId ? call.toolCallId === resultToolCallId : false),
    );
    const namedCalls = toolCalls.filter(
      (call) => analyticsActionName(call.name) === "query-dbt-semantic-metric",
    );
    const namedResults = toolResults.filter(
      (candidate) =>
        analyticsActionName(candidate.name) === "query-dbt-semantic-metric",
    );
    if (resultToolCallId) {
      return matchingCalls.length === 1 ? matchingCalls[0] : undefined;
    }
    return namedCalls.length === 1 && namedResults.length === 1
      ? namedCalls[0]
      : undefined;
  };
  const querySpecsMatch = (
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ) => {
    const leftRange = metricTimeRange(left.timeRange);
    const rightRange = metricTimeRange(right.timeRange);
    const leftGroupBy = normalizedGroupBy(left.groupBy);
    const rightGroupBy = normalizedGroupBy(right.groupBy);
    return (
      (left.allTime === true) === (right.allTime === true) &&
      leftGroupBy !== null &&
      rightGroupBy !== null &&
      JSON.stringify(leftGroupBy) === JSON.stringify(rightGroupBy) &&
      (leftRange === null) === (rightRange === null) &&
      (!leftRange ||
        (leftRange.startDate === rightRange?.startDate &&
          leftRange.endDate === rightRange?.endDate))
    );
  };
  const recoveredDbtProviderError = (
    priorIndex: number,
    priorOutput: Record<string, unknown>,
    currentIndex: number,
    expectedQueryId: string,
    expectedMetricName: string,
    expectedQuerySpec: Record<string, unknown>,
  ) => {
    if (
      priorOutput.status !== "provider_error" ||
      priorOutput.queryId !== expectedQueryId ||
      normalizeMetricName(priorOutput.metricName) !== expectedMetricName ||
      typeof priorOutput.nextPage !== "string" ||
      !/^metric-results-v5\.[A-Za-z0-9_-]{1,1880}\.[A-Za-z0-9_-]{43}$/.test(
        priorOutput.nextPage,
      )
    ) {
      return false;
    }
    const priorSpec = actionSummaryRecord(priorOutput.querySpec);
    if (
      priorSpec.kind !== "record" ||
      !querySpecsMatch(priorSpec.record, expectedQuerySpec)
    ) {
      return false;
    }
    const errorCall = pairedCallForResult(priorIndex);
    const errorInput = actionSummaryRecord(errorCall?.input);
    if (errorInput.kind !== "record") return false;
    const errorInputQueryId = errorInput.record.queryId;
    if (errorInputQueryId === undefined) {
      if (
        normalizeMetricName(errorInput.record.metricName) !==
          expectedMetricName ||
        !querySpecsMatch(errorInput.record, priorSpec.record)
      ) {
        return false;
      }
    } else if (
      errorInputQueryId !== expectedQueryId ||
      typeof errorInput.record.nextPage !== "string" ||
      !/^metric-results-v5\.[A-Za-z0-9_-]{1,1880}\.[A-Za-z0-9_-]{43}$/.test(
        errorInput.record.nextPage,
      ) ||
      errorInput.record.timeRange !== undefined ||
      errorInput.record.groupBy !== undefined ||
      errorInput.record.allTime !== undefined
    ) {
      return false;
    }

    return queryResultIndexes.some((resumedIndex) => {
      if (resumedIndex <= priorIndex || resumedIndex > currentIndex) {
        return false;
      }
      const resumedResult = toolResults[resumedIndex];
      if (!resumedResult || resumedResult.isError) return false;
      const resumedOutput = actionSummaryRecord(resumedResult.content);
      if (
        resumedOutput.kind !== "record" ||
        (resumedOutput.record.status !== "success" &&
          resumedOutput.record.status !== "pending") ||
        resumedOutput.record.queryId !== expectedQueryId
      ) {
        return false;
      }
      const resumedCall = pairedCallForResult(resumedIndex);
      const resumedInput = actionSummaryRecord(resumedCall?.input);
      return (
        resumedInput.kind === "record" &&
        resumedInput.record.queryId === expectedQueryId &&
        resumedInput.record.nextPage === priorOutput.nextPage
      );
    });
  };
  const resolveDbtResultEvidence = (index: number) => {
    const result = toolResults[index];
    if (!result || result.isError) return null;
    const parsedOutput = actionSummaryRecord(result.content);
    if (parsedOutput.kind !== "record") return null;
    const output = parsedOutput.record;
    if (output.status !== "success" && output.status !== "pending") {
      return null;
    }
    const parsedQuerySpec = actionSummaryRecord(output.querySpec);
    if (parsedQuerySpec.kind !== "record") return null;
    const querySpec = parsedQuerySpec.record;
    const parsedOutputMetric = actionSummaryRecord(output.metric);
    if (parsedOutputMetric.kind === "invalid") return null;
    const outputMetric =
      parsedOutputMetric.kind === "record" ? parsedOutputMetric.record : null;
    const metricName = normalizeMetricName(
      output.metricName ?? outputMetric?.name,
    );
    const call = pairedCallForResult(index);
    if (!call) return null;
    const parsedInput = actionSummaryRecord(call.input);
    if (parsedInput.kind !== "record") return null;
    const input = parsedInput.record;
    const inputMetricName = normalizeMetricName(input.metricName);
    if (!metricName || inputMetricName !== metricName) return null;

    const hasResultCursor =
      typeof input.nextPage === "string" &&
      /^metric-results-v5\.[A-Za-z0-9_-]{1,1880}\.[A-Za-z0-9_-]{43}$/.test(
        input.nextPage,
      );
    const isContinuation = typeof input.queryId === "string";
    let effectiveInput = input;
    let metricDefinition = outputMetric;

    if (isContinuation) {
      if (
        !hasResultCursor ||
        typeof output.queryId !== "string" ||
        input.queryId !== output.queryId ||
        input.timeRange !== undefined ||
        input.groupBy !== undefined ||
        input.allTime !== undefined
      ) {
        return null;
      }

      let originalInput: Record<string, unknown> | undefined;
      const priorMetricDefinitions: Record<string, unknown>[] = [];
      for (const priorIndex of queryResultIndexes) {
        if (priorIndex >= index) break;
        const prior = toolResults[priorIndex];
        if (!prior || prior.isError) continue;
        const parsedPrior = actionSummaryRecord(prior.content);
        if (parsedPrior.kind !== "record") continue;
        const priorOutput = parsedPrior.record;
        if (priorOutput.queryId !== input.queryId) continue;
        const priorStatus = priorOutput.status;
        const recoveredProviderError = recoveredDbtProviderError(
          priorIndex,
          priorOutput,
          index,
          input.queryId as string,
          metricName,
          querySpec,
        );
        if (
          normalizeMetricName(priorOutput.metricName) !== metricName ||
          (priorStatus !== "success" &&
            priorStatus !== "pending" &&
            !recoveredProviderError)
        ) {
          return null;
        }
        const parsedPriorSpec = actionSummaryRecord(priorOutput.querySpec);
        if (
          parsedPriorSpec.kind !== "record" ||
          !querySpecsMatch(parsedPriorSpec.record, querySpec)
        ) {
          return null;
        }
        const priorMetric = actionSummaryRecord(priorOutput.metric);
        if (priorMetric.kind === "invalid") return null;
        if (priorMetric.kind === "record") {
          if (normalizeMetricName(priorMetric.record.name) !== metricName) {
            return null;
          }
          if (!recoveredProviderError) {
            priorMetricDefinitions.push(priorMetric.record);
          }
        }
        const priorCall = pairedCallForResult(priorIndex);
        if (!priorCall) return null;
        const parsedPriorInput = actionSummaryRecord(priorCall.input);
        if (parsedPriorInput.kind !== "record") return null;
        const priorInput = parsedPriorInput.record;
        if (priorInput.queryId === undefined) {
          if (normalizeMetricName(priorInput.metricName) !== metricName) {
            return null;
          }
          if (
            originalInput &&
            !querySpecsMatch(
              {
                groupBy: originalInput.groupBy ?? [],
                timeRange: originalInput.timeRange,
                allTime: originalInput.allTime === true,
              },
              {
                groupBy: priorInput.groupBy ?? [],
                timeRange: priorInput.timeRange,
                allTime: priorInput.allTime === true,
              },
            )
          ) {
            return null;
          }
          originalInput = priorInput;
        }
      }
      if (priorMetricDefinitions.length > 1) {
        if (
          priorMetricDefinitions.some(
            (definition) =>
              definition.dimensionsCount !==
                priorMetricDefinitions[0]?.dimensionsCount ||
              (definition.dimensionsTruncated !== true &&
                priorMetricDefinitions[0]?.dimensionsTruncated !== true &&
                JSON.stringify(definition.dimensions) !==
                  JSON.stringify(priorMetricDefinitions[0]?.dimensions)),
          )
        ) {
          return null;
        }
      }
      if (originalInput) {
        effectiveInput = originalInput;
      } else {
        // The action validates the signed cursor before returning this querySpec.
        effectiveInput = {
          metricName: input.metricName,
          groupBy: querySpec.groupBy,
          ...(querySpec.timeRange ? { timeRange: querySpec.timeRange } : {}),
          ...(querySpec.allTime === true ? { allTime: true } : {}),
        };
      }
      const priorCompleteMetricDefinition = priorMetricDefinitions.find(
        (definition) => definition.dimensionsTruncated !== true,
      );
      if (
        priorCompleteMetricDefinition &&
        (metricDefinition?.dimensionsTruncated === true || !metricDefinition)
      ) {
        metricDefinition = priorCompleteMetricDefinition;
      }
    } else if (hasResultCursor || input.nextPage !== undefined) {
      return null;
    }

    const inputRange = metricTimeRange(effectiveInput.timeRange);
    const outputRange = metricTimeRange(querySpec.timeRange);
    const inputGroupBy = normalizedGroupBy(effectiveInput.groupBy ?? []);
    const outputGroupBy = normalizedGroupBy(querySpec.groupBy);
    if (
      (effectiveInput.allTime === true) !== (querySpec.allTime === true) ||
      inputRange?.startDate !== outputRange?.startDate ||
      inputRange?.endDate !== outputRange?.endDate ||
      inputGroupBy === null ||
      outputGroupBy === null ||
      JSON.stringify(inputGroupBy) !== JSON.stringify(outputGroupBy)
    ) {
      return null;
    }
    if (
      metricDefinition &&
      normalizeMetricName(metricDefinition.name) !== metricName
    ) {
      return null;
    }
    return {
      output,
      querySpec,
      input: effectiveInput,
      metricName,
      metricDefinition,
    };
  };
  const comparisonResultIndexes: number[] = [];
  if (expectedComparisonRanges) {
    const expectedRangeKeys = new Set(
      expectedComparisonRanges.map(
        (range) => `${range.startDate}/${range.endDate}`,
      ),
    );
    const latestResultByExpectedRange = new Map<string, number>();
    for (const index of successfulResultIndexes) {
      const parsed = actionSummaryRecord(toolResults[index]?.content);
      if (parsed.kind !== "record") continue;
      const querySpec = actionSummaryRecord(parsed.record.querySpec);
      if (querySpec.kind !== "record" || querySpec.record.allTime === true)
        continue;
      const range = metricTimeRange(querySpec.record.timeRange);
      if (!range) continue;
      const key = `${range.startDate}/${range.endDate}`;
      if (expectedRangeKeys.has(key))
        latestResultByExpectedRange.set(key, index);
    }
    if (latestResultByExpectedRange.size !== expectedRangeKeys.size)
      return true;

    let comparisonMetricName: string | undefined;
    let comparisonGroupBy: string | undefined;
    for (const index of latestResultByExpectedRange.values()) {
      const evidence = resolveDbtResultEvidence(index);
      if (!evidence) return true;
      const resultRange = metricTimeRange(evidence.querySpec.timeRange);
      if (!resultRange) return true;
      const outputGroupBy = normalizedGroupBy(evidence.querySpec.groupBy);
      if (!outputGroupBy) return true;
      const groupByKey = JSON.stringify(outputGroupBy);
      if (
        (comparisonMetricName &&
          comparisonMetricName !== evidence.metricName) ||
        (comparisonGroupBy && comparisonGroupBy !== groupByKey)
      ) {
        return true;
      }
      comparisonMetricName = evidence.metricName;
      comparisonGroupBy = groupByKey;
      comparisonResultIndexes.push(index);
    }
  }
  if (
    successfulResultIndexes.length > 0 &&
    !expectedRange &&
    !expectedComparisonRanges
  ) {
    return true;
  }
  const resultIndex = expectedComparisonRanges
    ? comparisonResultIndexes.length > 0
      ? Math.max(...comparisonResultIndexes)
      : -1
    : (successfulResultIndexes[successfulResultIndexes.length - 1] ?? -1);
  if (resultIndex === -1) return false;
  const result = toolResults[resultIndex];
  if (!result) return true;
  const evidence = resolveDbtResultEvidence(resultIndex);
  if (!evidence) return true;
  const { querySpec, input: matchingInput } = evidence;
  const resultRange = metricTimeRange(querySpec.timeRange);
  if (querySpec.allTime === true || !resultRange) return true;

  if (
    expectedRange &&
    !expectedComparisonRanges &&
    (resultRange.startDate !== expectedRange.startDate ||
      resultRange.endDate !== expectedRange.endDate)
  ) {
    return true;
  }
  if (!expectedRange) {
    const openEndedRequest =
      /\b(?:since|from|after)\s+(?:\d{4}-\d{2}-\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2})\b/i.test(
        userText,
      );
    if (openEndedRequest) return true;
  }

  if (matchingInput.allTime === true) return true;

  const breakdownClause = userText.match(
    /\b(?:grouped\s+by|breakdown\s+by|split\s+by|per|by)\s+([^?.!,;\n]{1,100})/i,
  )?.[1];
  if (!breakdownClause) return false;
  const outputMetric = evidence.metricDefinition;
  const dimensions = Array.isArray(outputMetric?.dimensions)
    ? outputMetric.dimensions.map((dimension) => {
        const parsed = actionSummaryRecord(dimension);
        return parsed.kind === "record" ? parsed.record : {};
      })
    : [];
  if (!outputMetric) return true;
  const dimensionsTruncated =
    outputMetric.dimensionsTruncated === true ||
    (Number.isSafeInteger(outputMetric.dimensionsCount) &&
      Number(outputMetric.dimensionsCount) > dimensions.length);
  const selectedDimensions = new Set(
    (querySpec.groupBy as Array<Record<string, unknown>>).map(({ name }) =>
      String(name),
    ),
  );
  const requestedTimeGrain = breakdownClause
    .match(/\b(day|week|month|quarter|year)s?\b/i)?.[1]
    ?.toUpperCase();
  const requestedDimensionMatches = new Set<string>();
  const normalizeDimensionEvidence = (evidence: string) =>
    evidence
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const organizationHierarchyQualifier = (...evidence: string[]) => {
    const organizationTokens = new Set([
      "organization",
      "org",
      "company",
      "companies",
      "account",
      "accounts",
    ]);
    const hierarchyMarkers = [
      { tokens: ["top", "level"], qualifier: "root" },
      { tokens: ["root", "level"], qualifier: "root" },
      { tokens: ["ancestor"], qualifier: "ancestor" },
      { tokens: ["parent"], qualifier: "parent" },
      { tokens: ["root"], qualifier: "root" },
    ];
    for (const field of evidence) {
      const tokens = normalizeDimensionEvidence(field).split(" ");
      for (let start = 0; start < tokens.length; start += 1) {
        for (const marker of hierarchyMarkers) {
          if (
            !marker.tokens.every(
              (token, offset) => tokens[start + offset] === token,
            )
          ) {
            continue;
          }
          const end = start + marker.tokens.length;
          if (
            organizationTokens.has(tokens[start - 1] ?? "") ||
            organizationTokens.has(tokens[end] ?? "")
          ) {
            return marker.qualifier;
          }
        }
      }
    }
    return undefined;
  };
  const requestedOrganizationQualifier =
    organizationHierarchyQualifier(breakdownClause);
  const dimensionAliases = [
    {
      canonical: "organization",
      pattern: /\b(?:organization|org|company|companies|account|accounts)\b/i,
    },
    {
      canonical: "workspace",
      pattern: /\b(?:workspace|workspaces|project|projects)\b/i,
    },
    {
      canonical: "person",
      pattern: /\b(?:user|users|member|members|person|people|seat|seats)\b/i,
    },
    { canonical: "team", pattern: /\bteams?\b/i },
    { canonical: "plan", pattern: /\b(?:plan|tier|subscription)s?\b/i },
    {
      canonical: "region",
      pattern: /\b(?:country|countries|region|regions)\b/i,
    },
    { canonical: "source", pattern: /\b(?:source|channel)s?\b/i },
    { canonical: "platform", pattern: /\bplatforms?\b/i },
    { canonical: "device", pattern: /\bdevices?\b/i },
    { canonical: "browser", pattern: /\bbrowsers?\b/i },
    { canonical: "event", pattern: /\bevents?\b/i },
    {
      canonical: "metric_time",
      pattern:
        /\b(?:day|days|week|weeks|month|months|quarter|quarters|year|years|date|time)\b/i,
    },
  ];
  for (const { canonical, pattern } of dimensionAliases) {
    if (!pattern.test(breakdownClause)) continue;
    if (canonical === "metric_time") {
      const supportedGrains = Array.isArray(outputMetric.queryableGranularities)
        ? outputMetric.queryableGranularities.filter(
            (grain): grain is string => typeof grain === "string",
          )
        : [];
      if (
        !requestedTimeGrain ||
        !supportedGrains.some(
          (grain) => grain.toUpperCase() === requestedTimeGrain,
        )
      ) {
        return true;
      }
      requestedDimensionMatches.add("metric_time");
      continue;
    }
    const matchingNames = dimensions
      .filter((dimension) => {
        const evidence = normalizeDimensionEvidence(
          `${String(dimension.name ?? "")} ${String(dimension.description ?? "")}`,
        );
        return pattern.test(evidence);
      })
      .map((dimension) => String(dimension.name ?? ""))
      .filter(Boolean);
    const selectedMatches = dimensionsTruncated
      ? [...selectedDimensions].filter((name) =>
          pattern.test(normalizeDimensionEvidence(name)),
        )
      : [];
    const matchingSelectedNames = [
      ...new Set([...matchingNames, ...selectedMatches]),
    ].filter((name) => selectedDimensions.has(name));
    if (matchingSelectedNames.length === 0) return true;
    if (canonical === "organization") {
      for (const name of matchingSelectedNames) {
        const dimension = dimensions.find(
          (candidate) => String(candidate.name ?? "") === name,
        );
        const selectedQualifier = organizationHierarchyQualifier(
          name,
          String(dimension?.description ?? ""),
        );
        if (
          selectedQualifier !== requestedOrganizationQualifier &&
          (selectedQualifier !== undefined ||
            requestedOrganizationQualifier !== undefined)
        ) {
          return true;
        }
      }
    }
    for (const name of matchingSelectedNames) {
      requestedDimensionMatches.add(name);
    }
  }
  if (requestedDimensionMatches.size === 0) {
    const normalizedBreakdown = normalizeDimensionEvidence(breakdownClause);
    const exactMatches = new Set(
      dimensions
        .filter(
          (dimension) =>
            normalizeDimensionEvidence(String(dimension.name ?? "")) ===
            normalizedBreakdown,
        )
        .map((dimension) => String(dimension.name ?? "")),
    );
    if (dimensionsTruncated) {
      for (const name of selectedDimensions) {
        if (normalizeDimensionEvidence(name) === normalizedBreakdown) {
          exactMatches.add(name);
        }
      }
    }
    const selectedExactMatches = [...exactMatches].filter((name) =>
      selectedDimensions.has(name),
    );
    if (selectedExactMatches.length !== 1) return true;
    requestedDimensionMatches.add(selectedExactMatches[0]!);
  }
  return (
    requestedTimeGrain !== undefined &&
    !normalizedGroupBy(querySpec.groupBy)?.includes(
      `metric_time:${requestedTimeGrain}`,
    )
  );
}

export function realDataFinalGuard(
  context: AgentLoopFinalResponseGuardContext,
) {
  if ((context as { executionMode?: string }).executionMode === "plan") {
    return null;
  }
  const stableRequestText = (
    context as AgentLoopFinalResponseGuardContext & { requestText?: string }
  ).requestText;
  // Every check below judges what the message asks, not the page context it
  // carries: a dashboard named "Warehouse KPIs" asks nothing of the warehouse.
  const userText = stripInjectedAnalyticsGuardContext(
    stableRequestText ?? latestUserText(context.messages ?? []),
  );
  const dashboardConstructionRequest =
    looksLikeDashboardConstructionRequest(userText);
  // A turn that already ran catalog discovery is a data turn whatever the
  // wording, so a draft that follows it without a query is still judged.
  if (
    isNonDataTurn(userText) &&
    !hasCatalogSearchAttempt(context.toolResults) &&
    !dashboardConstructionRequest
  ) {
    if (isGenericNoDataFallback(context.text)) {
      return {
        retryMessage: NON_ANALYTICS_FALLBACK_RETRY_MESSAGE,
        fallbackMessage: NON_ANALYTICS_FALLBACK_FINAL_MESSAGE,
        maxRetries: 2,
      };
    }
    return null;
  }
  const incompleteEvidence = hasIncompleteDataEvidence(context.toolResults);
  const partialBigQueryResult = hasPartialBigQueryResult(context.toolResults);
  const dataQueryAttempted = hasDataQueryAttempt(context.toolResults);
  const sourceStatus = dataSourceStatusSummary(context.toolResults);
  const sourceStatusDetails = sourceStatusDescription(sourceStatus);
  const requestedSourceSetup = requestedExternalSourceSetup(
    userText,
    sourceStatus,
  );
  const setupLink = requestedSourceSetup?.setupLink ?? sourceStatus.setupLink;
  const setupLabel = requestedSourceSetup
    ? requestedSourceSetup.kind === "review"
      ? `Review ${requestedSourceSetup.label} connection`
      : `Connect ${requestedSourceSetup.label}`
    : "Connect data sources";
  const setupMarkdown = `[${setupLabel}](${setupLink})`;
  const hasUnknownExternalSourceStatus =
    sourceStatus.availableExternalSources.some(
      ({ configured }) => configured === null,
    );
  const noConfiguredExternalSources =
    sourceStatus.checked &&
    sourceStatus.configuredSourceLabels.length === 0 &&
    !hasUnknownExternalSourceStatus;
  const externalSourceRequest = looksLikeExternalSourceRequest(userText);
  const missingRequestedExternalSource = hasMissingRequestedExternalSource(
    userText,
    sourceStatus.configuredSourceLabels,
    sourceStatus.availableExternalSources,
  );
  const hasUsableExternalSource = sourceStatus.availableExternalSources.some(
    ({ workspaceGrantState, credentialsConfigured }) =>
      credentialsConfigured === true || workspaceGrantState === "connected",
  );
  const noUsableExternalSources =
    sourceStatus.checked &&
    !hasUsableExternalSource &&
    !hasUnknownExternalSourceStatus;
  const firstPartySourceShouldBeTried =
    noUsableExternalSources && !externalSourceRequest;
  const needsDataSourceLink =
    sourceStatus.checked &&
    externalSourceRequest &&
    (noConfiguredExternalSources || missingRequestedExternalSource);
  const unavailableSourceGuidance =
    requestedSourceSetup?.kind === "review"
      ? `The requested ${requestedSourceSetup.label} source already has an Analytics workspace grant, but no healthy connection is active.${sourceStatusDetails ? ` Status reports ${sourceStatusDetails}.` : ""} Ask the user to review that existing connection and include this exact link: ${setupMarkdown}. Do not ask them to connect it again.`
      : `The requested external source is not connected. Explain what is missing in the context of the user's question and include this exact markdown link: ${setupMarkdown}. Do not use the generic no-grounded-data fallback.`;
  const unavailableSourceFallback =
    requestedSourceSetup?.kind === "review"
      ? `I can query ${requestedSourceSetup.label} once its existing workspace connection is healthy.${sourceStatusDetails ? ` Status reports ${sourceStatusDetails}.` : ""} ${setupMarkdown}`
      : `I can help with that once the relevant source is connected. ${setupMarkdown}`;
  if (
    hasFailedCorpusWorkflowEvidence(context.toolResults) &&
    looksLikeCoverageSensitiveAnalyticsRequest(userText) &&
    hasOverstatedCoverageConfidenceClaim(context.text)
  ) {
    return {
      retryMessage:
        "A corpus-capable workflow such as provider-corpus-job, provider-api-request, query-staged-dataset, or run-code failed, but the draft still makes a confident all/any/full-corpus or defensible absence claim. Do not use failed code/API paths plus shortcut searches to support exhaustive coverage. Retry the provider API/code workflow if possible; otherwise finalize as explicitly partial, avoid full-corpus/defensible absence wording, and state the failed tools plus the exact inspected counts and gaps.",
      fallbackMessage:
        "I can't make a confident full-corpus or absence claim because the corpus/code path failed. The answer must be partial unless that provider API/code coverage is recovered.",
    };
  }
  if (
    needsCorpusWorkflowForCoverageSensitiveRequest({
      userText,
      finalText: context.text,
      toolResults: context.toolResults,
    })
  ) {
    return {
      retryMessage:
        "The user asked a coverage-sensitive provider question, but the draft only used bounded convenience data actions. Do not finalize an exhaustive, all-records, or absence-sensitive answer from shortcut actions alone. Use the broad provider API/MCP surface and a staged analysis workflow now: provider-api-catalog/provider-api-docs when needed; for Gong, use configured tracker results from /calls/extensive when they cover the term, otherwise use provider-api-request as raw ingestion with stageAs/saveToFile followed by query-staged-dataset or a Data Program; use provider-corpus-job for durable batched raw-transcript scans. Never loop per call from run-code or a delegated agent. For 500 or more Gong records, gong-calls is not the broad-search path. If full coverage is not possible in this turn, finalize with explicit partial-coverage wording, inspected counts, filters, and remaining gaps.",
      fallbackMessage:
        "I couldn't verify the full provider corpus after two search attempts. The bounded shortcuts did not report an exact inspected count, filter set, or remaining-gap size, so I won't present their absence claim as corpus-wide.",
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  if (
    needsSourceRecordBodyWorkflowForCoverageSensitiveRequest({
      userText,
      finalText: context.text,
      toolResults: context.toolResults,
    })
  ) {
    return {
      retryMessage:
        "The user asked to search source-record body text such as transcripts, messages, tickets, issues, notes, documents, or conversation logs, but the draft's corpus evidence does not show that the requested body records were actually searched. A parent/container metadata scan, title search, summary search, or call/ticket/message list is not enough for an absence-sensitive body-text claim. Retry with the provider's native search, indexed tracker result, or raw body endpoint for the requested record type, using provider-corpus-job batch-search/paginated-search, provider-api-request with staging, or a Data Program/query over staged raw records. Then report source path/body field, inspected record count, hit count, and gaps.",
      fallbackMessage:
        "I can't make a confident source-record body-text claim because the corpus evidence does not show that the requested raw records were searched.",
    };
  }
  if (
    partialBigQueryResult &&
    !hasBigQueryPartialDisclosure(context.text, context.toolResults)
  ) {
    return {
      retryMessage:
        "The BigQuery result is partial, truncated, or carries warnings. A truncated tool result may omit the completeness metadata. Do not present complete totals. Prefer a bounded aggregate query that returns a compact result; otherwise label the available figures as partial and include any warning that remains visible.",
      fallbackMessage:
        "The BigQuery result is incomplete or its output was truncated, so I can't present the available figures as complete. The answer must label them partial and include any warning that remains visible.",
      maxRetries: 2,
    };
  }
  if (
    incompleteEvidence &&
    (looksLikeStrongCoverageClaim(context.text) ||
      looksLikeCoverageSensitiveAnalyticsRequest(userText)) &&
    !hasExplicitPartialDisclosure(context.text)
  ) {
    return {
      retryMessage:
        "Some source evidence for this analytics answer was aborted, truncated, timed out, or indicated more pages. The user asked a coverage-sensitive provider question, or the draft makes a strong zero/all/exhaustive claim. Recover coverage with provider-corpus-job/provider-api-request/run-code/workspace staging if possible; otherwise finalize with explicit partial-coverage wording, the inspected sample size, and the missing coverage.",
      fallbackMessage:
        "I can't make a confident exhaustive analytics claim yet because part of the source evidence was aborted, truncated, or still paginated. I need to recover the missing coverage or state the answer as partial with the inspected sample size.",
    };
  }
  if (
    dashboardConstructionRequest &&
    hasPartialDashboardBuild(context.toolResults) &&
    !hasSuccessfulDashboardSave(context.toolResults) &&
    DASHBOARD_BUILD_PAUSE_PATTERN.test(context.text)
  ) {
    return {
      retryMessage:
        "The user explicitly requested this dashboard or Custom Block. Continue the non-destructive build in this same turn: seed or refresh extension data when needed, save and embed the dashboard, and navigate to the result. Do not ask whether to proceed. Ask only about an ambiguous metric scope, a destructive change, or an external side effect such as sending email or outreach.",
      fallbackMessage:
        "I couldn't finish the requested dashboard build in this turn. Please retry and I'll continue from the saved artifact.",
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  const failedQueryMessage = failedDataQueryAttemptMessage(context.toolResults);
  const failedDbtMetricQuery = hasFailedDbtSemanticMetricQuery(
    context.toolResults,
  );
  if (dbtMetricTimeScopeMismatch(userText, context)) {
    return {
      retryMessage:
        "The dbt Semantic Layer evidence does not show the same bounded date range and requested grouping in every query input and result used for the answer. Retry `query-dbt-semantic-metric` with exact inclusive dates anchored to this run, do not use `allTime:true`, verify every requested breakdown against the metric dimensions and result grouping, and match explicit dates exactly. If the user's wording is vague or asks for a sub-day window the metric cannot represent, ask for a concrete date range or use a timestamp-capable source; do not guess. Do not report figures from an unbounded or mismatched query.",
      fallbackMessage:
        "I can't report this period's dbt metric because the query evidence does not match the requested date range. Please retry the query for that exact period.",
      maxRetries: 2,
    };
  }
  // The detector is a heuristic over prose. Once its retries are spent the
  // schema ask is let through (a real ask lets the user answer it, and a false
  // match keeps a correct answer instead of replacing it with a canned
  // failure) and the remaining guards below still judge the draft. It runs
  // before the saved-edit early returns: a verified rename followed by "which
  // dataset?" is still a request for an identifier.
  if (
    context.retryCount < SCHEMA_DETAILS_MAX_RETRIES &&
    looksLikeSchemaDetailsRequest(context.text)
  ) {
    const failedQueryRecovery = failedQueryMessage
      ? ` ${failedQueryMessage}`
      : "";
    return {
      retryMessage:
        "The draft asks the user to supply internal dataset, table, column, or SQL details. Do not ask the user for warehouse schema identifiers. Use the configured Analytics tools now: call `find-data` once with the user's metric/entity question, then call `search-bigquery-schema` only when exact live columns or partition metadata remain unknown, and run one authoritative `bigquery` query using the exact discovered references. For a named customer, verify identity and distinguish actual consumption from limits or changelog metadata. If the tools prove the source or metric is unavailable, state that exact evidence gap instead of asking the user to name internal tables." +
        failedQueryRecovery,
      maxRetries: SCHEMA_DETAILS_MAX_RETRIES,
      expandToolSurface: true,
    };
  }
  if (
    hasSuccessfulDashboardSave(context.toolResults) &&
    !draftClaimsAnalyticsMetrics(context.text)
  ) {
    return null;
  }
  if (
    dashboardConstructionRequest &&
    !draftClaimsAnalyticsMetrics(context.text)
  ) {
    if (
      hasDashboardConstructionAttempt(context.toolResults) ||
      hasSuccessfulExtensionCreation(context.toolResults) ||
      isSafeNoDataAnalyticsResponse(context.text)
    ) {
      return null;
    }
    return {
      retryMessage:
        'This is a dashboard construction/template-clone request. First call `search-dashboard-references` with the named template terms. Inspect the matching result with `get-sql-dashboard` when `kind` is `sql` or `get-explorer-dashboard` when `kind` is `explorer`, using full config only when needed. If its panels are `chartType: "extension"`, use `get-extension` then `create-extension` to clone/adapt it, then `update-dashboard` to save the new dashboard. Do not invent SQL panels for an extension-backed template. Ask one clarifying filter question if needed. Only run a data-source query before presenting numbers or authoring invented SQL.',
      fallbackMessage:
        "I need to inspect the template dashboard (and its extension, if it uses one) before creating the new one. Tell me the template dashboard name, or confirm the org/account filter, and I'll clone it without inventing metrics.",
      expandToolSurface: true,
    };
  }

  // A verified dashboard save that rendered a data panel ran its SQL, so its
  // receipt is the live-query evidence for the figures the draft quotes. A
  // save that checked no panel (`noRenderAffected`) or only section and
  // extension panels proves nothing about data.
  if (
    dataQueryAttempted ||
    hasSuccessfulDashboardSave(
      (context.toolResults ?? []).filter(
        ({ receipt }) =>
          receipt?.verified === true &&
          receipt.checks?.every((check) => check.ok) &&
          receipt.checks?.some((check) =>
            check.detail?.startsWith(PANEL_RENDERED_PREFIX),
          ),
      ),
    )
  ) {
    return null;
  }
  const rosterSourceDiscoveryRequest =
    looksLikeRosterSourceDiscoveryRequest(userText);
  const emptyRosterCatalogSearch =
    rosterSourceDiscoveryRequest && hasEmptyFindDataResult(context.toolResults);
  const completeRosterSchemaSearch = hasCompleteBigQuerySchemaSearch(
    context.toolResults,
  );
  const hasRosterSchemaMatches = hasCompleteBigQuerySchemaSearchMatches(
    context.toolResults,
  );
  if (
    emptyRosterCatalogSearch &&
    !completeRosterSchemaSearch &&
    !failedQueryMessage
  ) {
    return {
      retryMessage:
        "`find-data` returned no roster candidate, but it searches bounded reference metadata and cannot prove that the source is absent. Continue any dashboard-reference page with `search-dashboard-references` using the exact `dashboardPanelReferenceNextPage` value (it is separate from `find-data.nextPage`), then check the current warehouse with `search-bigquery-schema` for organization, workspace, user, member, membership, role, and roster terms. Continue every BigQuery `nextPage` until the result says `truncated: false` and `nextPage: null`. Use a discovered row-grain source and verify it with a live query; exclude activity logs, snapshots, and aggregates as roster membership. If the source cannot be queried, report that access or schema gap without saying no source exists.",
      fallbackMessage:
        "I couldn't verify an organization-user roster from the current reference search: it returned no candidates, and no complete live BigQuery schema search confirmed a source. That does not show that the source is absent. I need a reachable warehouse schema or a verified membership source to answer this.",
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  if (
    emptyRosterCatalogSearch &&
    hasRosterSchemaMatches &&
    !failedQueryMessage
  ) {
    return {
      retryMessage:
        "The live BigQuery schema search found candidate tables for this roster question. Inspect those exact columns, identify the current row-grain membership source, and run a bounded live query before answering. Do not stop at the metadata search or substitute activity events, snapshots, or aggregate tables for membership.",
      fallbackMessage:
        "I found possible membership tables in the configured BigQuery schema but did not verify their row grain or run a live query, so I can't report roster data yet.",
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  if (
    rosterSourceDiscoveryRequest &&
    hasUnscopedRosterSourceAbsenceClaim(context.text) &&
    hasCompleteEmptyBigQuerySchemaSearch(context.toolResults)
  ) {
    return {
      retryMessage:
        "The completed BigQuery schema search returned no matching table names, but any absence statement must stay within the configured project/schema that was searched. Say what schema/search was checked and that the result does not establish whether a source exists elsewhere; do not claim there is no roster source generally.",
      fallbackMessage:
        "The completed schema search found no matching roster table in the configured BigQuery project. That scoped search does not establish that a membership source is absent from other schemas or systems.",
      maxRetries: 2,
    };
  }
  if (
    rosterSourceDiscoveryRequest &&
    hasCompleteEmptyBigQuerySchemaSearch(context.toolResults) &&
    hasScopedRosterSourceAbsenceClaim(context.text)
  ) {
    return null;
  }
  const draftMakesAnalyticsClaim =
    draftClaimsAnalyticsMetrics(context.text) ||
    isGenericNoDataFallback(context.text);
  if (
    firstPartySourceShouldBeTried &&
    !failedQueryMessage &&
    draftMakesAnalyticsClaim
  ) {
    return {
      retryMessage:
        "The user asked for live analytics, and the built-in first-party Analytics source is available even though no external provider is connected. Call `query-agent-native-analytics` for first-party product, usage, conversion, or observability data and answer from that result. If the request specifically names an external provider, explain what is missing and include the real Connect data sources link.",
      fallbackMessage:
        "I couldn't complete a grounded first-party Analytics query yet. Please retry and I'll use the built-in Analytics source before asking you to connect an external provider.",
      maxRetries: 2,
      expandToolSurface: true,
      exhaustedDraftPrefix: exhaustedDraftPrefixFor({
        toolResults: context.toolResults,
        setupMarkdown,
        includeConnectOption: false,
      }),
    };
  }
  if (isSafeNoDataAnalyticsResponse(context.text) && !failedDbtMetricQuery) {
    if (
      needsDataSourceLink &&
      !includesDataSourcesLink(context.text, setupLink)
    ) {
      return {
        retryMessage: `The response correctly explains that the requested live data is unavailable, but it needs a contextual next step. ${unavailableSourceGuidance}`,
        fallbackMessage: unavailableSourceFallback,
        maxRetries: 2,
      };
    }
    return null;
  }
  if (failedQueryMessage) {
    if (
      needsDataSourceLink &&
      !includesDataSourcesLink(context.text, setupLink)
    ) {
      return {
        retryMessage: `${failedQueryMessage} Explain which external source is missing and include this exact markdown link: ${setupMarkdown}.`,
        fallbackMessage: `${failedQueryMessage} ${setupMarkdown}`,
        maxRetries: 2,
      };
    }
    return {
      retryMessage: failedQueryMessage,
      fallbackMessage: failedQueryMessage,
    };
  }

  if (needsDataSourceLink) {
    return {
      retryMessage: unavailableSourceGuidance,
      fallbackMessage: unavailableSourceFallback,
      maxRetries: 2,
      expandToolSurface: true,
    };
  }

  const prior = priorTurnEvidence(context.messages ?? []);
  if (
    hasDataQueryAttempt(prior.toolResults) &&
    draftRestatesPriorEvidence(context.text, prior)
  ) {
    return null;
  }
  if (!draftMakesAnalyticsClaim) return null;

  const configuredSources = sourceStatus.configuredSourceLabels;
  const configuredSourceGuidance = sourceStatusDetails
    ? ` \`data-source-status\` reports ${sourceStatusDetails}. It checks configuration and workspace grants but does not run a source query. Treat configured credentials separately from healthy workspace connections; do not call a credential-only source connected or ask the user to reconnect before trying its query action.`
    : "";
  const catalogSearched = hasCatalogSearchAttempt(context.toolResults);
  const exhaustedDraftPrefix = exhaustedDraftPrefixFor({
    toolResults: context.toolResults,
    setupMarkdown,
    includeConnectOption: !catalogSearched,
  });

  if (catalogSearched) {
    return {
      retryMessage:
        "You already ran data-reference discovery this turn. If it returned a usable dashboard or query, adapt and run it now and cite the dashboard; if not, inspect exact metadata with search-bigquery-schema or data-source-status, then run one bounded query." +
        UNVERIFIED_DRAFT_RETRY_INSTRUCTION,
      fallbackMessage:
        "I searched the dashboard/query catalog but didn't finish a real source query. Please retry; I'll adapt a matching dashboard or query if one exists, or run the next discovery pass and query it directly.",
      maxRetries: 2,
      expandToolSurface: true,
      exhaustedDraftPrefix,
    };
  }

  return {
    retryMessage:
      "This looks like an analytics result request, but no real source query ran. If you are making data claims, run one relevant data-source action or connected provider MCP tool now and answer from that result." +
      configuredSourceGuidance +
      " If the right response is a clarification, plan, or explicit unavailable/credentials-missing message with no metrics or source-record claims, finalize that directly instead." +
      UNVERIFIED_DRAFT_RETRY_INSTRUCTION,
    fallbackMessage: configuredSources.length
      ? `I found ${sourceStatusDetails}, but the status check did not run a source query. Please retry so I can test the relevant source before reporting results.`
      : `I couldn't complete a grounded answer to that request. If the relevant provider isn't connected, [connect data sources](${ANALYTICS_DATA_SOURCES_LINK}) and I'll try again with real data.`,
    maxRetries: 2,
    expandToolSurface: true,
    exhaustedDraftPrefix,
  };
}

export async function searchDashboardMentions(query: string, event?: any) {
  if (!event) return [];
  try {
    const { getOrgContext } = await import("@agent-native/core/org");
    const { listDashboardSummaries } =
      await import("../lib/dashboards-store.js");
    const ctx = await getOrgContext(event);
    const rows = await listDashboardSummaries(
      { email: ctx.email, orgId: ctx.orgId ?? null },
      { kind: "sql", hidden: query ? "all" : "visible" },
    );
    const items = rows.map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
    }));

    const q = (query || "").toLowerCase().trim();
    const filtered = q
      ? items.filter(
          (dashboard) =>
            (dashboard.name || "").toLowerCase().includes(q) ||
            dashboard.id.toLowerCase().includes(q),
        )
      : items;

    return filtered.slice(0, 20).map((dashboard) => ({
      id: `dashboard:${dashboard.id}`,
      label: dashboard.name || "Untitled dashboard",
      description: `/dashboards/${dashboard.id}`,
      icon: "deck",
      refType: "dashboard",
      refId: dashboard.id,
      refPath: `/dashboards/${dashboard.id}`,
    }));
  } catch (err) {
    console.error("[analytics] Dashboard mention provider failed:", err);
    return [];
  }
}

export default createAgentChatPlugin({
  appId: "analytics",
  onAgentTurnComplete: autosaveAnalyticsAfterAgentTurn,
  onAgentRunComplete: async (_scope, run) => {
    let memoryCaptureQueued = 0;
    const owner = getRequestRunContext()?.owner ?? getRequestUserEmail();
    if (owner && getRequestContext()?.isSyntheticTraffic !== true) {
      try {
        memoryCaptureQueued = Number(
          await enqueueAnalyticsMemoryCapture({
            owner,
            orgId: getRequestOrgId() || null,
            threadId: run.threadId,
          }),
        );
      } catch (error) {
        console.warn("[analytics-memory-capture] enqueue failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    const properties = summarizeAnalyticsRun({
      events: run.events,
      groundingActionNames: GROUNDING_ACTION_NAMES,
      preloadedReferenceCount:
        getRequestRunContext()?.analyticsJevPrefetch?.preloadedReferenceCount ??
        0,
      // Core merges this app's status with its own preload stages.
      prefetchStatus:
        getRequestRunContext()?.contextStatus?.prefetch ?? "unrecorded",
    });
    properties.memory_capture_queued = memoryCaptureQueued;
    const { track } = await import("@agent-native/core/tracking");
    await track("analytics_agent_run_outcome", properties);
  },
  prepareRequest: async ({
    ownerEmail,
    message,
    requestContext,
    contextPrefetchDeadlineAt,
    dispatchToBackground,
  }) => {
    if (
      !ownerEmail ||
      dispatchToBackground ||
      isTrivialTurn(message ?? requestContext)
    ) {
      return;
    }
    const { prefetchStatus, ...references } =
      await retrieveAnalyticsPromptReferences({
        request: requestContext,
        email: ownerEmail,
        orgId: getRequestOrgId() || null,
        deadlineAt: contextPrefetchDeadlineAt,
      });
    // Core turns `timed_out` and `failed` into the model's context note.
    return { ...references, status: prefetchStatus };
  },
  leanPrompt: isProductionServerlessRuntime(),
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  corpusTools: "lazy",
  finalResponseGuard: realDataFinalGuard,
  codeExecution: { production: "sandboxed" },
  extensionTools: true,
  durableBackgroundRuns: true,
  runSoftTimeoutMs: ANALYTICS_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
  runNoProgressTimeoutMs: ANALYTICS_BACKGROUND_RUN_NO_PROGRESS_TIMEOUT_MS,
  mcp: ANALYTICS_MCP,
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  extraContext: analyticsExtraContext,
  mentionProviders: {
    dashboards: {
      label: "Dashboards",
      icon: "deck",
      search: searchDashboardMentions,
    },
  },
});
