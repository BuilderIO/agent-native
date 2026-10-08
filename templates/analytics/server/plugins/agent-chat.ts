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
import { INITIAL_TOOL_NAMES } from "../lib/agent-chat-plan-mode";
import {
  retrieveAnalyticsPromptReferences,
  summarizeAnalyticsRun,
} from "../lib/analytics-agent-context";
import { ANALYTICS_MCP } from "../lib/analytics-mcp";
import { enqueueAnalyticsMemoryCapture } from "../lib/analytics-memory-capture.js";
import { credentialProviderConfigs } from "../lib/credential-keys";
import { isProductionServerlessRuntime } from "../lib/production-serverless-runtime.js";
import {
  deriveGroundingActionNames,
  draftClaimsAnalyticsMetrics,
  draftRestatesPriorEvidence,
  failedDataQueryAttemptMessage,
  hasCatalogSearchAttempt,
  hasDashboardConstructionAttempt,
  hasExplicitPartialDisclosure,
  hasFailedCorpusWorkflowEvidence,
  hasDataQueryAttempt,
  hasIncompleteDataEvidence,
  isGenericNoDataFallback,
  isSafeNoDataAnalyticsResponse,
  hasOverstatedCoverageConfidenceClaim,
  looksLikeCoverageSensitiveAnalyticsRequest,
  looksLikeDashboardConstructionRequest,
  looksLikeStrongCoverageClaim,
  looksLikeAnalyticsDataRequest,
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
    text: "REAL DATA — Present metrics, counts, trends, or source-record conclusions only from a live data-source query that ran this turn; a catalog or dictionary hit, `data-source-status`, `get-sql-dashboard`, and dry-run validation are not data queries. Never substitute a fabricated number for a failed query or unavailable provider; report the exact gap. Non-data tasks (greetings, general knowledge, math, writing, coding, workflow or settings help, conceptual planning) need no data call and never get the no-grounded-data fallback.",
  },
  {
    id: "references",
    text: 'REFERENCES — The system may preload bounded dictionary entries and saved dashboard panels in `<resource scope="analytics-catalog">`. They supply definitions and query examples, never current values. Approved entries are canonical, unreviewed human entries unverified, AI-generated unapproved entries suggestions. If nothing fits, search once with `search-analytics-query-catalog`, then `list-data-dictionary` or `search-bigquery-schema`. The words all, total, or exact do not by themselves make a question a corpus investigation.',
  },
  {
    id: "failed-calls",
    text: "FAILED CALLS — Correct invalid arguments once; never repeat an identical failed call. For credential, permission, quota, network, or repeated schema failures, stop using that source for the turn and surface the actual error rather than trying unrelated providers. Never ask the user for internal dataset, table, column, or SQL identifiers: `search-bigquery-schema` searches the configured project without a dataset, and `list-data-dictionary` defines the metrics.",
  },
  {
    id: "sources",
    text:
      "SOURCES — A provider the user names is authoritative for the turn: use its first-class query action, or `tool-search` for it when it is not loaded, instead of loading unrelated catalogs. `query-agent-native-analytics` is the always-available built-in first-party source (product events, signups, session recordings): never call it disconnected because an external provider is, and keep the event semantics of a first-party dashboard definition the catalog returns. When a live request needs an unavailable external provider, explain what is missing in context and link [Connect data sources](" +
      ANALYTICS_DATA_SOURCES_LINK +
      ") rather than a canned no-data sentence. Load provider API, corpus, staging, or code tools (`provider-api-request`, `provider-corpus-job`, `query-staged-dataset`, `run-code`) only for explicit cross-source work, exhaustive unstructured-record coverage, an absence claim the first-class action cannot support, or a durable export.",
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
    text: 'SKILLS — Read the owning skill with `docs-search --slug "skill-<name>"` before the work: `dashboard-management` for any dashboard or panel edit, layout, or folder; `custom-blocks` for extension panels, which are a one-off exception to native panels; `account-health` for a named customer, QBR, or renewal; `incident-investigation` for a named user\'s sessions, errors, stuck runs, or replay evidence; `analysis-workspace` for CSV, XLSX, or file delivery.',
  },
  {
    id: "acknowledgments",
    text: "ACKNOWLEDGMENTS — When responding to user feedback, use at most one brief acknowledgment. Avoid stacked compliments or repeated validation, then address the feedback directly.",
  },
];

export function analyticsExtraContext(): string {
  return `<data-source-guidance>\n${ANALYTICS_PROMPT_RULES.map((rule) => rule.text).join("\n")}\n</data-source-guidance>`;
}

