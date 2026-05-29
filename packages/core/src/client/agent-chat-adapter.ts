import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import {
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
} from "./active-run-state.js";
import {
  AgentAutoContinueSignal,
  type AgentActivityTrailEntry,
  type ContentPart,
  readSSEStream,
} from "./sse-event-processor.js";
import { agentNativePath } from "./api-path.js";
import { formatChatErrorText, normalizeChatError } from "./error-format.js";
import { captureError } from "./analytics.js";
import { unwrapAttachmentEnvelope } from "./composer/pasted-text.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import type {
  AgentChatStructuredContentPart,
  AgentChatStructuredMessage,
} from "../agent/types.js";
import type { ChatThreadScope } from "./use-chat-threads.js";

export type AgentChatSurfaceKind =
  /**
   * Chat rendered by the app itself, including the normal AgentSidebar. This
   * surface must not receive code-editing dev tools because source edits can
   * reload the same React tree that is hosting the chat.
   */
  | "app"
  /** Chat rendered by the outer local dev frame, outside the app iframe. */
  | "dev-frame";

type AdapterHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantUiAttachment = {
  name: string;
  contentType?: string;
  content: readonly Record<string, unknown>[];
};

type AgentChatAdapterAttachment = {
  type: string;
  name: string;
  contentType?: string;
  data?: string;
  text?: string;
};

const TEXT_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "text/csv",
  "text/css",
  "text/html",
  "text/json",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

const AUTO_CONTINUE_PROMPT =
  "Continue from where you left off and finish the user's original request. Do not repeat completed work, do not mention internal reconnects, time limits, or step limits, and continue as if this is the same uninterrupted run.";
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_STARTUP_RECOVERY_ATTEMPTS = 8;
const MAX_STALE_RUN_CONTINUATIONS = 3;
const MAX_STALLED_TRANSIENT_CONTINUATIONS = 8;
const MAX_TOTAL_TRANSIENT_CONTINUATIONS = 32;
const MAX_EMPTY_TRANSIENT_CONTINUATIONS = 1;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
const MAX_HISTORY_ATTACHMENT_CHARS = 60_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_TOTAL_CHARS = 64_000;
const MAX_HISTORY_MESSAGE_CHARS = 12_000;
const MAX_HISTORY_TOOL_ARGS_CHARS = 8_000;
const MAX_HISTORY_TOOL_RESULT_CHARS = 12_000;
const STARTUP_RESPONSE_TIMEOUT_MS = 45_000;

function normalizeMentions(text: string): string {
  return text.replace(/@\[([^\]|]+)\|[^\]]+\]/g, "@$1");
}

function truncateForContinuation(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n...[truncated ${value.length - maxChars} chars from prior partial output]`;
}

function truncateForHistory(
  value: string,
  maxChars: number,
  label: string,
): string {
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n\n[${label} truncated after ${maxChars.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from prior chat history. Read the current app/resource state with tools if exact content is needed.]`;
}

function contentToContinuationHistory(content: ContentPart[]): string {
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text.trim()) chunks.push(part.text.trim());
      continue;
    }
    const toolSummary = [
      `Tool: ${part.toolName}`,
      part.argsText ? `Input: ${part.argsText}` : "",
      part.result
        ? `Result:\n${truncateForContinuation(part.result, 8_000)}`
        : "Result: interrupted before this tool returned a result",
    ]
      .filter(Boolean)
      .join("\n");
    chunks.push(toolSummary);
  }
  return truncateForContinuation(chunks.join("\n\n"), 40_000).trim();
}

function messageTextFromContent(
  content: readonly { type: string; text?: string }[],
): string {
  return truncateForHistory(
    content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => normalizeMentions(p.text))
      .join("\n"),
    MAX_HISTORY_MESSAGE_CHARS,
    "Message",
  );
}

function truncateToolArgsForHistory(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  try {
    const json = JSON.stringify(args);
    if (json.length <= MAX_HISTORY_TOOL_ARGS_CHARS) {
      return args as Record<string, unknown>;
    }
    return {
      __agentNativeTruncated: true,
      note: "Tool input was too large to resend in chat history. Use the current app/resource state as the source of truth if exact content is needed.",
      preview: truncateForHistory(
        json,
        MAX_HISTORY_TOOL_ARGS_CHARS,
        "Tool input",
      ),
    };
  } catch {
    return {
      __agentNativeTruncated: true,
      note: "Tool input could not be serialized for prior chat history.",
    };
  }
}

function messageTextFromContentRaw(
  content: readonly { type: string; text?: string }[],
): string {
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => normalizeMentions(p.text))
    .join("\n");
}

function escapeAttachmentAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isTextAttachmentContentType(value: string | undefined): boolean {
  if (!value) return false;
  const contentType = value.split(";")[0]?.trim().toLowerCase();
  return (
    !!contentType &&
    (contentType.startsWith("text/") ||
      TEXT_ATTACHMENT_CONTENT_TYPES.has(contentType))
  );
}

function decodeTextDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(
    /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/i,
  );
  if (!match || !isTextAttachmentContentType(match[1])) return null;

  try {
    const payload = match[3] ?? "";
    if (match[2]) {
      if (typeof atob === "function") {
        return decodeURIComponent(
          Array.from(
            atob(payload),
            (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
          ).join(""),
        );
      }
      return null;
    }
    return decodeURIComponent(payload.replace(/\+/g, "%20"));
  } catch {
    return null;
  }
}

function extractAttachmentsFromMessage(message: {
  content?: readonly { type: string; image?: string }[];
  attachments?: readonly AssistantUiAttachment[];
}): AgentChatAdapterAttachment[] {
  const attachments: AgentChatAdapterAttachment[] = [];
  for (const att of message.attachments ?? []) {
    for (const part of att.content) {
      if (part.type === "image" && typeof part.image === "string") {
        attachments.push({
          type: "image",
          name: att.name,
          contentType: att.contentType,
          data: part.image,
        });
      } else if (part.type === "file" && typeof part.data === "string") {
        const contentType =
          att.contentType ??
          (typeof part.mimeType === "string" ? part.mimeType : undefined);
        const decodedText = part.data.startsWith("data:")
          ? decodeTextDataUrl(part.data)
          : null;
        attachments.push({
          type: "file",
          name: att.name,
          contentType,
          ...(decodedText !== null
            ? { text: truncateOutboundAttachment(decodedText) }
            : part.data.startsWith("data:")
              ? { data: part.data }
              : { text: truncateOutboundAttachment(part.data) }),
        });
      } else if (part.type === "text" && typeof part.text === "string") {
        attachments.push({
          type: "file",
          name: att.name,
          contentType: att.contentType,
          text: truncateOutboundAttachment(unwrapAttachmentEnvelope(part.text)),
        });
      }
    }
  }
  for (const part of message.content ?? []) {
    if (part.type === "image" && typeof part.image === "string") {
      attachments.push({
        type: "image",
        name: "image",
        contentType: /^data:([^;,]+)/.exec(part.image)?.[1],
        data: part.image,
      });
    }
  }
  return attachments;
}

