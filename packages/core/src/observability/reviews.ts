import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import { isEmailDerivedName } from "../user-profile/shared.js";
import { getUserProfiles } from "../user-profile/store.js";
import {
  getOrgScopedThreadData,
  getOrgScopedReviewThreads,
  getFeedback,
  getInstructionUpdates,
  getSuccessfulToolSpansForReview,
  MAX_REVIEW_TOOL_SPANS,
  getHumanReviewSummariesForThreads,
  getTraceSummary,
  getTraceSummaries,
  getRecentReviewRunsForThreads,
} from "./store.js";
import type {
  FeedbackEntry,
  HumanReviewArtifactRef,
  InstructionUpdate,
  ObservabilityReviewScope,
  ObservabilityReviewThreadScope,
  OutputReviewDetail,
  OutputReviewListRow,
  TraceSummary,
} from "./types.js";
import { observabilityReviewThreadKey } from "./types.js";

const MAX_INLINE_APP_TITLE_LENGTH = 120;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

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

type ParsedToolOutput =
  | { kind: "parsed"; output: Record<string, unknown> }
  | { kind: "unavailable" }
  | { kind: "malformed" };

function parseToolOutput(value: unknown): ParsedToolOutput {
  const directOutput = record(value);
  if (directOutput) return { kind: "parsed", output: directOutput };
  if (typeof value !== "string") return { kind: "unavailable" };
  if (value.length > MAX_THREAD_DATA_CHARS) return { kind: "malformed" };
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
    return { kind: "unavailable" };
  try {
    const parsed: unknown = JSON.parse(value);
    const output = record(parsed);
    return output ? { kind: "parsed", output } : { kind: "unavailable" };
  } catch {
    return { kind: "malformed" };
  }
}

interface ReviewToolCall {
  name: string;
  output?: Record<string, unknown>;
  outputMalformed?: true;
}

function toolOutputArtifacts(
  calls: readonly ReviewToolCall[],
): HumanReviewArtifactRef[] {
  const artifacts = new Map<string, HumanReviewArtifactRef>();
  for (const call of calls) {
    if (!call.output) continue;
    const name = call.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const output = call.output;
    let artifact: HumanReviewArtifactRef | undefined;
    if (/(?:^|_)(?:create|generate|edit|update)_design(?:_|$)/.test(name)) {
      if (output.renderable !== false) {
        const artifactId = output.designId ?? output.id;
        if (
          typeof artifactId === "string" &&
          ARTIFACT_ID_PATTERN.test(artifactId)
        ) {
          artifact = {
            appId: "design",
            artifactId,
            title:
              (typeof output.title === "string" && output.title.trim()) ||
              "Design",
            path: `/present/${encodeURIComponent(artifactId)}`,
          };
        }
      }
    } else if (
      /(?:^|_)(?:create|generate|update)_(?:deck|slides?)(?:_|$)/.test(name)
    ) {
      const artifactId = output.deckId ?? output.presentationId ?? output.id;
      if (
        typeof artifactId === "string" &&
        ARTIFACT_ID_PATTERN.test(artifactId)
      ) {
        artifact = {
          appId: "slides",
          artifactId,
          title:
            (typeof output.title === "string" && output.title.trim()) ||
            "Presentation",
          path: `/deck/${encodeURIComponent(artifactId)}/present`,
        };
      }
    } else if (/(?:^|_)(?:compose|create|update)_dashboard(?:_|$)/.test(name)) {
      const artifactId = output.dashboardId ?? output.id;
      if (
        typeof artifactId === "string" &&
        ARTIFACT_ID_PATTERN.test(artifactId)
      ) {
        artifact = {
          appId: "analytics",
          artifactId,
          title:
            (typeof output.name === "string" && output.name.trim()) ||
            (typeof output.title === "string" && output.title.trim()) ||
            "Dashboard",
          path: `/dashboards/${encodeURIComponent(artifactId)}`,
        };
      }
    } else if (/(?:^|_)generate_chart(?:_|$)/.test(name)) {
      const filename = output.filename;
      if (
        typeof filename === "string" &&
        ARTIFACT_ID_PATTERN.test(filename) &&
        /\.(?:png|svg)$/i.test(filename)
      ) {
        artifact = {
          appId: "analytics",
          artifactId: filename,
          title: filename,
          path: `/api/media/${encodeURIComponent(filename)}`,
        };
      }
    }
    if (artifact)
      artifacts.set(`${artifact.appId}:${artifact.artifactId}`, artifact);
  }
  return [...artifacts.values()];
}

