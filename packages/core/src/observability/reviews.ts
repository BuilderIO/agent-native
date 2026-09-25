import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import {
  getHumanReviewSummaries,
  getOrgScopedThreadData,
  getOrgScopedThreadTitles,
  getOrgScopedReviewThreads,
  getFeedback,
  getInstructionUpdates,
  getSuccessfulToolSpansForReview,
  MAX_REVIEW_TOOL_SPANS,
  getTraceSummary,
  getTraceSummaries,
} from "./store.js";
import type {
  FeedbackEntry,
  InstructionUpdate,
  OutputReviewDetail,
  OutputReviewListRow,
  TraceSummary,
} from "./types.js";

const MAX_INLINE_APP_TITLE_LENGTH = 120;

function unwrapMessage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.message;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : record;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inlineMcpApp(value: unknown): AgentMcpAppPayload | null {
  const app = record(value);
  const resource = record(app?.resource);
  if (
    !app ||
    typeof app.serverId !== "string" ||
    typeof app.toolName !== "string" ||
    typeof app.originalToolName !== "string" ||
    typeof app.resourceUri !== "string" ||
    !record(app.toolInput) ||
    !record(app.toolResult) ||
    typeof resource?.uri !== "string" ||
    typeof resource.mimeType !== "string" ||
    !resource.mimeType.toLowerCase().startsWith("text/html") ||
    (typeof resource.text !== "string" && typeof resource.blob !== "string")
  ) {
    return null;
  }
  return value as AgentMcpAppPayload;
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter(
      (part): part is { type: "text"; text?: unknown } =>
        Boolean(part) &&
        typeof part === "object" &&
        !Array.isArray(part) &&
        (part as Record<string, unknown>).type === "text",
    )
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function messageRunId(message: Record<string, unknown>): string | undefined {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const meta = metadata as Record<string, unknown>;
  const custom = meta.custom;
  const customRecord =
    custom && typeof custom === "object" && !Array.isArray(custom)
      ? (custom as Record<string, unknown>)
      : null;
  const candidates = [
    meta.runId,
    customRecord?.runId,
    customRecord?.submittedRunId,
  ];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0,
  );
}

function readThreadMessages(threadData: string): Array<{
  role: "user" | "assistant";
  text: string;
  runId?: string;
  inlineApps: AgentMcpAppPayload[];
}> {
  if (threadData.length > MAX_THREAD_DATA_CHARS) {
    throw new Error("Observability thread data exceeds the maximum size");
  }
  try {
    const repository = JSON.parse(threadData);
    const values: unknown[] = Array.isArray(repository?.messages)
      ? repository.messages
      : [];
    return values.flatMap((value) => {
      const message = unwrapMessage(value);
      if (
        !message ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        return [];
      }
      if (!Object.prototype.hasOwnProperty.call(message, "content")) {
        return [];
      }
      const content = message.content;
      if (typeof content !== "string" && !Array.isArray(content)) {
        return [];
      }
      const text = messageText(content).trim();
      const inlineApps = Array.isArray(content)
        ? content.flatMap((part) => {
            const app = inlineMcpApp(record(part)?.mcpApp);
            return app ? [app] : [];
          })
        : [];
      return text || inlineApps.length > 0
        ? [
            {
              role: message.role,
              text,
              runId: messageRunId(message),
              inlineApps,
            },
          ]
        : [];
    });
  } catch (error) {
    throw new Error("Unable to parse observability thread data", {
      cause: error,
    });
  }
}

