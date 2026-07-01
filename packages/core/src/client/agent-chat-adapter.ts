import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

import type {
  AgentChatStructuredContentPart,
  AgentChatStructuredMessage,
} from "../agent/types.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import {
  setActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
} from "./active-run-state.js";
import { captureError } from "./analytics.js";
import { agentNativePath } from "./api-path.js";
import { unwrapAttachmentEnvelope } from "./composer/pasted-text.js";
import { formatChatErrorText, normalizeChatError } from "./error-format.js";
import {
  AgentAutoContinueSignal,
  type AgentActivityTrailEntry,
  type AgentAutoContinueErrorInfo,
  type ContentPart,
  readSSEStream,
  settleInterruptedToolCalls,
} from "./sse-event-processor.js";
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
  "image/svg+xml",
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
const AUTO_CONTINUE_COMPLETION_GUARD =
  "Before doing more work, inspect the prior partial assistant output in history. If it already gives a coherent answer, summary, artifact, coverage note, or next-step recommendation, finish with at most one short closing sentence and do not call tools, scan more data, or expand the search. Continue only genuinely unfinished work.";
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_STARTUP_RECOVERY_ATTEMPTS = 8;
const MAX_QUEUED_CONFLICT_RETRIES = 120;
const MAX_STALE_RUN_CONTINUATIONS = 3;
const MAX_STALLED_TRANSIENT_CONTINUATIONS = 8;
const MAX_TOTAL_TRANSIENT_CONTINUATIONS = 32;
// How many consecutive continuations that produce NO progress (no streamed
// text, no completed/in-flight tool) we tolerate before giving up. A complex
// first turn can spend the whole soft-timeout window (~40s) "thinking" with no
// visible output; giving up after a single such window made the agent feel like
// it "craps out / stops midway" on heavier prompts (Analytics). Retrying a few
// times lets a transient slow start recover, while the cap still terminates a
// genuinely stuck turn with a clear message instead of looping forever.
const MAX_EMPTY_TRANSIENT_CONTINUATIONS = 3;
// How many consecutive continuations that re-stream the SAME narration without
// advancing (no in-flight tool, no completed tool) we tolerate before giving
// up. A model that degenerates into repeating one phrase ("I have the full
// HTML. Creating the extension now!") emits "new" text every continuation,
// which keeps resetting the stalled/empty budgets — so without this guard the
// stuck turn burns the entire MAX_TOTAL_TRANSIENT_CONTINUATIONS budget (each
// round re-sending any large pasted payload) before bailing. Catching the
// repeat ends it in a few rounds with a clear, actionable message instead.
const MAX_REPEATED_TRANSIENT_CONTINUATIONS = 3;
// How many consecutive continuations that only reach the SAME "preparing
// action" activity card we tolerate before giving up. This catches runs that
// keep timing out while assembling a large tool payload: they are not empty,
// and the narration may vary enough to bypass the text-repeat guard, but the
// real tool never starts.
const MAX_REPEATED_ACTION_PREPARATION_CONTINUATIONS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
const MAX_HISTORY_ATTACHMENT_CHARS = 60_000;
// The attachment submitted with the CURRENT turn gets a much larger cap than
// prior-history embedding. The server threads this turn's attachments into each
// action's ActionRunContext, and `create-extension`/`update-extension` host a
// pasted file verbatim from it via `contentFromAttachment` — a feature whose
// whole point is large pastes. Truncating the outbound payload to the 60K
// history cap would silently cut a >60K HTML/Alpine file before the server ever
// reads it, hosting a broken extension. Mirror the large-input tool-arg cap
// (MAX_HISTORY_LARGE_TOOL_ARGS_CHARS) so realistic pasted files survive intact;
// the trailing truncation notice still makes a pathological multi-MB paste
// visibly (not silently) capped.
const MAX_OUTBOUND_ATTACHMENT_CHARS = 200_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_TOTAL_CHARS = 64_000;
const MAX_HISTORY_MESSAGE_CHARS = 12_000;
const MAX_HISTORY_TOOL_ARGS_CHARS = 8_000;
const MAX_HISTORY_TOOL_RESULT_CHARS = 12_000;
// Tools whose entire input IS the artifact being built (extension HTML, etc.).
// Lossy-truncating these to a `{ __agentNativeTruncated }` placeholder strands
// the resumed agent — it can no longer refine the artifact because it sees a
// fake input. Keep the real input for these on continuation, only collapsing
// inputs that are far larger than any realistic extension payload.
const LARGE_INPUT_TOOL_NAMES = new Set([
  "create-extension",
  "update-extension",
]);
const MAX_HISTORY_LARGE_TOOL_ARGS_CHARS = 200_000;
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
    if (part.activity === true) continue;
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

