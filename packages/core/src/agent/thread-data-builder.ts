import type { AgentChatAttachment, RunEvent } from "./types.js";
import type { EngineMessage } from "./engine/types.js";
import {
  normalizeCodeAgentTranscript,
  type CodeAgentTranscriptEvent as CoreCodeAgentTranscriptEvent,
  type NormalizedCodeAgentStatusEvent,
  type NormalizedCodeAgentToolEvent,
  type NormalizedCodeAgentTranscriptItem,
} from "../code-agents/transcript-normalizer.js";

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
  /**
   * Logical-turn identity. When set it is stamped onto the message metadata so
   * continuation runs of the same turn can be folded onto a single durable
   * assistant message (see foldAssistantTurn) instead of each run dropping or
   * overwriting the others.
   */
  turnId?: string;
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
      toolCallCounter += 1;
      const toolCallId = runId
        ? `${runId}:tc_${toolCallCounter}`
        : `tc_${toolCallCounter}`;
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

  // Only a truly empty turn produces nothing to persist. A turn that ended at
  // an internal continuation boundary (soft-timeout auto_continue, a
  // recoverable gateway error, suppressed loop_limit) DID stream real content
  // — persist it as a partial so the continuation run can fold the next chunk
  // onto it (foldAssistantTurn) instead of the earlier text being dropped.
  if (content.length === 0) return null;

  const continued = endedAtInternalContinuationBoundary;

  const custom: Record<string, unknown> = {};
  if (options.turnId) custom.turnId = options.turnId;
  if (runId) custom.foldedRunIds = [runId];
  if (continued) custom.continued = true;
  if (runError) {
    custom.runError = {
      ...runError,
      ...(runId ? { runId } : {}),
    };
  }

  const metadata: Record<string, unknown> = {};
  if (runId) metadata.runId = runId;
  if (Object.keys(custom).length > 0) metadata.custom = custom;

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

// Strip the render-only `toolCallId` before fingerprinting. The id is generated
// differently depending on who built the message — the server now scopes it by
// run (`${runId}:tc_1`) while the client's live stream uses a bare counter
// (`tc_1`) — so the client export and the server fold of the SAME tool-call turn
// would otherwise hash to different fingerprints and fail to dedupe, leaving the
// turn rendered twice. The id never participates in message identity (history
// replay regenerates its own ids), so hashing content without it is the correct
// notion of "same message".
function normalizeContentForFingerprint(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part: any) =>
    part && typeof part === "object" && part.type === "tool-call"
      ? { ...part, toolCallId: undefined }
      : part,
  );
}

function messageIdentityKeys(message: any): string[] {
  const keys: string[] = [];
  if (typeof message?.id === "string" && message.id) {
    keys.push(`id:${message.id}`);
  }
  const runId = getMessageRunId(message);
  if (runId) keys.push(`run:${runId}`);
  // A logical turn is ONE durable assistant message even though it may span
  // several continuation runs, so two messages sharing a turnId (e.g. the
  // client export and the server fold of the same answer) must dedupe to one.
  const turnId = turnIdOf(message);
  if (turnId) keys.push(`turn:${turnId}`);

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
        content: normalizeContentForFingerprint(message?.content),
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
          content: normalizeContentForFingerprint(message.content),
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
  // Same logical turn (client export vs server fold of one accumulating
  // answer): never shrink — keep whichever side accumulated more content, so a
  // stale/lossy export can't overwrite the richer folded turn. Ties prefer the
  // terminal copy.
  const existingTurn = turnIdOf(existing);
  const incomingTurn = turnIdOf(incoming);
  if (
    existing?.role === "assistant" &&
    incoming?.role === "assistant" &&
    existingTurn &&
    existingTurn === incomingTurn
  ) {
    const existingWeight = assistantContentWeight(existing.content);
    const incomingWeight = assistantContentWeight(incoming.content);
    if (existingWeight > incomingWeight) return existingEntry;
    if (incomingWeight > existingWeight) return incomingEntry;
    return isTerminalAssistantStatus(existing?.status) &&
      !isTerminalAssistantStatus(incoming?.status)
      ? existingEntry
      : incomingEntry;
  }
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
  const normalizedMessage = normalizeAssistantToolCallIds(message);
  const runConfig = getStoredRunConfig(entry);
  return {
    message: normalizedMessage,
    parentId,
    ...(runConfig !== undefined ? { runConfig } : {}),
  };
}