function askAndAnswer(
  summary: TraceSummary,
  threadData: string | null,
): { ask: string; answer: string; inlineApp?: AgentMcpAppPayload } {
  if (!threadData) return { ask: "", answer: "" };
  const messages = readThreadMessages(threadData);
  const askIndex = messages.findIndex(
    (message) => message.role === "user" && message.runId === summary.runId,
  );
  const resolvedAskIndex =
    askIndex >= 0
      ? askIndex
      : messages.filter((message) => message.role === "user").length === 1
        ? messages.findIndex((message) => message.role === "user")
        : -1;
  const answerIndex =
    resolvedAskIndex < 0
      ? -1
      : messages.findIndex((message, index) => {
          if (index <= resolvedAskIndex || message.role === "user") {
            return false;
          }
          if (message.role !== "assistant") return false;
          return message.runId === summary.runId || !message.runId;
        });
  return {
    ask: resolvedAskIndex >= 0 ? messages[resolvedAskIndex]!.text : "",
    answer: answerIndex >= 0 ? messages[answerIndex]!.text : "",
    ...(answerIndex >= 0 && messages[answerIndex]!.inlineApps.length > 0
      ? { inlineApp: messages[answerIndex]!.inlineApps.at(-1) }
      : {}),
  };
}

function inlineAppTitle(app: AgentMcpAppPayload): string | undefined {
  const title =
    app.tool?.title?.trim() || app.tool?.name?.trim() || app.toolName.trim();
  return title ? title.slice(0, MAX_INLINE_APP_TITLE_LENGTH) : undefined;
}

function getInlineAppForRun(
  summary: TraceSummary,
  threadData: string | null,
): AgentMcpAppPayload | null {
  return askAndAnswer(summary, threadData).inlineApp ?? null;
}

export async function getOutputReviewAppForRun(opts: {
  runId: string;
  orgId: string;
}): Promise<
  { found: false } | { found: true; app: AgentMcpAppPayload | null }
> {
  const summary = await getTraceSummary(opts.runId, { orgId: opts.orgId });
  if (!summary) return { found: false };
  if (!summary.threadId) return { found: true, app: null };

  if (!summary.userId) return { found: false };
  const threads = await getOrgScopedThreadData(opts.orgId, summary.userId, [
    summary.threadId,
  ]);
  const threadData = threads.get(summary.threadId);
  if (threadData === undefined) return { found: false };

  return {
    found: true,
    app: getInlineAppForRun(summary, threadData),
  };
}

export async function getOutputReviewDetailForRun(opts: {
  runId: string;
  orgId: string;
}): Promise<{ found: false } | ({ found: true } & OutputReviewDetail)> {
  const summary = await getTraceSummary(opts.runId, { orgId: opts.orgId });
  if (!summary) return { found: false };
  if (!summary.threadId) {
    return { found: true, app: null, messages: [] };
  }

  if (!summary.userId) return { found: false };
  const threads = await getOrgScopedThreadData(opts.orgId, summary.userId, [
    summary.threadId,
  ]);
  const threadData = threads.get(summary.threadId);
  if (threadData === undefined) return { found: false };

  const threadMessages = threadData
    ? readThreadMessages(threadData).filter(
        (message) => message.runId === summary.runId,
      )
    : [];
  return {
    found: true,
    app: getInlineAppForRun(summary, threadData),
    messages: threadMessages.map(({ role, text }) => ({ role, text })),
  };
}