const SCHEMA_DETAILS_REQUEST_PATTERN =
  /\b(?:could you|can you|would you|please\s+(?:provide|share|send|tell)|provide|share|send(?: me)?|tell me|i need(?: you to)?|what (?:is|are)|which)\b[\s\S]{0,260}\b(?:bigquery\s+)?(?:dataset(?: name)?s?|table(?: name)?s?|column(?: name)?s?|field(?: name)?s?|schema|sql query)\b/i;

function looksLikeSchemaDetailsRequest(text: string): boolean {
  return SCHEMA_DETAILS_REQUEST_PATTERN.test(
    stripInjectedAnalyticsGuardContext(String(text ?? "")),
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

function configuredDataSourceLabels(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): string[] {
  const labels = new Set<string>();
  for (const result of toolResults ?? []) {
    const normalizedName = String(result.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (normalizedName !== "data-source-status" || result.isError) continue;

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(String(result.content ?? ""));
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      parsed = value as Record<string, unknown>;
    } catch {
      continue;
    }

    const compactSources = Array.isArray(parsed.configuredDataSources)
      ? parsed.configuredDataSources
      : [];
    for (const source of compactSources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        continue;
      }
      const record = source as Record<string, unknown>;
      const label = record.label ?? record.provider;
      if (typeof label === "string" && label.trim()) labels.add(label.trim());
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
      if (record.configured !== true) continue;
      const label = record.label ?? record.provider;
      if (typeof label === "string" && label.trim()) labels.add(label.trim());
    }
  }
  return [...labels];
}

const UNVERIFIED_DRAFT_RETRY_INSTRUCTION =
  ' If you cannot run a query, restate every number, count, or trend in the draft as explicitly unverified (prefix the sentence with "Unverified:") rather than asserting it.';

function exhaustedDraftPrefixFor({
  toolResults,
  setupMarkdown,
  includeConnectOption,
}: {
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"];
  setupMarkdown: string;
  includeConnectOption: boolean;
}): string {
  const configuredSources = configuredDataSourceLabels(toolResults);
  const connectedSentence = configuredSources.length
    ? ` Connected sources: ${configuredSources.join(", ")}.`
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
    connectedSentence +
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
  externalSourceLabels: string[];
  availableExternalSources: Array<{
    aliases: string[];
    configured: boolean | null;
    label?: string;
    setupLink?: string;
  }>;
  setupLink: string;
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
  const externalSourceLabels = new Set<string>();
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
        externalSourceLabels.add(label.trim());
      }
      addAvailableExternalSource(
        record.provider,
        label,
        true,
        record.setupLink,
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
      addAvailableExternalSource(
        record.provider,
        label,
        configured,
        record.setupLink,
      );
      if (configured !== true) continue;
      if (typeof label === "string" && label.trim()) {
        externalSourceLabels.add(label.trim());
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
        record.configured === true || grantState === "connected"
          ? true
          : record.configured === false ||
              grantState === "granted" ||
              grantState === "needs_grant" ||
              grantState === "not_connected"
            ? false
            : null;
      addAvailableExternalSource(providerId, label, configured);
      if (configured && typeof label === "string" && label.trim()) {
        externalSourceLabels.add(label.trim());
      }
    }
  }

  return {
    checked,
    externalSourceLabels: [...externalSourceLabels],
    availableExternalSources: [...availableExternalSources.values()],
    setupLink,
  };
}