function uniqueToolCallId(toolCallId: string, seen: Set<string>): string {
  if (!seen.has(toolCallId)) return toolCallId;
  let suffix = 2;
  let candidate = `${toolCallId}__dedup_${suffix}`;
  while (seen.has(candidate)) {
    suffix += 1;
    candidate = `${toolCallId}__dedup_${suffix}`;
  }
  return candidate;
}

function normalizeAssistantToolCallIds(message: any): any {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return message;
  }

  const seen = new Set<string>();
  let changed = false;
  const content = message.content.map((part: any) => {
    if (
      part?.type !== "tool-call" ||
      typeof part.toolCallId !== "string" ||
      part.toolCallId.length === 0
    ) {
      return part;
    }

    const nextToolCallId = uniqueToolCallId(part.toolCallId, seen);
    seen.add(nextToolCallId);
    if (nextToolCallId === part.toolCallId) return part;
    changed = true;
    return { ...part, toolCallId: nextToolCallId };
  });

  return changed ? { ...message, content } : message;
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

/**
 * Rebuild a flat `EngineMessage[]` from persisted thread_data (the
 * assistant-ui ExportedMessageRepository shape). Text-only — tool calls/results
 * are flattened to their text so a continuation run gets the conversation
 * prefix as plain context (Anthropic's prompt cache makes the resume cheap).
 *
 * Used to resume a background sub-agent in a fresh function invocation (the
 * server-side analog of the browser re-POSTing history for the main chat).
 * Originally inlined in `integrations/webhook-handler.ts`.
 */
export function threadDataToEngineMessages(
  threadData: string | Record<string, unknown> | null | undefined,
): EngineMessage[] {
  const messages: EngineMessage[] = [];
  if (!threadData) return messages;
  let data: any;
  try {
    data = typeof threadData === "string" ? JSON.parse(threadData) : threadData;
  } catch {
    return messages;
  }
  if (!Array.isArray(data?.messages)) return messages;
  for (const entry of data.messages) {
    const m = entry?.message ?? entry;
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter(
                (c: any) => c?.type === "text" && typeof c.text === "string",
              )
              .map((c: any) => c.text)
              .join("\n")
          : "";
    if (!text.trim()) continue;
    messages.push({ role: m.role, content: [{ type: "text", text }] });
  }
  return messages;
}

export interface CodeAgentThreadTranscriptEvent {
  id: string;
  runId: string;
  kind?: CoreCodeAgentTranscriptEvent["kind"];
  type?: CoreCodeAgentTranscriptEvent["kind"] | "note";
  message?: string;
  text?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  artifactPath?: string;
  artifactUrl?: string;
}

export interface BuildRepositoryFromCodeAgentTranscriptOptions {
  hideCredentialMessages?: boolean;
}