function threadScopeArtifact(thread: {
  scopeType: string | null;
  scopeId: string | null;
  scopeLabel: string | null;
}): HumanReviewArtifactRef | undefined {
  const { scopeType, scopeId, scopeLabel } = thread;
  if (!scopeId || !ARTIFACT_ID_PATTERN.test(scopeId)) return undefined;
  const artifact = {
    design: {
      appId: "design",
      path: `/present/${encodeURIComponent(scopeId)}`,
      fallbackTitle: "Design",
    },
    deck: {
      appId: "slides",
      path: `/deck/${encodeURIComponent(scopeId)}/present`,
      fallbackTitle: "Presentation",
    },
    dashboard: {
      appId: "analytics",
      path: `/dashboards/${encodeURIComponent(scopeId)}`,
      fallbackTitle: "Dashboard",
    },
    analysis: {
      appId: "analytics",
      path: `/analyses/${encodeURIComponent(scopeId)}`,
      fallbackTitle: "Analysis",
    },
  }[scopeType ?? ""];
  if (!artifact) return undefined;
  return {
    appId: artifact.appId as HumanReviewArtifactRef["appId"],
    artifactId: scopeId,
    title: scopeLabel
      ? redactEvidenceString(scopeLabel)
      : artifact.fallbackTitle,
    path: artifact.path,
  };
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
  toolCalls: ReviewToolCall[];
}> {
  if (threadData.length > MAX_THREAD_DATA_CHARS) {
    throw new Error("Observability thread data exceeds the maximum size");
  }
  try {
    const repository = JSON.parse(threadData);
    const values: unknown[] = Array.isArray(repository?.messages)
      ? repository.messages
      : [];
    const parsedMessages = values.flatMap((value) => {
      const message = unwrapMessage(value);
      if (
        !message ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        return [];
      }
      const role: "user" | "assistant" = message.role;
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
      const toolCalls = Array.isArray(content)
        ? content.flatMap((part): Array<ReviewToolCall & { id?: string }> => {
            const tool = record(part);
            if (tool?.type !== "tool-call") return [];
            const name =
              typeof tool.toolName === "string"
                ? tool.toolName
                : typeof tool.name === "string"
                  ? tool.name
                  : undefined;
            if (!name) return [];
            const outputResult =
              tool.isError === true
                ? { kind: "unavailable" as const }
                : parseToolOutput(
                    tool.result ?? tool.resultText ?? tool.content,
                  );
            return [
              {
                name,
                ...(typeof tool.toolCallId === "string"
                  ? { id: tool.toolCallId }
                  : typeof tool.id === "string"
                    ? { id: tool.id }
                    : {}),
                ...(outputResult.kind === "parsed"
                  ? { output: outputResult.output }
                  : {}),
                ...(outputResult.kind === "malformed"
                  ? { outputMalformed: true as const }
                  : {}),
              },
            ];
          })
        : [];
      const hasToolResult =
        Array.isArray(content) &&
        content.some((part) => record(part)?.type === "tool-result");
      return text ||
        inlineApps.length > 0 ||
        toolCalls.length > 0 ||
        hasToolResult
        ? [
            {
              role,
              text,
              runId: messageRunId(message),
              inlineApps,
              toolCalls: toolCalls.map(({ name, output, outputMalformed }) => ({
                name,
                ...(output ? { output } : {}),
                ...(outputMalformed ? { outputMalformed } : {}),
              })),
              toolCallIds: toolCalls.flatMap((tool, index) =>
                tool.id ? [{ id: tool.id, index }] : [],
              ),
              contentParts: Array.isArray(content) ? content : [],
            },
          ]
        : [];
    });
    const toolCallsById = new Map<
      string,
      { message: (typeof parsedMessages)[number]; index: number }
    >();
    parsedMessages.forEach((message) => {
      message.toolCallIds.forEach(({ id, index }) => {
        toolCallsById.set(id, { message, index });
      });
    });
    for (const message of parsedMessages) {
      for (const part of message.contentParts) {
        const tool = record(part);
        if (tool?.type !== "tool-result" || tool.isError === true) continue;
        const callId = tool.toolCallId;
        if (typeof callId !== "string") continue;
        const matched = toolCallsById.get(callId);
        if (!matched || matched.message.toolCalls[matched.index]?.output) {
          continue;
        }
        const outputResult = parseToolOutput(
          tool.result ?? tool.resultText ?? tool.content,
        );
        if (outputResult.kind === "parsed")
          matched.message.toolCalls[matched.index] = {
            ...matched.message.toolCalls[matched.index]!,
            output: outputResult.output,
          };
        else if (outputResult.kind === "malformed")
          matched.message.toolCalls[matched.index] = {
            ...matched.message.toolCalls[matched.index]!,
            outputMalformed: true,
          };
      }
    }
    return parsedMessages
      .filter(
        (message) =>
          message.text ||
          message.inlineApps.length > 0 ||
          message.toolCalls.length > 0,
      )
      .map(
        ({ toolCallIds: _ids, contentParts: _parts, ...message }) => message,
      );
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
  let answerIndex = -1;
  for (let index = resolvedAskIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "user") break;
    if (
      message.role === "assistant" &&
      message.text &&
      (message.runId === summary.runId || !message.runId)
    ) {
      answerIndex = index;
    }
  }
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
    return {
      found: true,
      runId: summary.runId,
      orgId: opts.orgId,
      app: null,
      messages: [],
      artifacts: [],
      summary: null,
      ask: "",
      answer: "",
    };
  }

  if (!summary.userId) return { found: false };
  const threadKey = observabilityReviewThreadKey(opts.orgId, summary.threadId);
  const threads = await getOrgScopedReviewThreads([
    {
      orgId: opts.orgId,
      ownerEmail: summary.userId,
      threadId: summary.threadId,
    },
  ]);
  const thread = threads.get(threadKey);
  if (!thread) return { found: false };
  const threadData = thread.threadData;

  const threadMessages = threadData ? readThreadMessages(threadData) : [];
  const messageRunIds = new Set(
    threadMessages.flatMap((message) => (message.runId ? [message.runId] : [])),
  );
  const runMessages = messageRunIds.has(summary.runId)
    ? threadMessages.filter((message) => message.runId === summary.runId)
    : messageRunIds.size === 0
      ? threadMessages
      : [];
  const artifacts = [
    threadScopeArtifact(thread),
    ...toolOutputArtifacts(runMessages.flatMap((message) => message.toolCalls)),
  ].filter((artifact): artifact is HumanReviewArtifactRef => Boolean(artifact));
  const savedSummaries = await getHumanReviewSummariesForThreads([
    { orgId: opts.orgId, threadId: summary.threadId },
  ]);
  const savedSummary = savedSummaries.get(threadKey);
  const { ask, answer } = askAndAnswer(summary, threadData);
  return {
    found: true,
    runId: summary.runId,
    orgId: opts.orgId,
    app: getInlineAppForRun(summary, threadData),
    artifacts: [...artifacts, ...(savedSummary?.artifacts ?? [])].filter(
      (artifact, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.appId === artifact.appId &&
            candidate.artifactId === artifact.artifactId,
        ) === index,
    ),
    summary: savedSummary
      ? {
          ask: savedSummary.ask,
          outcome: savedSummary.outcome,
          artifacts: savedSummary.artifacts,
        }
      : null,
    ask,
    answer,
    messages: runMessages.map(({ role, text, toolCalls }) => ({
      role,
      text,
      ...(toolCalls.length > 0
        ? {
            toolCalls: toolCalls.map((tool) =>
              /^[A-Za-z0-9_.:-]{1,80}$/.test(tool.name) ? tool.name : "tool",
            ),
          }
        : {}),
    })),
  };
}