function truncateHistoryAttachment(text: string): string {
  if (text.length <= MAX_HISTORY_ATTACHMENT_CHARS) return text;
  const omitted = text.length - MAX_HISTORY_ATTACHMENT_CHARS;
  return `${text.slice(0, MAX_HISTORY_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_HISTORY_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from prior chat history.]`;
}

function truncateOutboundAttachment(text: string): string {
  if (text.length <= MAX_HISTORY_ATTACHMENT_CHARS) return text;
  const omitted = text.length - MAX_HISTORY_ATTACHMENT_CHARS;
  return `${text.slice(0, MAX_HISTORY_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_HISTORY_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from the submitted attachment.]`;
}

function attachmentHistoryText(
  attachment: AgentChatAdapterAttachment,
): string | null {
  if (typeof attachment.text === "string" && attachment.text.length > 0) {
    const attrs = [
      `name="${escapeAttachmentAttribute(attachment.name || "attachment")}"`,
      attachment.contentType
        ? `contentType="${escapeAttachmentAttribute(attachment.contentType)}"`
        : null,
      attachment.type
        ? `type="${escapeAttachmentAttribute(attachment.type)}"`
        : null,
    ].filter(Boolean);
    return `<attachment ${attrs.join(" ")}>\n${truncateHistoryAttachment(attachment.text)}\n</attachment>`;
  }

  if (attachment.name) {
    return `[Attached ${attachment.type || "file"}: ${attachment.name}${attachment.contentType ? ` (${attachment.contentType})` : ""}]`;
  }
  return null;
}

function messageTextForHistory(message: {
  content: readonly { type: string; text?: string }[];
  attachments?: readonly AssistantUiAttachment[];
}): string {
  const text = messageTextFromContentRaw(message.content);
  const attachments = extractAttachmentsFromMessage(message)
    .map(attachmentHistoryText)
    .filter((part): part is string => !!part && part.trim().length > 0);
  return truncateForHistory(
    [text, ...attachments].filter((part) => part.trim()).join("\n\n"),
    MAX_HISTORY_MESSAGE_CHARS,
    "Message",
  );
}

type AdapterMessage = {
  role: string;
  content: readonly { type: string; text?: string }[];
  attachments?: readonly AssistantUiAttachment[];
  metadata?: unknown;
};

const RECOVERY_USER_MESSAGE_PREFIXES = [
  "Continue from where you left off",
  "Continue from where you stopped",
  "Retry the previous request from a clean approach",
];

function recoveryActionFromMessage(
  message: unknown,
): "continue" | "retry" | null {
  const meta = (message as { metadata?: unknown })?.metadata as
    | { custom?: { agentNativeRecoveryAction?: unknown } }
    | undefined;
  const action = meta?.custom?.agentNativeRecoveryAction;
  return action === "continue" || action === "retry" ? action : null;
}

function isRecoveryUserMessage(message: AdapterMessage): boolean {
  if (recoveryActionFromMessage(message)) return true;
  const text = messageTextFromContentRaw(message.content).trim();
  return RECOVERY_USER_MESSAGE_PREFIXES.some((prefix) =>
    text.startsWith(prefix),
  );
}

function latestUserMessage(
  messages: readonly AdapterMessage[],
  options?: { skipRecovery?: boolean; beforeIndex?: number },
): AdapterMessage | undefined {
  const start =
    typeof options?.beforeIndex === "number"
      ? Math.min(options.beforeIndex, messages.length)
      : messages.length;
  for (let i = start - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (options?.skipRecovery && isRecoveryUserMessage(message)) continue;
    return message;
  }
  return undefined;
}

function isToolCallContentPart(
  part: unknown,
): part is Extract<ContentPart, { type: "tool-call" }> {
  return Boolean(
    part && typeof part === "object" && (part as any).type === "tool-call",
  );
}

function toolResultContent(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result ?? "");
  }
}

function contentToStructuredMessages(
  content: readonly ContentPart[],
  nextToolCallId: () => string,
  options?: { truncateForHistory?: boolean },
): AgentChatStructuredMessage[] {
  const messages: AgentChatStructuredMessage[] = [];
  let assistantParts: AgentChatStructuredContentPart[] = [];
  let pendingToolResults: AgentChatStructuredContentPart[] = [];
  const truncate = options?.truncateForHistory === true;

  const flushToolTurn = () => {
    if (pendingToolResults.length === 0) return;
    if (assistantParts.length > 0) {
      messages.push({ role: "assistant", content: assistantParts });
    }
    messages.push({ role: "user", content: pendingToolResults });
    assistantParts = [];
    pendingToolResults = [];
  };

  for (const part of content) {
    if (part.type === "text") {
      if (pendingToolResults.length > 0) flushToolTurn();
      if (part.text.trim()) {
        assistantParts.push({
          type: "text",
          text: truncate
            ? truncateForHistory(
                part.text,
                MAX_HISTORY_MESSAGE_CHARS,
                "Assistant text",
              )
            : part.text,
        });
      }
      continue;
    }

    if (isToolCallContentPart(part)) {
      const toolCallId = nextToolCallId();
      assistantParts.push({
        type: "tool-call",
        toolCallId,
        toolName: part.toolName,
        args: truncate
          ? truncateToolArgsForHistory(part.args ?? {})
          : (part.args ?? {}),
      });
      if (part.result !== undefined) {
        pendingToolResults.push({
          type: "tool-result",
          toolCallId,
          toolName: part.toolName,
          toolInput: JSON.stringify(part.args ?? {}),
          content: truncate
            ? truncateForHistory(
                toolResultContent(part.result),
                MAX_HISTORY_TOOL_RESULT_CHARS,
                "Tool result",
              )
            : toolResultContent(part.result),
        });
      } else {
        pendingToolResults.push({
          type: "tool-result",
          toolCallId,
          toolName: part.toolName,
          toolInput: JSON.stringify(part.args ?? {}),
          content: "Interrupted before this tool returned a result.",
        });
      }
    }
  }

  flushToolTurn();
  if (assistantParts.length > 0) {
    messages.push({ role: "assistant", content: assistantParts });
  }
  return messages;
}