export function buildRepositoryFromCodeAgentTranscript(
  events: readonly CodeAgentThreadTranscriptEvent[],
  options: BuildRepositoryFromCodeAgentTranscriptOptions = {},
): any {
  const normalized = normalizeCodeAgentTranscript(
    events.map(toCoreCodeAgentTranscriptEvent),
  );
  const repo: {
    headId: string | null;
    messages: Array<{ message: any; parentId: string | null }>;
  } = {
    headId: null,
    messages: [],
  };

  let headId: string | null = null;
  let assistantTurn: {
    turnIndex: number;
    id: string;
    createdAt: string;
    updatedAt: string;
    runId?: string;
    content: ContentPart[];
    eventIds: string[];
  } | null = null;

  const flushAssistant = () => {
    if (!assistantTurn || assistantTurn.content.length === 0) {
      assistantTurn = null;
      return;
    }
    const message = {
      id: assistantTurn.id,
      createdAt: new Date(assistantTurn.createdAt),
      role: "assistant" as const,
      content: assistantTurn.content,
      status: { type: "complete" as const, reason: "stop" as const },
      metadata: {
        ...(assistantTurn.runId ? { runId: assistantTurn.runId } : {}),
        custom: {
          codeAgentTranscriptEventIds: assistantTurn.eventIds,
        },
      },
    };
    repo.messages.push({ message, parentId: headId });
    headId = message.id;
    repo.headId = headId;
    assistantTurn = null;
  };

  for (const item of normalized.items) {
    if (item.type === "user") {
      flushAssistant();
      const runId = item.events[0]?.runId;
      const userMessage = buildUserMessage({
        text: item.text,
        attachments: codeAgentAttachmentsFromEvents(item.events),
        runId: runId ? `${runId}-${item.id}` : item.id,
        createdAt: new Date(item.createdAt),
      });
      userMessage.id = `code-user-${item.id}`;
      const existingCustom =
        userMessage.metadata.custom &&
        typeof userMessage.metadata.custom === "object"
          ? (userMessage.metadata.custom as Record<string, unknown>)
          : {};
      userMessage.metadata = {
        ...userMessage.metadata,
        custom: {
          ...existingCustom,
          submittedRunId: runId,
          codeAgentTranscriptEventIds: item.eventIds,
        },
      };
      repo.messages.push({ message: userMessage, parentId: headId });
      headId = userMessage.id;
      repo.headId = headId;
      continue;
    }

    const content = contentPartForCodeAgentTranscriptItem(item, options);
    if (!content) continue;

    if (!assistantTurn || assistantTurn.turnIndex !== item.turnIndex) {
      flushAssistant();
      assistantTurn = {
        turnIndex: item.turnIndex,
        id: `code-assistant-${item.turnIndex}-${item.id}`,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        runId: item.events[0]?.runId,
        content: [],
        eventIds: [],
      };
    }
    assistantTurn.updatedAt = item.updatedAt;
    assistantTurn.eventIds.push(...item.eventIds);
    if (content.type === "text") {
      const last = assistantTurn.content.at(-1);
      if (last?.type === "text") {
        last.text = `${last.text}${last.text ? "\n\n" : ""}${content.text}`;
      } else {
        assistantTurn.content.push(content);
      }
    } else {
      assistantTurn.content.push(content);
    }
  }

  flushAssistant();
  return normalizeThreadRepository(repo);
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

function toCoreCodeAgentTranscriptEvent(
  event: CodeAgentThreadTranscriptEvent,
): CoreCodeAgentTranscriptEvent {
  return {
    schemaVersion: 1,
    id: event.id,
    runId: event.runId,
    kind: (event.kind ??
      event.type ??
      "status") as CoreCodeAgentTranscriptEvent["kind"],
    message: event.message ?? event.text ?? "",
    createdAt: event.createdAt,
    metadata: {
      ...(event.metadata ?? {}),
      ...(event.artifactPath ? { artifactPath: event.artifactPath } : {}),
      ...(event.artifactUrl ? { artifactUrl: event.artifactUrl } : {}),
    },
  };
}

function contentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentTranscriptItem,
  options: BuildRepositoryFromCodeAgentTranscriptOptions,
): ContentPart | null {
  if (item.type === "assistant") {
    return item.text.trim() ? { type: "text", text: item.text } : null;
  }
  if (item.type === "tool") {
    return toolContentPartForCodeAgentTranscriptItem(item);
  }
  if (item.type === "status") {
    const text = statusTextForCodeAgentTranscriptItem(item, options);
    return text ? { type: "text", text } : null;
  }
  return null;
}

function toolContentPartForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentToolEvent,
): ContentPart {
  return {
    type: "tool-call",
    toolCallId: `code-tool-${item.id}`,
    toolName: item.tool ?? item.label ?? "code-agent",
    argsText: previewCodeAgentTranscriptValue(item.input) ?? "",
    args: recordArgsForCodeAgentTool(item.input),
    ...(item.result !== undefined
      ? { result: previewCodeAgentTranscriptValue(item.result) ?? "" }
      : {}),
  };
}