function truncateToolArgsForHistory(
  args: unknown,
  toolName?: string,
): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  // Large-input tools (e.g. create-extension/update-extension) carry the
  // artifact itself as their input. Preserve the real input on continuation so
  // the resumed agent can keep refining it; only collapse inputs that exceed a
  // far larger ceiling than any realistic payload.
  const cap =
    toolName && LARGE_INPUT_TOOL_NAMES.has(toolName)
      ? MAX_HISTORY_LARGE_TOOL_ARGS_CHARS
      : MAX_HISTORY_TOOL_ARGS_CHARS;
  try {
    const json = JSON.stringify(args);
    if (json.length <= cap) {
      return args as Record<string, unknown>;
    }
    return {
      __agentNativeTruncated: true,
      note: "Tool input was too large to resend in chat history. Use the current app/resource state as the source of truth if exact content is needed.",
      preview: truncateForHistory(json, cap, "Tool input"),
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

function isSvgAttachment(args: {
  name?: string;
  contentType?: string;
}): boolean {
  const contentType = args.contentType?.split(";")[0]?.trim().toLowerCase();
  return contentType === "image/svg+xml" || /\.svg$/i.test(args.name ?? "");
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
        const preserveDataUrl =
          part.data.startsWith("data:") &&
          shouldPreserveFileDataUrl({ name: att.name, contentType });
        const decodedText = part.data.startsWith("data:")
          ? decodeTextDataUrl(part.data)
          : null;
        attachments.push({
          type: "file",
          name: att.name,
          contentType,
          ...(preserveDataUrl
            ? {
                data: part.data,
                ...(decodedText !== null
                  ? { text: truncateOutboundAttachment(decodedText) }
                  : {}),
              }
            : decodedText !== null
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

function shouldPreserveFileDataUrl(args: {
  name?: string;
  contentType?: string;
}): boolean {
  return isSvgAttachment(args);
}

function truncateHistoryAttachment(text: string): string {
  if (text.length <= MAX_HISTORY_ATTACHMENT_CHARS) return text;
  const omitted = text.length - MAX_HISTORY_ATTACHMENT_CHARS;
  return `${text.slice(0, MAX_HISTORY_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_HISTORY_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from prior chat history.]`;
}

function truncateOutboundAttachment(text: string): string {
  if (text.length <= MAX_OUTBOUND_ATTACHMENT_CHARS) return text;
  const omitted = text.length - MAX_OUTBOUND_ATTACHMENT_CHARS;
  return `${text.slice(0, MAX_OUTBOUND_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_OUTBOUND_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from the submitted attachment.]`;
}

function attachmentHistoryText(
  attachment: AgentChatAdapterAttachment,
): string | null {
  if (isSvgAttachment(attachment)) {
    const label = attachment.name || "SVG attachment";
    const contentType = attachment.contentType
      ? ` (${attachment.contentType})`
      : "";
    return `[Attached ${attachment.type || "file"}: ${label}${contentType}; SVG reference-only, raw markup omitted from prior chat history.]`;
  }

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

function isSuccessOnlyToolResult(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  return keys.every((key) => {
    const item = value[key];
    if (key === "ok" || key === "success") return item === true;
    if (key === "status") {
      return item === "ok" || item === "success" || item === "completed";
    }
    return false;
  });
}

function toolResultContent(result: unknown, toolName?: string): string {
  if (typeof result === "string") return result;
  const completed = toolName?.trim()
    ? `${toolName.trim()} completed.`
    : "Tool completed.";
  if (result === true || result == null) return completed;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    const message = record.message ?? record.summary;
    if (typeof message === "string" && message.trim()) return message.trim();
    const title = record.title ?? record.name;
    if (typeof title === "string" && title.trim()) {
      return `${title.trim()} is ready.`;
    }
    const id = record.id ?? record.planId ?? record.commentId;
    if (typeof id === "string" && id.trim() && toolName?.trim()) {
      return `${toolName.trim()} completed for ${id.trim()}.`;
    }
    if (isSuccessOnlyToolResult(record)) return completed;
  }
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
      if (part.activity === true) continue;
      const toolCallId = nextToolCallId();
      assistantParts.push({
        type: "tool-call",
        toolCallId,
        toolName: part.toolName,
        args: truncate
          ? truncateToolArgsForHistory(part.args ?? {}, part.toolName)
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
                toolResultContent(part.result, part.toolName),
                MAX_HISTORY_TOOL_RESULT_CHARS,
                "Tool result",
              )
            : toolResultContent(part.result, part.toolName),
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
        if ((part as { activity?: unknown }).activity === true) continue;
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
            ? { result: toolResultContent(part.result, toolName) }
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

function hasContinuationProgress(content: ContentPart[]): boolean {
  return content.some((part) =>
    part.type === "text"
      ? part.text.trim().length > 0
      : part.result !== undefined,
  );
}

const COMPLETED_TOOL_TIMEOUT_NAME_RE =
  /^(add|apply|archive|capture|create|delete|deploy|duplicate|edit|generate|grant|insert|migrate|move|present|publish|remove|rename|reorder|revoke|save|send|set|sync|trash|update|write)(-|$)/;
const COMPLETED_TOOL_TIMEOUT_NAME_ALLOWLIST = new Set([
  "connect-assets-mcp",
  "import-design-tokens",
]);

function isCompletedToolTimeoutCandidate(
  part: Extract<ContentPart, { type: "tool-call" }>,
): boolean {
  if (part.completedSideEffect === false) return false;
  if (part.completedSideEffect === true) return true;
  const toolName = part.toolName.toLowerCase();
  return (
    COMPLETED_TOOL_TIMEOUT_NAME_ALLOWLIST.has(toolName) ||
    COMPLETED_TOOL_TIMEOUT_NAME_RE.test(toolName)
  );
}

function lastCompletedTimeoutCandidateTool(
  content: ContentPart[],
): Extract<ContentPart, { type: "tool-call" }> | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.activity !== true &&
      part.result !== undefined &&
      part.isError !== true &&
      isCompletedToolTimeoutCandidate(part)
    ) {
      return part;
    }
  }
  return undefined;
}

function humanizeActionName(toolName: string): string {
  return toolName
    .replace(/^agent:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function completedToolTimeoutMessage(toolName: string): string {
  if (toolName === "generate-design" || toolName === "update-design") {
    return "The design was saved, but the assistant timed out before sending its final note. You can open the generated design from the completed tool card above.";
  }
  if (toolName === "present-design-variants") {
    return "The design variants were saved, but the assistant timed out before sending its final note. You can review the completed variants from the tool card above.";
  }
  return `The ${humanizeActionName(toolName)} action completed, but the assistant timed out before sending its final response. The saved result is in the completed tool card above.`;
}

/**
 * Signature of the *unique* sentence-like segments in a continuation's newly
 * streamed text, used to detect a degenerate repetition loop. A stuck model
 * re-emits the same phrase ("I have the full HTML. Creating the extension
 * now!") an arbitrary number of times per run, so the set of unique segments
 * is small and stable across continuations regardless of how many times any
 * single run repeated it. An empty signature (no visible text) is never a
 * repeat — the stalled/empty budgets handle no-output stalls instead.
 */
function continuationRepeatSignature(content: ContentPart[]): string {
  const text = content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .toLowerCase();
  const segments = text
    // Split after sentence punctuation even when runs are concatenated without
    // a following space ("...now!I have..."), and on newlines.
    .split(/(?<=[.!?])|\n+/)
    .map((segment) => segment.replace(/[^a-z0-9]+/g, " ").trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return "";
  return Array.from(new Set(segments)).sort().join("\u0000");
}

/**
 * True when an action was streamed but never returned a result yet — i.e. a
 * `tool_start` with no matching `tool_done`. The server is still executing it,
 * so a run_timeout that fires in this window is NOT a stall: the agent was
 * actively working and `foldAssistantTurn` persisted the in-flight call. We
 * must not count this against the stalled/empty continuation budgets.
 */
function hasInFlightToolCall(content: ContentPart[]): boolean {
  return content.some(
    (part) =>
      part.type === "tool-call" &&
      part.result === undefined &&
      part.activity !== true,
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

function formatActivityTrail(
  trail: readonly AgentActivityTrailEntry[],
): string | undefined {
  const items = trail
    .slice(-8)
    .map((entry) => {
      const label = entry.label.replace(/\s+/g, " ").trim();
      const tool = entry.tool?.replace(/\s+/g, " ").trim();
      if (label && tool && label !== tool) return `${label} (${tool})`;
      return label || tool || "";
    })
    .filter(Boolean);
  return items.length > 0 ? items.join(" > ") : undefined;
}

function lastUnresolvedToolActivity(
  content: ContentPart[],
): string | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (
      part.type === "tool-call" &&
      part.activity === true &&
      part.result === undefined
    ) {
      return part.toolName;
    }
  }
  return undefined;
}

function snapshotContent(content: ContentPart[]): ContentPart[] {
  return content.map((part) =>
    part.type === "text" ? { ...part } : { ...part, args: { ...part.args } },
  );
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

// Bounded signature of an in-flight tool call's input, used by the stall guard
// to tell a genuinely-stuck retry (same tool, same payload, connection keeps
// dropping) apart from a legitimate retry with a CHANGED payload (e.g. the
// `create-extension` cutoff nudge tells the model to re-send a smaller body).
// A changed payload yields a different signature, so the guard resets that
// tool's stall budget instead of aborting the new attempt as a repeat. Bounded
// to length + head so we never retain a large pasted payload across rounds.
function inFlightToolInputSignature(
  part: Extract<ContentPart, { type: "tool-call" }>,
): string {
  const raw = part.argsText ?? stableJson(part.args);
  return `${raw.length}\u0000${raw.slice(0, 256)}`;
}

function toolContinuationKey(
  part: Extract<ContentPart, { type: "tool-call" }>,
): string {
  return [
    part.toolCallId,
    part.toolName,
    part.argsText,
    stableJson(part.args),
    part.result === undefined ? "pending" : "done",
    part.result ?? "",
    part.isError === true ? "error" : "",
    part.completedSideEffect === true ? "side-effect" : "",
    part.activity === true ? "activity" : "tool",
    part.mcpApp ? "mcp-app" : "",
  ].join("\u0000");
}

function contentAfterContinuationPrefix(
  content: ContentPart[],
  prefix: ContentPart[],
): ContentPart[] {
  if (prefix.length === 0) return content;

  const delta: ContentPart[] = [];
  let contentIndex = 0;

  for (const prefixPart of prefix) {
    const currentPart = content[contentIndex];
    if (!currentPart) return content.slice(contentIndex);

    if (prefixPart.type === "text" && currentPart.type === "text") {
      if (currentPart.text === prefixPart.text) {
        contentIndex += 1;
        continue;
      }

      if (currentPart.text.startsWith(prefixPart.text)) {
        const appendedText = currentPart.text.slice(prefixPart.text.length);
        if (appendedText) delta.push({ type: "text", text: appendedText });
        contentIndex += 1;
        continue;
      }

      return content.slice(contentIndex);
    }

    if (
      prefixPart.type === "tool-call" &&
      currentPart.type === "tool-call" &&
      toolContinuationKey(currentPart) === toolContinuationKey(prefixPart)
    ) {
      contentIndex += 1;
      continue;
    }

    return content.slice(contentIndex);
  }

  return [...delta, ...content.slice(contentIndex)];
}

// Concrete "ship a compact first version, then refine incrementally" guidance
// keyed by the large-payload action the model was cut off while preparing. A run
// cut off mid-stream while streaming one big tool input (extension HTML, a full
// design file set, an entire dashboard config) re-streams the SAME oversized
// payload on every continuation and never finishes inside the soft-timeout
// window — the classic thrash loop. Pointing the resumed model at the
// incremental-edit path for that specific action is what breaks the loop.
// Returns undefined for tools with no known incremental counterpart so the
// caller falls back to generic compact-first advice.
function incrementalActionGuidance(tool: string): string | undefined {
  switch (tool) {
    case "create-extension":
    case "update-extension":
      return "create a compact working v1 with `create-extension`, then use focused `update-extension` edits for refinements";
    case "generate-design":
    case "update-design":
      return 'if an existing design file or snapshot is already in history, especially after a Design variant pick, stop retrying `generate-design`: call `get-design-snapshot` for the selected file, then call `edit-design` once on that same `fileId` (`mode: "replace-file"` for a compact full-file replacement, or search/replace for smaller edits). Use `generate-design` only for a brand-new compact first file when no target file exists yet';
    case "present-design-variants":
      return 'call `present-design-variants` with concise labels, descriptions, accent colors, and feature bullets; omit large `content` HTML when needed so the action can render compact representative screens. After the user picks a direction, delete unchosen screens, snapshot the selected `fileId`, and refine that same file with `edit-design` (`mode: "replace-file"` for placeholder expansion). Do not call `generate-design` after the variant pick';
    case "create-visual-plan":
    case "create-ui-plan":
    case "create-plan-design":
    case "create-prototype-plan":
      return "create the plan with its core sections or first screen, then expand it with `update-visual-plan`/`patch-visual-plan-source` follow-up edits";
    case "update-visual-plan":
    case "patch-visual-plan-source":
      return "apply smaller, targeted `patch-visual-plan-source` edits rather than rewriting the whole plan in one call";
    case "update-dashboard":
      return "save a small dashboard first, then add panels one at a time with `update-dashboard` incremental `ops` edits instead of authoring the whole config in one call";
    default:
      return undefined;
  }
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
  // A run_timeout or a mid-stream cutoff while assembling one large action
  // payload (e.g. inlining a big pasted HTML file into `create-extension`, a
  // full file set into `generate-design`, or a whole `update-dashboard` config)
  // is the classic trigger for the repetition/cutoff loop. Nudge the model
  // toward a compact first version it can actually finish in a single run, then
  // incremental refinements — never re-streaming the same oversized payload.
  const cutoffPreparingAction =
    signal.reason === "run_timeout" || signal.reason === "stream_ended";
  let actionInputNote = "";
  if (cutoffPreparingAction && tool) {
    const guidance = incrementalActionGuidance(tool);
    actionInputNote = guidance
      ? `\n\nThe previous run was cut off while preparing the \`${tool}\` action input before the action could finish. Avoid spending another whole run assembling one large tool payload — ${guidance}.`
      : `\n\nThe previous run was cut off while preparing the \`${tool}\` action input before the action could finish. Avoid re-assembling one large tool payload: produce a compact first result you can finish in a single run, then refine it with smaller follow-up edits.`;
  }
  return `${AUTO_CONTINUE_PROMPT}\n\n${AUTO_CONTINUE_COMPLETION_GUARD}\n\nInternal note: ${reason}${actionInputNote}`;
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

function shouldCaptureRecoveryHttpStatus(status: number): boolean {
  return status < 500 || status >= 600;
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

function missingCredentialFailure(message: string): {
  text: string;
  runError: { message: string; errorCode: string };
} {
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
    const errorCode =
      typeof parsed.errorCode === "string"
        ? parsed.errorCode
        : "missing_credentials";
    return {
      text: formatChatErrorText(
        raw,
        typeof parsed.upgradeUrl === "string" ? parsed.upgradeUrl : undefined,
        errorCode,
      ),
      runError: {
        message: normalizeChatError(raw).message,
        errorCode,
      },
    };
  } catch {
    return {
      text: formatChatErrorText(message, undefined, "missing_credentials"),
      runError: {
        message: normalizeChatError(message).message,
        errorCode: "missing_credentials",
      },
    };
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
export interface CreateAgentChatAdapterOptions {
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
}

export function createAgentChatAdapter(
  options?: CreateAgentChatAdapterOptions,
): ChatModelAdapter {
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
      const trackInRunsTray =
        runConfig?.custom &&
        typeof runConfig.custom === "object" &&
        (runConfig.custom as { trackInRunsTray?: unknown }).trackInRunsTray ===
          true;
      // Human-in-the-loop approval keys (opt-in `needsApproval` actions). When
      // the user approves a paused tool call, the turn is re-issued with the
      // approval key so the server lets that specific call run.
      const approvedToolCalls = (() => {
        const raw =
          runConfig?.custom &&
          typeof runConfig.custom === "object" &&
          "approvedToolCalls" in runConfig.custom
            ? (runConfig.custom as { approvedToolCalls?: unknown })
                .approvedToolCalls
            : undefined;
        if (!Array.isArray(raw)) return undefined;
        const keys = raw.filter(
          (key): key is string => typeof key === "string" && key.length > 0,
        );
        return keys.length > 0 ? keys : undefined;
      })();
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
      let queuedConflictRetries = 0;
      let staleRunContinuationAttempts = 0;
      let stalledTransientContinuationAttempts = 0;
      let emptyTransientContinuationAttempts = 0;
      let totalTransientContinuationAttempts = 0;
      let repeatedTransientContinuationAttempts = 0;
      let lastContinuationRepeatSignature: string | null = null;
      let recoveryGaveUpOnRepetition = false;
      // Track when the same write tool is stuck in-flight across consecutive
      // continuations (connection keeps dropping mid-execution). This is
      // orthogonal to the text-repeat guard — in-flight tools reset
      // madeProgress=true so the stalled/empty budgets never fire, but the tool
      // never actually completes. After MAX_REPEATED_INFLIGHT_TOOL_STALLS
      // consecutive interruptions of the same tool, bail with a clear message.
      let lastInFlightToolName: string | undefined;
      // Signature of the stuck tool's input. A retry with a changed payload
      // (different signature) resets the stall count so the new attempt gets
      // its own budget rather than inheriting the prior payload's.
      let lastInFlightToolSignature: string | undefined;
      let repeatedInFlightToolCount = 0;
      let recoveryGaveUpOnInFlightTool = false;
      const MAX_REPEATED_INFLIGHT_TOOL_STALLS = 3;
      let lastPreparingToolName: string | undefined;
      let repeatedActionPreparationCount = 0;
      let recoveryGaveUpOnActionPreparation = false;
      const continuationHistoryFragments: string[] = [];
      const structuredContinuationFragments: AgentChatStructuredMessage[] = [];
      let visibleContinuationPrefix: ContentPart[] = [];
      let lastAutoContinueReason: string | null = null;
      let lastRecoverableRunError: AgentAutoContinueErrorInfo | null = null;
      let lastActivityTrail: AgentActivityTrailEntry[] = [];
      const attemptedRunIds: string[] = [];
      let authRecoveryAttempted = false;
      let continuationToolCallCounter = 0;
      const nextContinuationToolCallId = () =>
        `continuation_tc_${++continuationToolCallCounter}`;

      const runDebugContextDetails = (): string => {
        const pageOrigin =
          typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "";
        return [
          `api_url: ${apiUrl}`,
          pageOrigin ? `page_origin: ${pageOrigin}` : "",
          tabId ? `tab_id: ${tabId}` : "",
          threadId ? `thread_id: ${threadId}` : "",
          `turn_id: ${turnId}`,
          runId ? `current_run: ${runId}` : "",
          attemptedRunIds.length > 0
            ? `attempted_runs: ${attemptedRunIds.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      };

      const connectionRecoveryDetails = (): string => {
        return [
          runDebugContextDetails(),
          lastAutoContinueReason
            ? `last_auto_continue_reason: ${lastAutoContinueReason}`
            : "",
          lastRecoverableRunError?.errorCode
            ? `last_recoverable_error_code: ${lastRecoverableRunError.errorCode}`
            : "",
          lastRecoverableRunError?.message
            ? `last_recoverable_error: ${lastRecoverableRunError.message}`
            : "",
          `stale_run_continuations: ${staleRunContinuationAttempts}`,
          `stalled_transient_continuations: ${stalledTransientContinuationAttempts}`,
          `empty_transient_continuations: ${emptyTransientContinuationAttempts}`,
          `repeated_transient_continuations: ${repeatedTransientContinuationAttempts}`,
          `repeated_inflight_tool_stalls: ${repeatedInFlightToolCount}`,
          lastInFlightToolName
            ? `last_inflight_tool: ${lastInFlightToolName}`
            : "",
          `repeated_action_preparation_stalls: ${repeatedActionPreparationCount}`,
          lastPreparingToolName
            ? `last_preparing_tool: ${lastPreparingToolName}`
            : "",
          formatActivityTrail(lastActivityTrail)
            ? `activity_trail: ${formatActivityTrail(lastActivityTrail)}`
            : "",
          `total_transient_continuations: ${totalTransientContinuationAttempts}`,
        ]
          .filter(Boolean)
          .join("\n");
      };

      const exhaustedRecoveryMessage = (reason?: string): string => {
        if (recoveryGaveUpOnInFlightTool) {
          return "The agent got stuck waiting for the same tool to finish, so I stopped the automatic retries. The tool did not report a completed result.";
        }
        if (recoveryGaveUpOnRepetition) {
          return "The agent got stuck repeating the same response without finishing, so I stopped the automatic retries. This often happens when it tries to re-type a large pasted file into one action — starting a new chat, or asking for a smaller first step, usually gets it unstuck.";
        }
        if (recoveryGaveUpOnActionPreparation) {
          const tool = lastPreparingToolName
            ? ` the ${humanizeActionName(lastPreparingToolName)} action`
            : " the same action";
          return `The agent got stuck preparing${tool} input and never started the tool, so I stopped the automatic retries. Try a smaller first step or a more compact version of the request.`;
        }
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
            activityTrail: [...lastActivityTrail],
            startupRecoveryAttempts,
            staleRunContinuationAttempts,
            stalledTransientContinuationAttempts,
            emptyTransientContinuationAttempts,
            repeatedTransientContinuationAttempts,
            repeatedInFlightToolCount,
            lastInFlightToolName,
            repeatedActionPreparationCount,
            lastPreparingToolName,
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
              repeatedTransientContinuationAttempts,
              repeatedInFlightToolCount,
              lastInFlightToolName,
              repeatedActionPreparationCount,
              lastPreparingToolName,
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
                if (reconnectRes.status === 404) {
                  clearActiveRun();
                  return false;
                }
                lastReconnectError = new Error(
                  `Reconnect failed: ${reconnectRes.status}`,
                );
                if (shouldCaptureRecoveryHttpStatus(reconnectRes.status)) {
                  captureChatClientError(
                    lastReconnectError,
                    "reconnect-current-response",
                    {
                      status: reconnectRes.status,
                      hasBody: Boolean(reconnectRes.body),
                      attempt,
                    },
                  );
                }
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
                if (activeRes.status === 404) {
                  return false;
                }
                lastActiveRunError = new Error(
                  `Active run lookup failed: ${activeRes.status}`,
                );
                if (shouldCaptureRecoveryHttpStatus(activeRes.status)) {
                  captureChatClientError(
                    lastActiveRunError,
                    "reconnect-active-response",
                    { status: activeRes.status, attempt },
                  );
                }
                return false;
              }
              const active = await activeRes.json();
              if (active?.active && active.runId) {
                const activeStatus =
                  typeof active.status === "string" ? active.status : "";
                const activeTurnId =
                  typeof active.turnId === "string" ? active.turnId : "";
                if (activeStatus !== "running" && activeTurnId !== turnId) {
                  return false;
                }
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

        const reconnectBackgroundContinuationForRunTimeout =
          async function* (): AsyncGenerator<
            ChatModelRunResult,
            boolean,
            unknown
          > {
            if (!threadId || !runId) return false;
            const interruptedRunId = runId;
            const interruptedLastSeq = lastSeq;
            let lastActiveRunError: unknown = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) {
                await delay(500, abortSignal);
              }
              if (abortSignal.aborted) return true;
              try {
                const activeRes = await fetch(
                  `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
                  { signal: abortSignal },
                );
                if (!activeRes.ok) {
                  if (activeRes.status === 404) return false;
                  lastActiveRunError = new Error(
                    `Active run lookup failed: ${activeRes.status}`,
                  );
                  continue;
                }
                const active = await activeRes.json();
                if (!active?.active || !active.runId) return false;
                const activeRunId = String(active.runId);
                const dispatchMode =
                  typeof active.dispatchMode === "string"
                    ? active.dispatchMode
                    : "";
                if (activeRunId === interruptedRunId) {
                  if (dispatchMode.startsWith("background")) continue;
                  return false;
                }
                const activeTurnId =
                  typeof active.turnId === "string" ? active.turnId : "";
                const activeStatus =
                  typeof active.status === "string" ? active.status : "";
                if (!dispatchMode.startsWith("background")) return false;
                if (activeTurnId && activeTurnId !== turnId) return false;
                if (activeStatus !== "running" && activeStatus !== "starting") {
                  return false;
                }
                runId = activeRunId;
                if (!attemptedRunIds.includes(activeRunId)) {
                  attemptedRunIds.push(activeRunId);
                }
                lastSeq = -1;
                setActiveRun({ threadId, runId: activeRunId, lastSeq: -1 });
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return true;
              } catch (activeErr: unknown) {
                if (
                  activeErr instanceof Error &&
                  activeErr.name === "AbortError"
                ) {
                  clearActiveRun();
                  return true;
                }
                lastActiveRunError = activeErr;
              }
            }
            if (lastActiveRunError) {
              captureChatClientError(
                lastActiveRunError,
                "reconnect-background-continuation-failed",
              );
            }
            runId = interruptedRunId;
            lastSeq = interruptedLastSeq;
            return false;
          };

        const visibleContentForContinuation = (): ContentPart[] => {
          return contentAfterContinuationPrefix(
            content,
            visibleContinuationPrefix,
          );
        };

        const prepareAutoContinuation = (
          signal: AgentAutoContinueSignal,
        ): {
          ok: boolean;
          resetVisibleContent: boolean;
          completedToolName?: string;
        } => {
          lastAutoContinueReason = signal.reason;
          lastActivityTrail = [...signal.activityTrail];
          if (signal.errorInfo) {
            lastRecoverableRunError = signal.errorInfo;
          }
          const isTransient = signal.reason !== "loop_limit";
          const visibleContent = visibleContentForContinuation();
          let currentPartialHistory =
            contentToContinuationHistory(visibleContent);
          // Real, content-weight progress: streamed text or a completed tool
          // result. Used to reset the stalled/empty counters so trivial
          // whitespace-only output cannot keep the run alive indefinitely.
          const madeContentProgress = hasContinuationProgress(visibleContent);
          // An action was streamed but has not returned yet (a tool_start with
          // no tool_done). This is durable enough to survive continuation: the
          // server already emitted a real tool call. A tool-scoped activity
          // card ("Preparing generate-design") is useful UI, but it happens
          // before tool_start; treating it as progress caused silent retry
          // loops when the LLM timed out while assembling a large tool input.
          const hasInFlightTool = hasInFlightToolCall(visibleContent);
          const completedTool = lastCompletedTimeoutCandidateTool(content);
          // Either real output or an actively-running tool counts as progress
          // for the stalled/empty caps.
          const madeProgress = madeContentProgress || hasInFlightTool;
          const madeDurableToolProgress = visibleContent.some(
            (part) =>
              part.type === "tool-call" &&
              part.activity !== true &&
              part.result !== undefined,
          );
          const currentPreparingToolName =
            lastUnresolvedToolActivity(visibleContent);
          // In-flight tool stall guard. When the same write tool is stuck
          // in-flight because the connection keeps dropping (stream_ended),
          // hasInFlightTool=true keeps madeProgress=true and completely
          // bypasses the stalled/empty budgets. Track the last in-flight tool
          // name; when the same tool is still unresolved after
          // MAX_REPEATED_INFLIGHT_TOOL_STALLS consecutive stream_ended events,
          // bail with a clear message.
          //
          // Count broken streams (connection drop / reconnect failed) and
          // no_progress stalls (the client aborts a stream that stayed open but
          // stopped producing events). Do NOT count run_timeout: with an
          // in-flight tool that means the server is still actively executing a
          // slow action and reconnection may recover the result.
          const currentInFlightToolPart = visibleContent.find(
            (p): p is Extract<ContentPart, { type: "tool-call" }> =>
              p.type === "tool-call" &&
              p.result === undefined &&
              p.activity !== true,
          );
          const currentInFlightToolName = currentInFlightToolPart?.toolName;
          const currentInFlightToolSignature = currentInFlightToolPart
            ? inFlightToolInputSignature(currentInFlightToolPart)
            : undefined;
          const isBrokenInFlightTool =
            signal.reason === "stream_ended" || signal.reason === "no_progress";
          if (currentInFlightToolName && isBrokenInFlightTool) {
            if (
              currentInFlightToolName === lastInFlightToolName &&
              currentInFlightToolSignature === lastInFlightToolSignature
            ) {
              repeatedInFlightToolCount += 1;
            } else {
              // New tool, or the same tool retried with a CHANGED (e.g.
              // smaller) payload — give the changed input a fresh stall budget
              // instead of aborting it as a repeat of the prior payload.
              repeatedInFlightToolCount = 0;
              lastInFlightToolName = currentInFlightToolName;
              lastInFlightToolSignature = currentInFlightToolSignature;
            }
          } else if (!currentInFlightToolName) {
            repeatedInFlightToolCount = 0;
          }

          const isRepeatedActionPreparationCandidate =
            signal.reason !== "loop_limit" &&
            currentPreparingToolName !== undefined &&
            !hasInFlightTool &&
            !madeDurableToolProgress;
          if (isRepeatedActionPreparationCandidate) {
            if (currentPreparingToolName === lastPreparingToolName) {
              repeatedActionPreparationCount += 1;
            } else {
              repeatedActionPreparationCount = 0;
              lastPreparingToolName = currentPreparingToolName;
            }
          } else if (
            !currentPreparingToolName ||
            hasInFlightTool ||
            madeDurableToolProgress
          ) {
            repeatedActionPreparationCount = 0;
            lastPreparingToolName = undefined;
          }

          // Degenerate repetition guard. When the model gets stuck re-streaming
          // the SAME narration every continuation without ever starting or
          // finishing a tool, each round is "new" text — so madeProgress stays
          // true and the stalled/empty budgets never trip. Compare this round's
          // unique-sentence signature to the previous round's; a match with no
          // tool progress is a non-advancing loop. Tracked by its own counter
          // so it bails after a few rounds instead of the full transient budget,
          // without perturbing the stalled/empty/stale accounting.
          const repeatSignature = continuationRepeatSignature(visibleContent);
          const isNonAdvancingRepeat =
            signal.reason !== "loop_limit" &&
            repeatSignature !== "" &&
            repeatSignature === lastContinuationRepeatSignature &&
            !hasInFlightTool &&
            !madeDurableToolProgress;

          if (signal.reason === "loop_limit") {
            stalledTransientContinuationAttempts = 0;
            emptyTransientContinuationAttempts = 0;
          } else {
            totalTransientContinuationAttempts += 1;
            // If a tool already completed, do not turn a missing closing
            // sentence into a scary connection failure. Give the model one
            // continuation opportunity (the completed tool itself counts as
            // progress on the first timeout); if the follow-up produces no new
            // content, stop locally with a clear completed-tool warning.
            if (
              signal.reason === "run_timeout" &&
              completedTool &&
              !hasInFlightToolCall(content) &&
              !currentPreparingToolName &&
              !madeContentProgress &&
              !hasInFlightTool
            ) {
              return {
                ok: false,
                resetVisibleContent: false,
                completedToolName: completedTool.toolName,
              };
            }
            // Bail when the same write tool is stuck in-flight across too many
            // consecutive continuations. Checked before the text-repeat guard
            // because hasInFlightTool=true would mask the repeat as progress.
            if (
              repeatedInFlightToolCount >= MAX_REPEATED_INFLIGHT_TOOL_STALLS
            ) {
              recoveryGaveUpOnInFlightTool = true;
              return { ok: false, resetVisibleContent: false };
            }
            if (
              repeatedActionPreparationCount >
              MAX_REPEATED_ACTION_PREPARATION_CONTINUATIONS
            ) {
              recoveryGaveUpOnActionPreparation = true;
              return { ok: false, resetVisibleContent: false };
            }
            // Bail fast on a non-advancing repetition loop, well before the
            // stalled/empty/total budgets would (each round otherwise re-sends
            // the whole pasted payload). Tracked separately so it never trips
            // on legitimately-progressing runs that happen to be slow.
            if (isNonAdvancingRepeat) {
              repeatedTransientContinuationAttempts += 1;
              if (
                repeatedTransientContinuationAttempts >
                MAX_REPEATED_TRANSIENT_CONTINUATIONS
              ) {
                recoveryGaveUpOnRepetition = true;
                return { ok: false, resetVisibleContent: false };
              }
            } else {
              repeatedTransientContinuationAttempts = 0;
            }
            if (repeatSignature) {
              lastContinuationRepeatSignature = repeatSignature;
            }
            // A run_timeout that produced nothing visible and no activity (the
            // model spent the whole soft-timeout window thinking before its
            // first output) is NOT an immediate give-up: a transient slow start
            // routinely recovers on the next continuation. Let it fall through
            // to the empty-continuation budget below so it retries a bounded
            // number of times before surfacing the "no visible progress" error.
            // Reset the empty-continuation counter on real progress — streamed
            // text/completed tool OR an in-flight tool the server is running —
            // not merely on a non-zero part count, which whitespace-only or
            // unresolved-only output would falsely satisfy.
            if (!madeProgress) {
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

          if (isTransient) {
            const settledInterruptedTools = settleInterruptedToolCalls(
              visibleContent,
              undefined,
              { includeActivity: true },
            );
            if (settledInterruptedTools) {
              currentPartialHistory =
                contentToContinuationHistory(visibleContent);
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

          // Keep everything visible during transient recovery. The continuation
          // prefix diff tracks what the next request has already seen, so
          // preserving text no longer causes duplicate continuation history.
          visibleContinuationPrefix = snapshotContent(content);
          return { ok: true, resetVisibleContent: false };
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
                  ...(trackInRunsTray ? { trackInRunsTray: true } : {}),
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
                  ...(approvedToolCalls ? { approvedToolCalls } : {}),
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
                let activeRunId: string | null = null;
                try {
                  const body = await res.json();
                  if (body?.activeRunId) {
                    activeRunId = String(body.activeRunId);
                  }
                } catch {
                  // Fall through to the generic response handling below.
                }
                // A 409 means the server still has an active run for this
                // thread. For a fresh user turn — a queued follow-up OR a normal
                // send fired shortly after the previous run finished (the server
                // can report a just-finished run as active for up to
                // RUN_STALE_MS while its terminal status write lands) — adopting
                // `activeRunId` below would reconnect to that prior run, replay
                // its final answer, and silently drop this turn. Wait for the
                // run to clear and retry THIS prompt instead. Only genuine
                // internal continuations (deliberate resumes of the active run)
                // fall through to the reconnect path.
                if (!internalContinuationRequest && activeRunId) {
                  queuedConflictRetries += 1;
                  if (queuedConflictRetries <= MAX_QUEUED_CONFLICT_RETRIES) {
                    await delay(500, abortSignal);
                    if (abortSignal.aborted) return;
                    continue;
                  }
                  const message =
                    "The previous response is still finishing and the new message could not start yet. Please try again.";
                  const runError = {
                    message,
                    details: `The server kept reporting active run ${activeRunId} for this thread after ${MAX_QUEUED_CONFLICT_RETRIES} retries.`,
                    errorCode: "active_run_conflict",
                    recoverable: true,
                    runId: activeRunId,
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
                    metadata: { custom: { runError } },
                  } as ChatModelRunResult;
                  clearActiveRun();
                  return;
                }
                if (activeRunId) {
                  try {
                    runId = activeRunId;
                    if (!attemptedRunIds.includes(runId)) {
                      attemptedRunIds.push(runId);
                    }
                    lastSeq = -1;
                    if (threadId) {
                      setActiveRun({ threadId, runId, lastSeq: -1 });
                    }
                    const reconnected = yield* reconnectCurrentRun();
                    if (reconnected) return;
                    await delay(1000, abortSignal);
                    if (abortSignal.aborted) return;
                    continue;
                  } catch {
                    // Fall through to the generic response handling below.
                  }
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
                  const failure = missingCredentialFailure(body);
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new Event("agent-chat:missing-api-key"),
                    );
                    window.dispatchEvent(
                      new CustomEvent("agent-chat:run-error", {
                        detail: { ...failure.runError, tabId },
                      }),
                    );
                  }
                  content.push({ type: "text", text: failure.text });
                  yield {
                    content: [...content],
                    status: {
                      type: "incomplete" as const,
                      reason: "error" as const,
                    },
                    metadata: { custom: { runError: failure.runError } },
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
              if (err.reason === "run_timeout" && !err.errorInfo) {
                const reconnected =
                  yield* reconnectBackgroundContinuationForRunTimeout();
                if (reconnected) return;
              }
              if (err.reason === "stream_ended") {
                const reconnected = yield* reconnectCurrentRun();
                if (reconnected) return;
                const activeReconnected = yield* reconnectActiveRunForThread();
                if (activeReconnected) return;
              }
              const continuation = prepareAutoContinuation(err);
              if (!continuation.ok) {
                if (continuation.completedToolName) {
                  const message = completedToolTimeoutMessage(
                    continuation.completedToolName,
                  );
                  content.push({ type: "text", text: message });
                  yield {
                    content: [...content],
                    status: {
                      type: "complete" as const,
                      reason: "stop" as const,
                    },
                    metadata: {
                      custom: {
                        ...(runId ? { runId } : {}),
                        runWarning: {
                          message,
                          errorCode: "final_response_timeout_after_tool",
                          recoverable: true,
                        },
                      },
                    },
                  };
                  clearActiveRun();
                  return;
                }
                const preservedError =
                  err.errorInfo ?? lastRecoverableRunError ?? null;
                const message =
                  preservedError?.message ??
                  exhaustedRecoveryMessage(err.reason);
                const details = [
                  preservedError?.details,
                  connectionRecoveryDetails(),
                ]
                  .filter(Boolean)
                  .join("\n\n");
                const errorCode =
                  preservedError?.errorCode ?? "connection_error";
                captureChatClientError(err, "auto-continuation-exhausted", {
                  autoContinueReason: err.reason,
                  ...(errorCode ? { errorCode } : {}),
                });
                const runError = {
                  message,
                  ...(details ? { details } : {}),
                  errorCode,
                  recoverable: preservedError?.recoverable ?? true,
                  ...(runId ? { runId } : {}),
                };
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("agent-chat:run-error", {
                      detail: { ...runError, tabId },
                    }),
                  );
                }
                settleInterruptedToolCalls(content, undefined, {
                  includeActivity: true,
                });
                content.push({
                  type: "text",
                  text: formatChatErrorText(
                    message,
                    preservedError?.upgradeUrl,
                    errorCode,
                  ),
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
              // Signal to the UI that we are in the continuation window so it
              // can display "Resuming…" instead of "Thinking" during the gap.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:auto-continue", {
                    detail: { tabId },
                  }),
                );
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
              const failure = missingCredentialFailure(errMsg);
              if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("agent-chat:missing-api-key"));
                window.dispatchEvent(
                  new CustomEvent("agent-chat:run-error", {
                    detail: { ...failure.runError, tabId },
                  }),
                );
              }
              content.push({ type: "text", text: failure.text });
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                },
                metadata: { custom: { runError: failure.runError } },
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
                if (continuation.completedToolName) {
                  const message = completedToolTimeoutMessage(
                    continuation.completedToolName,
                  );
                  content.push({ type: "text", text: message });
                  yield {
                    content: [...content],
                    status: {
                      type: "complete" as const,
                      reason: "stop" as const,
                    },
                    metadata: {
                      custom: {
                        ...(runId ? { runId } : {}),
                        runWarning: {
                          message,
                          errorCode: "final_response_timeout_after_tool",
                          recoverable: true,
                        },
                      },
                    },
                  };
                  clearActiveRun();
                  return;
                }
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
                settleInterruptedToolCalls(content, undefined, {
                  includeActivity: true,
                });
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
              // Signal to the UI that we are in the continuation window.
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("agent-chat:auto-continue", {
                    detail: { tabId },
                  }),
                );
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