function assistantUiMessagesToStructuredHistory(
  messages: readonly {
    role: string;
    content: readonly any[];
    attachments?: readonly AssistantUiAttachment[];
  }[],
): AgentChatStructuredMessage[] {
  let nextId = 0;
  const nextToolCallId = () => `history_tc_${++nextId}`;
  const structured: AgentChatStructuredMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = messageTextForHistory(message);
      if (text.trim()) {
        structured.push({
          role: "user",
          content: [{ type: "text", text }],
        });
      }
      continue;
    }

    if (message.role !== "assistant") continue;
    const content: ContentPart[] = [];
    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string") {
        content.push({ type: "text", text: part.text });
        continue;
      }
      if (part?.type === "tool-call") {
        const toolNameRaw =
          typeof part.toolName === "string"
            ? part.toolName
            : typeof (part as { name?: string }).name === "string"
              ? (part as { name?: string }).name
              : "";
        const toolName = toolNameRaw.trim();
        if (!toolName) continue;
        content.push({
          type: "tool-call",
          toolCallId:
            typeof part.toolCallId === "string" ? part.toolCallId : "",
          toolName,
          argsText:
            typeof part.argsText === "string"
              ? part.argsText
              : JSON.stringify(part.args ?? {}),
          args:
            part.args &&
            typeof part.args === "object" &&
            !Array.isArray(part.args)
              ? part.args
              : {},
          ...(part.result !== undefined
            ? { result: toolResultContent(part.result) }
            : {}),
        });
      }
    }
    structured.push(
      ...contentToStructuredMessages(content, nextToolCallId, {
        truncateForHistory: true,
      }),
    );
  }

  return structured;
}

function estimateHistoryMessageCost(message: {
  content: readonly { type: string; text?: string }[];
  attachments?: readonly AssistantUiAttachment[];
}): number {
  return Math.max(1, messageTextForHistory(message).length);
}

function limitPriorMessagesForRequest<
  T extends {
    role: string;
    content: readonly { type: string; text?: string }[];
    attachments?: readonly AssistantUiAttachment[];
  },
>(messages: readonly T[]): T[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  const kept: T[] = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i];
    if (message.role !== "user" && message.role !== "assistant") continue;
    const cost = estimateHistoryMessageCost(message);
    if (kept.length > 0 && totalChars + cost > MAX_HISTORY_TOTAL_CHARS) {
      break;
    }
    kept.push(message);
    totalChars += cost;
  }

  kept.reverse();
  while (kept.length > 0 && kept[0].role !== "user") {
    kept.shift();
  }
  return kept;
}

function combineContinuationHistory(fragments: string[]): string {
  return truncateForContinuation(
    fragments.filter(Boolean).join("\n\n"),
    40_000,
  ).trim();
}

function visibleTransientContinuationContent(
  content: ContentPart[],
): ContentPart[] {
  // NOTE: this intentionally keeps ONLY completed tool calls, dropping
  // already-streamed text, on a transient continuation. Preserving the text
  // here is desirable (it's the live "paragraphs disappear" flicker) BUT it
  // breaks visibleContentForContinuation's part-count prefix slicing: the
  // resumed run's text concatenates into the preserved trailing text part, so
  // the "new chunk" reads as empty and the empty-continuation cap gives up
  // prematurely on text-heavy multi-continuation turns. The durable fix
  // (server-side foldAssistantTurn) already preserves the text in thread_data,
  // so no data is lost — only the live render flickers. Fixing the flicker
  // safely requires reworking the prefix/new-chunk detection to diff by text
  // length rather than part count; see the agent-run reliability follow-up.
  return content.filter(
    (part) => part.type === "tool-call" && part.result !== undefined,
  );
}

function hasContinuationProgress(content: ContentPart[]): boolean {
  return content.some((part) =>
    part.type === "text"
      ? part.text.trim().length > 0
      : part.result !== undefined,
  );
}

function lastActivityTool(
  trail: readonly AgentActivityTrailEntry[],
): string | undefined {
  for (let i = trail.length - 1; i >= 0; i--) {
    const tool = trail[i]?.tool?.trim();
    if (tool) return tool;
  }
  return undefined;
}

function snapshotContent(content: ContentPart[]): ContentPart[] {
  return content.map((part) =>
    part.type === "text" ? { ...part } : { ...part, args: { ...part.args } },
  );
}

function autoContinueMessage(signal: AgentAutoContinueSignal): string {
  const tool = lastActivityTool(signal.activityTrail);
  const reason =
    signal.reason === "loop_limit"
      ? "The previous run reached an internal step budget."
      : signal.reason === "stale_run"
        ? "The previous run stopped unexpectedly in the server runtime before it could finish."
        : signal.reason === "no_progress"
          ? "The previous run stopped producing progress events while the connection stayed open."
          : signal.reason === "stream_ended"
            ? "The previous stream ended before the agent sent a final completion signal."
            : "The previous run reached an internal execution budget.";
  const actionInputNote =
    signal.reason === "run_timeout" && tool
      ? `\n\nThe previous run timed out while preparing the \`${tool}\` action input before the action could run. Avoid spending another whole run assembling one large tool payload. If this is \`create-extension\`, create a compact working v1 first, then use focused \`update-extension\` edits for refinements.`
      : "";
  return `${AUTO_CONTINUE_PROMPT}\n\nInternal note: ${reason}${actionInputNote}`;
}