function statusTextForCodeAgentTranscriptItem(
  item: NormalizedCodeAgentStatusEvent,
  options: BuildRepositoryFromCodeAgentTranscriptOptions,
): string | null {
  if (options.hideCredentialMessages && isCredentialCodeAgentText(item.text)) {
    return null;
  }
  if (item.statusKind === "artifact") {
    const event = item.events[0];
    const path =
      stringRecordValue(event?.metadata, "artifactPath") ??
      stringRecordValue(event?.metadata, "path");
    const url = stringRecordValue(event?.metadata, "artifactUrl");
    const target = url ?? path;
    return target
      ? `Artifact: ${item.text}\n${target}`
      : `Artifact: ${item.text}`;
  }
  if (item.level === "info" && item.statusKind !== "note") return null;
  return item.text;
}

function codeAgentAttachmentsFromEvents(
  events: readonly CoreCodeAgentTranscriptEvent[],
): AgentChatAttachment[] {
  for (const event of events) {
    const raw = event.metadata?.attachments;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const attachments: AgentChatAttachment[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const name = stringRecordValue(record, "name");
      if (!name) continue;
      const contentType = stringRecordValue(record, "type");
      const text = stringRecordValue(record, "text");
      const dataUrl = stringRecordValue(record, "dataUrl");
      attachments.push({
        type: dataUrl ? "image" : "file",
        name,
        ...(contentType ? { contentType } : {}),
        ...(text ? { text } : {}),
        ...(dataUrl ? { data: dataUrl } : {}),
      });
    }
    if (attachments.length > 0) return attachments;
  }
  return [];
}

function recordArgsForCodeAgentTool(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] =
      typeof entry === "string"
        ? entry
        : (previewCodeAgentTranscriptValue(entry) ?? "");
  }
  return result;
}

function previewCodeAgentTranscriptValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
}

function stringRecordValue(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCredentialCodeAgentText(value: string): boolean {
  return /No LLM provider key was found|Missing credentials/i.test(value);
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

function turnIdOf(message: any): string | undefined {
  const t = message?.metadata?.custom?.turnId;
  return typeof t === "string" && t ? t : undefined;
}

function foldedRunIdsOf(message: any): string[] {
  const ids = message?.metadata?.custom?.foldedRunIds;
  return Array.isArray(ids)
    ? ids.filter((x: unknown): x is string => typeof x === "string")
    : [];
}

/** Rough size of an assistant message's content, used only to pick the larger
 *  of two representations of the same chunk so a fold can never shrink. */
function assistantContentWeight(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let weight = 0;
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      weight += part.text.length;
    } else {
      weight += 1;
    }
  }
  return weight;
}

/** Concatenate continuation content onto the accumulated turn, merging a
 *  trailing+leading text run so the resumed answer reads as one flowing
 *  message rather than two stacked fragments. */
function appendFoldedContent(existing: any[], incoming: any[]): any[] {
  const merged = existing.map((p) => ({ ...p }));
  for (const part of incoming) {
    const last = merged[merged.length - 1];
    if (
      part?.type === "text" &&
      typeof part.text === "string" &&
      last?.type === "text" &&
      typeof last.text === "string"
    ) {
      last.text = `${last.text}${part.text}`;
    } else {
      merged.push({ ...part });
    }
  }
  return normalizeAssistantToolCallIds({
    role: "assistant",
    content: merged,
  }).content;
}

/**
 * Fold a continuation run's assistant message onto the single durable message
 * for its logical turn (identified by `turnId`), so a turn that spans several
 * continuation runs accumulates into ONE message that only ever grows. This is
 * the server-side analog of an append-only rollout: the durable transcript is
 * a monotonic fold over every run in the turn, never a per-run snapshot that
 * drops the earlier chunks.
 *
 * Idempotent and never-shrinking, so it is safe to run alongside the client's
 * full-thread export (which may write the same turn from the other side):
 *   - First chunk of a turn → appended as a fresh message.
 *   - A run whose content is already represented (already folded, or the client
 *     saved it) → kept as-is, choosing whichever copy has more content.
 *   - A new chunk → appended onto the accumulated turn.
 * Falls back to per-run upsert when no `turnId` is available (turn == run).
 */