export async function listOutputReviews(opts: {
  sinceMs: number;
  limit: number;
  scope?: ObservabilityReviewScope;
  orgId?: string;
}): Promise<OutputReviewListRow[]> {
  const scope =
    opts.scope ??
    (opts.orgId ? { kind: "organization" as const, orgId: opts.orgId } : null);
  if (!scope) throw new Error("An authorized review scope is required.");
  const orgId = scope.kind === "organization" ? scope.orgId : undefined;
  const summaries = await getTraceSummaries({
    sinceMs: opts.sinceMs,
    limit: opts.limit,
    orgId,
    excludeSpanName: "agent_run:observability:human-review-summary",
    requireReviewContext: true,
  });
  const threadScopes: ObservabilityReviewThreadScope[] = summaries.flatMap(
    (summary) =>
      summary.orgId && summary.threadId
        ? [{ orgId: summary.orgId, threadId: summary.threadId }]
        : [],
  );
  const threadScopesWithOwner = summaries.flatMap((summary) =>
    summary.orgId && summary.userId && summary.threadId
      ? [
          {
            orgId: summary.orgId,
            ownerEmail: summary.userId,
            threadId: summary.threadId,
          },
        ]
      : [],
  );
  const [feedback, updates] = await Promise.all([
    getFeedback({
      sinceMs: opts.sinceMs,
      limit: opts.limit * 4,
      ...(orgId ? { orgId } : {}),
      threadScopes,
    }),
    getInstructionUpdates({
      sinceMs: opts.sinceMs,
      perThreadLimit: 1,
      ...(orgId ? { orgId } : {}),
      threadScopes,
    }),
  ]);
  const updateByThread = new Map<string, InstructionUpdate>();
  for (const update of updates) {
    if (update.orgId && update.threadId) {
      const key = observabilityReviewThreadKey(update.orgId, update.threadId);
      if (!updateByThread.has(key)) updateByThread.set(key, update);
    }
  }

  const [threadRows, humanSummaries] = await Promise.all([
    getOrgScopedReviewThreads(threadScopesWithOwner),
    getHumanReviewSummariesForThreads(threadScopes),
  ]);
  const reviewRuns = await getRecentReviewRunsForThreads({
    threadScopes,
    sinceMs: opts.sinceMs,
    perThreadLimit: 6,
  });
  const runsByThread = new Map<string, TraceSummary[]>();
  for (const run of reviewRuns) {
    if (!run.orgId || !run.threadId) continue;
    const key = observabilityReviewThreadKey(run.orgId, run.threadId);
    const runs = runsByThread.get(key) ?? [];
    runs.push(run);
    runsByThread.set(key, runs);
  }
  const threads = new Map(
    [...threadRows].map(([key, thread]) => [key, thread.threadData]),
  );
  const profiles = await getUserProfiles(
    [...threadRows.values()].map((thread) => thread.ownerEmail),
  );
  const titles = new Map(
    [...threadRows].flatMap(([key, thread]) =>
      thread.title?.trim() ? [[key, thread.title]] : [],
    ),
  );
  const feedbackByThread = groupByThread(feedback);

  return summaries
    .map((summary): OutputReviewListRow | null => {
      if (!summary.orgId || !summary.threadId) return null;
      const key = observabilityReviewThreadKey(summary.orgId, summary.threadId);
      if (!threadRows.has(key)) return null;
      const savedSummary = humanSummaries.get(key) ?? null;
      const threadData = threads.get(key) ?? undefined;
      if (threadData === undefined && !savedSummary) return null;
      const { answer, inlineApp } = askAndAnswer(summary, threadData ?? null);
      const messages = threadData ? readThreadMessages(threadData) : [];
      const threadTitle = titles.get(key);
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
      const title = [...messages]
        .reverse()
        .flatMap((message) => message.inlineApps)
        .map(inlineAppTitle)
        .find((value): value is string => Boolean(value));
      const author = threadRows.get(key)?.ownerEmail;
      const profile = author ? profiles.get(author.toLowerCase()) : undefined;
      const authorName =
        profile && !isEmailDerivedName(profile.name, profile.email)
          ? profile.name.trim().split(/\s+/)[0]
          : undefined;
      const thread = threadRows.get(key);
      const messageRunIds = new Set(
        messages.flatMap((message) => (message.runId ? [message.runId] : [])),
      );
      const runMessages = messageRunIds.has(summary.runId)
        ? messages.filter((message) => message.runId === summary.runId)
        : messageRunIds.size === 0
          ? messages
          : [];
      const artifacts = [
        ...(reviewSummary?.artifacts ?? []),
        ...(thread ? [threadScopeArtifact(thread)] : []),
        ...toolOutputArtifacts(
          runMessages.flatMap((message) => message.toolCalls),
        ),
      ].filter((artifact, index, all): artifact is HumanReviewArtifactRef => {
        if (!artifact) return false;
        return (
          all.findIndex(
            (candidate) =>
              candidate?.appId === artifact.appId &&
              candidate?.artifactId === artifact.artifactId,
          ) === index
        );
      });
      return {
        runId: summary.runId,
        orgId: summary.orgId,
        readOnly: scope.kind === "all" && summary.orgId !== scope.activeOrgId,
        threadId: summary.threadId,
        ask,
        answer: resolvedAnswer,
        hasInlineApp: Boolean(inlineApp),
        threadTitle: threadTitle ?? "",
        summary: reviewSummary,
        artifacts,
        runs: (runsByThread.get(key) ?? [summary]).map((run) => ({
          runId: run.runId,
          model: run.model,
          createdAt: run.createdAt,
        })),
        runCount: summary.runCount ?? 1,
        ...(authorName ? { authorName } : {}),
        ...(profile?.image ? { authorAvatar: profile.image } : {}),
        ...(title ? { inlineAppTitle: title } : {}),
        model: summary.model,
        createdAt: summary.createdAt,
        feedback: feedbackByThread.get(key) ?? [],
        instructionUpdate: updateByThread.get(key) ?? null,
      } satisfies OutputReviewListRow;
    })
    .filter((row): row is OutputReviewListRow => row !== null);
}