export async function listOutputReviews(opts: {
  sinceMs: number;
  limit: number;
  orgId: string;
}): Promise<OutputReviewListRow[]> {
  const summaries = await getTraceSummaries({
    sinceMs: opts.sinceMs,
    limit: opts.limit,
    orgId: opts.orgId,
    excludeSpanName: "agent_run:observability:human-review-summary",
    requireReviewContext: true,
  });
  const [feedback, updates] = await Promise.all([
    getFeedback({
      sinceMs: opts.sinceMs,
      limit: opts.limit * 4,
      orgId: opts.orgId,
      runIds: summaries.map((summary) => summary.runId),
    }),
    getInstructionUpdates({
      sinceMs: opts.sinceMs,
      limit: opts.limit * 2,
      orgId: opts.orgId,
      runIds: summaries.map((summary) => summary.runId),
    }),
  ]);
  const updateByRun = new Map<string, InstructionUpdate>();
  for (const update of updates) {
    if (!updateByRun.has(update.runId)) updateByRun.set(update.runId, update);
  }

  const [threadRows, humanSummaries] = await Promise.all([
    getOrgScopedReviewThreads(
      opts.orgId,
      summaries.flatMap((summary) =>
        summary.userId && summary.threadId
          ? [{ ownerEmail: summary.userId, threadId: summary.threadId }]
          : [],
      ),
    ),
    getHumanReviewSummaries(
      opts.orgId,
      summaries.map((summary) => summary.runId),
    ),
  ]);
  const threads = new Map(
    [...threadRows].map(([id, thread]) => [id, thread.threadData]),
  );
  const titles = new Map(
    [...threadRows].flatMap(([id, thread]) =>
      thread.title?.trim() ? [[id, thread.title]] : [],
    ),
  );
  const visibleRunIds = new Set(summaries.map((summary) => summary.runId));
  const feedbackByRun = groupByRun(
    feedback.filter((entry) => entry.runId && visibleRunIds.has(entry.runId)),
  );

  return summaries
    .map((summary): OutputReviewListRow | null => {
      if (!summary.threadId) return null;
      const savedSummary = humanSummaries.get(summary.runId) ?? null;
      const threadData = summary.threadId
        ? (threads.get(summary.threadId) ?? undefined)
        : null;
      if (threadData === undefined && !savedSummary) return null;
      const { answer, inlineApp } = askAndAnswer(summary, threadData ?? null);
      const threadTitle = summary.threadId
        ? titles.get(summary.threadId)
        : undefined;
      const reviewSummary = savedSummary
        ? {
            ask: savedSummary.ask,
            outcome: savedSummary.outcome,
            artifacts: savedSummary.artifacts,
          }
        : null;
      if (!reviewSummary && !threadTitle?.trim()) return null;
      const ask = reviewSummary?.ask ?? threadTitle ?? "";
      const resolvedAnswer = reviewSummary?.outcome ?? answer;
      const title = inlineApp ? inlineAppTitle(inlineApp) : undefined;
      return {
        runId: summary.runId,
        threadId: summary.threadId,
        ask,
        answer: resolvedAnswer,
        hasInlineApp: Boolean(inlineApp),
        threadTitle: threadTitle ?? "",
        summary: reviewSummary,
        ...(title ? { inlineAppTitle: title } : {}),
        model: summary.model,
        createdAt: summary.createdAt,
        feedback: feedbackByRun.get(summary.runId) ?? [],
        instructionUpdate: updateByRun.get(summary.runId) ?? null,
      } satisfies OutputReviewListRow;
    })
    .filter((row): row is OutputReviewListRow => row !== null);
}

const MAX_SOURCE_MESSAGES = 40;
const MAX_SOURCE_TEXT = 500;
const MAX_THREAD_DATA_CHARS = 1_000_000;
const MAX_EVIDENCE_TEXT = 600;
const MAX_EVIDENCE_NODES_PER_SPAN = 80;
const MAX_EVIDENCE_CHARS_PER_SPAN = 2_400;
const OMITTED_EVIDENCE_FIELDS =
  /^(html|markup|content|body|blob|data|base64|image|screenshot|file|payload|thread_data|resource|source|raw|prompt|query|request|response|text|message|messages|document|code|description)$/i;
const REDACTED_EVIDENCE_FIELDS =
  /(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization|cookie|session|jwt|bearer)/i;
const SAFE_EVIDENCE_STRING_FIELDS =
  /^(?:id|artifact_?id|(?:design|slide|deck|presentation|chart|dashboard|analysis)_?id|app_?id|app|application|server_?id|tool_?name|title|name|path|route|type|kind|status|action|operation|slug)$/i;

function normalizedEvidenceKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isSensitiveEvidenceKey(key: string): boolean {
  return REDACTED_EVIDENCE_FIELDS.test(normalizedEvidenceKey(key));
}

function isSensitiveHeaderKey(key: string): boolean {
  return /^(?:authorization|cookie|setcookie)$/.test(
    normalizedEvidenceKey(key),
  );
}

