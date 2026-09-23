import { resolveThreadsAccess } from "../chat-threads/store.js";
import type { AgentMcpAppPayload } from "../mcp-client/app-result.js";
import {
  getFeedback,
  getInstructionUpdates,
  getTraceSummaries,
} from "./store.js";
import type {
  FeedbackEntry,
  InstructionUpdate,
  OutputReviewRow,
  TraceSummary,
} from "./types.js";

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

export async function listOutputReviews(opts: {
  sinceMs: number;
  limit: number;
  userId: string;
}): Promise<OutputReviewRow[]> {
  const summaries = await getTraceSummaries({
    sinceMs: opts.sinceMs,
    limit: opts.limit,
    userId: opts.userId,
  });
  const [feedback, updates] = await Promise.all([
    getFeedback({
      sinceMs: opts.sinceMs,
      limit: opts.limit * 4,
      userId: opts.userId,
    }),
    getInstructionUpdates({
      sinceMs: opts.sinceMs,
      limit: opts.limit * 2,
      userId: opts.userId,
    }),
  ]);
  const feedbackByRun = groupByRun(feedback);
  const updateByRun = new Map<string, InstructionUpdate>();
  for (const update of updates) {
    if (!updateByRun.has(update.runId)) updateByRun.set(update.runId, update);
  }

  const threadIds = summaries.flatMap((summary) =>
    summary.threadId ? [summary.threadId] : [],
  );
  const threads = await resolveThreadsAccess(opts.userId, threadIds);

  return summaries
    .map((summary) => {
      const thread = summary.threadId
        ? (threads.get(summary.threadId) ?? null)
        : null;
      if (summary.threadId && !thread) return null;
      const { ask, answer, inlineApp } = askAndAnswer(
        summary,
        thread?.threadData ?? null,
      );
      return {
        runId: summary.runId,
        threadId: summary.threadId,
        ask,
        answer,
        ...(inlineApp ? { inlineApp } : {}),
        model: summary.model,
        createdAt: summary.createdAt,
        feedback: feedbackByRun.get(summary.runId) ?? [],
        instructionUpdate: updateByRun.get(summary.runId) ?? null,
      } satisfies OutputReviewRow;
    })
    .filter((row): row is OutputReviewRow => row !== null);
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