function delay(ms: number, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

class AgentStartupTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Agent chat did not start streaming within ${Math.round(timeoutMs / 1000)}s.`,
    );
    this.name = "AgentStartupTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

async function fetchWithStartupTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  abortSignal: AbortSignal,
): Promise<Response> {
  if (abortSignal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  abortSignal.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new AgentStartupTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    abortSignal.removeEventListener("abort", abort);
  }
}

function retryDelay(attempt: number, abortSignal: AbortSignal): Promise<void> {
  const base = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
  );
  const jitter = base * 0.2;
  const ms = Math.max(0, base + (Math.random() * 2 - 1) * jitter);
  return delay(ms, abortSignal);
}

function generateTurnId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `turn-${crypto.randomUUID()}`;
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRetryableStartupError(message: string): boolean {
  const msg = message.toLowerCase();
  if (
    msg.includes("cannot find any route matching") &&
    msg.includes("/_agent-native/agent-chat")
  ) {
    return true;
  }
  if (
    msg.includes("unauthorized") ||
    msg.includes("not authenticated") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("405") ||
    msg.includes("missing api key") ||
    msg.includes("api key") ||
    msg.includes("context_length") ||
    msg.includes("input_too_long") ||
    msg.includes("too many tokens") ||
    msg.includes("prompt is too long") ||
    msg.includes("credits-limit") ||
    msg.includes("billing") ||
    msg.includes("permission")
  ) {
    return false;
  }
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("connection") ||
    msg.includes("reset") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("timeout") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("server error: 408") ||
    msg.includes("server error: 429") ||
    msg.includes("server error: 500") ||
    msg.includes("server error: 502") ||
    msg.includes("server error: 503") ||
    msg.includes("server error: 504") ||
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

function isAuthErrorMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("authentication required") ||
    msg.includes("unauthorized") ||
    msg.includes("not authenticated") ||
    msg.includes("forbidden") ||
    msg.includes("invalid token") ||
    msg.includes("invalid or expired token") ||
    msg.includes("session expired") ||
    msg.includes("http_401") ||
    msg.includes("http_403") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("405")
  );
}

function authErrorReasonFromMessage(
  message: string,
): "auth-required" | "session-expired" {
  const msg = message.toLowerCase();
  return msg.includes("session") ||
    msg.includes("expired") ||
    msg.includes("invalid token") ||
    msg.includes("405")
    ? "session-expired"
    : "auth-required";
}

function authErrorText(
  reason: "auth-required" | "session-expired",
  message?: string,
): string {
  const fallback =
    reason === "session-expired"
      ? "Your chat session expired. Refresh chat and sign in again to continue."
      : "Authentication required. Sign in again to use chat.";

  if (!message) return formatChatErrorText(fallback);

  try {
    const parsed = JSON.parse(message) as {
      error?: unknown;
      message?: unknown;
    };
    const raw =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : undefined;
    return formatChatErrorText(raw || fallback);
  } catch {
    return formatChatErrorText(message || fallback);
  }
}

function safeAgentNativePath(path: string): string {
  try {
    return agentNativePath(path);
  } catch {
    return path;
  }
}

function isMissingCredentialMessage(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("apikey") ||
    msg.includes("authtoken") ||
    msg.includes("anthropic_api_key") ||
    msg.includes("missing_api_key") ||
    msg.includes("missing api key") ||
    msg.includes("missing credentials") ||
    msg.includes("no llm provider") ||
    msg.includes("llm provider is connected")
  );
}

function missingCredentialErrorText(message: string): string {
  try {
    const parsed = JSON.parse(message) as {
      error?: unknown;
      message?: unknown;
      upgradeUrl?: unknown;
      errorCode?: unknown;
    };
    const raw =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : message;
    return formatChatErrorText(
      raw,
      typeof parsed.upgradeUrl === "string" ? parsed.upgradeUrl : undefined,
      typeof parsed.errorCode === "string" ? parsed.errorCode : undefined,
    );
  } catch {
    return formatChatErrorText(message);
  }
}

/**
 * The composer's exec mode is sent as explicit request metadata. The server
 * owns the plan-mode prompt and read-only tool filtering so the chat history
 * stays clean and Plan mode is enforced outside the model's goodwill.
 */
/**
 * Creates a ChatModelAdapter that connects to the agent-native
 * `/_agent-native/agent-chat` SSE endpoint. Supports reconnection via run-manager.
 */
export function createAgentChatAdapter(options?: {
  apiUrl?: string;
  tabId?: string;
  threadId?: string;
  modelRef?: { current: string | undefined };
  engineRef?: { current: string | undefined };
  effortRef?: { current: ReasoningEffort | undefined };
  execModeRef?: { current: "build" | "plan" | undefined };
  browserTabId?: string;
  scopeRef?: { current: ChatThreadScope | null | undefined };
  surface?: AgentChatSurfaceKind;
}): ChatModelAdapter {
  const apiUrl =
    options?.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const tabId = options?.tabId;
  const threadId = options?.threadId;
  const modelRef = options?.modelRef;
  const engineRef = options?.engineRef;
  const effortRef = options?.effortRef;
  const execModeRef = options?.execModeRef;
  const browserTabId = options?.browserTabId;
  const scopeRef = options?.scopeRef;
  const surface = options?.surface ?? "app";

  return {
    async *run({ messages, abortSignal, runConfig }) {
      // Extract latest user message and build history from prior messages
      const adapterMessages = messages as readonly AdapterMessage[];
      const latestUserIndex = (() => {
        for (let i = adapterMessages.length - 1; i >= 0; i--) {
          if (adapterMessages[i].role === "user") return i;
        }
        return -1;
      })();
      const latestUserMsg =
        latestUserIndex >= 0 ? adapterMessages[latestUserIndex] : undefined;
      const latestUserIsRecovery = latestUserMsg
        ? isRecoveryUserMessage(latestUserMsg)
        : false;
      const lastUserMsg =
        latestUserIsRecovery && latestUserIndex >= 0
          ? (latestUserMessage(adapterMessages, {
              skipRecovery: true,
              beforeIndex: latestUserIndex,
            }) ?? latestUserMsg)
          : latestUserMsg;
      const recoveryMessageText =
        latestUserIsRecovery && latestUserMsg
          ? messageTextFromContentRaw(latestUserMsg.content)
          : "";
      const rawMessageText =
        lastUserMsg?.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? "";
      const runConfigRequestMode =
        runConfig?.custom &&
        typeof runConfig.custom === "object" &&
        "requestMode" in runConfig.custom
          ? (runConfig.custom as { requestMode?: unknown }).requestMode
          : undefined;
      const requestMode =
        runConfigRequestMode === "act" || runConfigRequestMode === "plan"
          ? runConfigRequestMode
          : execModeRef?.current === "plan"
            ? "plan"
            : execModeRef?.current === "build"
              ? "act"
              : undefined;

      const withRequestModeMetadata = (
        result: ChatModelRunResult,
      ): ChatModelRunResult => {
        if (!requestMode) return result;
        const metadata = (result.metadata ?? {}) as Record<string, unknown>;
        const custom =
          metadata.custom && typeof metadata.custom === "object"
            ? (metadata.custom as Record<string, unknown>)
            : {};
        return {
          ...result,
          metadata: {
            ...metadata,
            custom: { ...custom, requestMode },
          },
        };
      };

      // Extract attachments (images as base64, text as content).
      // assistant-ui puts user attachments on msg.attachments (not on content);
      // each attachment carries its own content parts from the adapter.
      const attachments = lastUserMsg
        ? extractAttachmentsFromMessage(lastUserMsg as any)
        : [];
      const userMessageText =
        rawMessageText.trim() || attachments.length === 0
          ? rawMessageText
          : "Use the attached context.";

      const priorMessages = limitPriorMessagesForRequest(
        messages.slice(0, latestUserIndex >= 0 ? latestUserIndex : -1) as any,
      ); // exclude latest user/recovery message and cap resend size
      const history = priorMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content:
            m.role === "user"
              ? messageTextForHistory(m as any)
              : messageTextFromContent(m.content),
        }))
        .filter((m) => m.content.trim());
      const structuredHistory =
        assistantUiMessagesToStructuredHistory(priorMessages);

      // Signal that generation is starting
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: true, tabId },
          }),
        );
      }

      const content: ContentPart[] = [];
      const toolCallCounter = { value: 0 };
      const turnId = generateTurnId();
      let runId: string | null = null;
      let lastSeq = -1;
      let currentMessageText = normalizeMentions(
        recoveryMessageText.trim() || userMessageText,
      );
      let currentHistory: AdapterHistoryMessage[] = history;
      let currentStructuredHistory: AgentChatStructuredMessage[] =
        structuredHistory;
      let includeAttachments = attachments.length > 0;
      let includeReferences = Boolean(runConfig?.custom?.references);
      let internalContinuationRequest = false;
      let startupRecoveryAttempts = 0;
      let staleRunContinuationAttempts = 0;
      let stalledTransientContinuationAttempts = 0;
      let emptyTransientContinuationAttempts = 0;
      let totalTransientContinuationAttempts = 0;
      const continuationHistoryFragments: string[] = [];
      const structuredContinuationFragments: AgentChatStructuredMessage[] = [];
      let visibleContinuationPrefix: ContentPart[] = [];
      let lastAutoContinueReason: string | null = null;
      const attemptedRunIds: string[] = [];
      let authRecoveryAttempted = false;
      let continuationToolCallCounter = 0;
      const nextContinuationToolCallId = () =>
        `continuation_tc_${++continuationToolCallCounter}`;

      const connectionRecoveryDetails = (): string => {
        return [
          lastAutoContinueReason
            ? `last_auto_continue_reason: ${lastAutoContinueReason}`
            : "",
          `stale_run_continuations: ${staleRunContinuationAttempts}`,
          `stalled_transient_continuations: ${stalledTransientContinuationAttempts}`,
          `empty_transient_continuations: ${emptyTransientContinuationAttempts}`,
          `total_transient_continuations: ${totalTransientContinuationAttempts}`,
          attemptedRunIds.length > 0
            ? `attempted_runs: ${attemptedRunIds.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      };

      const exhaustedRecoveryMessage = (reason?: string): string => {
        if (
          content.length === 0 &&
          (reason === "run_timeout" ||
            reason === "no_progress" ||
            reason === "stream_ended")
        ) {
          return "The agent request started but did not produce any visible progress before timing out. I stopped the automatic retries so this chat would not stay stuck on Thinking.";
        }
        return "The agent connection kept failing after several automatic recovery attempts.";
      };

      const dispatchAuthError = (
        reason: "auth-required" | "session-expired",
      ) => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent("agent-chat:auth-error", {
            detail: {
              reason,
              ...(tabId ? { tabId } : {}),
              ...(threadId ? { threadId } : {}),
            },
          }),
        );
      };

      const tryRecoverAuthOnce = async (): Promise<boolean> => {
        if (authRecoveryAttempted || abortSignal.aborted) return false;
        authRecoveryAttempted = true;
        try {
          const sessionRes = await fetch(
            safeAgentNativePath("/_agent-native/auth/session"),
            {
              method: "GET",
              headers: { Accept: "application/json" },
              cache: "no-store",
              credentials: "same-origin",
              signal: abortSignal,
            },
          );
          if (!sessionRes.ok) return false;
          const session = await sessionRes.json().catch(() => null);
          return Boolean(session && !session.error);
        } catch {
          return false;
        }
      };

      const captureChatClientError = (
        error: unknown,
        phase: string,
        extra: Record<string, unknown> = {},
      ) => {
        captureError(error, {
          tags: {
            source: "agent-chat-client",
            phase,
            hasThread: threadId ? "true" : "false",
            hasRun: runId ? "true" : "false",
            lastAutoContinueReason: lastAutoContinueReason ?? undefined,
          },
          extra: {
            apiUrl,
            tabId,
            threadId,
            runId,
            lastSeq,
            contentParts: content.length,
            attemptedRunIds: [...attemptedRunIds],
            startupRecoveryAttempts,
            staleRunContinuationAttempts,
            stalledTransientContinuationAttempts,
            emptyTransientContinuationAttempts,
            totalTransientContinuationAttempts,
            ...extra,
          },
          contexts: {
            agentChat: {
              tabId,
              threadId,
              runId,
              lastSeq,
              contentParts: content.length,
              startupRecoveryAttempts,
              staleRunContinuationAttempts,
              stalledTransientContinuationAttempts,
              emptyTransientContinuationAttempts,
              totalTransientContinuationAttempts,
            },
          },
        });
      };

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (tz) headers["x-user-timezone"] = tz;
        } catch {
          // Non-browser or Intl unavailable — tool calls will fall back to UTC.
        }
        // Surface hint — the server uses this to keep code-editing dev tools
        // out of the app-rendered sidebar. The outer dev frame passes
        // "dev-frame" explicitly; the reusable in-product chat defaults to
        // "app" even when it is running in Desktop or inside a preview iframe.
        headers["x-agent-native-surface"] = surface;

        const reconnectCurrentRun = async function* (): AsyncGenerator<
          ChatModelRunResult,
          boolean,
          unknown
        > {
          if (!runId) return false;
          let lastReconnectError: unknown = null;
          let reconnectErrorCaptured = false;
          for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
            try {
              const reconnectRes = await fetch(
                `${apiUrl}/runs/${encodeURIComponent(runId)}/events?after=${lastSeq + 1}`,
                { signal: abortSignal },
              );
              if (!reconnectRes.ok || !reconnectRes.body) {
                lastReconnectError = new Error(
                  `Reconnect failed: ${reconnectRes.status}`,
                );
                captureChatClientError(
                  lastReconnectError,
                  "reconnect-current-response",
                  {
                    status: reconnectRes.status,
                    hasBody: Boolean(reconnectRes.body),
                    attempt,
                  },
                );
                reconnectErrorCaptured = true;
                break;
              }

              for await (const result of readSSEStream(
                reconnectRes.body,
                content,
                toolCallCounter,
                tabId,
                (seq) => {
                  lastSeq = seq;
                  if (threadId) updateActiveRunSeq(seq);
                },
                runId,
              )) {
                yield withRequestModeMetadata(result);
              }
              clearActiveRun();
              return true;
            } catch (reconnectErr: unknown) {
              if (
                reconnectErr instanceof Error &&
                reconnectErr.name === "AbortError"
              ) {
                clearActiveRun();
                return true;
              }
              if (reconnectErr instanceof AgentAutoContinueSignal) {
                if (reconnectErr.reason === "no_progress") {
                  throw reconnectErr;
                }
                return false;
              }
              lastReconnectError = reconnectErr;
              await retryDelay(attempt, abortSignal);
            }
          }
          if (lastReconnectError && !reconnectErrorCaptured) {
            captureChatClientError(
              lastReconnectError,
              "reconnect-current-failed",
            );
          }
          return false;
        };

        const abortCurrentRun = async (): Promise<void> => {
          if (!runId) return;
          try {
            await fetch(`${apiUrl}/runs/${encodeURIComponent(runId)}/abort`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: "no_progress" }),
              signal: abortSignal,
            });
          } catch {
            // Best effort. The follow-up POST will still reconnect or 409 if
            // the producer is alive and cannot be aborted cross-isolate.
          } finally {
            clearActiveRun();
          }
        };

        const reconnectActiveRunForThread = async function* (): AsyncGenerator<
          ChatModelRunResult,
          boolean,
          unknown
        > {
          if (!threadId) return false;
          let lastActiveRunError: unknown = null;
          for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
            try {
              const activeRes = await fetch(
                `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                { signal: abortSignal },
              );
              if (!activeRes.ok) {
                lastActiveRunError = new Error(
                  `Active run lookup failed: ${activeRes.status}`,
                );
                captureChatClientError(
                  lastActiveRunError,
                  "reconnect-active-response",
                  { status: activeRes.status, attempt },
                );
                return false;
              }
              const active = await activeRes.json();
              if (active?.active && active.runId) {
                const activeRunId = String(active.runId);
                runId = activeRunId;
                if (!attemptedRunIds.includes(activeRunId)) {
                  attemptedRunIds.push(activeRunId);
                }
                lastSeq = -1;
                setActiveRun({ threadId, runId: activeRunId, lastSeq: -1 });
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return true;
              }
              return false;
            } catch (activeErr: unknown) {
              if (
                activeErr instanceof Error &&
                activeErr.name === "AbortError"
              ) {
                clearActiveRun();
                return true;
              }
              lastActiveRunError = activeErr;
              await retryDelay(attempt, abortSignal);
            }
          }
          if (lastActiveRunError) {
            captureChatClientError(
              lastActiveRunError,
              "reconnect-active-failed",
            );
          }
          return false;
        };

        const visibleContentForContinuation = (): ContentPart[] => {
          if (
            visibleContinuationPrefix.length > 0 &&
            visibleContinuationPrefix.every(
              (part, index) => content[index] === part,
            )
          ) {
            return content.slice(visibleContinuationPrefix.length);
          }
          return content;
        };

        const prepareAutoContinuation = (
          signal: AgentAutoContinueSignal,
        ): { ok: boolean; resetVisibleContent: boolean } => {
          lastAutoContinueReason = signal.reason;
          const isTransient = signal.reason !== "loop_limit";
          const visibleContent = visibleContentForContinuation();
          const currentPartialHistory =
            contentToContinuationHistory(visibleContent);
          const madeProgress = hasContinuationProgress(visibleContent);
          const madeVisibleProgress = visibleContent.length > 0;
          const madeDurableToolProgress = visibleContent.some(
            (part) => part.type === "tool-call" && part.result !== undefined,
          );

          if (signal.reason === "loop_limit") {
            stalledTransientContinuationAttempts = 0;
            emptyTransientContinuationAttempts = 0;
          } else {
            totalTransientContinuationAttempts += 1;
            const madeActivityProgress =
              signal.activityTrail.length > 0 ||
              Boolean(lastActivityTool(signal.activityTrail));
            if (
              !madeVisibleProgress &&
              signal.reason === "run_timeout" &&
              !madeActivityProgress
            ) {
              return { ok: false, resetVisibleContent: false };
            }
            if (!madeVisibleProgress) {
              emptyTransientContinuationAttempts += 1;
              if (
                emptyTransientContinuationAttempts >
                MAX_EMPTY_TRANSIENT_CONTINUATIONS
              ) {
                return { ok: false, resetVisibleContent: false };
              }
            } else {
              emptyTransientContinuationAttempts = 0;
            }
            if (signal.reason === "stale_run") {
              staleRunContinuationAttempts = madeDurableToolProgress
                ? 0
                : staleRunContinuationAttempts + 1;
              if (staleRunContinuationAttempts > MAX_STALE_RUN_CONTINUATIONS) {
                return { ok: false, resetVisibleContent: false };
              }
            }
            stalledTransientContinuationAttempts = madeProgress
              ? 0
              : stalledTransientContinuationAttempts + 1;
            if (
              stalledTransientContinuationAttempts >
                MAX_STALLED_TRANSIENT_CONTINUATIONS ||
              totalTransientContinuationAttempts >
                MAX_TOTAL_TRANSIENT_CONTINUATIONS
            ) {
              return { ok: false, resetVisibleContent: false };
            }
          }

          if (isTransient && currentPartialHistory) {
            continuationHistoryFragments.push(currentPartialHistory);
          }
          const partialHistory = combineContinuationHistory(
            isTransient
              ? continuationHistoryFragments
              : [...continuationHistoryFragments, currentPartialHistory],
          );
          const structuredPartialHistory = contentToStructuredMessages(
            visibleContent,
            nextContinuationToolCallId,
          );
          if (isTransient && structuredPartialHistory.length > 0) {
            structuredContinuationFragments.push(...structuredPartialHistory);
          }
          const structuredCombinedHistory = isTransient
            ? structuredContinuationFragments
            : [...structuredContinuationFragments, ...structuredPartialHistory];
          currentHistory = [
            ...history,
            { role: "user", content: normalizeMentions(userMessageText) },
            ...(partialHistory
              ? [{ role: "assistant" as const, content: partialHistory }]
              : []),
          ];
          currentStructuredHistory = [
            ...structuredHistory,
            {
              role: "user",
              content: [
                { type: "text", text: normalizeMentions(userMessageText) },
              ],
            },
            ...structuredCombinedHistory,
          ];
          currentMessageText = autoContinueMessage(signal);
          // Continuation requests are stateless new POSTs. If the interrupted
          // turn depended on uploaded context, re-send that context; otherwise
          // an attachment-only prompt degrades to "Use the attached context."
          // with nothing attached after a stale run or reconnect recovery.
          includeAttachments = attachments.length > 0;
          includeReferences = Boolean(runConfig?.custom?.references);
          internalContinuationRequest = true;
          startupRecoveryAttempts = 0;
          clearActiveRun();
          if (!isTransient) {
            return { ok: true, resetVisibleContent: false };
          }

          const preservedContent = visibleTransientContinuationContent(content);
          content.splice(0, content.length, ...preservedContent);
          visibleContinuationPrefix = preservedContent;
          return { ok: true, resetVisibleContent: true };
        };

        while (true) {
          try {
            runId = null;
            lastSeq = -1;
            const res = await fetchWithStartupTimeout(
              apiUrl,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  message: currentMessageText,
                  displayMessage: userMessageText,
                  history: currentHistory,
                  structuredHistory: currentStructuredHistory,
                  turnId,
                  ...(threadId ? { threadId } : {}),
                  ...(internalContinuationRequest
                    ? { internalContinuation: true }
                    : {}),
                  ...(requestMode ? { mode: requestMode } : {}),
                  ...(modelRef?.current ? { model: modelRef.current } : {}),
                  ...(engineRef?.current ? { engine: engineRef.current } : {}),
                  ...(effortRef?.current ? { effort: effortRef.current } : {}),
                  ...(browserTabId ? { browserTabId } : {}),
                  ...(scopeRef?.current ? { scope: scopeRef.current } : {}),
                  ...(includeAttachments ? { attachments } : {}),
                  ...(includeReferences && runConfig?.custom?.references
                    ? { references: runConfig.custom.references }
                    : {}),
                }),
              },
              STARTUP_RESPONSE_TIMEOUT_MS,
              abortSignal,
            );

            // Check for auth errors returned as 200 with JSON (common with middleware issues)
            const contentType = res.headers.get("content-type") || "";
            if (
              res.ok &&
              contentType.includes("application/json") &&
              !contentType.includes("text/event-stream")
            ) {
              try {
                const body = await res.text();
                const parsed = JSON.parse(body);
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch (e) {
                if (
                  e instanceof Error &&
                  e.message !== "Unexpected end of JSON input"
                ) {
                  throw e;
                }
              }
            }

            if (!res.ok) {
              if (res.status === 409) {
                let handledConflict = false;
                try {
                  const body = await res.json();
                  if (body?.activeRunId) {
                    handledConflict = true;
                    runId = String(body.activeRunId);
                    if (!attemptedRunIds.includes(runId)) {
                      attemptedRunIds.push(runId);
                    }
                    lastSeq = -1;
                    if (threadId) {
                      setActiveRun({ threadId, runId, lastSeq: -1 });
                    }
                    const reconnected = yield* reconnectCurrentRun();
                    if (reconnected) return;
                  }
                } catch {
                  // Fall through to the generic response handling below.
                }
                if (handledConflict) {
                  await delay(1000, abortSignal);
                  if (abortSignal.aborted) return;
                  continue;
                }
              }

              if (res.status === 401 || res.status === 403) {
                if (await tryRecoverAuthOnce()) {
                  continue;
                }
                dispatchAuthError("auth-required");
                content.push({
                  type: "text",
                  text: authErrorText("auth-required"),
                });
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                } as ChatModelRunResult;
                return;
              }

              // 405 Method Not Allowed usually means the session is broken/expired
              // (e.g. a redirect to a login page that only accepts GET).
              if (res.status === 405) {
                if (await tryRecoverAuthOnce()) {
                  continue;
                }
                dispatchAuthError("session-expired");
                content.push({
                  type: "text",
                  text: authErrorText("session-expired"),
                });
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                } as ChatModelRunResult;
                return;
              }

              let errorText = `Server error: ${res.status}`;
              try {
                const body = await res.text();
                if (isAuthErrorMessage(body)) {
                  if (await tryRecoverAuthOnce()) {
                    continue;
                  }
                  const reason = authErrorReasonFromMessage(body);
                  dispatchAuthError(reason);
                  content.push({
                    type: "text",
                    text: authErrorText(reason, body),
                  });
                  yield {
                    content: [...content],
                    status: {
                      type: "incomplete" as const,
                      reason: "error" as const,
                    },
                  } as ChatModelRunResult;
                  return;
                }
                if (isMissingCredentialMessage(body)) {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new Event("agent-chat:missing-api-key"),
                    );
                  }
                  content.push({
                    type: "text",
                    text: missingCredentialErrorText(body),
                  });
                  yield {
                    content: [...content],
                    status: {
                      type: "incomplete" as const,
                      reason: "error" as const,
                    },
                  } as ChatModelRunResult;
                  return;
                } else if (body.includes("Cannot find any path")) {
                  errorText =
                    "Agent chat endpoint not found. Make sure the agent-chat plugin is loaded in server/plugins/.";
                } else if (body) {
                  errorText =
                    body.length > 200 ? body.slice(0, 200) + "..." : body;
                }
              } catch {}
              throw new Error(errorText);
            }
            if (!res.body) {
              throw new Error("No response body");
            }

            // Track the run ID for reconnection
            runId = res.headers.get("X-Run-Id");
            if (runId && !attemptedRunIds.includes(runId)) {
              attemptedRunIds.push(runId);
            }
            if (runId && threadId) {
              setActiveRun({ threadId, runId, lastSeq: -1 });
            }

            for await (const result of readSSEStream(
              res.body,
              content,
              toolCallCounter,
              tabId,
              (seq) => {
                lastSeq = seq;
                if (runId && threadId) {
                  updateActiveRunSeq(seq);
                }
              },
              runId,
            )) {
              yield withRequestModeMetadata(result);
            }

            // Run completed normally — clear active run state
            clearActiveRun();
            return;
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") {
              // User-initiated abort (Stop button) — clear active run
              clearActiveRun();
              return;
            }

            if (err instanceof AgentAutoContinueSignal) {
              if (err.reason === "no_progress") {
                await abortCurrentRun();
              }
              if (err.reason === "stream_ended") {
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return;
                const activeReconnected = yield* reconnectActiveRunForThread();
                if (activeReconnected) return;
              }
              const continuation = prepareAutoContinuation(err);
              if (!continuation.ok) {
                const message = exhaustedRecoveryMessage(err.reason);
                captureChatClientError(err, "auto-continuation-exhausted", {
                  autoContinueReason: err.reason,
                });
                const runError = {
                  message,
                  details: connectionRecoveryDetails(),
                  errorCode: "connection_error",
                  recoverable: true,
                  ...(runId ? { runId } : {}),
                };
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:run-error", {
                      detail: { ...runError, tabId },
                    }),
                  );
                }
                content.push({
                  type: "text",
                  text: `Something went wrong: ${message}`,
                });
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                  metadata: {
                    custom: { ...(runId ? { runId } : {}), runError },
                  },
                };
                clearActiveRun();
                return;
              }
              if (continuation.resetVisibleContent) {
                yield {
                  content: snapshotContent(content),
                } as ChatModelRunResult;
              }
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            const errMsg =
              err instanceof Error ? err.message : "Something went wrong.";
            const isAuthError = isAuthErrorMessage(errMsg);

            // Don't try to reconnect for auth/client errors — show error directly
            if (isAuthError) {
              if (await tryRecoverAuthOnce()) {
                continue;
              }
              const reason = authErrorReasonFromMessage(errMsg);
              dispatchAuthError(reason);
              content.push({
                type: "text",
                text: authErrorText(reason, errMsg),
              });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              };
              clearActiveRun();
              return;
            }

            if (isMissingCredentialMessage(errMsg)) {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("agent-chat:missing-api-key"));
              }
              content.push({
                type: "text",
                text: missingCredentialErrorText(errMsg),
              });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
              };
              clearActiveRun();
              return;
            }

            // Connection lost — try to reconnect to the run
            const reconnected = yield* reconnectCurrentRun();
            if (reconnected) return;
            const activeReconnected = yield* reconnectActiveRunForThread();
            if (activeReconnected) return;

            if (err instanceof AgentStartupTimeoutError) {
              const message =
                "The agent chat endpoint accepted the request but did not start streaming in time. This usually means prompt setup, the LLM gateway, or the provider is stalled.";
              captureChatClientError(err, "startup-timeout", {
                timeoutMs: err.timeoutMs,
              });
              const runError = {
                message,
                details: connectionRecoveryDetails(),
                errorCode: "startup_timeout",
                recoverable: true,
                ...(runId ? { runId } : {}),
              };
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:run-error", {
                    detail: { ...runError, tabId },
                  }),
                );
              }
              content.push({
                type: "text",
                text: `Something went wrong: ${message}`,
              });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
                metadata: { custom: { ...(runId ? { runId } : {}), runError } },
              };
              clearActiveRun();
              return;
            }

            // Reconnect failed or not possible — keep going from the partial
            // streamed content instead of surfacing a transient transport error.
            if (content.length > 0) {
              const continuation = prepareAutoContinuation(
                new AgentAutoContinueSignal({ reason: "stream_ended" }),
              );
              if (!continuation.ok) {
                const message = exhaustedRecoveryMessage("stream_ended");
                captureChatClientError(err, "recovery-exhausted");
                const runError = {
                  message,
                  details: connectionRecoveryDetails(),
                  errorCode: "connection_error",
                  recoverable: true,
                  ...(runId ? { runId } : {}),
                };
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:run-error", {
                      detail: { ...runError, tabId },
                    }),
                  );
                }
                content.push({
                  type: "text",
                  text: `Something went wrong: ${message}`,
                });
                yield {
                  content: [...content],
                  status: {
                    type: "incomplete" as const,
                    reason: "error" as const,
                  },
                  metadata: {
                    custom: { ...(runId ? { runId } : {}), runError },
                  },
                };
                clearActiveRun();
                return;
              }
              if (continuation.resetVisibleContent) {
                yield {
                  content: snapshotContent(content),
                } as ChatModelRunResult;
              }
              await delay(250, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            if (
              isRetryableStartupError(errMsg) &&
              startupRecoveryAttempts < MAX_STARTUP_RECOVERY_ATTEMPTS
            ) {
              await retryDelay(startupRecoveryAttempts++, abortSignal);
              if (abortSignal.aborted) return;
              continue;
            }

            // No partial work exists, so this is still a real startup failure.
            captureChatClientError(err, "startup-failed", {
              retryableStartupError: isRetryableStartupError(errMsg),
            });
            const normalized = normalizeChatError(errMsg);
            const runError = {
              message: normalized.message,
              ...(normalized.details ? { details: normalized.details } : {}),
              errorCode: "connection_error",
              recoverable: true,
              ...(runId ? { runId } : {}),
            };
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("agent-chat:run-error", {
                  detail: { ...runError, tabId },
                }),
              );
            }
            content.push({
              type: "text",
              text: errMsg.startsWith("Server error:")
                ? errMsg
                : `Something went wrong: ${normalized.message}`,
            });
            yield {
              content: [...content],
              status: {
                type: "incomplete" as const,
                reason: "error" as const,
              },
              metadata: { custom: { ...(runId ? { runId } : {}), runError } },
            };
            return;
          }
        }
      } finally {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("agentNative.chatRunning", {
              detail: { isRunning: false, tabId },
            }),
          );
        }
      }
    },
  };
}