function redactEvidenceString(value: string): string {
  const redacted = value
    .replace(/\bdata(?::|%3a)[^\s"'<>]*/gi, "[omitted data payload]")
    .replace(/\b[A-Za-z0-9+/]{128,}={0,2}\b/g, "[omitted encoded payload]")
    .replace(/<\/?(?:html|script|svg|iframe)\b[^>]*>/gi, "[omitted markup]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\b/g,
      "[REDACTED]",
    )
    .replace(/(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(
      /(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>#]*)#[^\s"'<>]*/gi,
      "$1#[REDACTED]",
    )
    .replace(/\bAIza[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bSG\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bsk-(?:proj|ant)-[A-Za-z0-9_-]{4,}\b/gi, "[REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{6,}\b/g, "[REDACTED]")
    .replace(
      /\b(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_-]{12,}\b/g,
      "[REDACTED]",
    )
    .replace(
      /(^|[^A-Za-z0-9])(["']?)([A-Za-z][A-Za-z0-9_-]*)(["']?\s*[:=]\s*)(["'])([^"'\r\n]*)\5/gi,
      (match, prefix, keyQuote, key, separator, valueQuote) =>
        isSensitiveEvidenceKey(key)
          ? `${prefix}${keyQuote}${key}${separator}${valueQuote}[REDACTED]${valueQuote}`
          : match,
    )
    .replace(
      /(^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)([^\s"'`][^\r\n,;}\]]*)/gi,
      (match, prefix, key, separator) =>
        isSensitiveHeaderKey(key)
          ? `${prefix}${key}${separator}[REDACTED]`
          : match,
    )
    .replace(
      /(^|[^A-Za-z0-9])(["']?)([A-Za-z][A-Za-z0-9_-]*)(["']?\s*[:=]\s*["']?)(?!\[REDACTED\])([^\s"'`,;}\]]+)/gi,
      (match, prefix, keyQuote, key, separator) =>
        isSensitiveEvidenceKey(key)
          ? `${prefix}${keyQuote}${key}${separator}[REDACTED]`
          : match,
    )
    .replace(
      /(^|[\r\n])([ \t]*(?:cookie|set-cookie)[ \t]*:[ \t]*)[^\r\n]*/gi,
      (_match, prefix, header) => `${prefix}${header}[REDACTED]`,
    )
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, rawKey) => {
      let key: string;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        return `${separator}${rawKey}=[REDACTED]`;
      }
      const normalizedKey = normalizedEvidenceKey(key);
      return /(?:token|secret|password|credential|signature|apikey|accesskey|privatekey|authorization|auth|cookie|session|jwt|bearer)/.test(
        normalizedKey,
      ) ||
        normalizedKey === "key" ||
        normalizedKey === "sig"
        ? `${separator}${rawKey}=[REDACTED]`
        : match;
    });
  return redacted.length > MAX_EVIDENCE_TEXT
    ? "[omitted long value]"
    : redacted;
}

function boundedEvidence(
  value: unknown,
  budget: { nodes: number; chars: number },
  depth = 0,
  key?: string,
): unknown {
  if (budget.nodes-- <= 0 || depth > 4) return "[omitted]";
  if (typeof value === "string") {
    if (!key) {
      if (value.length > budget.chars) return "[omitted]";
      const trimmed = value.trimStart();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return "[omitted]";
      }
      try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object"
          ? boundedEvidence(parsed, budget, depth + 1)
          : "[omitted]";
      } catch {
        return "[omitted]";
      }
    }
    if (!SAFE_EVIDENCE_STRING_FIELDS.test(key)) return "[omitted]";
    if (
      /^path$/i.test(key) &&
      /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value.trimStart())
    ) {
      return "[omitted]";
    }
    const safe = redactEvidenceString(value);
    budget.chars -= safe.length;
    return budget.chars < 0 ? "[omitted]" : safe;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return "[omitted]";
  if (Array.isArray(value))
    return value
      .slice(0, 20)
      .map((item) => boundedEvidence(item, budget, depth + 1, key));
  if (value && typeof value === "object") {
    const bounded: Record<string, unknown> = {};
    let entries = 0;
    for (const childKey in value) {
      if (!Object.hasOwn(value, childKey)) continue;
      if (entries++ >= 30) break;
      const item = (value as Record<string, unknown>)[childKey];
      bounded[childKey] = REDACTED_EVIDENCE_FIELDS.test(childKey)
        ? "[REDACTED]"
        : OMITTED_EVIDENCE_FIELDS.test(childKey)
          ? "[omitted]"
          : boundedEvidence(item, budget, depth + 1, childKey);
    }
    return bounded;
  }
  return undefined;
}

export async function getOutputReviewSummarySource(opts: {
  runId: string;
  orgId: string;
}): Promise<
  | { found: false }
  | {
      found: true;
      runId: string;
      threadTitle: string | null;
      threadEvidenceAvailable: boolean;
      messages: Array<{ role: "user" | "assistant"; text: string }>;
      toolEvidence: Array<{
        name: string;
        status: "success";
        input?: unknown;
        output?: unknown;
      }>;
      toolEvidenceAvailable: boolean;
    }
> {
  const summary = await getTraceSummary(opts.runId, { orgId: opts.orgId });
  if (!summary) return { found: false };
  let threadTitle: string | null = null;
  let threadEvidenceAvailable = false;
  let messages: Array<{ role: "user" | "assistant"; text: string }> = [];
  if (summary.threadId && summary.userId) {
    const [titles, threads] = await Promise.all([
      getOrgScopedThreadTitles(opts.orgId, summary.userId, [summary.threadId]),
      getOrgScopedThreadData(opts.orgId, summary.userId, [summary.threadId]),
    ]);
    const title = titles.get(summary.threadId) ?? null;
    threadTitle = title ? redactEvidenceString(title) : null;
    const threadData = threads.get(summary.threadId);
    if (threadData) {
      threadEvidenceAvailable = true;
      messages = readThreadMessages(threadData)
        .filter((message) => message.runId === summary.runId)
        .slice(-MAX_SOURCE_MESSAGES)
        .map(({ role, text }) => ({
          role,
          text: redactEvidenceString(text)
            .replace(
              /<\/?(?:html|script|svg|iframe)\b[^>]*>/gi,
              "[omitted markup]",
            )
            .slice(0, MAX_SOURCE_TEXT),
        }));
    }
  }
  const toolSpans = await getSuccessfulToolSpansForReview(
    opts.runId,
    opts.orgId,
    MAX_REVIEW_TOOL_SPANS,
  );
  const toolEvidence = toolSpans.flatMap((span) => {
    const metadata = record(span.metadata);
    const inputBudget = {
      nodes: MAX_EVIDENCE_NODES_PER_SPAN,
      chars: MAX_EVIDENCE_CHARS_PER_SPAN,
    };
    const outputBudget = {
      nodes: MAX_EVIDENCE_NODES_PER_SPAN,
      chars: MAX_EVIDENCE_CHARS_PER_SPAN,
    };
    const input =
      metadata && Object.hasOwn(metadata, "input")
        ? boundedEvidence(metadata.input, inputBudget)
        : undefined;
    const output =
      metadata && Object.hasOwn(metadata, "output")
        ? boundedEvidence(metadata.output, outputBudget)
        : undefined;
    if (input === undefined && output === undefined) return [];
    return [
      {
        name: span.name.slice(0, 160),
        status: "success" as const,
        ...(input === undefined ? {} : { input }),
        ...(output === undefined ? {} : { output }),
      },
    ];
  });
  return {
    found: true,
    runId: summary.runId,
    threadTitle,
    threadEvidenceAvailable,
    messages,
    toolEvidence,
    toolEvidenceAvailable: toolEvidence.length > 0,
  };
}

function groupByRun(entries: FeedbackEntry[]): Map<string, FeedbackEntry[]> {
  const grouped = new Map<string, FeedbackEntry[]>();
  for (const entry of entries) {
    if (!entry.runId) continue;
    const current = grouped.get(entry.runId) ?? [];
    current.push(entry);
    grouped.set(entry.runId, current);
  }
  return grouped;
}
