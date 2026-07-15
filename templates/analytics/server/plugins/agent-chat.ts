import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  buildDeepLink,
  loadActionsFromStaticRegistry,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import {
  applyAnalyticsPlanModePolicy,
  INITIAL_TOOL_NAMES,
} from "../lib/agent-chat-plan-mode";
import { ANALYTICS_CONNECTOR_CATALOG } from "../lib/analytics-connector-catalog";
import { credentialProviderConfigs } from "../lib/credential-keys";
import {
  failedDataQueryAttemptMessage,
  hasExplicitPartialDisclosure,
  hasFailedCorpusWorkflowEvidence,
  hasDataQueryAttempt,
  hasIncompleteDataEvidence,
  isGenericNoDataFallback,
  isSafeNoDataAnalyticsResponse,
  hasOverstatedCoverageConfidenceClaim,
  looksLikeCoverageSensitiveAnalyticsRequest,
  looksLikeStrongCoverageClaim,
  looksLikeAnalyticsDataRequest,
  needsCorpusWorkflowForCoverageSensitiveRequest,
  needsSourceRecordBodyWorkflowForCoverageSensitiveRequest,
} from "../lib/real-data-actions";

const ANALYTICS_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;

const ANALYTICS_DATA_SOURCES_LINK = buildDeepLink({
  app: "analytics",
  view: "data-sources",
  to: "/data-sources",
});

export const SIMPLE_TIME_BOUNDED_METRIC_FAST_PATH_GUIDANCE =
  "SIMPLE TIME-BOUNDED METRIC FAST PATH — When the data dictionary or a known canonical source identifies the metric, run one bounded aggregate. Once it returns a valid result, answer the explicit question immediately with the source, time window, row count, and only necessary caveats. Do not schema-discover, retry, enrich, cross-check, or add breakdowns after that successful result unless the query failed or the result conflicts with the known metric definition. This does not waive the real-data requirement: never answer from a guess, stale value, or unverified result. ";

export const BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE =
  "BUILT-IN FIRST-PARTY SOURCE — Analytics always provides one built-in first-party source alongside connected external providers such as BigQuery, HubSpot, Gong, Slack, and the other configured integrations. This does not replace or restrict external sources. For Builder/product signups, page views, app/template usage, conversions, and LLM observability, use `query-agent-native-analytics` over `analytics_events` (or `session_recordings` for replay summaries) when the event lives in first-party Analytics. When the user names an external provider, or the data dictionary identifies one as authoritative, query that provider instead. Do not report the first-party source as disconnected merely because an external provider is not configured. If the first-party query returns no rows, report that grounded result with its scope and time window. ";

export const ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE =
  "OBSERVABILITY INCIDENT WORKFLOW — For a named user's session or error question, resolve the user's email from context, then use list-session-recordings with userId over a bounded recent window to discover the relevant sessions. Do not require hasErrors=true for this initial lookup: replay/network/stuck-run evidence can exist while the recording's JavaScript errorCount is zero. Use hasErrors=true only when the user specifically asks for recordings with captured JavaScript errors or the recording metadata confirms that filter is appropriate. Use list-error-issues with userId or sessionRecordingId to identify a grouped issue, then get-error-issue for stack, breadcrumbs, occurrences, and linked recordings. For console diagnostics or failed network requests, create-session-replay-agent-link first and use its scoped diagnostics endpoint for detailed error text, stacks, request metadata, and bounded 5xx snippets; enumerate with kind/limit and fromMs/toMs or offset when needed. Use get-session-replay-summary and get-session-replay-timeline for the page-navigation and click sequence, and use get-session-replay-events only for additional bounded replay-event details. If no grouped error exists, correlate first-party observability events such as agent_chat_stuck_detected with query-agent-native-analytics in execution mode. In Plan mode, query-agent-native-analytics is intentionally unavailable: do not claim a live event correlation or root cause from it, and describe the event lookup as a planned next step. Prefer these first-party actions over generic SQL. Report the matching evidence and do not claim a root cause without a corroborating error, event, or replay signal. ";