function requestedExternalSourceSetup(
  userText: string,
  summary: DataSourceStatusSummary,
): { label: string; setupLink: string } | null {
  let source:
    | DataSourceStatusSummary["availableExternalSources"][number]
    | undefined;
  let bestMatchLength = -1;
  for (const candidate of summary.availableExternalSources) {
    if (candidate.configured !== false || !candidate.setupLink) continue;
    const matchLength = Math.max(
      -1,
      ...candidate.aliases
        .filter((alias) => containsNormalizedPhrase(userText, alias))
        .map((alias) => normalizeSourceLabel(alias).length),
    );
    if (matchLength > bestMatchLength) {
      source = candidate;
      bestMatchLength = matchLength;
    }
  }
  if (!source?.setupLink) return null;
  return {
    label: source.label ?? source.aliases[0] ?? "data source",
    setupLink: source.setupLink,
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

export function realDataFinalGuard(
  context: AgentLoopFinalResponseGuardContext,
) {
  if ((context as { executionMode?: string }).executionMode === "plan") {
    return null;
  }
  const stableRequestText = (
    context as AgentLoopFinalResponseGuardContext & { requestText?: string }
  ).requestText;
  const userText = stableRequestText ?? latestUserText(context.messages ?? []);
  const dashboardConstructionRequest =
    looksLikeDashboardConstructionRequest(userText);
  if (
    !looksLikeAnalyticsDataRequest(userText) &&
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
  const dataQueryAttempted = hasDataQueryAttempt(context.toolResults);
  const sourceStatus = dataSourceStatusSummary(context.toolResults);
  const requestedSourceSetup = requestedExternalSourceSetup(
    userText,
    sourceStatus,
  );
  const setupLink = requestedSourceSetup?.setupLink ?? sourceStatus.setupLink;
  const setupLabel = requestedSourceSetup
    ? `Connect ${requestedSourceSetup.label}`
    : "Connect data sources";
  const setupMarkdown = `[${setupLabel}](${setupLink})`;
  const hasUnknownExternalSourceStatus =
    sourceStatus.availableExternalSources.some(
      ({ configured }) => configured === null,
    );
  const noConnectedExternalSources =
    sourceStatus.checked &&
    sourceStatus.externalSourceLabels.length === 0 &&
    !hasUnknownExternalSourceStatus;
  const externalSourceRequest = looksLikeExternalSourceRequest(userText);
  const missingRequestedExternalSource = hasMissingRequestedExternalSource(
    userText,
    sourceStatus.externalSourceLabels,
    sourceStatus.availableExternalSources,
  );
  const firstPartySourceShouldBeTried =
    noConnectedExternalSources && !externalSourceRequest;
  const needsDataSourceLink =
    sourceStatus.checked &&
    externalSourceRequest &&
    (noConnectedExternalSources || missingRequestedExternalSource);
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

  const failedQueryMessage = failedDataQueryAttemptMessage(context.toolResults);
  if (looksLikeSchemaDetailsRequest(context.text)) {
    const failedQueryRecovery = failedQueryMessage
      ? ` ${failedQueryMessage}`
      : "";
    return {
      retryMessage:
        "The draft asks the user to supply internal dataset, table, column, or SQL details. Do not ask the user for warehouse schema identifiers. Use the configured Analytics tools now: call `search-analytics-query-catalog`, then `list-data-dictionary` and `search-bigquery-schema` with focused metric terms when the catalog has no usable definition, and run one authoritative `bigquery` query using the exact discovered references. `search-bigquery-schema` searches the configured project without a dataset. For a named customer, verify identity and distinguish actual consumption from limits or changelog metadata. If the tools prove the source or metric is unavailable, state that exact evidence gap instead of asking the user to name internal tables." +
        failedQueryRecovery,
      fallbackMessage:
        "I couldn't complete that lookup from the configured Analytics sources yet. Please retry and I'll inspect the catalog and warehouse schema directly rather than asking you to provide internal table names.",
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  if (dataQueryAttempted) return null;
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
  if (isSafeNoDataAnalyticsResponse(context.text)) {
    if (
      needsDataSourceLink &&
      !includesDataSourcesLink(context.text, setupLink)
    ) {
      return {
        retryMessage: `The response correctly explains that the requested live data is unavailable, but it needs a contextual next step. Explain which external source is missing, keep the conversation open, and include this exact markdown link: ${setupMarkdown}. Do not use the generic no-grounded-data fallback.`,
        fallbackMessage: `I can help with that once the relevant source is connected. ${setupMarkdown}`,
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
      retryMessage: `The requested external source is not connected. Explain what is missing in the context of the user's question and include this exact markdown link: ${setupMarkdown}. Do not use the generic no-grounded-data fallback.`,
      fallbackMessage: `I can help with that once the relevant source is connected. ${setupMarkdown}`,
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

  const configuredSources = configuredDataSourceLabels(context.toolResults);
  const configuredSourceGuidance = configuredSources.length
    ? ` \`data-source-status\` already confirmed these connected sources: ${configuredSources.join(", ")}. Do not claim that no sources are connected and do not ask the user to reconnect them. Immediately call the relevant query action for one of those sources.`
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
        "You already ran catalog/dashboard-reference discovery this turn. If it returned a usable dashboard or query, adapt and run it now and cite the dashboard; if not, run the next discovery pass (list-data-dictionary, search-bigquery-schema, or data-source-status) and one bounded query." +
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
      ? `I found connected data sources (${configuredSources.join(", ")}), but the model still did not run a real source query. Please retry the request; you do not need to reconnect those sources.`
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
    });
    properties.memory_capture_queued = memoryCaptureQueued;
    const { track } = await import("@agent-native/core/tracking");
    await track("analytics_agent_run_outcome", properties);
  },
  prepareRequest: async ({
    ownerEmail,
    requestContext,
    contextPrefetchDeadlineAt,
    dispatchToBackground,
  }) => {
    if (
      !ownerEmail ||
      dispatchToBackground ||
      !looksLikeAnalyticsDataRequest(requestContext)
    ) {
      return;
    }
    return retrieveAnalyticsPromptReferences({
      request: requestContext,
      email: ownerEmail,
      orgId: getRequestOrgId() || null,
      deadlineAt: contextPrefetchDeadlineAt,
    });
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