export function foldAssistantTurn(
  repo: any,
  assistantMsg: AssistantMessage,
  options: { turnId?: string; runId?: string },
): any {
  const turnId = options.turnId;
  const runId = options.runId;
  if (!turnId) return upsertAssistantMessage(repo, assistantMsg);

  const nextRepo = normalizeThreadRepository(repo);
  const lastIndex = nextRepo.messages.length - 1;
  const lastEntry = lastIndex >= 0 ? nextRepo.messages[lastIndex] : undefined;
  const lastMsg = getStoredMessage(lastEntry);

  const sameTurn =
    lastMsg?.role === "assistant" &&
    (turnIdOf(lastMsg) === turnId ||
      // A message the client wrote for one of this turn's runs before it
      // carried a turnId stamp.
      (!!runId && getMessageRunId(lastMsg) === runId));

  if (!sameTurn) {
    // First chunk of this turn (or the previous assistant belongs to an
    // earlier turn) — append as a fresh message; buildAssistantMessage already
    // stamped turnId + foldedRunIds onto it.
    return upsertAssistantMessage(repo, assistantMsg);
  }

  const existingContent = Array.isArray(lastMsg.content) ? lastMsg.content : [];
  const incomingContent = Array.isArray(assistantMsg.content)
    ? assistantMsg.content
    : [];
  const existingFolded = foldedRunIdsOf(lastMsg);
  const runAlreadyFolded =
    !!runId &&
    (existingFolded.includes(runId) || getMessageRunId(lastMsg) === runId);

  // If this run's chunk is already represented in the turn (the client saved
  // it, or we already folded it), do not re-append — keep the larger copy so
  // the turn never shrinks. Otherwise fold this chunk onto the accumulated turn.
  const mergedContent = runAlreadyFolded
    ? assistantContentWeight(incomingContent) >
      assistantContentWeight(existingContent)
      ? incomingContent
      : existingContent
    : appendFoldedContent(existingContent, incomingContent);

  const mergedFolded = Array.from(
    new Set([...existingFolded, ...(runId ? [runId] : [])]),
  );

  const existingCustom =
    lastMsg.metadata?.custom && typeof lastMsg.metadata.custom === "object"
      ? (lastMsg.metadata.custom as Record<string, unknown>)
      : {};
  const incomingCustom =
    assistantMsg.metadata?.custom &&
    typeof assistantMsg.metadata.custom === "object"
      ? (assistantMsg.metadata.custom as Record<string, unknown>)
      : {};

  const mergedCustom: Record<string, unknown> = {
    ...existingCustom,
    ...incomingCustom,
    turnId,
    foldedRunIds: mergedFolded,
  };
  // Only the freshest chunk decides whether the turn is still continuing.
  if (incomingCustom.continued !== true) delete mergedCustom.continued;

  const mergedMessage = {
    ...lastMsg,
    content: normalizeAssistantToolCallIds({
      role: "assistant",
      content: mergedContent,
    }).content,
    // The freshest chunk's status wins: a clean done supersedes a prior
    // partial; a real error supersedes a partial.
    status: assistantMsg.status ?? lastMsg.status,
    metadata: {
      ...lastMsg.metadata,
      runId: runId ?? lastMsg.metadata?.runId,
      custom: mergedCustom,
    },
  };

  nextRepo.messages[lastIndex] = { ...lastEntry, message: mergedMessage };
  nextRepo.headId = mergedMessage.id ?? nextRepo.headId;
  return nextRepo;
}

export function normalizeThreadTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Extract title and preview from a thread runtime export.
 * Isomorphic — works on both server and client.
 */
export function extractThreadMeta(repo: any): {
  title: string;
  preview: string;
} {
  const titleOverride = normalizeThreadTitle(repo?._titleOverride);
  const msgs = repo?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0)
    return { title: titleOverride, preview: "" };

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
  return { title: titleOverride || title, preview };
}
