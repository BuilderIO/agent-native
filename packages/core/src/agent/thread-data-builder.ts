import type { RunEvent } from "./types.js";

interface ContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsText?: string;
  args?: Record<string, string>;
  result?: string;
}

interface BuildAssistantMessageOptions {
  suppressInternalContinuation?: boolean;
}

type AssistantMessage = NonNullable<ReturnType<typeof buildAssistantMessage>>;

function isInternalContinuationError(event: {
  error: string;
  errorCode?: string;
  recoverable?: boolean;
}): boolean {
  const code = String(event.errorCode ?? "").toLowerCase();
  const msg = event.error.toLowerCase();
  return (
    event.recoverable === true ||
    code === "builder_gateway_error" ||
    code === "builder_gateway_timeout" ||
    code === "stale_run" ||
    code === "timeout" ||
    code === "timeout_error" ||
    code === "http_408" ||
    code === "http_429" ||
    code === "http_500" ||
    code === "http_502" ||
    code === "http_503" ||
    code === "http_504" ||
    code === "rate_limited" ||
    code === "too_many_concurrent_requests" ||
    code === "overloaded_error" ||
    msg.includes("timeout") ||
    msg.includes("gateway error") ||
    msg.includes("gateway timeout") ||
    msg.includes("inactivity timeout") ||
    msg.includes("stream ended") ||
    msg.includes("stream closed") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("529")
  );
}

/**
 * Reconstruct an assistant-ui message from raw agent run events.
 * Mirrors the client-side processEvent logic so the server can persist
 * the assistant's response even if the frontend is disconnected.
 */
export function buildAssistantMessage(
  events: RunEvent[],
  runId?: string,
  options: BuildAssistantMessageOptions = {},
): {
  id: string;
  createdAt: Date;
  role: "assistant";
  content: ContentPart[];
  status:
    | { type: "complete"; reason: "stop" }
    | { type: "incomplete"; reason: "error" };
  metadata: Record<string, unknown>;
} | null {
  const content: ContentPart[] = [];
  let toolCallCounter = 0;
  let runError: {
    message: string;
    errorCode?: string;
    details?: string;
    recoverable?: boolean;
  } | null = null;
  let endedAtInternalContinuationBoundary = false;

  const appendText = (text: string) => {
    const last = content[content.length - 1];
    if (last && last.type === "text") {
      last.text = (last.text ?? "") + text;
    } else {
      content.push({ type: "text", text });
    }
  };

  for (const { event } of events) {
    if (event.type === "clear") {
      content.length = 0;
      toolCallCounter = 0;
      continue;
    }

    if (event.type === "text") {
      appendText(event.text ?? "");
      continue;
    }

    if (event.type === "tool_start") {
      const toolCallId = `tc_${++toolCallCounter}`;
      const args = (event.input ?? {}) as Record<string, string>;
      content.push({
        type: "tool-call",
        toolCallId,
        toolName: event.tool ?? "unknown",
        argsText: JSON.stringify(args),
        args,
      });
      continue;
    }

    if (event.type === "tool_done") {
      for (let i = content.length - 1; i >= 0; i--) {
        const part = content[i];
        if (
          part.type === "tool-call" &&
          part.toolName === event.tool &&
          part.result === undefined
        ) {
          part.result = event.result ?? "";
          break;
        }
      }
      continue;
    }

    if (event.type === "loop_limit") {
      // Older servers emitted this as a user-visible terminal event. Treat it
      // as an internal continuation boundary when rebuilding persisted turns.
      if (options.suppressInternalContinuation) {
        endedAtInternalContinuationBoundary = true;
      }
      continue;
    }

    if (event.type === "auto_continue") {
      if (options.suppressInternalContinuation) {
        endedAtInternalContinuationBoundary = true;
      }
      continue;
    }

    if (event.type === "error") {
      if (
        options.suppressInternalContinuation &&
        isInternalContinuationError(event)
      ) {
        endedAtInternalContinuationBoundary = true;
        continue;
      }
      if (event.errorCode === "run_timeout" && event.recoverable) {
        continue;
      }
      runError = {
        message: event.error,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.details ? { details: event.details } : {}),
        ...(event.recoverable ? { recoverable: event.recoverable } : {}),
      };
      appendText(`${content.length > 0 ? "\n\n" : ""}Error: ${event.error}`);
      continue;
    }

    // done, missing_api_key — terminal signals, not content
  }

  if (content.length === 0 || endedAtInternalContinuationBoundary) return null;

  const metadata: Record<string, unknown> = {};
  if (runId) metadata.runId = runId;
  if (runError) {
    metadata.custom = {
      runError: {
        ...runError,
        ...(runId ? { runId } : {}),
      },
    };
  }

  return {
    id: `server-${runId ?? Date.now()}`,
    createdAt: new Date(),
    role: "assistant",
    content,
    status: runError
      ? { type: "incomplete" as const, reason: "error" as const }
      : { type: "complete" as const, reason: "stop" as const },
    metadata,
  };
}