export const NON_ANALYTICS_REQUEST_GUIDANCE =
  "NON-ANALYTICS REQUESTS — If the user is not asking for a live metric, source record, or derived analytics claim, answer normally in chat. Greetings, general-knowledge questions, math, writing, coding, and conceptual questions do not need a data-source call. Do not use the no-grounded-data fallback for those requests. ";

// Deterministic backstop for the soft NON_ANALYTICS_REQUEST_GUIDANCE prompt
// above: if a model still parrots the canned no-grounded-data fallback on a
// non-analytics turn, retry once with this synthetic user message instead of
// letting the canned sentence reach the user. Wrapped in an injected-context
// tag (registered in INJECTED_CONTEXT_BLOCKS) so `looksLikeAnalyticsDataRequest`
// never classifies the guard's own retry turn as a data request and loops.
export const NON_ANALYTICS_FALLBACK_RETRY_MESSAGE =
  "<non-analytics-retry>\nThe user's latest message is ordinary conversation. Reply to it directly and naturally. Never answer it with the no-grounded-data disclaimer.\n</non-analytics-retry>";

export const NON_ANALYTICS_FALLBACK_FINAL_MESSAGE =
  "I got stuck generating a reply to that message. Please try again or rephrase it.";

export function analyticsSourceGuidanceOpening(): string {
  return (
    "<data-source-guidance>\n" +
    "Apply real-data requirements only when presenting analytics results, source records, or derived metrics. Do not call data-source tools for workflow migration, recurring-job setup, UI/code fixes, settings help, conceptual planning, or other non-data tasks unless the user explicitly asks for data. " +
    NON_ANALYTICS_REQUEST_GUIDANCE +
    SIMPLE_TIME_BOUNDED_METRIC_FAST_PATH_GUIDANCE +
    BUILT_IN_FIRST_PARTY_SOURCE_GUIDANCE +
    ANALYTICS_OBSERVABILITY_INCIDENT_GUIDANCE +
    `DATA-SOURCE SETUP UX — Chat remains available when no external data source is connected. For a live-data request that needs an unavailable external provider, explain what is missing in the context of the user's question and guide them naturally to [Connect data sources](${ANALYTICS_DATA_SOURCES_LINK}). Use that real link from the app; do not emit a generic canned no-data sentence. For general conversation, conceptual questions, and questions the built-in first-party source can answer, continue helping normally. ` +
    "SURFACE DIFFERENTIATION — You are the analytics assistant for definitions, deep-dive analysis, and action. For questions about what a metric, model, or table means, use the Data Dictionary and configured schema tools first. For trends, comparisons, anomalies, current data, or anything that requires querying live data, answer directly in chat with the relevant provider query, dashboard analysis, and inline charts when useful. "
  );
}

export function analyticsDataDictionaryRoutingContext(): string {
  return `<data-dictionary-routing>
Data-dictionary definitions are available on demand instead of being embedded in every chat request. Before writing SQL or making a metric-definition claim, call \`list-data-dictionary\` with a focused \`search\` or \`department\` filter. If the user asks what definitions exist and no useful filter is available, call it without filters. Treat approved entries as canonical, verify unreviewed human entries when stakes are high, and treat AI-generated unapproved entries as suggestions only. If no matching definition exists, inspect the configured source schema or ask the user instead of guessing.
</data-dictionary-routing>`;
}

export {
  applyAnalyticsPlanModePolicy,
  INITIAL_TOOL_NAMES,
  PLAN_MODE_ACT_ONLY_TOOLS,
} from "../lib/agent-chat-plan-mode";

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

    // Backward compatibility for runs against deployments that predate the
    // compact configuredDataSources summary.
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

interface DataSourceStatusSummary {
  checked: boolean;
  externalSourceLabels: string[];
  availableExternalSources: Array<{
    aliases: string[];
    configured: boolean;
  }>;
  setupLink: string;
}

const GENERIC_EXTERNAL_SOURCE_REQUEST_TERMS = /\b(warehouse|crm|payments?)\b/i;