const MAX_SOURCE_MESSAGES = 40;
const MAX_SOURCE_TEXT = 500;
const MAX_FIRST_ASK_TEXT = 2_000;
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
  if (typeof value === "boolean") {
    return key === "renderable" ? value : "[omitted]";
  }
  if (value === null || typeof value === "number") return "[omitted]";
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
      attachedArtifacts: HumanReviewArtifactRef[];
      threadEvidenceAvailable: boolean;
      messages: Array<{ role: "user" | "assistant"; text: string }>;
      toolEvidence: Array<{
        name: string;
        status: "success";
        input?: unknown;
        output?: unknown;
      }>;
      toolEvidenceAvailable: boolean;
      malformedThreadToolOutput: boolean;
    }
> {
  const summary = await getTraceSummary(opts.runId, { orgId: opts.orgId });
  if (!summary) return { found: false };
  let threadTitle: string | null = null;
  let attachedArtifacts: HumanReviewArtifactRef[] = [];
  let threadEvidenceAvailable = false;
  let messages: Array<{ role: "user" | "assistant"; text: string }> = [];
  let threadToolEvidence: Array<{
    name: string;
    status: "success";
    output: unknown;
  }> = [];
  let malformedThreadToolOutput = false;
  if (summary.threadId && summary.userId) {
    const threadKey = observabilityReviewThreadKey(
      opts.orgId,
      summary.threadId,
    );
    const threads = await getOrgScopedReviewThreads([
      {
        orgId: opts.orgId,
        ownerEmail: summary.userId,
        threadId: summary.threadId,
      },
    ]);
    const thread = threads.get(threadKey);
    const title = thread?.title ?? null;
    threadTitle = title ? redactEvidenceString(title) : null;
    attachedArtifacts = thread
      ? [threadScopeArtifact(thread)].filter(
          (artifact): artifact is HumanReviewArtifactRef => Boolean(artifact),
        )
      : [];
    const threadData = thread?.threadData;
    if (threadData) {
      threadEvidenceAvailable = true;
      const threadMessages = readThreadMessages(threadData);
      const firstAsk = threadMessages.find(
        (message) => message.role === "user",
      );
      const messageRunIds = new Set(
        threadMessages.flatMap((message) =>
          message.runId ? [message.runId] : [],
        ),
      );
      const runMessages = messageRunIds.has(opts.runId)
        ? threadMessages.filter((message) => message.runId === opts.runId)
        : messageRunIds.size === 0
          ? threadMessages
          : [];
      malformedThreadToolOutput = runMessages.some((message) =>
        message.toolCalls.some((call) => call.outputMalformed),
      );
      const recentMessages = threadMessages.slice(
        -(MAX_SOURCE_MESSAGES - (firstAsk ? 1 : 0)),
      );
      const retained = firstAsk
        ? [
            firstAsk,
            ...recentMessages.filter((message) => message !== firstAsk),
          ]
        : recentMessages;
      messages = retained.map(({ role, text }) => ({
        role,
        text: redactEvidenceString(text)
          .replace(
            /<\/?(?:html|script|svg|iframe)\b[^>]*>/gi,
            "[omitted markup]",
          )
          .slice(
            0,
            firstAsk && text === firstAsk.text
              ? MAX_FIRST_ASK_TEXT
              : MAX_SOURCE_TEXT,
          ),
      }));
      threadToolEvidence = runMessages
        .flatMap((message) => message.toolCalls)
        .filter(
          (
            call,
          ): call is ReviewToolCall & { output: Record<string, unknown> } =>
            Boolean(call.output),
        )
        .slice(-MAX_REVIEW_TOOL_SPANS)
        .flatMap((call) => {
          const output = boundedEvidence(call.output, {
            nodes: MAX_EVIDENCE_NODES_PER_SPAN,
            chars: MAX_EVIDENCE_CHARS_PER_SPAN,
          });
          return output === undefined
            ? []
            : [
                {
                  name: call.name.slice(0, 160),
                  status: "success" as const,
                  output,
                },
              ];
        });
    }
  }
  const toolSpans =
    threadToolEvidence.length > 0
      ? []
      : await getSuccessfulToolSpansForReview(
          opts.runId,
          opts.orgId,
          MAX_REVIEW_TOOL_SPANS,
        );
  const spanEvidence = toolSpans.flatMap((span) => {
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
  const toolEvidence =
    threadToolEvidence.length > 0 ? threadToolEvidence : spanEvidence;
  return {
    found: true,
    runId: summary.runId,
    threadTitle,
    attachedArtifacts,
    threadEvidenceAvailable,
    messages,
    toolEvidence,
    toolEvidenceAvailable: toolEvidence.length > 0,
    malformedThreadToolOutput,
  };
}

function groupByThread(entries: FeedbackEntry[]): Map<string, FeedbackEntry[]> {
  const grouped = new Map<string, FeedbackEntry[]>();
  for (const entry of entries) {
    if (!entry.orgId || !entry.threadId) continue;
    const key = observabilityReviewThreadKey(entry.orgId, entry.threadId);
    const current = grouped.get(key) ?? [];
    current.push(entry);
    grouped.set(key, current);
  }
  return grouped;
}