function getStoredMessage(entry: any): any {
  return entry?.message ?? entry;
}

function getMessageRunId(message: any): string | undefined {
  const meta = message?.metadata;
  const direct = meta?.runId;
  const custom = meta?.custom?.runId;
  const errorRun = meta?.custom?.runError?.runId ?? meta?.runError?.runId;
  if (typeof direct === "string") return direct;
  if (typeof custom === "string") return custom;
  if (typeof errorRun === "string") return errorRun;
  return undefined;
}

function messageContentIsEmpty(content: unknown): boolean {
  if (Array.isArray(content)) return content.length === 0;
  return content == null || content === "";
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part: any) => part?.type === "text" && typeof part.text === "string",
    )
    .map((part: any) => part.text)
    .join("");
}

function isTerminalAssistantStatus(status: unknown): boolean {
  const type = (status as { type?: unknown } | undefined)?.type;
  return type === "complete" || type === "incomplete";
}

function messageIdentityKeys(message: any): string[] {
  const keys: string[] = [];
  if (typeof message?.id === "string" && message.id) {
    keys.push(`id:${message.id}`);
  }
  const runId = getMessageRunId(message);
  if (runId) keys.push(`run:${runId}`);

  try {
    keys.push(
      `fingerprint:${JSON.stringify({
        role: message?.role,
        content: message?.content,
        attachments: message?.attachments,
      })}`,
    );
  } catch {
    // Best effort. id/runId usually exist for persisted assistant-ui rows.
  }
  return keys;
}

function chooseMergedMessageEntry(existingEntry: any, incomingEntry: any): any {
  const existing = getStoredMessage(existingEntry);
  const incoming = getStoredMessage(incomingEntry);
  if (
    existing?.role === "assistant" &&
    incoming?.role === "assistant" &&
    isTerminalAssistantStatus(existing?.status) &&
    !isTerminalAssistantStatus(incoming?.status)
  ) {
    return existingEntry;
  }
  return incomingEntry;
}

/**
 * Merge an incoming client-side full-thread save over the current SQL copy.
 *
 * The browser exports and PUTs the whole assistant-ui repository. If a server
 * completion save lands first, an older browser export can otherwise replace
 * `thread_data` wholesale and delete the assistant message the server just
 * reconstructed from run events. Preserve server-only messages while still
 * accepting client-only messages and metadata.
 */
export function mergeThreadDataForClientSave(
  existingRepo: any,
  incomingRepo: any,
) {
  const merged =
    incomingRepo && typeof incomingRepo === "object" ? incomingRepo : {};
  if (
    existingRepo &&
    typeof existingRepo === "object" &&
    existingRepo.queuedMessages !== undefined &&
    merged.queuedMessages === undefined
  ) {
    merged.queuedMessages = existingRepo.queuedMessages;
  }

  const existingMessages = Array.isArray(existingRepo?.messages)
    ? existingRepo.messages
    : null;
  const incomingMessages = Array.isArray(merged.messages)
    ? merged.messages
    : null;
  if (!existingMessages || !incomingMessages) return merged;

  const incomingKeySets = incomingMessages.map(
    (entry: any) => new Set(messageIdentityKeys(getStoredMessage(entry))),
  );
  const usedIncoming = new Set<number>();
  const nextMessages: any[] = [];

  for (const existingEntry of existingMessages) {
    const existingKeys = messageIdentityKeys(getStoredMessage(existingEntry));
    const incomingIndex = incomingKeySets.findIndex(
      (keys, index) =>
        !usedIncoming.has(index) && existingKeys.some((key) => keys.has(key)),
    );

    if (incomingIndex === -1) {
      nextMessages.push(existingEntry);
      continue;
    }

    usedIncoming.add(incomingIndex);
    nextMessages.push(
      chooseMergedMessageEntry(existingEntry, incomingMessages[incomingIndex]),
    );
  }

  for (let index = 0; index < incomingMessages.length; index++) {
    if (!usedIncoming.has(index)) nextMessages.push(incomingMessages[index]);
  }

  merged.messages = nextMessages;
  return merged;
}