const EXTERNAL_SOURCE_PROVIDER_ALIASES = [
  ...credentialProviderConfigs.map(({ provider, label }) => ({
    terms: [provider, label],
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
      .filter(({ configured }) => configured)
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
    .some(
      ({ aliases }) =>
        !configuredAliases.some((configured) =>
          sourceAliasesOverlap(configured, aliases),
        ),
    );
}

function dataSourceStatusSummary(
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"],
): DataSourceStatusSummary {
  const externalSourceLabels = new Set<string>();
  const availableExternalSources = new Map<
    string,
    { aliases: string[]; configured: boolean }
  >();
  let checked = false;
  let setupLink = ANALYTICS_DATA_SOURCES_LINK;

  const addAvailableExternalSource = (
    provider: unknown,
    label: unknown,
    configured: boolean,
  ) => {
    const aliases = [provider, label]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    const key = normalizeSourceLabel(aliases[0] ?? aliases[1] ?? "");
    if (!key) return;
    const existing = availableExternalSources.get(key);
    if (existing) {
      existing.configured ||= configured;
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
      return;
    }
    availableExternalSources.set(key, { aliases, configured });
  };

  for (const result of toolResults ?? []) {
    const normalizedName = String(result.name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-");
    if (normalizedName !== "data-source-status" || result.isError) continue;

    checked = true;
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
      const provider = String(record.provider ?? "")
        .trim()
        .toLowerCase();
      const via = String(record.via ?? "")
        .trim()
        .toLowerCase();
      if (provider === "first-party" || via === "built-in") continue;
      const label = record.label ?? record.provider;
      if (typeof label === "string" && label.trim()) {
        externalSourceLabels.add(label.trim());
      }
      addAvailableExternalSource(record.provider, label, true);
    }

    // Backward compatibility for status responses that predate the compact
    // configuredDataSources summary.
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
      const providerId = String(record.provider ?? "")
        .trim()
        .toLowerCase();
      if (providerId === "first-party") continue;
      const label = record.label ?? record.provider;
      addAvailableExternalSource(
        record.provider,
        label,
        record.configured === true,
      );
      if (record.configured !== true) continue;
      if (typeof label === "string" && label.trim()) {
        externalSourceLabels.add(label.trim());
      }
    }

    const workspaceConnections =
      parsed.workspaceConnections &&
      typeof parsed.workspaceConnections === "object" &&
      !Array.isArray(parsed.workspaceConnections)
        ? (parsed.workspaceConnections as Record<string, unknown>)
        : null;
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
      const configured =
        record.configured === true || record.grantState === "connected";
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
  // Keep the template compatible with the currently installed core package
  // while the new requestText field ships in the same framework release.
  const stableRequestText = (
    context as AgentLoopFinalResponseGuardContext & { requestText?: string }
  ).requestText;
  const userText = stableRequestText ?? latestUserText(context.messages ?? []);
  if (!looksLikeAnalyticsDataRequest(userText)) {
    // Deterministic backstop: the soft NON_ANALYTICS_REQUEST_GUIDANCE prompt
    // sentence is not always enough, and a model occasionally parrots the
    // canned no-grounded-data fallback even for ordinary conversation. Catch
    // that case here instead of letting it reach the user.
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
  const noConnectedExternalSources =
    sourceStatus.checked && sourceStatus.externalSourceLabels.length === 0;
  const externalSourceRequest = looksLikeExternalSourceRequest(userText);
  const missingRequestedExternalSource = hasMissingRequestedExternalSource(
    userText,
    sourceStatus.externalSourceLabels,
    sourceStatus.availableExternalSources,
  );
  const firstPartySourceShouldBeTried =
    noConnectedExternalSources && !externalSourceRequest;
  const needsDataSourceLink =
    !sourceStatus.checked ||
    (externalSourceRequest &&
      (noConnectedExternalSources || missingRequestedExternalSource));
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
        "The user asked a coverage-sensitive provider question, but the draft only used bounded convenience data actions. Do not finalize an exhaustive, all-records, or absence-sensitive answer from shortcut actions alone. Use the broad provider API/MCP surface and a corpus workflow now: provider-api-catalog/provider-api-docs when needed, provider-corpus-job for durable paginated or batched corpus scans, provider-api-request with fetchAllPages/stageAs/saveToFile for the exact provider endpoint/filter/body/pagination, then run-code or query-staged-dataset to join, grep, classify, and aggregate. If full coverage is not possible in this turn, finalize with explicit partial-coverage wording, inspected counts, filters, and remaining gaps.",
      fallbackMessage:
        "I can't make a confident coverage-sensitive provider claim from bounded shortcut actions alone. I need a provider API/corpus workflow, or I need to label the answer as partial with exact inspected counts and gaps.",
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
        "The user asked to search source-record body text such as transcripts, messages, tickets, issues, notes, documents, or conversation logs, but the draft's corpus evidence does not show that the requested body records were actually searched. A parent/container metadata scan, title search, summary search, or call/ticket/message list is not enough for an absence-sensitive body-text claim. Retry with the provider's raw body endpoint or native search for the requested record type, using provider-corpus-job batch-search/paginated-search, provider-api-request with staging, or run-code over staged raw records. Then report source path/body field, inspected record count, hit count, and gaps.",
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
  if (dataQueryAttempted) return null;
  if (isSafeNoDataAnalyticsResponse(context.text)) {
    if (firstPartySourceShouldBeTried) {
      return {
        retryMessage:
          "The built-in first-party Analytics source is available even though no external provider is connected. Use `query-agent-native-analytics` for the user's first-party product, usage, conversion, or observability question before explaining that data is unavailable. Only guide the user to connect a source if the request specifically needs an external provider.",
        fallbackMessage:
          "I couldn't complete a grounded first-party Analytics query yet. Please retry and I'll use the built-in Analytics source before asking you to connect an external provider.",
        maxRetries: 2,
        expandToolSurface: true,
      };
    }
    if (
      needsDataSourceLink &&
      !includesDataSourcesLink(context.text, sourceStatus.setupLink)
    ) {
      return {
        retryMessage: `The response correctly explains that the requested live data is unavailable, but it needs a contextual next step. Explain which external source is missing, keep the conversation open, and include this exact markdown link: [Connect data sources](${sourceStatus.setupLink}). Do not use the generic no-grounded-data fallback.`,
        fallbackMessage: `I can help with that once the relevant source is connected. [Connect data sources](${sourceStatus.setupLink})`,
        maxRetries: 2,
      };
    }
    return null;
  }
  const failedQueryMessage = failedDataQueryAttemptMessage(context.toolResults);
  if (failedQueryMessage) {
    if (
      needsDataSourceLink &&
      !includesDataSourcesLink(context.text, sourceStatus.setupLink)
    ) {
      return {
        retryMessage: `${failedQueryMessage} Explain which external source is missing and include this exact markdown link: [Connect data sources](${sourceStatus.setupLink}).`,
        fallbackMessage: `${failedQueryMessage} [Connect data sources](${sourceStatus.setupLink})`,
        maxRetries: 2,
      };
    }
    return {
      retryMessage: failedQueryMessage,
      fallbackMessage: failedQueryMessage,
    };
  }

  if (
    needsDataSourceLink &&
    (missingRequestedExternalSource ||
      (noConnectedExternalSources && externalSourceRequest))
  ) {
    return {
      retryMessage: `The requested external source is not connected. Explain what is missing in the context of the user's question and include this exact markdown link: [Connect data sources](${sourceStatus.setupLink}). Do not use the generic no-grounded-data fallback.`,
      fallbackMessage: `I can help with that once the relevant source is connected. [Connect data sources](${sourceStatus.setupLink})`,
      maxRetries: 2,
      expandToolSurface: true,
    };
  }

  const configuredSources = configuredDataSourceLabels(context.toolResults);
  if (firstPartySourceShouldBeTried) {
    return {
      retryMessage:
        "The user asked for live analytics, and the built-in first-party Analytics source is available even though no external provider is connected. Call `query-agent-native-analytics` for first-party product, usage, conversion, or observability data and answer from that result. If the request specifically names an external provider, explain what is missing and include the real Connect data sources link.",
      fallbackMessage:
        "I couldn't complete a grounded first-party Analytics query yet. Please retry and I'll use the built-in Analytics source before asking you to connect an external provider.",
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  if (noConnectedExternalSources) {
    return {
      retryMessage: `The user asked for live analytics, but data-source-status found no connected external providers. The built-in first-party source is still available for first-party Analytics data. If this request needs an external source, respond naturally in the context of the user's question, explain what is missing, and include [Connect data sources](${sourceStatus.setupLink}). Do not use a generic canned no-data response.`,
      fallbackMessage: `I can help with that once the relevant source is connected. [Connect data sources](${sourceStatus.setupLink})`,
      maxRetries: 2,
      expandToolSurface: true,
    };
  }
  const configuredSourceGuidance = configuredSources.length
    ? ` \`data-source-status\` already confirmed these connected sources: ${configuredSources.join(", ")}. Do not claim that no sources are connected and do not ask the user to reconnect them. Immediately call the relevant query action for one of those sources.`
    : "";
  return {
    retryMessage:
      "This looks like an analytics result request, but no real source query ran. If you are making data claims, run one relevant data-source action or connected provider MCP tool now and answer from that result." +
      configuredSourceGuidance +
      " If the right response is a clarification, plan, or explicit unavailable/credentials-missing message with no metrics or source-record claims, finalize that directly instead.",
    fallbackMessage: configuredSources.length
      ? `I found connected data sources (${configuredSources.join(", ")}), but the model still did not run a real source query. Please retry the request; you do not need to reconnect those sources.`
      : `I couldn't complete a grounded answer to that request. If the relevant provider isn't connected, [connect data sources](${ANALYTICS_DATA_SOURCES_LINK}) and I'll try again with real data.`,
    // Some models use separate turns for status, schema discovery, and the
    // actual query. One corrective turn was enough for Sonnet but caused Luna
    // to hit the fallback before it reached the query.
    maxRetries: 2,
    // The first request may use the compact starter catalog. A corrective
    // retry must be able to reach the real source action directly; otherwise
    // some model families spend the retry on tool-search narration and hit
    // the canned fallback without ever running a query.
    expandToolSurface: true,
  };
}

export default createAgentChatPlugin({
  appId: "analytics",
  actions: applyAnalyticsPlanModePolicy(
    loadActionsFromStaticRegistry(actionsRegistry),
  ),
  initialToolNames: INITIAL_TOOL_NAMES,
  finalResponseGuard: realDataFinalGuard,
  // Enable sandboxed JavaScript execution for analytics data processing.
  // Code runs in an isolated Node.js child process with no access to app
  // source, secrets, or DB. It can call provider-api-request, web-request,
  // and Resources-backed workspace file helpers via the bridge.
  //
  // Operators deploying to trusted internal environments can set
  // AGENT_PROD_CODE_EXECUTION=trusted to also enable bash/read/edit/write.
  codeExecution: { production: "sandboxed" },
  // Long-running A2A analysis belongs on the durable worker so provider
  // pagination, cross-source joins, and corpus reduction can outlive the
  // standard serverless request budget without orphaning the task.
  durableBackgroundRuns: true,
  runSoftTimeoutMs: ANALYTICS_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
  connectorCatalog: [...ANALYTICS_CONNECTOR_CATALOG],
  externalAgents: {
    // Keep the direct MCP surface deliberately curated. External agents
    // should use ask_app for multi-step investigation; these six actions are
    // bounded fallback reads for callers that already know what they need.
    authenticatedReads: "off",
    writes: "ask_app_only",
  },
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
  extraContext: async () => {
    // Always inject compact source-routing guidance. Dictionary definitions
    // stay behind list-data-dictionary so prompt assembly does not read and
    // render every organization metric before the model request starts.
    const sourceGuidance =
      analyticsSourceGuidanceOpening() +
      "DASHBOARD CREATION RULE — You may create dashboards, analyses, SQL panels, or other resources only when the user explicitly asks you to (e.g. 'build me a dashboard for...', 'create a new analysis', 'add a chart for...'). Never create any resource proactively during research, trend analysis, or answering questions. If you think a dashboard would be useful, suggest it and wait for explicit confirmation before creating anything. Never add new items to the sidebar or modify existing dashboards without an explicit user directive. " +
      "DASHBOARD MUTATION RULE — For dashboard edits, default to `mutate-dashboard` with the typed `dashboard.*` script API so the main payload is a string and avoids native-array serialization traps. It can move panels by id, edit titles/SQL/config, insert, duplicate, remove, and patch dashboard fields in one atomic save. The script API is constrained: no variables/imports/loops/functions, only JSON-compatible arguments on documented dashboard methods. Do not count shifting `/panels/<index>` positions for ordinary dashboard edits unless the user specifically asks for low-level JSON-pointer operations. " +
      'FIRST-PARTY DASHBOARD TIME RULE — AI-generated `source: "first-party"` panels are dashboard-time-bound by default: set `config.timeScope` to `dashboard` and include a matching dashboard time predicate. `{{timeRange}}` requires a matching `filters` entry with `id: "timeRange"` and `type: "select"`; `{{<id>Start}}`/`{{<id>End}}` require a matching `type: "date-range"` filter with that id. Allowed `timeScope` values are `dashboard`, `fixed-window`, `cohort-history`, and `all-time`; use `all-time` only when the user requests full available history and put all-time, lifetime, or historical in the title or description. Server validation rejects unbound first-party SQL. ' +
      "DASHBOARD READ RULE — `get-sql-dashboard` is compact by default: use its `panels` summaries plus `layout.panelOrder`, `layout.firstPanelIds`, and `layout.groups[].rows[].rowNumber/panelIds` for orientation and verification. Pass `includeConfig: true` only when you truly need full panel SQL/config. " +
      'DASHBOARD REORDER RULE — For simple chart/section moves, use `mutate-dashboard` code such as `dashboard.panels(["panel-a","panel-b"]).moveToTop();`. For visible placement requests like "second row" or "next to return rates", use row-aware placement such as `dashboard.insertPanel({...}).nextTo("retention-over-time")`, `.atRow(2)`, or `dashboard.panel("panel-a").moveNextTo("panel-b")`; these keep panels in the intended rendered row and expand/rebalance that row when needed. Never count shifting `/panels/<index>` positions for ordinary \'move this chart\' requests. Use `get-sql-dashboard.layout.groups[].rows` as proof of visible row placement, not only flat `panelOrder`. ' +
      "Use configured data sources and actions only. The built-in first-party Analytics source is an additional source and is always available through `query-agent-native-analytics`, even when no external provider credentials are connected. External provider actions remain available and are the authoritative path when the user names a provider or the data lives there. Call `data-source-status` when you need to know which external providers are connected, and treat provider actions as unavailable for analysis only if they return missing credentials, permission, syntax, quota, or network errors. " +
      "The built-in `demo` dashboard source is a demo-environment Prometheus source reserved for the Node Exporter demo. It must never satisfy REAL_DATA_REQUIRED or be cited as user analytics evidence unless the user explicitly asks to inspect the demo dashboard. " +
      "When the user names a provider or tool such as Jira, Pylon, HubSpot, Gong, Slack, Sentry, GA4, or BigQuery, that named source is authoritative for the turn: use that provider's real tool/API surface, not a warehouse or different-provider substitute, unless the user explicitly asks for the copy/fallback. For bounded lookups where a first-class action fully models the requested source, object, filter, and pagination need, that shortcut is fine. For broad provider searches, cross-source joins, corpus-wide counts, exact cohort coverage, or any answer where absence matters, do not start and stop with shortcuts; use the broad provider API/MCP and corpus/code workflow as the primary path. " +
      "Provider-specific actions are shortcuts, not limits. If a first-class action cannot express the exact endpoint, object type, filters, request body, pagination mode, API version, or corpus coverage needed, call `provider-api-catalog` and `provider-api-docs` as needed, then call `provider-api-request` against the provider's real HTTP API. Use this raw provider API escape hatch instead of weakening the analysis, broadening filters, sampling default pages, or claiming the integration cannot do something the underlying API can do. " +
      "When one provider cohort becomes the input to a second provider search, join, or exhaustive corpus scan, stage the upstream cohort with `provider-api-request`/`stageAs` (or a native provider API/MCP bulk primitive) before the downstream search. Avoid starting such workflows with convenience list/search actions that return display-shaped pages or can time out before the corpus path is established. " +
      'For broad unstructured provider records such as transcripts, messages, tickets, issues, notes, events, documents, or conversation logs, prefer `provider-corpus-job` so the scan has durable checkpoints, stored snippets, coverage counts, and provider quota pause/resume. Use mode="paginated-search" for any provider endpoint that already pages over the target records; use mode="batch-search" when a staged upstream cohort of ids/records must feed a second provider endpoint by `itemBodyPath` or `itemQueryParam`. Continue paused jobs until completed or quota_wait, then read results. Use `run-code` with `providerSearchAll`, `providerFetch`, `appAction`, `workspaceRead`, and Resources-backed workspace files for shorter reductions, joins, classification, and aggregation after the corpus path is established. Convenience actions are bounded shortcuts for common checks, not the ceiling for what the underlying provider API can answer. ' +
      "When the user asks to search source-record body text, use the raw body endpoint or native provider search for that record type. Parent/container metadata such as call lists, titles, summaries, briefs, channel lists, ticket lists, or issue lists can discover scope but cannot support a complete body-text absence claim. " +
      "For source-record mention searches, phrase searches, and absence checks across transcripts/messages/tickets/issues, prefer provider-side search, `provider-corpus-job`, staged corpus, `providerSearchAll`, or action-side search arguments that return counts, coverage, and snippets instead of loading raw full records into chat. Use full transcripts/messages only for selected evidence after the search narrows the corpus, and state whether the search covered every matching record or only a bounded sample. " +
      "For complex provider questions, broad searches, corpus-wide counts, cross-source joins, or any answer where absence matters, prefer a corpus-first workflow: inspect the provider API, fetch every relevant page or an explicitly bounded cohort, stage large responses with `saveToFile`/`stageAs`/`fetchAllPages`, use `provider-corpus-job` for durable long-running searches, and use `run-code` with `providerSearchAll`, `providerFetch`, `appAction`, and Resources-backed workspace files to join, search, classify, and aggregate. Use `scratch/` for temporary staging and durable folder names only for files the user should keep. Do not infer no results from sampled records, default limits, truncated excerpts, or aborted calls. If full coverage is not possible in the turn, say exactly what was inspected and what remains uncovered. " +
      'For HubSpot deal cohorts, structured `hubspot-deals` filters can enumerate a bounded cohort for direct deal-list answers: `product` for the `products` field, `pipeline` for pipeline label/id, `closedStatus` for won/lost/open/closed, and `closedDateFrom`/`closedDateTo` for close-date windows. The `query` argument is full-text deal search and is not proof that a specific property matched; do not use `query: "Publish"` when the user asked for products field = Publish. If the cohort feeds transcript/message/ticket search, a cross-source join, or exhaustive/absence-sensitive coverage, use `provider-api-request` with HubSpot search and `stageAs` for the cohort first, then continue with the provider API/corpus workflow. Report the returned filter values and cohort count in the methodology. ' +
      "For named deal, account, renewal, churn-risk, or customer deep dives that need HubSpot and Gong context, `account-deep-dive` can provide a bounded evidence bundle. Use it when the user asks for a targeted entity deep dive, then use the broad provider API/corpus workflow for any requested exhaustive transcript/message/ticket search or absence claim. Do not answer a requested transcript deep dive from call metadata alone. " +
      "When the user refers to the current analysis, this analysis, this project, or asks to spin off, adapt, modify, or reuse a saved analysis, call `view-screen` first and use the returned analysis details; if an analysis id or @mention is provided, call `get-analysis` before responding. " +
      "If a provider action fails, stop using that provider for the turn, surface the actual error, and wait for the user to choose whether to fix SQL, use another source, or retry. Do not loop through more queries after a failed provider call. " +
      "For ordinary ad-hoc, non-coverage-sensitive data questions, answer the explicit question after the first relevant successful query or bounded evidence batch instead of continuing into suggested follow-up investigations. " +
      "If the user challenges coverage, asks why more records were not included, or asks for the updated answer, rerun the relevant source query or revise from the corrected cohort and provide the updated deliverable directly. Do not claim an analysis was revised unless the revised answer is included in the response or saved with `save-analysis`. " +
      "Unstructured source records are valid analytics evidence: Pylon tickets, Jira issues, Gong calls/transcripts, Slack messages, and similar text records may be coded for themes, mention counts, sentiment, objections, and qualitative patterns as long as the answer states the inspected sample size and does not imply unsupported statistical certainty. " +
      "For schema questions, prefer data-dictionary entries and configured warehouse schemas over assumptions; use `search-bigquery-schema` for BigQuery metadata before inventing datasets, tables, or columns. " +
      "Before finalizing any analytics answer, make the evidence trail explicit enough to audit: answer the user's question, name the source(s), time window, sample size or row count, filters, join/match method, caveats/gaps, and recommended next action when useful. Never substitute fabricated numbers for a failed query or unavailable provider. It is fine to ask a clarifying question, provide a plan, or say exactly which source is unavailable as long as you do not present metrics or source-record conclusions without evidence.\n" +
      "</data-source-guidance>";
    const artifactGuidance =
      "<analytics-artifact-guidance>\n" +
      "Native Analytics dashboards and saved analyses are constrained artifacts: dashboards are JSON configs rendered by the built-in dashboard components, and analyses are Markdown reports with generated chart images plus structured resultData. " +
      "If the user's requested dashboard, analysis surface, visualization, interaction model, custom layout, or bespoke workflow cannot be faithfully represented within those native components/config fields, do not hand-wave, force an approximate JSON dashboard, or route to source-code changes. In production mode, automatically create a sandboxed extension with `create-extension` instead, using Alpine.js HTML and the available app/data helpers. " +
      "After creating the extension, briefly tell the user that the request needed bespoke UI/code beyond the native Analytics dashboard or analysis format, so you built it as an extension. " +
      "Do not also create a same-named dashboard or saved analysis unless the user explicitly asked for multiple artifacts; saved analyses appear in the sidebar and should not be used for throwaway notes or scratch summaries.\n" +
      "</analytics-artifact-guidance>";

    return `${sourceGuidance}\n\n${artifactGuidance}\n\n${analyticsDataDictionaryRoutingContext()}`;
  },
  mentionProviders: {
    dashboards: {
      label: "Dashboards",
      icon: "deck",
      search: async (query: string, event?: any) => {
        if (!event) return [];
        try {
          const { getOrgContext } = await import("@agent-native/core/org");
          const { listDashboards } = await import("../lib/dashboards-store.js");
          const ctx = await getOrgContext(event);
          const rows = await listDashboards(
            { email: ctx.email, orgId: ctx.orgId ?? null },
            { kind: "sql", hidden: query ? "all" : "visible" },
          );
          const items = rows.map((d) => ({ id: d.id, name: d.title }));

          const q = (query || "").toLowerCase().trim();
          const filtered = q
            ? items.filter(
                (d) =>
                  (d.name || "").toLowerCase().includes(q) ||
                  d.id.toLowerCase().includes(q),
              )
            : items;

          return filtered.slice(0, 20).map((d) => ({
            id: `dashboard:${d.id}`,
            label: d.name || "Untitled dashboard",
            description: `/dashboards/${d.id}`,
            icon: "deck",
            refType: "dashboard",
            refId: d.id,
            refPath: `/dashboards/${d.id}`,
          }));
        } catch (err) {
          console.error("[analytics] Dashboard mention provider failed:", err);
          return [];
        }
      },
    },
    analyses: {
      label: "Analyses",
      icon: "document",
      search: async (query: string, event?: any) => {
        if (!event) return [];
        try {
          const { getOrgContext } = await import("@agent-native/core/org");
          const { listAnalyses } = await import("../lib/dashboards-store.js");
          const ctx = await getOrgContext(event);
          const rows = await listAnalyses({
            email: ctx.email,
            orgId: ctx.orgId ?? null,
          });
          const q = (query || "").toLowerCase().trim();
          const filtered = q
            ? rows.filter(
                (analysis) =>
                  (analysis.name || "").toLowerCase().includes(q) ||
                  (analysis.description || "").toLowerCase().includes(q) ||
                  analysis.id.toLowerCase().includes(q),
              )
            : rows;

          return filtered
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
            )
            .slice(0, 20)
            .map((analysis) => ({
              id: `analysis:${analysis.id}`,
              label: analysis.name || "Untitled analysis",
              description: `/analyses/${analysis.id}`,
              icon: "document",
              refType: "analysis",
              refId: analysis.id,
              refPath: `/analyses/${analysis.id}`,
            }));
        } catch (err) {
          console.error("[analytics] Analysis mention provider failed:", err);
          return [];
        }
      },
    },
  },
});
