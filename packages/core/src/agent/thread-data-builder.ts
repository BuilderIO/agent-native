import type { AgentChatAttachment, RunEvent } from "./types.js";

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
type UserMessage = ReturnType<typeof buildUserMessage>;

const MAX_STORED_ATTACHMENT_CHARS = 60_000;

function isInternalContinuationError(event: {
  error: string;
  errorCode?: string;
  recoverable?: boolean;
}): boolean {
  const code = String(event.errorCode ?? "").toLowerCase();
  const msg = event.error.toLowerCase();
  if (code === "builder_gateway_error") return false;
  return (
    event.recoverable === true ||
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

function getStoredParentId(entry: any): string | null | undefined {
  return typeof entry?.parentId === "string" || entry?.parentId === null
    ? entry.parentId
    : undefined;
}

function getStoredRunConfig(entry: any): any {
  return entry && typeof entry === "object" && "runConfig" in entry
    ? entry.runConfig
    : undefined;
}

function messageId(message: any): string | undefined {
  return typeof message?.id === "string" && message.id ? message.id : undefined;
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

function normalizeAttachmentIdentity(attachments: unknown): unknown {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments.map((att: any) => ({
    type: att?.type,
    name: att?.name,
    contentType: att?.contentType,
  }));
}

function messageIdentityKeys(message: any): string[] {
  const keys: string[] = [];
  if (typeof message?.id === "string" && message.id) {
    keys.push(`id:${message.id}`);
  }
  const runId = getMessageRunId(message);
  if (runId) keys.push(`run:${runId}`);

  // Normalize attachments through `normalizeAttachmentIdentity` so an
  // explicit empty `[]` (assistant-ui's default for messages with no
  // attachments) and an omitted/undefined `attachments` field hash to the
  // same fingerprint. Without this, every user message ended up duplicated
  // in `chat_threads`: one copy from `saveThreadData` (runtime export
  // includes `attachments: []`) and one from `persistSubmittedUserMessage`
  // → `buildUserMessage` (omits the field entirely). The merge couldn't
  // dedupe them because their fingerprints differed by exactly one
  // `[]` vs `undefined`. (Repro on slides prod: every user turn produced
  // a `client_user → assistant → server_user` triple instead of a
  // `user → assistant` pair.)
  try {
    keys.push(
      `fingerprint:${JSON.stringify({
        role: message?.role,
        content: message?.content,
        attachments: normalizeAttachmentIdentity(message?.attachments),
      })}`,
    );
  } catch {
    // Best effort. id/runId usually exist for persisted assistant-ui rows.
  }
  if (message?.role === "user") {
    try {
      keys.push(
        `user-fingerprint:${JSON.stringify({
          role: message.role,
          content: message.content,
          attachments: normalizeAttachmentIdentity(message.attachments),
        })}`,
      );
    } catch {
      // Same best-effort behavior as the full fingerprint.
    }
  }
  return keys;
}

function messagesMatch(a: any, b: any): boolean {
  const bKeys = new Set(messageIdentityKeys(b));
  return messageIdentityKeys(a).some((key) => bKeys.has(key));
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

function normalizeMessageEntry(
  entry: any,
  parentId: string | null,
): { message: any; parentId: string | null; runConfig?: any } | null {
  const message = getStoredMessage(entry);
  if (!messageId(message)) return null;
  const runConfig = getStoredRunConfig(entry);
  return {
    message,
    parentId,
    ...(runConfig !== undefined ? { runConfig } : {}),
  };
}

/**
 * Convert legacy/partially merged thread data into assistant-ui's exported
 * repository shape and repair parent links so `threadRuntime.import()` cannot
 * fail with "Parent message not found".
 */
export function normalizeThreadRepository(repo: any): any {
  const normalized = repo && typeof repo === "object" ? { ...repo } : {};
  const sourceMessages = Array.isArray(repo?.messages) ? repo.messages : [];
  const messages: Array<{
    message: any;
    parentId: string | null;
    runConfig?: any;
  }> = [];
  const seenIds = new Set<string>();
  let previousId: string | null = null;

  for (const entry of sourceMessages) {
    const message = getStoredMessage(entry);
    const id = messageId(message);
    if (!id) continue;

    const requestedParentId = getStoredParentId(entry);
    const parentId =
      requestedParentId === null
        ? null
        : requestedParentId && seenIds.has(requestedParentId)
          ? requestedParentId
          : previousId;

    const normalizedEntry = normalizeMessageEntry(entry, parentId);
    if (!normalizedEntry) continue;

    messages.push(normalizedEntry);
    seenIds.add(id);
    previousId = id;
  }

  normalized.messages = messages;
  const headId = typeof repo?.headId === "string" ? repo.headId : undefined;
  normalized.headId =
    headId && seenIds.has(headId) ? headId : (previousId ?? null);
  return normalized;
}

function rewriteEntryParentId(
  entry: any,
  idRewrites: Map<string, string>,
): any {
  const parentId = getStoredParentId(entry);
  if (!parentId) return entry;
  const rewritten = idRewrites.get(parentId);
  if (!rewritten) return entry;
  return { ...entry, parentId: rewritten };
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
export interface MergeThreadDataOptions {
  preserveExistingQueuedMessages?: boolean;
  preserveExistingTopLevelKeys?: boolean;
}

export function mergeThreadDataForClientSave(
  existingRepo: any,
  incomingRepo: any,
  options: MergeThreadDataOptions = {},
) {
  const preserveExistingQueuedMessages =
    options.preserveExistingQueuedMessages ?? true;
  const preserveExistingTopLevelKeys =
    options.preserveExistingTopLevelKeys ?? true;
  const existingNormalized = normalizeThreadRepository(existingRepo);
  const incomingNormalized = normalizeThreadRepository(incomingRepo);
  const merged =
    incomingNormalized && typeof incomingNormalized === "object"
      ? { ...incomingNormalized }
      : {};
  if (
    preserveExistingTopLevelKeys &&
    existingNormalized &&
    typeof existingNormalized === "object"
  ) {
    for (const [key, value] of Object.entries(existingNormalized)) {
      if (key === "messages" || key === "headId") continue;
      if (key === "queuedMessages" && !preserveExistingQueuedMessages) {
        continue;
      }
      if (!(key in merged)) {
        merged[key] = value;
      }
    }
  } else if (
    preserveExistingQueuedMessages &&
    existingNormalized &&
    typeof existingNormalized === "object" &&
    existingNormalized.queuedMessages !== undefined &&
    merged.queuedMessages === undefined
  ) {
    merged.queuedMessages = existingNormalized.queuedMessages;
  }

  const existingMessages = Array.isArray(existingNormalized?.messages)
    ? existingNormalized.messages
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
  const idRewrites = new Map<string, string>();

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
    const incomingEntry = incomingMessages[incomingIndex];
    const chosen = chooseMergedMessageEntry(existingEntry, incomingEntry);
    const existingId = messageId(getStoredMessage(existingEntry));
    const chosenId = messageId(getStoredMessage(chosen));
    if (existingId && chosenId && existingId !== chosenId) {
      idRewrites.set(existingId, chosenId);
    }
    nextMessages.push(chosen);
  }

  for (let index = 0; index < incomingMessages.length; index++) {
    if (!usedIncoming.has(index)) nextMessages.push(incomingMessages[index]);
  }

  merged.messages = nextMessages.map((entry) =>
    rewriteEntryParentId(entry, idRewrites),
  );
  return normalizeThreadRepository(merged);
}

function escapeAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unwrapTextAttachmentEnvelope(text: string): string {
  const match = text.match(
    /^<attachment\b[^>]*>\n?([\s\S]*?)\n?<\/attachment>$/,
  );
  return match ? match[1] : text;
}

function truncateStoredAttachment(text: string): string {
  const unwrapped = unwrapTextAttachmentEnvelope(text);
  if (unwrapped.length <= MAX_STORED_ATTACHMENT_CHARS) return unwrapped;
  const omitted = unwrapped.length - MAX_STORED_ATTACHMENT_CHARS;
  return `${unwrapped.slice(0, MAX_STORED_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_STORED_ATTACHMENT_CHARS.toLocaleString()} characters; ${omitted.toLocaleString()} characters omitted from persisted chat history.]`;
}

function textAttachmentEnvelope(
  att: AgentChatAttachment,
  text: string,
): string {
  const attrs = [
    `name="${escapeAttachmentAttribute(att.name || "attachment")}"`,
    att.contentType
      ? `contentType="${escapeAttachmentAttribute(att.contentType)}"`
      : null,
    att.type ? `type="${escapeAttachmentAttribute(att.type)}"` : null,
  ].filter(Boolean);
  return `<attachment ${attrs.join(" ")}>\n${truncateStoredAttachment(text)}\n</attachment>`;
}

function buildStoredAttachments(
  attachments: AgentChatAttachment[] | undefined,
  runId: string | undefined,
): any[] {
  return (attachments ?? [])
    .map((att, index) => {
      const id = `server-${runId ?? Date.now()}-attachment-${index}`;
      if (att.type === "image" && att.data) {
        return {
          id,
          type: "image",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content: [{ type: "image", image: att.data }],
        };
      }
      if (att.data) {
        return {
          id,
          type: "file",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content: [
            {
              type: "file",
              data: att.data,
              mimeType: att.contentType,
              filename: att.name,
            },
          ],
        };
      }
      if (typeof att.text === "string" && att.text.length > 0) {
        return {
          id,
          type: "file",
          name: att.name,
          contentType: att.contentType,
          status: { type: "complete" },
          content: [
            { type: "text", text: textAttachmentEnvelope(att, att.text) },
          ],
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function buildUserMessage(opts: {
  text: string;
  attachments?: AgentChatAttachment[];
  runId?: string;
  createdAt?: Date;
}): {
  id: string;
  createdAt: Date;
  role: "user";
  content: ContentPart[];
  attachments?: any[];
  metadata: Record<string, unknown>;
} {
  const attachments = buildStoredAttachments(opts.attachments, opts.runId);
  return {
    id: `server-user-${opts.runId ?? Date.now()}`,
    createdAt: opts.createdAt ?? new Date(),
    role: "user",
    content: [{ type: "text", text: opts.text }],
    ...(attachments.length > 0 ? { attachments } : {}),
    metadata: {
      custom: {
        submittedRunId: opts.runId,
      },
    },
  };
}

export function upsertUserMessage(repo: any, userMsg: UserMessage): any {
  const nextRepo = normalizeThreadRepository(repo);

  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);
  if (lastMsg?.role === "user" && messagesMatch(lastMsg, userMsg)) {
    return nextRepo;
  }

  const parentId =
    lastIndex >= 0 ? (messageId(getStoredMessage(lastEntry)) ?? null) : null;
  nextRepo.messages.push({ message: userMsg, parentId });
  nextRepo.headId = userMsg.id;
  return nextRepo;
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
  const nextRepo = normalizeThreadRepository(repo);

  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);
  const lastRole = lastMsg?.role;

  if (
    lastRole === "assistant" &&
    shouldReplaceLastAssistant(lastMsg, assistantMsg)
  ) {
    nextRepo.messages[lastIndex] = { ...lastEntry, message: assistantMsg };
    nextRepo.headId = assistantMsg.id;
    return nextRepo;
  }

  const parentId =
    nextRepo.messages.length > 0
      ? (messageId(
          getStoredMessage(nextRepo.messages[nextRepo.messages.length - 1]),
        ) ?? null)
      : null;
  nextRepo.messages.push({ message: assistantMsg, parentId });
  nextRepo.headId = assistantMsg.id;
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