function shouldReplaceLastAssistant(
  lastMessage: any,
  assistantMsg: AssistantMessage,
): boolean {
  const lastContent = lastMessage?.content;
  if (messageContentIsEmpty(lastContent)) return true;

  const lastRunId = getMessageRunId(lastMessage);
  const nextRunId = getMessageRunId(assistantMsg);
  if (lastRunId && nextRunId && lastRunId === nextRunId) return true;
  if (lastRunId && nextRunId && lastRunId !== nextRunId) return false;

  const lastStatus = lastMessage?.status;
  if (lastStatus && !isTerminalAssistantStatus(lastStatus)) return true;

  try {
    if (JSON.stringify(lastContent) === JSON.stringify(assistantMsg.content)) {
      return true;
    }
  } catch {
    // Fall through to the text-prefix check.
  }

  const lastText = messageText(lastContent).trim();
  const nextText = messageText(assistantMsg.content).trim();
  if (isTerminalAssistantStatus(lastStatus)) return false;
  return Boolean(lastText && nextText && nextText.startsWith(lastText));
}

/**
 * Merge the server-reconstructed assistant message into persisted
 * assistant-ui thread data.
 *
 * The browser periodically saves thread data while a run is still streaming.
 * That can leave the last assistant message non-empty but partial/pending.
 * Completion must replace that same-run partial message instead of treating
 * any assistant content as proof that the frontend already saved the final
 * turn.
 */
export function upsertAssistantMessage(
  repo: any,
  assistantMsg: AssistantMessage,
): any {
  const nextRepo = repo && typeof repo === "object" ? repo : {};
  if (!Array.isArray(nextRepo.messages)) nextRepo.messages = [];

  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);
  const lastRole = lastMsg?.role;
  const isWrapped = Boolean(lastEntry && "message" in lastEntry);

  if (
    lastRole === "assistant" &&
    shouldReplaceLastAssistant(lastMsg, assistantMsg)
  ) {
    nextRepo.messages[lastIndex] = isWrapped
      ? { ...lastEntry, message: assistantMsg }
      : assistantMsg;
    return nextRepo;
  }

  if (isWrapped) {
    const parentId =
      nextRepo.messages.length > 0
        ? (getStoredMessage(nextRepo.messages[nextRepo.messages.length - 1])
            ?.id ?? null)
        : null;
    nextRepo.messages.push({ message: assistantMsg, parentId });
  } else {
    nextRepo.messages.push(assistantMsg);
  }
  return nextRepo;
}

/**
 * Extract title and preview from a thread runtime export.
 * Isomorphic — works on both server and client.
 */
export function extractThreadMeta(repo: any): {
  title: string;
  preview: string;
} {
  const msgs = repo?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0)
    return { title: "", preview: "" };

  let title = "";
  let preview = "";
  for (const entry of msgs) {
    // Support both wrapped ({ message: { role, content } }) and flat ({ role, content }) formats
    const msg = entry?.message ?? entry;
    if (msg.role !== "user") continue;
    const textParts = Array.isArray(msg.content)
      ? msg.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ")
      : typeof msg.content === "string"
        ? msg.content
        : "";
    if (textParts.trim()) {
      if (!title) title = textParts.trim().slice(0, 80);
      preview = textParts.trim().slice(0, 120);
    }
  }
  return { title, preview };
}
