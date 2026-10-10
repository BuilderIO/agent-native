import { AgentKitRunSlotBusyError } from "@agent-native/agentkit/client";
import type {
  AgentAnnotation,
  AgentAnnotationSnapshot,
  AgentError,
  AgentEvent,
  AgentMessage,
  AgentMessagePart,
  AgentObjectReference,
  AgentRunSnapshot,
  AgentQueuedMessage,
  AgentRequestContext,
  AgentToolCall,
  AgentThreadSnapshot,
  AgentWidgetSnapshot,
  TextPart,
} from "@agent-native/agentkit/protocol";
import {
  isAgentKitProtocolVersion,
  parseAgentQueuedMessage,
  parseAgentRunOptions,
  parseAgentThreadSnapshot,
  persistableFilePart,
} from "@agent-native/agentkit/protocol";

import { projectRootAssistantMessages } from "../../agent/thread-message-projection.js";
import {
  RUN_NOT_STARTED_METADATA_KEY,
  retryContextFromRequest,
} from "../../shared/agent-chat-run-not-started.js";
import {
  agentEngineStatusUrlForChatApi,
  requireAgentEngineConfiguredForDispatch,
} from "../agent-engine-readiness.js";
import { agentNativePath } from "../api-path.js";
import { CHAT_REQUEST_TOO_LARGE_MESSAGE } from "../error-format.js";
import { dispatchAgentChatRunning } from "../use-agent-chat-running-threads.js";
import {
  appendChatThreadScopeParams,
  type ChatThreadScope,
} from "../use-chat-threads.js";
import {
  AGENT_NATIVE_PROTOCOL_METADATA_KEY,
  createAgentKitProtocolAdapter,
  type AgentNativeProtocolMetadata,
  type AgentKitProtocolAdapter,
  type CreateAgentKitProtocolAdapterOptions,
} from "./agentkit-protocol.js";
import { trackRunFeedback, trackRunOutcome } from "./run-outcome-telemetry.js";
import { runOutcomeForCode } from "./run-outcome.js";
import {
  createAgentNativeChatRuntime,
  isAgentNativeChatRuntime,
  type AgentChatRuntime,
  type CreateAgentNativeChatRuntimeOptions,
} from "./runtime.js";

export interface CreateAgentNativeAgentKitTransportOptions extends CreateAgentNativeChatRuntimeOptions {
  /** Optional host runtime executed through AgentKit's protocol lifecycle. */
  readonly runtime?: AgentChatRuntime;
  /** Restrict durable thread and queue requests to the configured resource scope. */
  readonly isolateHistoryByScope?: boolean;
  readonly adapter?: Omit<CreateAgentKitProtocolAdapterOptions, "operations">;
  readonly operations?: CreateAgentKitProtocolAdapterOptions["operations"];
  readonly feedbackUrl?: string;
}

interface StoredThread {
  id?: unknown;
  title?: unknown;
  preview?: unknown;
  messageCount?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  threadData?: unknown;
  metadata?: unknown;
}

interface ActiveRunStatus {
  active?: unknown;
  status?: unknown;
  runId?: unknown;
  awaitingRedispatch?: unknown;
  terminalReason?: unknown;
  turnId?: unknown;
}

interface SnapshotAnnotationConflict {
  messageId: string;
  annotationId?: string;
  operation: "upsert" | "remove";
}

const RUN_SLOT_POLL_INTERVAL_MS = 150;
const RUN_SLOT_STABLE_POLLS = 2;
const MAX_READINESS_SOURCES = 128;
const MAX_THREAD_SNAPSHOT_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_THREAD_SNAPSHOT_RETRIES = 2;
const MAX_THREAD_SNAPSHOT_ANNOTATION_REPLACEMENT_BYTES = 64 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeStoredReasoningParts(
  messageParts: AgentMessagePart[],
  storedParts: AgentMessagePart[],
): AgentMessagePart[] {
  const storedReasoning = storedParts.filter(
    (part): part is Extract<AgentMessagePart, { type: "reasoning" }> =>
      part.type === "reasoning",
  );
  if (storedReasoning.length === 0) return messageParts;
  const reasoningText = (parts: AgentMessagePart[]) =>
    parts
      .filter(
        (part): part is Extract<AgentMessagePart, { type: "reasoning" }> =>
          part.type === "reasoning",
      )
      .map((part) => part.text)
      .join("");
  if (reasoningText(messageParts) === reasoningText(storedReasoning)) {
    return messageParts;
  }
  const withoutReasoning = messageParts.filter(
    (part) => part.type !== "reasoning",
  );
  const firstTextIndex = withoutReasoning.findIndex(
    (part) => part.type === "text",
  );
  const insertionIndex =
    firstTextIndex < 0 ? withoutReasoning.length : firstTextIndex;
  return [
    ...withoutReasoning.slice(0, insertionIndex),
    ...storedReasoning,
    ...withoutReasoning.slice(insertionIndex),
  ];
}

function latestSnapshotRunRecord(
  runs: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(runs)) return undefined;
  return runs.reduce<Record<string, unknown> | undefined>((latest, run) => {
    const record = asRecord(run);
    if (typeof record?.id !== "string") return latest;
    if (!latest) return record;
    const latestTime = latest.startedAt ?? latest.completedAt;
    const runTime = record.startedAt ?? record.completedAt;
    return latestTime && runTime && runTime < latestTime ? latest : record;
  }, undefined);
}

function protocolTurnId(metadata: unknown): string | undefined {
  const native = asRecord(
    asRecord(metadata)?.[AGENT_NATIVE_PROTOCOL_METADATA_KEY],
  );
  const observability = asRecord(native?.observability);
  return typeof observability?.turnId === "string"
    ? observability.turnId
    : undefined;
}

function protocolInterruptedRunId(metadata: unknown): string | undefined {
  const native = asRecord(
    asRecord(metadata)?.[AGENT_NATIVE_PROTOCOL_METADATA_KEY],
  );
  const observability = asRecord(native?.observability);
  return typeof observability?.interruptedRunId === "string"
    ? observability.interruptedRunId
    : undefined;
}

function scopeObject(scope: unknown): AgentObjectReference | undefined {
  const value = asRecord(scope);
  if (typeof value?.id !== "string" || typeof value.type !== "string") {
    return undefined;
  }
  return {
    id: value.id,
    kind: value.type,
    label:
      typeof value.label === "string" && value.label ? value.label : value.id,
    metadata: { agentNativeScope: true },
  };
}

function adapterMetadata(
  options: CreateAgentNativeAgentKitTransportOptions,
): Record<string, unknown> | undefined {
  const configured = options.adapter?.metadata;
  const configuredNative = asRecord(
    configured?.[AGENT_NATIVE_PROTOCOL_METADATA_KEY],
  );
  const configuredContext = asRecord(configuredNative?.context);
  const configuredObjects = Array.isArray(configuredNative?.smartObjects)
    ? configuredNative.smartObjects
    : [];
  const focusedObject = scopeObject(options.scope);
  const context = {
    ...configuredContext,
    ...(options.browserTabId ? { browserTabId: options.browserTabId } : {}),
    surface: options.surface ?? "app",
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(focusedObject
      ? {
          focusedObjects: [
            ...(Array.isArray(configuredContext?.focusedObjects)
              ? configuredContext.focusedObjects
              : []),
            focusedObject,
          ],
        }
      : {}),
  };
  const native = {
    ...configuredNative,
    ...(Object.keys(context).length ? { context } : {}),
    ...(focusedObject
      ? { smartObjects: [...configuredObjects, focusedObject] }
      : {}),
  } satisfies AgentNativeProtocolMetadata;
  if (!configured && Object.keys(native).length === 0) return undefined;
  return {
    ...configured,
    [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: native,
  };
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return fallback;
}

function messagePart(
  value: unknown,
  fallbackTextFormat?: TextPart["format"],
): AgentMessagePart | null {
  const part = asRecord(value);
  if (!part || typeof part.type !== "string") return null;
  if (part.type === "text" && typeof part.text === "string") {
    const format =
      part.format === "plain" || part.format === "markdown"
        ? part.format
        : fallbackTextFormat;
    return {
      type: "text",
      text: part.text,
      ...(format ? { format } : {}),
    };
  }
  if (part.type === "reasoning" && typeof part.text === "string") {
    return {
      type: "reasoning",
      text: part.text,
      visibility: "summary",
    };
  }
  if (part.type === "file" || part.type === "image") {
    const name =
      typeof part.name === "string"
        ? part.name
        : typeof part.filename === "string"
          ? part.filename
          : part.type;
    return {
      type: "file",
      name,
      ...(typeof part.url === "string" ? { url: part.url } : {}),
      ...(typeof part.fileId === "string" ? { fileId: part.fileId } : {}),
      ...(typeof part.mediaType === "string"
        ? { mediaType: part.mediaType }
        : typeof part.mimeType === "string"
          ? { mediaType: part.mimeType }
          : {}),
      ...(part.omitted === "inline-bytes"
        ? { omitted: "inline-bytes" as const }
        : {}),
    };
  }
  return {
    type: "data",
    data: part,
    mediaType: "application/x-agent-native-repository-part",
  };
}

function attachmentReferenceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? value
      : undefined;
  } catch {
    return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
  }
}

function storedAttachmentPart(value: unknown): AgentMessagePart | null {
  const attachment = asRecord(value);
  if (
    !attachment ||
    (attachment.type !== "file" && attachment.type !== "image")
  ) {
    return null;
  }
  const contentParts = Array.isArray(attachment.content)
    ? attachment.content.map(asRecord).filter((part) => part !== null)
    : [];
  const reference = contentParts.find(
    (part) =>
      (part.type === "file" && typeof part.url === "string") ||
      (part.type === "image" && typeof part.image === "string"),
  );
  const metadata = asRecord(attachment.metadata);
  const url =
    attachmentReferenceUrl(metadata?.uploadUrl) ??
    attachmentReferenceUrl(reference?.url ?? reference?.image);
  const name =
    (typeof attachment.name === "string" && attachment.name) ||
    (typeof reference?.filename === "string" && reference.filename) ||
    attachment.type;
  const fileId =
    (typeof attachment.id === "string" && attachment.id) ||
    (typeof reference?.fileId === "string" && reference.fileId);
  const mediaType =
    (typeof attachment.contentType === "string" && attachment.contentType) ||
    (typeof reference?.mimeType === "string" && reference.mimeType);
  return {
    type: "file",
    name,
    ...(url ? { url } : {}),
    ...(fileId ? { fileId } : {}),
    ...(mediaType ? { mediaType } : {}),
  };
}

function storedMessages(
  value: unknown,
  now: () => string,
  fallbackTextFormat?: TextPart["format"],
): AgentMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Agent chat history must be an array.");
  }
  return value.flatMap((entry, index) => {
    const outer = asRecord(entry);
    const message = asRecord(outer?.message ?? outer);
    if (!message) {
      throw new TypeError(`Agent chat message ${index} must be an object.`);
    }
    const role = message.role;
    if (
      role !== "user" &&
      role !== "assistant" &&
      role !== "system" &&
      role !== "tool"
    ) {
      return [];
    }
    const content = message.content;
    const textFormat = role === "assistant" ? fallbackTextFormat : undefined;
    const parts =
      typeof content === "string"
        ? [
            {
              type: "text" as const,
              text: content,
              ...(textFormat ? { format: textFormat } : {}),
            },
          ]
        : Array.isArray(content)
          ? content
              .map((part) => messagePart(part, textFormat))
              .filter((part) => part !== null)
          : [];
    const attachmentParts = Array.isArray(message.attachments)
      ? message.attachments
          .map(storedAttachmentPart)
          .filter((part) => part !== null)
      : [];
    return [
      {
        id:
          typeof message.id === "string"
            ? message.id
            : `repository-message-${index}`,
        role,
        parts: [...parts, ...attachmentParts],
        createdAt: timestamp(message.createdAt, now()),
        ...(asRecord(message.metadata)
          ? { metadata: asRecord(message.metadata)! }
          : {}),
        ...(messageStatus(message.status)
          ? { status: messageStatus(message.status) }
          : {}),
      },
    ];
  });
}

/**
 * The server answers a turn it refused before any run started with a durable
 * notice and a failed run. The run renders as the recovery card, so showing the
 * notice too would print the same failure twice.
 */
function isRenderedRunNotStartedNotice(
  message: AgentMessage,
  failedRunIds: ReadonlySet<string>,
): boolean {
  const metadata = asRecord(message.metadata);
  return (
    message.role === "assistant" &&
    asRecord(metadata?.custom)?.[RUN_NOT_STARTED_METADATA_KEY] === true &&
    typeof metadata?.runId === "string" &&
    failedRunIds.has(metadata.runId)
  );
}

function sameUserPrompt(left: AgentMessage, right: AgentMessage): boolean {
  if (
    left.role !== "user" ||
    right.role !== "user" ||
    !left.createdAt ||
    !right.createdAt ||
    Date.parse(left.createdAt) !== Date.parse(right.createdAt) ||
    left.parts.length !== right.parts.length
  ) {
    return false;
  }
  return left.parts.every((part, index) => {
    const other = right.parts[index];
    if (!other || part.type !== other.type) return false;
    if (part.type === "text" && other.type === "text") {
      return part.text === other.text;
    }
    if (part.type !== "file" || other.type !== "file") return false;
    const sameReference =
      (part.fileId && other.fileId && part.fileId === other.fileId) ||
      (part.url && other.url && part.url === other.url);
    if (sameReference) return true;
    if ((part.fileId && other.fileId) || (part.url && other.url)) return false;
    return (
      Boolean(part.name) &&
      part.name === other.name &&
      part.mediaType === other.mediaType
    );
  });
}

function completedDurableRunIds(messages: AgentMessage[]): Set<string> {
  return new Set(
    messages.flatMap((message) => {
      const runId = asRecord(message.metadata)?.runId;
      const custom = asRecord(asRecord(message.metadata)?.custom);
      return message.role === "assistant" &&
        message.status === "complete" &&
        custom?.continued !== true &&
        custom?.userStopped !== true &&
        typeof runId === "string"
        ? [runId]
        : [];
    }),
  );
}

function userStoppedDurableRunIds(messages: AgentMessage[]): Set<string> {
  return new Set(
    messages.flatMap((message) => {
      const runId = asRecord(message.metadata)?.runId;
      const custom = asRecord(asRecord(message.metadata)?.custom);
      return message.role === "assistant" &&
        custom?.userStopped === true &&
        typeof runId === "string"
        ? [runId]
        : [];
    }),
  );
}

function durableRunFailures(messages: AgentMessage[]): Map<string, AgentError> {
  return new Map(
    messages.flatMap((message) => {
      const runId = asRecord(message.metadata)?.runId;
      const error = asRecord(
        asRecord(asRecord(message.metadata)?.custom)?.runError,
      );
      if (
        message.role !== "assistant" ||
        message.status !== "error" ||
        typeof runId !== "string" ||
        !error ||
        typeof error.message !== "string"
      ) {
        return [];
      }
      return [
        [
          runId,
          {
            code:
              typeof error.errorCode === "string"
                ? error.errorCode
                : "run_failed",
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {}),
            ...(typeof error.recoverable === "boolean"
              ? { retryable: error.recoverable }
              : {}),
          },
        ] as const,
      ];
    }),
  );
}

/** The turn each durable prompt started, keyed by the run it was submitted to. */
function durableSubmittedTurns(messages: AgentMessage[]): Map<string, string> {
  return new Map(
    messages.flatMap((message) => {
      const custom = asRecord(asRecord(message.metadata)?.custom);
      return message.role === "user" &&
        typeof custom?.submittedRunId === "string" &&
        typeof custom.submittedTurnId === "string"
        ? [[custom.submittedRunId, custom.submittedTurnId] as const]
        : [];
    }),
  );
}

/** The runs that left a durable reply on each turn. */
function durableReplyRunsByTurn(
  messages: AgentMessage[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const message of messages) {
    const turnId = asRecord(asRecord(message.metadata)?.custom)?.turnId;
    if (message.role !== "assistant" || typeof turnId !== "string") continue;
    const runIds = result.get(turnId) ?? new Set<string>();
    for (const runId of durableRunIds(message)) runIds.add(runId);
    result.set(turnId, runIds);
  }
  return result;
}

/** A durable reply's terminal run plus every continuation run folded into it. */
function durableRunIds(message: AgentMessage): string[] {
  const metadata = asRecord(message.metadata);
  const folded = asRecord(metadata?.custom)?.foldedRunIds;
  return [
    ...new Set(
      [metadata?.runId, ...(Array.isArray(folded) ? folded : [])].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  ];
}

const REFUSED_TURN_CUSTOM_KEYS = [
  RUN_NOT_STARTED_METADATA_KEY,
  "submittedRunId",
  "submittedTurnId",
] as const;

/** The retry context of a refused prompt, bounded the way the server stores it. */
function refusedTurnRetryContext(
  metadata: Record<string, unknown> | null | undefined,
) {
  return retryContextFromRequest({
    metadata,
    model: metadata?.model,
    engine: metadata?.engine,
    effort: metadata?.effort,
    mode: metadata?.requestMode,
  });
}

/**
 * A snapshot copy of a prompt the server refused stands in for the durable one,
 * and a client save keeps only a few markers of it, so the refusal marker and
 * the retry context come from the durable message when the copy lacks them.
 */
function withRefusedTurnMetadata(
  message: AgentMessage,
  stored: AgentMessage,
): AgentMessage {
  const storedMetadata = asRecord(stored.metadata);
  const storedCustom = asRecord(storedMetadata?.custom);
  if (storedCustom?.[RUN_NOT_STARTED_METADATA_KEY] !== true) return message;
  const metadata = asRecord(message.metadata);
  const custom = asRecord(metadata?.custom);
  return {
    ...message,
    metadata: {
      ...refusedTurnRetryContext(storedMetadata),
      ...metadata,
      custom: {
        ...Object.fromEntries(
          REFUSED_TURN_CUSTOM_KEYS.flatMap((key) =>
            storedCustom[key] === undefined ? [] : [[key, storedCustom[key]]],
          ),
        ),
        ...custom,
      },
    },
  };
}

function orderMessagesByDurableSequence(
  snapshotMessages: AgentMessage[],
  missingMessages: AgentMessage[],
  durableMessages: AgentMessage[],
  durableIndexById: Map<string, number>,
  durableIdBySnapshotId: Map<string, string>,
): AgentMessage[] {
  const messageByDurableId = new Map(
    missingMessages.map((message) => [message.id, message]),
  );
  const snapshotIdByDurableId = new Map<string, string>();
  const durableIndexBySnapshotId = new Map<string, number>();
  for (const message of snapshotMessages) {
    const durableId =
      durableIdBySnapshotId.get(message.id) ??
      (durableIndexById.has(message.id) ? message.id : undefined);
    const durableIndex = durableId
      ? durableIndexById.get(durableId)
      : undefined;
    if (
      !durableId ||
      durableIndex === undefined ||
      snapshotIdByDurableId.has(durableId)
    ) {
      continue;
    }
    snapshotIdByDurableId.set(durableId, message.id);
    durableIndexBySnapshotId.set(message.id, durableIndex);
    messageByDurableId.set(durableId, message);
  }

  if (snapshotIdByDurableId.size === 0) {
    return [...snapshotMessages, ...missingMessages]
      .map((message, index) => ({ message, index }))
      .sort((left, right) => {
        const leftCreatedAt = Date.parse(left.message.createdAt ?? "");
        const rightCreatedAt = Date.parse(right.message.createdAt ?? "");
        if (
          Number.isFinite(leftCreatedAt) &&
          Number.isFinite(rightCreatedAt) &&
          leftCreatedAt !== rightCreatedAt
        ) {
          return leftCreatedAt - rightCreatedAt;
        }
        return left.index - right.index;
      })
      .map(({ message }) => message);
  }

  const insertions = new Map<number, AgentMessage[]>();
  for (let index = 0; index < snapshotMessages.length; index += 1) {
    const message = snapshotMessages[index]!;
    if (durableIndexBySnapshotId.has(message.id)) continue;

    let insertionIndex: number | undefined;
    for (let next = index + 1; next < snapshotMessages.length; next += 1) {
      const durableIndex = durableIndexBySnapshotId.get(
        snapshotMessages[next]!.id,
      );
      if (durableIndex !== undefined) {
        insertionIndex = durableIndex;
        break;
      }
    }
    if (insertionIndex === undefined) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const durableIndex = durableIndexBySnapshotId.get(
          snapshotMessages[previous]!.id,
        );
        if (durableIndex !== undefined) {
          insertionIndex = durableIndex + 1;
          break;
        }
      }
    }
    if (insertionIndex === undefined) continue;
    const messages = insertions.get(insertionIndex) ?? [];
    messages.push(message);
    insertions.set(insertionIndex, messages);
  }

  const ordered: AgentMessage[] = [];
  for (let index = 0; index <= durableMessages.length; index += 1) {
    ordered.push(...(insertions.get(index) ?? []));
    const durableMessage = durableMessages[index];
    if (!durableMessage) continue;
    const projected = messageByDurableId.get(durableMessage.id);
    if (projected) ordered.push(projected);
  }
  return ordered;
}

function reconcileDurableMessages(
  messages: AgentMessage[],
  durable: AgentMessage[],
  events: AgentThreadSnapshot["events"],
  runs: AgentThreadSnapshot["runs"],
  toolCalls: AgentThreadSnapshot["toolCalls"],
): AgentMessage[] {
  const submittedRunId = (message: AgentMessage) => {
    const value = asRecord(asRecord(message.metadata)?.custom)?.submittedRunId;
    return typeof value === "string" ? value : undefined;
  };
  const submittedAgentKitMessageId = (message: AgentMessage) => {
    const value = asRecord(
      asRecord(message.metadata)?.custom,
    )?.agentKitMessageId;
    return typeof value === "string" ? value : undefined;
  };
  const sameSubmittedPrompt = (
    snapshot: AgentMessage,
    stored: AgentMessage,
  ) => {
    const storedMessageId = submittedAgentKitMessageId(stored);
    return (
      (storedMessageId === undefined || storedMessageId === snapshot.id) &&
      sameUserPrompt(snapshot, stored)
    );
  };
  const submittedUsers = durable.filter(
    (message) =>
      message.role === "user" &&
      asRecord(message.metadata)?.hideUserMessage !== true &&
      submittedRunId(message) !== undefined,
  );
  const submittedIds = new Set(submittedUsers.map((message) => message.id));
  const durableIndexById = new Map(
    durable.map((message, index) => [message.id, index]),
  );
  const submittedUsersByRun = new Map<string, AgentMessage | null>();
  for (const stored of submittedUsers) {
    const runId = submittedRunId(stored)!;
    submittedUsersByRun.set(
      runId,
      submittedUsersByRun.has(runId) ? null : stored,
    );
  }
  const submittedUsersByAgentKitMessageId = new Map<
    string,
    AgentMessage | null
  >();
  for (const stored of submittedUsers) {
    const messageId = submittedAgentKitMessageId(stored);
    if (!messageId) continue;
    submittedUsersByAgentKitMessageId.set(
      messageId,
      submittedUsersByAgentKitMessageId.has(messageId) ? null : stored,
    );
  }
  const durableById = new Map(durable.map((message) => [message.id, message]));
  const assistantIdsByRun = new Map<string, Set<string>>();
  for (const event of events ?? []) {
    if (
      (event.type !== "message.created" &&
        event.type !== "message.completed") ||
      event.message.role !== "assistant"
    ) {
      continue;
    }
    const ids = assistantIdsByRun.get(event.runId) ?? new Set<string>();
    ids.add(event.message.id);
    assistantIdsByRun.set(event.runId, ids);
  }
  for (const value of runs ?? []) {
    const run = asRecord(value);
    if (
      typeof run?.id !== "string" ||
      typeof run.activeMessageId !== "string"
    ) {
      continue;
    }
    const ids = assistantIdsByRun.get(run.id) ?? new Set<string>();
    ids.add(run.activeMessageId);
    assistantIdsByRun.set(run.id, ids);
  }
  const runByAssistantId = new Map<string, string>();
  for (const [runId, ids] of assistantIdsByRun) {
    if (ids.size === 1) runByAssistantId.set([...ids][0]!, runId);
  }
  const durableByRun = new Map<string, AgentMessage | null>();
  for (const message of durable) {
    if (message.role !== "assistant") continue;
    const runId = asRecord(message.metadata)?.runId;
    if (typeof runId !== "string") continue;
    durableByRun.set(runId, durableByRun.has(runId) ? null : message);
  }
  const durableByFoldedRun = new Map<string, AgentMessage | null>();
  for (const message of durable) {
    if (message.role !== "assistant") continue;
    for (const runId of durableRunIds(message)) {
      durableByFoldedRun.set(
        runId,
        durableByFoldedRun.has(runId) ? null : message,
      );
    }
  }
  const textOf = (parts: AgentMessage["parts"]) =>
    parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  // A run that recovered an interrupted turn records only itself on its reply,
  // while an open page streamed it into the run the prompt was submitted to.
  // The recovering run's events open their own message, so the reply is on
  // screen only when one of that run's messages is exactly it; anything less
  // keeps the saved reply, so the answer is never dropped.
  const submittedRunByTurn = new Map<string, string | null>();
  for (const stored of submittedUsers) {
    const turnId = asRecord(asRecord(stored.metadata)?.custom)?.submittedTurnId;
    if (typeof turnId !== "string") continue;
    submittedRunByTurn.set(
      turnId,
      submittedRunByTurn.has(turnId) ? null : submittedRunId(stored)!,
    );
  }
  const shownByInterruptedRun = (reply: AgentMessage) => {
    const turnId = asRecord(asRecord(reply.metadata)?.custom)?.turnId;
    const submitted =
      typeof turnId === "string" ? submittedRunByTurn.get(turnId) : undefined;
    if (
      !submitted ||
      durableRunIds(reply).includes(submitted) ||
      durableByRun.has(submitted)
    ) {
      return false;
    }
    const ids = assistantIdsByRun.get(submitted);
    const replyText = textOf(reply.parts);
    if (!ids || !replyText) return false;
    return messages.some(
      (message) =>
        message.role === "assistant" &&
        ids.has(message.id) &&
        textOf(message.parts) === replyText,
    );
  };

  const rootAssistantProjection = projectRootAssistantMessages({
    rootMessages: durable,
    snapshotMessages: messages,
    events,
    runs,
    toolCalls,
  });
  const representedDurableAssistantIds =
    rootAssistantProjection.representedRootMessageIds;
  const snapshotRunIdsByMessageId =
    rootAssistantProjection.snapshotRunIdsByMessageId;
  const rootMessageIdsBySnapshotMessageId = new Map(
    [...rootAssistantProjection.snapshotMessageIdsByRootMessageId].map(
      ([rootId, snapshotId]) => [snapshotId, rootId],
    ),
  );
  const deduplicatedMessages = messages.filter(
    (message) => !representedDurableAssistantIds.has(message.id),
  );

  const representedSubmittedUserIds = new Set<string>();
  const storedUserBySnapshotId = new Map<string, AgentMessage>();
  const unmatchedSnapshotUsers: AgentMessage[] = [];
  const representedAssistantIds = new Set(
    deduplicatedMessages.flatMap((message) =>
      message.role === "assistant" ? [message.id] : [],
    ),
  );
  const snapshotAssistantRunIds = new Set<string>();
  for (const message of deduplicatedMessages) {
    if (
      message.role === "user" &&
      asRecord(message.metadata)?.hideUserMessage !== true
    ) {
      const runId = submittedRunId(message);
      const hasAgentKitMessageId = submittedUsersByAgentKitMessageId.has(
        message.id,
      );
      const represented = hasAgentKitMessageId
        ? submittedUsersByAgentKitMessageId.get(message.id)
        : submittedIds.has(message.id)
          ? durableById.get(message.id)
          : runId
            ? submittedUsersByRun.get(runId)
            : undefined;
      if (represented?.role === "user") {
        representedSubmittedUserIds.add(represented.id);
        storedUserBySnapshotId.set(message.id, represented);
      } else if (!runId) {
        unmatchedSnapshotUsers.push(message);
      }
    } else if (message.role === "assistant") {
      const metadataRunId = asRecord(message.metadata)?.runId;
      const runId =
        typeof metadataRunId === "string"
          ? metadataRunId
          : (snapshotRunIdsByMessageId.get(message.id) ??
            runByAssistantId.get(message.id));
      if (runId) snapshotAssistantRunIds.add(runId);
    }
  }
  const matchedSnapshotUserIds = new Set<string>();
  for (const snapshotUser of unmatchedSnapshotUsers) {
    const candidates = submittedUsers.filter(
      (message) =>
        !representedSubmittedUserIds.has(message.id) &&
        sameSubmittedPrompt(snapshotUser, message),
    );
    if (candidates.length !== 1) continue;
    const stored = candidates[0]!;
    const matchingSnapshots = unmatchedSnapshotUsers.filter(
      (message) =>
        !matchedSnapshotUserIds.has(message.id) &&
        sameSubmittedPrompt(message, stored),
    );
    if (matchingSnapshots.length !== 1) continue;
    representedSubmittedUserIds.add(stored.id);
    matchedSnapshotUserIds.add(snapshotUser.id);
    storedUserBySnapshotId.set(snapshotUser.id, stored);
  }
  // ponytail: only collapse balanced indistinguishable prompt groups; use
  // stable message IDs when the client exposes them for unequal groups.
  for (const snapshotUser of unmatchedSnapshotUsers) {
    if (matchedSnapshotUserIds.has(snapshotUser.id)) continue;
    const candidates = submittedUsers.filter(
      (message) =>
        !representedSubmittedUserIds.has(message.id) &&
        sameSubmittedPrompt(snapshotUser, message),
    );
    if (candidates.length < 2) continue;
    const matchingSnapshots = unmatchedSnapshotUsers.filter(
      (message) =>
        !matchedSnapshotUserIds.has(message.id) &&
        candidates.every((candidate) =>
          sameSubmittedPrompt(message, candidate),
        ),
    );
    if (matchingSnapshots.length !== candidates.length) continue;
    for (const candidate of candidates) {
      representedSubmittedUserIds.add(candidate.id);
    }
    for (const message of matchingSnapshots) {
      matchedSnapshotUserIds.add(message.id);
    }
    for (let index = 0; index < matchingSnapshots.length; index += 1) {
      storedUserBySnapshotId.set(
        matchingSnapshots[index]!.id,
        candidates[index]!,
      );
    }
  }

  const missingMessages: AgentMessage[] = submittedUsers.filter(
    (message) => !representedSubmittedUserIds.has(message.id),
  );
  const completedRunIds = new Set([
    ...(runs ?? [])
      .filter((run) =>
        ["completed", "failed", "cancelled"].includes(run.status),
      )
      .map((run) => run.id),
    ...completedDurableRunIds(durable),
  ]);
  const durableAssistantRunIds = new Set(
    durable.flatMap((message) => {
      const runId = asRecord(message.metadata)?.runId;
      const custom = asRecord(asRecord(message.metadata)?.custom);
      return message.role === "assistant" &&
        ["complete", "error"].includes(message.status ?? "") &&
        custom?.continued !== true &&
        typeof runId === "string"
        ? [runId]
        : [];
    }),
  );
  const recoverableAssistantRunIds = new Set([
    ...completedRunIds,
    ...durableAssistantRunIds,
  ]);
  for (const message of durable) {
    if (
      message.role !== "assistant" ||
      representedDurableAssistantIds.has(message.id) ||
      representedAssistantIds.has(message.id)
    ) {
      continue;
    }
    const runId = asRecord(message.metadata)?.runId;
    if (typeof runId !== "string" || !recoverableAssistantRunIds.has(runId)) {
      continue;
    }
    if (shownByInterruptedRun(message)) continue;
    missingMessages.push(message);
    representedAssistantIds.add(message.id);
  }

  const durableIdBySnapshotId = new Map<string, string>();
  for (const [snapshotId, stored] of storedUserBySnapshotId) {
    durableIdBySnapshotId.set(snapshotId, stored.id);
  }
  for (const [snapshotId, rootId] of rootMessageIdsBySnapshotMessageId) {
    durableIdBySnapshotId.set(snapshotId, rootId);
  }
  const projectedMessages = orderMessagesByDurableSequence(
    deduplicatedMessages,
    missingMessages.sort(
      (left, right) =>
        (durableIndexById.get(left.id) ?? 0) -
        (durableIndexById.get(right.id) ?? 0),
    ),
    durable,
    durableIndexById,
    durableIdBySnapshotId,
  );
  const snapshotRunId = (message: AgentMessage) => {
    const metadataRunId = asRecord(message.metadata)?.runId;
    return (
      runByAssistantId.get(message.id) ??
      snapshotRunIdsByMessageId.get(message.id) ??
      (typeof metadataRunId === "string" ? metadataRunId : undefined)
    );
  };

  const reconciledMessages = projectedMessages.map((message) => {
    if (message.role === "user") {
      const stored = storedUserBySnapshotId.get(message.id);
      if (!stored) return message;
      const createdAt = message.createdAt ?? stored.createdAt;
      const reconciled =
        createdAt === message.createdAt
          ? message
          : { ...message, ...(createdAt ? { createdAt } : {}) };
      return withRefusedTurnMetadata(reconciled, stored);
    }
    if (message.role !== "assistant") return message;
    const representedRootId = rootMessageIdsBySnapshotMessageId.get(message.id);
    const representedRoot = representedRootId
      ? durableById.get(representedRootId)
      : undefined;
    if (representedRoot?.role === "assistant") {
      const parts = mergeStoredReasoningParts(
        message.parts,
        representedRoot.parts,
      );
      const terminalStatus =
        representedRoot.status === "complete" ||
        representedRoot.status === "error"
          ? representedRoot.status
          : undefined;
      const createdAt = message.createdAt ?? representedRoot.createdAt;
      if (
        parts !== message.parts ||
        terminalStatus !== undefined ||
        createdAt !== message.createdAt
      ) {
        message = {
          ...message,
          ...(parts !== message.parts ? { parts } : {}),
          ...(createdAt ? { createdAt } : {}),
          ...(terminalStatus ? { status: terminalStatus } : {}),
        };
      }
    }
    const runId = snapshotRunId(message);
    const matched =
      durableById.get(message.id) ??
      (runId ? durableByRun.get(runId) : undefined);
    // An earlier run of a folded reply is completed with the continuation text
    // the page never saw, unless the page saved that continuation as its own
    // message (folding it in would show it twice).
    const folded =
      matched || !runId ? undefined : durableByFoldedRun.get(runId);
    const foldedTerminalRunId = asRecord(folded?.metadata)?.runId;
    const stored =
      matched ??
      (typeof foldedTerminalRunId === "string" &&
      snapshotAssistantRunIds.has(foldedTerminalRunId)
        ? undefined
        : folded);
    if (stored?.role !== "assistant") return message;
    const foldedRunIds = durableRunIds(stored);
    const spansRuns = foldedRunIds.length > 1;
    const foldedGroup = spansRuns
      ? projectedMessages.filter(
          (candidate) =>
            candidate.role === "assistant" &&
            foldedRunIds.includes(snapshotRunId(candidate) ?? ""),
        )
      : [message];
    const isFoldedTerminalProjection =
      !spansRuns || foldedGroup.at(-1) === message;
    const messageMetadata = asRecord(message.metadata);
    const storedMetadata = asRecord(stored.metadata);
    const messageCustom = asRecord(messageMetadata?.custom);
    const storedCustom = asRecord(storedMetadata?.custom);
    const metadata = storedMetadata
      ? {
          ...messageMetadata,
          ...storedMetadata,
          ...(messageCustom || storedCustom
            ? { custom: { ...messageCustom, ...storedCustom } }
            : {}),
        }
      : message.metadata;
    const reconciledParts = isFoldedTerminalProjection
      ? mergeStoredReasoningParts(message.parts, stored.parts)
      : message.parts;
    const reconciled =
      stored === matched
        ? {
            ...message,
            ...(reconciledParts !== message.parts
              ? { parts: reconciledParts }
              : {}),
            ...(stored.status === "complete" || stored.status === "error"
              ? { status: stored.status }
              : {}),
            ...(metadata ? { metadata } : {}),
          }
        : reconciledParts !== message.parts
          ? { ...message, parts: reconciledParts }
          : message;
    const lastPart = reconciled.parts.at(-1);
    if (lastPart && lastPart.type !== "text" && !spansRuns) return reconciled;
    // Only the last message the page saved for a folded reply takes the
    // continuation, and it is measured against everything the page saved.
    if (spansRuns && foldedGroup.at(-1) !== message) return reconciled;
    const currentText = textOf(foldedGroup.flatMap((entry) => entry.parts));
    const storedText = textOf(stored.parts);
    const orderedFoldedRunIds = [
      ...new Set(
        [
          ...(Array.isArray(storedCustom?.foldedRunIds)
            ? storedCustom.foldedRunIds
            : []),
          asRecord(stored.metadata)?.runId,
        ].filter((id): id is string => typeof id === "string"),
      ),
    ];
    const hasEarlierFoldedRun = orderedFoldedRunIds
      .slice(0, -1)
      .some((id) => snapshotAssistantRunIds.has(id));
    if (
      spansRuns &&
      runId === asRecord(stored.metadata)?.runId &&
      !hasEarlierFoldedRun &&
      currentText.length > 0 &&
      storedText.endsWith(currentText) &&
      storedText.length > currentText.length
    ) {
      let replacedText = false;
      const parts = reconciled.parts.map((part) => {
        if (part.type !== "text") return part;
        if (replacedText) return { ...part, text: "" };
        replacedText = true;
        return { ...part, text: storedText };
      });
      if (!replacedText) parts.push({ type: "text", text: storedText });
      return { ...reconciled, parts };
    }
    if (
      !storedText.startsWith(currentText) ||
      storedText.length <= currentText.length
    ) {
      return reconciled;
    }
    const suffix = storedText.slice(currentText.length);
    const parts = [...reconciled.parts];
    if (lastPart?.type === "text") {
      parts[parts.length - 1] = { ...lastPart, text: lastPart.text + suffix };
    } else {
      parts.push({ type: "text", text: suffix });
    }
    return { ...reconciled, parts };
  });
  return reconciledMessages;
}

function messageStatus(value: unknown): AgentMessage["status"] | undefined {
  const status = asRecord(value)?.type ?? value;
  if (status === "incomplete") return "error";
  return status === "streaming" || status === "complete" || status === "error"
    ? status
    : undefined;
}

function storedQueue(
  value: unknown,
  threadId: string,
  fallbackCreatedAt: string,
): AgentQueuedMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Agent chat queued messages must be an array.");
  }
  return value.map((entry, index) => {
    const queued = asRecord(entry);
    if (
      !queued ||
      typeof queued.id !== "string" ||
      typeof queued.text !== "string"
    ) {
      throw new TypeError(
        `Agent chat queued message ${index} requires string id and text fields.`,
      );
    }
    const attachments = Array.isArray(queued.attachments)
      ? queued.attachments
          .map((part) => messagePart(part))
          .filter(
            (part): part is Extract<AgentMessagePart, { type: "file" }> =>
              part?.type === "file",
          )
      : undefined;
    const requestAttachments =
      queued.requestAttachments === undefined
        ? undefined
        : parseAgentQueuedMessage({
            id: queued.id,
            threadId,
            text: queued.text,
            createdAt: timestamp(queued.createdAt, fallbackCreatedAt),
            requestAttachments: queued.requestAttachments,
          }).requestAttachments;
    return {
      id: queued.id,
      threadId,
      text: queued.text,
      createdAt: timestamp(queued.createdAt, fallbackCreatedAt),
      ...(attachments?.length ? { attachments } : {}),
      ...(requestAttachments?.length ? { requestAttachments } : {}),
      ...(asRecord(queued.metadata)
        ? { metadata: asRecord(queued.metadata)! }
        : {}),
      ...(queued.options === undefined
        ? {}
        : {
            options: parseAgentRunOptions(
              queued.options,
              `queuedMessages[${index}].options`,
            ),
          }),
    };
  });
}

function storedRepository(stored: StoredThread): Record<string, unknown> {
  if (stored.threadData === undefined || stored.threadData === "") return {};
  if (typeof stored.threadData !== "string") {
    throw new TypeError("Agent chat threadData must be a JSON string.");
  }
  const parsed = JSON.parse(stored.threadData) as unknown;
  const repository = asRecord(parsed);
  if (!repository) {
    throw new TypeError("Agent chat threadData must contain an object.");
  }
  return repository;
}

function persistedError(value: unknown): AgentError {
  const error = asRecord(value);
  if (typeof error?.code !== "string" || typeof error.message !== "string") {
    throw new TypeError(
      "Agent chat run errors must include a code and message.",
    );
  }
  const persisted: Record<string, unknown> = {
    code: error.code.slice(0, 128),
    message: error.message.slice(0, 2_048),
  };
  if (typeof error.retryable === "boolean") {
    persisted.retryable = error.retryable;
  }
  if (typeof error.correlationId === "string") {
    persisted.correlationId = error.correlationId.slice(0, 128);
  }
  if (
    error.code === "capability_unsupported" ||
    error.code === "capability_unavailable"
  ) {
    persisted.capability =
      typeof error.capability === "string"
        ? error.capability.slice(0, 128)
        : "x-unknown";
    persisted.retryable =
      error.code === "capability_unsupported"
        ? false
        : typeof error.retryable === "boolean"
          ? error.retryable
          : false;
  } else if (error.code === "operation_unsupported") {
    persisted.operation =
      typeof error.operation === "string"
        ? error.operation.slice(0, 128)
        : "unknown";
    persisted.retryable = false;
  } else if (error.code === "protocol_version_unsupported") {
    persisted.supportedVersions = Array.isArray(error.supportedVersions)
      ? error.supportedVersions.filter(isAgentKitProtocolVersion).slice(0, 32)
      : [];
    persisted.receivedVersions = Array.isArray(error.receivedVersions)
      ? error.receivedVersions
          .filter(
            (version): version is number =>
              Number.isSafeInteger(version) && Number(version) > 0,
          )
          .slice(0, 32)
      : [];
    persisted.retryable = false;
  }
  return persisted as unknown as AgentError;
}

function persistedAnnotation(annotation: AgentAnnotation): AgentAnnotation {
  return {
    id: annotation.id,
    kind: annotation.kind,
    label: annotation.label,
    ...(annotation.url ? { url: annotation.url } : {}),
    ...(annotation.start !== undefined ? { start: annotation.start } : {}),
    ...(annotation.end !== undefined ? { end: annotation.end } : {}),
  };
}

function persistedAnnotations(
  annotations: AgentAnnotationSnapshot[] = [],
  messageIds: ReadonlySet<string>,
): AgentAnnotationSnapshot[] {
  return annotations.flatMap(({ messageId, annotation }) =>
    messageIds.has(messageId)
      ? [{ messageId, annotation: persistedAnnotation(annotation) }]
      : [],
  );
}

function assistantMessageIdsByRun(
  events: AgentThreadSnapshot["events"],
): Map<string, string> {
  const messageIdsByRun = new Map<string, Set<string>>();
  for (const event of events ?? []) {
    if (
      (event.type !== "message.created" &&
        event.type !== "message.completed") ||
      event.message.role !== "assistant"
    ) {
      continue;
    }
    const messageIds = messageIdsByRun.get(event.runId) ?? new Set<string>();
    messageIds.add(event.message.id);
    messageIdsByRun.set(event.runId, messageIds);
  }
  const uniqueMessageIdsByRun = new Map<string, string>();
  for (const [runId, messageIds] of messageIdsByRun) {
    if (messageIds.size === 1) {
      uniqueMessageIdsByRun.set(runId, [...messageIds][0]!);
    }
  }
  return uniqueMessageIdsByRun;
}

function persistedHistoryEvents(events: AgentEvent[] = []): AgentEvent[] {
  const sequenceByRun = new Map<string, number>();
  return events.flatMap((event): AgentEvent[] => {
    const base = () => {
      const sequence = (sequenceByRun.get(event.runId) ?? 0) + 1;
      sequenceByRun.set(event.runId, sequence);
      return {
        id: event.id,
        threadId: event.threadId,
        runId: event.runId,
        sequence,
        occurredAt: event.occurredAt,
      };
    };
    if (event.type === "run.started") {
      return [{ ...base(), type: event.type }];
    }
    if (event.type === "run.completed" || event.type === "run.cancelled") {
      return [{ ...base(), type: event.type }];
    }
    if (event.type === "run.failed") {
      return [
        { ...base(), type: event.type, error: persistedError(event.error) },
      ];
    }
    if (event.type === "run.status") {
      return [{ ...base(), type: event.type, status: event.status }];
    }
    if (
      event.type === "activity.started" ||
      event.type === "activity.updated" ||
      event.type === "activity.completed"
    ) {
      const activity = event.activity;
      return [
        {
          ...base(),
          type: event.type,
          activity: {
            id: activity.id,
            kind: activity.kind,
            label: activity.label,
            status: activity.status,
            ...(activity.runId ? { runId: activity.runId } : {}),
            ...(activity.agentId ? { agentId: activity.agentId } : {}),
            ...(activity.startedAt ? { startedAt: activity.startedAt } : {}),
            ...(activity.completedAt
              ? { completedAt: activity.completedAt }
              : {}),
          },
        },
      ];
    }
    if (
      event.type === "message.completed" &&
      event.message.role === "assistant"
    ) {
      return [
        {
          ...base(),
          type: event.type,
          message: {
            id: event.message.id,
            role: event.message.role,
            parts: event.message.parts.filter((part) => part.type === "text"),
            ...(event.message.createdAt
              ? { createdAt: event.message.createdAt }
              : {}),
            ...(event.message.status ? { status: event.message.status } : {}),
          },
        },
      ];
    }
    return [];
  });
}

function persistedMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.flatMap((part): AgentMessagePart[] => {
      if (part.type === "text") {
        return [
          {
            type: "text",
            text: part.text,
            ...(part.format ? { format: part.format } : {}),
          },
        ];
      }
      if (part.type === "citation") {
        return [
          {
            type: "citation",
            title: part.title,
            ...(part.url ? { url: part.url } : {}),
            ...(part.sourceId ? { sourceId: part.sourceId } : {}),
          },
        ];
      }
      if (part.type === "annotation") {
        return [
          {
            type: "annotation",
            annotation: persistedAnnotation(part.annotation),
          },
        ];
      }
      if (part.type === "file") {
        const stored = persistableFilePart(part);
        if (!stored.url && !stored.fileId && !stored.omitted) return [];
        return [
          {
            type: "file",
            name: stored.name,
            ...(stored.mediaType ? { mediaType: stored.mediaType } : {}),
            ...(stored.url ? { url: stored.url } : {}),
            ...(stored.fileId ? { fileId: stored.fileId } : {}),
            ...(stored.omitted ? { omitted: stored.omitted } : {}),
          },
        ];
      }
      return [];
    }),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...persistedMessageMetadata(message.metadata),
  }));
}

/**
 * Only the markers a reloaded or second tab needs: a hidden recovery message,
 * which failed run a recovery message already answered, so the same failure is
 * never sent again from another tab or after a reload, and, for a prompt the
 * server refused before a run started, its refusal marker and retry context,
 * so the setup card and Retry still resend the original request.
 */
function persistedMessageMetadata(
  value: unknown,
): { metadata: Record<string, unknown> } | Record<string, never> {
  const metadata = asRecord(value);
  const custom = asRecord(metadata?.custom);
  const answeredRunId = custom?.agentNativeRecoveryOfRunId;
  const refused = custom?.[RUN_NOT_STARTED_METADATA_KEY] === true;
  const refusedCustom = refused
    ? Object.fromEntries(
        REFUSED_TURN_CUSTOM_KEYS.flatMap((key) =>
          custom[key] === undefined ? [] : [[key, custom[key]]],
        ),
      )
    : {};
  const keptCustom = {
    ...refusedCustom,
    ...(typeof answeredRunId === "string" && answeredRunId
      ? { agentNativeRecoveryOfRunId: answeredRunId }
      : {}),
  };
  const kept = {
    ...(refused ? refusedTurnRetryContext(metadata) : {}),
    ...(metadata?.hideUserMessage === true ? { hideUserMessage: true } : {}),
    ...(Object.keys(keptCustom).length > 0 ? { custom: keptCustom } : {}),
  };
  return Object.keys(kept).length > 0 ? { metadata: kept } : {};
}

function mergeStoredAndIncomingMessages(
  stored: AgentMessage[],
  incoming: AgentMessage[],
): AgentMessage[] {
  const messages = new Map(stored.map((message) => [message.id, message]));
  for (const message of incoming) {
    messages.set(message.id, message);
  }
  return [...messages.values()];
}

function mergeLegacyRootMessages(
  snapshotMessages: AgentMessage[],
  legacyMessages: AgentMessage[],
): AgentMessage[] {
  const merged = [...snapshotMessages];
  for (const message of legacyMessages) {
    const createdAt = Date.parse(message.createdAt ?? "");
    const index = merged.findIndex((candidate) => {
      const candidateCreatedAt = Date.parse(candidate.createdAt ?? "");
      return (
        Number.isFinite(createdAt) &&
        Number.isFinite(candidateCreatedAt) &&
        candidateCreatedAt > createdAt
      );
    });
    if (index === -1) merged.push(message);
    else merged.splice(index, 0, message);
  }
  return merged;
}

function mergeStoredAndIncomingToolCalls(
  stored: AgentToolCall[],
  incoming: AgentToolCall[],
): AgentToolCall[] {
  const toolCalls = new Map(stored.map((toolCall) => [toolCall.id, toolCall]));
  for (const toolCall of incoming) {
    toolCalls.set(toolCall.id, toolCall);
  }
  return [...toolCalls.values()];
}

function mergeStoredAndIncomingWidgets(
  stored: AgentWidgetSnapshot[],
  incoming: AgentWidgetSnapshot[],
): AgentWidgetSnapshot[] {
  const widgets = new Map(
    stored.map((snapshot) => [snapshot.widget.id, snapshot]),
  );
  for (const snapshot of incoming) {
    widgets.set(snapshot.widget.id, snapshot);
  }
  return [...widgets.values()];
}

function persistedActionWidgets(
  widgets: AgentWidgetSnapshot[] = [],
  messageIds: ReadonlySet<string>,
): AgentWidgetSnapshot[] {
  return widgets.flatMap(({ messageId, widget }) => {
    if (!messageIds.has(messageId)) return [];
    const data = asRecord(widget.data);
    if (
      typeof data?.toolCallId !== "string" ||
      typeof data.toolName !== "string"
    ) {
      return [];
    }
    const description = asRecord(widget.metadata)?.description;
    return [
      {
        messageId,
        widget: {
          id: widget.id,
          kind: widget.kind,
          data: { toolCallId: data.toolCallId, toolName: data.toolName },
          ...(widget.title ? { title: widget.title } : {}),
          ...(typeof description === "string"
            ? { metadata: { description } }
            : {}),
        },
      },
    ];
  });
}

function persistedToolCalls(toolCalls: AgentToolCall[] = []): AgentToolCall[] {
  return toolCalls.flatMap((toolCall) => {
    const serialized = JSON.stringify(toolCall);
    if (
      serialized &&
      new TextEncoder().encode(serialized).byteLength <= 64 * 1024
    ) {
      return [JSON.parse(serialized) as AgentToolCall];
    }
    return [
      {
        id: toolCall.id,
        name: toolCall.name,
        status: toolCall.status,
        ...(toolCall.runId ? { runId: toolCall.runId } : {}),
        ...(toolCall.messageId ? { messageId: toolCall.messageId } : {}),
        metadata: {
          agentKitSnapshot: {
            toolCallResult: "omitted",
            reason: serialized ? "size_limit" : "not_json",
          },
        },
      },
    ];
  });
}

function changedSnapshotEntries<T>(
  incoming: T[],
  previous: unknown,
  getId: (entry: T) => string | undefined,
): T[] {
  const previousById = new Map<string, unknown>();
  for (const entry of Array.isArray(previous) ? previous : []) {
    const id = getId(entry as T);
    if (id) previousById.set(id, entry);
  }
  return incoming.filter((entry) => {
    const id = getId(entry);
    if (!id || !previousById.has(id)) return true;
    return JSON.stringify(previousById.get(id)) !== JSON.stringify(entry);
  });
}

function samePersistedMessageContent(
  left: AgentMessage,
  right: AgentMessage,
): boolean {
  return (
    left.role === right.role &&
    JSON.stringify(left.parts) === JSON.stringify(right.parts) &&
    JSON.stringify(left.status) === JSON.stringify(right.status) &&
    JSON.stringify(left.metadata) === JSON.stringify(right.metadata)
  );
}

function snapshotEntryId(value: unknown): string | undefined {
  const entry = asRecord(value);
  return typeof entry?.id === "string" ? entry.id : undefined;
}

function snapshotWidgetId(value: unknown): string | undefined {
  const entry = asRecord(value);
  const widget = asRecord(entry?.widget);
  return typeof widget?.id === "string" ? widget.id : undefined;
}

function snapshotAnnotationKey(value: unknown): string {
  const entry = asRecord(value);
  const annotation = asRecord(entry?.annotation);
  return typeof annotation?.id === "string"
    ? JSON.stringify(["id", annotation.id])
    : JSON.stringify(["value", value]);
}

function threadSnapshotBody(input: {
  stored: StoredThread;
  title?: string;
  snapshotMessages: AgentMessage[];
  agentKit: Record<string, unknown>;
}): string {
  const repository = { messages: [], agentKit: input.agentKit };
  return JSON.stringify({
    threadData: JSON.stringify(repository),
    title:
      input.title ??
      (typeof input.stored.title === "string" ? input.stored.title : ""),
    preview:
      typeof input.stored.preview === "string" ? input.stored.preview : "",
    messageCount: input.snapshotMessages.length,
  });
}

function storedMessageId(value: unknown): string | undefined {
  const outer = asRecord(value);
  const message = asRecord(outer?.message ?? outer);
  return typeof message?.id === "string" ? message.id : undefined;
}

function storedActionWidgets(value: unknown): {
  toolCalls: AgentToolCall[];
  widgets: AgentWidgetSnapshot[];
} {
  if (!Array.isArray(value)) return { toolCalls: [], widgets: [] };
  const toolCalls: AgentToolCall[] = [];
  const widgets: AgentWidgetSnapshot[] = [];

  for (const [index, entry] of value.entries()) {
    const outer = asRecord(entry);
    const message = asRecord(outer?.message ?? outer);
    if (!message || !Array.isArray(message.content)) continue;
    const messageId =
      typeof message.id === "string"
        ? message.id
        : `repository-message-${index}`;

    for (const value of message.content) {
      const part = asRecord(value);
      const chatUI = asRecord(part?.chatUI);
      if (
        part?.type !== "tool-call" ||
        typeof part.toolCallId !== "string" ||
        typeof part.toolName !== "string" ||
        typeof chatUI?.renderer !== "string" ||
        chatUI.renderer.length === 0 ||
        part.result === undefined
      ) {
        continue;
      }

      const input = asRecord(part.args);
      const toolCall: AgentToolCall = {
        id: part.toolCallId,
        name: part.toolName,
        ...(input ? { input } : {}),
        output: "chatUIResult" in part ? part.chatUIResult : part.result,
        status: part.isError === true ? "failed" : "completed",
        messageId,
      };
      toolCalls.push(toolCall);
      if (part.isError === true) continue;
      const widget: AgentWidgetSnapshot["widget"] = {
        id: `${part.toolCallId}:chat-ui`,
        kind: chatUI.renderer,
        data: { toolCallId: part.toolCallId, toolName: part.toolName },
        ...(typeof chatUI.title === "string" ? { title: chatUI.title } : {}),
        ...(typeof chatUI.description === "string"
          ? { metadata: { description: chatUI.description } }
          : {}),
      };
      widgets.push({ messageId, widget });
    }
  }

  return { toolCalls, widgets };
}

async function responseError(response: Response): Promise<Error> {
  if (response.status === 413) {
    return Object.assign(new Error(CHAT_REQUEST_TOO_LARGE_MESSAGE), {
      code: "http_413",
      status: response.status,
      retryable: false,
    });
  }

  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    return Object.assign(
      new Error(
        `Agent chat request failed with ${response.status}, and its error body could not be read.`,
        { cause },
      ),
      {
        code: httpErrorCode(response.status),
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
      },
    );
  }
  let payload: Record<string, unknown> | undefined;
  try {
    payload = asRecord(JSON.parse(body)) ?? undefined;
  } catch {
    payload = undefined;
  }
  const data = asRecord(payload?.data);
  const nestedError = asRecord(payload?.error);
  const nestedMessage =
    typeof payload?.error === "string"
      ? payload.error
      : typeof data?.message === "string"
        ? data.message
        : typeof nestedError?.message === "string"
          ? nestedError.message
          : typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.statusMessage === "string"
              ? payload.statusMessage
              : undefined;
  const explicitRetryable =
    data?.retryable ?? payload?.retryable ?? nestedError?.retryable;
  const activeRunId =
    (typeof data?.activeRunId === "string" && data.activeRunId) ||
    (typeof payload?.activeRunId === "string" && payload.activeRunId) ||
    (typeof nestedError?.activeRunId === "string" && nestedError.activeRunId);
  const code =
    (typeof data?.code === "string" && data.code) ||
    (typeof payload?.code === "string" && payload.code) ||
    (typeof payload?.errorCode === "string" && payload.errorCode) ||
    (typeof nestedError?.code === "string" && nestedError.code) ||
    (response.status === 409 && activeRunId ? "run_slot_busy" : undefined) ||
    httpErrorCode(response.status);
  const runSlotBusy = response.status === 409 && code === "run_slot_busy";
  const error = runSlotBusy
    ? new AgentKitRunSlotBusyError(
        typeof activeRunId === "string" ? activeRunId : undefined,
      )
    : new Error(
        nestedMessage ??
          (body.trim() || `Agent chat request failed with ${response.status}.`),
      );
  Object.assign(error, {
    ...(nestedMessage ? { message: nestedMessage } : {}),
    code,
    status: response.status,
    retryable:
      typeof explicitRetryable === "boolean"
        ? explicitRetryable
        : isRetryableHttpStatus(response.status),
    ...(activeRunId ? { activeRunId } : {}),
    ...(data?.details === undefined &&
    payload?.details === undefined &&
    nestedError?.details === undefined
      ? {}
      : {
          details: data?.details ?? payload?.details ?? nestedError?.details,
        }),
  });
  return error;
}

function httpErrorCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return `http_${status}`;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function snapshotAnnotationConflicts(
  value: unknown,
): SnapshotAnnotationConflict[] {
  const response = asRecord(value);
  if (!response || response.ok !== true) {
    throw new TypeError("Agent chat thread save response must be an object.");
  }
  if (response.annotationConflicts === undefined) return [];
  if (!Array.isArray(response.annotationConflicts)) {
    throw new TypeError("Agent chat annotation conflicts must be an array.");
  }
  return response.annotationConflicts.map((value) => {
    const conflict = asRecord(value);
    if (
      typeof conflict?.messageId !== "string" ||
      (conflict.operation !== "upsert" && conflict.operation !== "remove") ||
      (conflict.annotationId !== undefined &&
        typeof conflict.annotationId !== "string")
    ) {
      throw new TypeError("Agent chat annotation conflict is invalid.");
    }
    return {
      messageId: conflict.messageId,
      ...(typeof conflict.annotationId === "string"
        ? { annotationId: conflict.annotationId }
        : {}),
      operation: conflict.operation,
    };
  });
}

function scopedThreadEndpoint(
  endpoint: string,
  options: CreateAgentNativeAgentKitTransportOptions,
): string {
  if (!options.isolateHistoryByScope) return endpoint;
  const scope = asRecord(options.scope);
  if (typeof scope?.type !== "string" || typeof scope.id !== "string") {
    return endpoint;
  }
  const params = new URLSearchParams();
  appendChatThreadScopeParams(params, {
    type: scope.type,
    id: scope.id,
  } satisfies ChatThreadScope);
  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

export function createAgentNativeAgentKitTransport(
  options: CreateAgentNativeAgentKitTransportOptions = {},
): AgentKitProtocolAdapter {
  const apiUrl = options.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const fetcher = options.fetch ?? fetch;
  const now = options.adapter?.now ?? (() => new Date().toISOString());
  const promotionClaimIds = new Map<string, string>();
  const durableAssistantMessageIdsByRun = new Map<string, string | null>();
  const assistantHistoryMessageIdsByRun = new Map<string, string>();
  const readinessSourcesBySession = new Map<
    string,
    {
      statusUrl: string;
      fetch: typeof fetch;
      headers: () => Promise<Headers>;
    }
  >();
  let transport: AgentKitProtocolAdapter;

  function promotionClaimId(threadId: string, messageId: string): string {
    const key = JSON.stringify([threadId, messageId]);
    let claimId = promotionClaimIds.get(key);
    if (!claimId) {
      const suffix =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      claimId = `queue-claim-${suffix}`;
      promotionClaimIds.set(key, claimId);
    }
    return claimId;
  }

  function clearPromotionClaimId(threadId: string, messageId: string): void {
    promotionClaimIds.delete(JSON.stringify([threadId, messageId]));
  }

  async function assertAiSetupReady(
    input: { engine?: string; threadId?: string },
    _context?: AgentRequestContext,
  ): Promise<void> {
    const sessionId = input.threadId ?? options.threadId;
    const sessionKey = sessionId ?? "";
    let source = readinessSourcesBySession.get(sessionKey);
    if (!source) {
      if (readinessSourcesBySession.size >= MAX_READINESS_SOURCES) {
        const oldestSession = readinessSourcesBySession.keys().next().value;
        if (oldestSession !== undefined) {
          readinessSourcesBySession.delete(oldestSession);
        }
      }
      source = {
        statusUrl: agentEngineStatusUrlForChatApi(apiUrl),
        fetch: fetcher,
        headers: () => headers({ sessionId }),
      };
      readinessSourcesBySession.set(sessionKey, source);
    }
    return requireAgentEngineConfiguredForDispatch({
      engine: input.engine ?? options.engine,
      source,
    });
  }

  async function headers(input: { sessionId?: string } = {}): Promise<Headers> {
    const configured =
      typeof options.headers === "function"
        ? await options.headers({ sessionId: input.sessionId })
        : options.headers;
    return new Headers(configured);
  }

  async function fetchThread(threadId: string): Promise<StoredThread | null> {
    const response = await fetcher(
      scopedThreadEndpoint(
        `${apiUrl}/threads/${encodeURIComponent(threadId)}`,
        options,
      ),
      { headers: await headers({ sessionId: threadId }) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response);
    const value = await response.json();
    if (!asRecord(value)) {
      throw new TypeError("Agent chat thread response must be an object.");
    }
    return value as StoredThread;
  }

  function projectThread(
    threadId: string,
    stored: StoredThread,
  ): AgentThreadSnapshot {
    const projectedAt = now();
    const createdAt = timestamp(stored.createdAt, projectedAt);
    const updatedAt = timestamp(stored.updatedAt, createdAt);
    const repository = storedRepository(stored);
    const agentKit = asRecord(repository.agentKit);
    const failedRunIds = new Set(
      (Array.isArray(agentKit?.runs) ? agentKit.runs : []).flatMap((value) => {
        const run = asRecord(value);
        return run?.status === "failed" &&
          asRecord(run.error) &&
          typeof run.id === "string"
          ? [run.id]
          : [];
      }),
    );
    const storedMessageProjection = storedMessages(
      repository.messages,
      now,
      options.adapter?.textFormat,
    ).filter(
      (message) => !isRenderedRunNotStartedNotice(message, failedRunIds),
    );
    const queuedMessages = storedQueue(
      repository.queuedMessages,
      threadId,
      updatedAt,
    );
    const agentKitMessages = Array.isArray(agentKit?.messages)
      ? (agentKit.messages as AgentMessage[])
      : undefined;
    const agentKitMessageIds = new Set(
      agentKitMessages?.map((message) => message.id) ?? [],
    );
    const legacyRootMessages = storedMessageProjection.filter((message) => {
      if (agentKitMessageIds.has(message.id)) return false;
      const metadata = asRecord(message.metadata);
      const custom = asRecord(metadata?.custom);
      if (
        typeof metadata?.runId === "string" ||
        typeof custom?.submittedRunId === "string" ||
        typeof custom?.agentKitMessageId === "string"
      ) {
        return false;
      }
      return !message.parts.some((part) => {
        if (part.type !== "data") return false;
        const repositoryPart = asRecord(part.data);
        return repositoryPart?.type === "tool-call";
      });
    });
    const mergeAllStoredMessages =
      agentKit?._mergeRootMessages === true || agentKitMessages?.length === 0;
    const messagesWithLegacyRoot =
      agentKitMessages &&
      agentKit?._mergeRootMessages !== true &&
      agentKitMessages.length > 0
        ? mergeLegacyRootMessages(agentKitMessages, legacyRootMessages)
        : undefined;
    const protocolSnapshot = agentKit
      ? parseAgentThreadSnapshot({
          id: threadId,
          title: typeof stored.title === "string" ? stored.title : undefined,
          createdAt,
          updatedAt,
          metadata: asRecord(stored.metadata) ?? undefined,
          messages: agentKitMessages
            ? mergeAllStoredMessages
              ? mergeStoredAndIncomingMessages(
                  storedMessageProjection,
                  agentKitMessages,
                )
              : (messagesWithLegacyRoot ?? agentKitMessages)
            : storedMessageProjection,
          events: agentKit.events,
          runs: agentKit.runs,
          activeRunIds: agentKit.activeRunIds,
          suggestions: agentKit.suggestions,
          toolCalls: agentKit.toolCalls,
          activities: agentKit.activities,
          widgets: agentKit.widgets,
          annotations: agentKit.annotations,
        })
      : undefined;
    const durableMessages = storedMessageProjection;
    const messages = protocolSnapshot?.messages
      ? reconcileDurableMessages(
          protocolSnapshot.messages,
          durableMessages,
          protocolSnapshot.events,
          protocolSnapshot.runs,
          protocolSnapshot.toolCalls ?? [],
        )
      : durableMessages;
    const actionWidgets = storedActionWidgets(repository.messages);
    const canonicalToolCallMessageIds = new Map(
      (protocolSnapshot?.toolCalls ?? []).flatMap((toolCall) =>
        toolCall.messageId ? [[toolCall.id, toolCall.messageId] as const] : [],
      ),
    );
    const embeddedWidgetIds = new Set(
      messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "widget" ? [part.widget.id] : [],
        ),
      ),
    );
    const persistedWidgetIds = new Set([
      ...(protocolSnapshot?.widgets ?? []).map(({ widget }) => widget.id),
      ...embeddedWidgetIds,
    ]);
    const messageIds = new Set(messages.map((message) => message.id));
    const reconciledActionWidgets = actionWidgets.widgets.map(
      ({ messageId, widget }) => {
        const toolCallId = asRecord(widget.data)?.toolCallId;
        const canonicalMessageId =
          typeof toolCallId === "string"
            ? canonicalToolCallMessageIds.get(toolCallId)
            : undefined;
        return {
          messageId:
            canonicalMessageId && messageIds.has(canonicalMessageId)
              ? canonicalMessageId
              : messageId,
          widget,
        };
      },
    );
    const widgetMessageIds = new Set(
      reconciledActionWidgets
        .filter(({ widget }) => !persistedWidgetIds.has(widget.id))
        .map(({ messageId }) => messageId),
    );
    for (const message of storedMessageProjection) {
      if (!widgetMessageIds.has(message.id) || messageIds.has(message.id)) {
        continue;
      }
      messages.push({
        ...message,
        parts: message.parts.filter((part) => part.type !== "data"),
      });
      messageIds.add(message.id);
    }
    for (const { messageId, widget } of reconciledActionWidgets) {
      if (!persistedWidgetIds.has(widget.id) && !messageIds.has(messageId)) {
        throw new TypeError(
          `Action widget ${widget.id} references missing message ${messageId}.`,
        );
      }
    }
    const toolCalls = new Map<string, AgentToolCall>(
      (protocolSnapshot?.toolCalls ?? []).map(
        (toolCall): [string, AgentToolCall] => [toolCall.id, toolCall],
      ),
    );
    for (const toolCall of actionWidgets.toolCalls) {
      if (!toolCalls.has(toolCall.id)) toolCalls.set(toolCall.id, toolCall);
    }
    const widgets = new Map<string, AgentWidgetSnapshot>(
      (protocolSnapshot?.widgets ?? []).map(
        (widget): [string, AgentWidgetSnapshot] => [widget.widget.id, widget],
      ),
    );
    for (const widget of reconciledActionWidgets) {
      if (
        !widgets.has(widget.widget.id) &&
        !embeddedWidgetIds.has(widget.widget.id)
      ) {
        widgets.set(widget.widget.id, widget);
      }
    }
    return {
      id: threadId,
      title: typeof stored.title === "string" ? stored.title : undefined,
      createdAt,
      updatedAt,
      metadata: asRecord(stored.metadata) ?? undefined,
      messages,
      queuedMessages,
      ...(protocolSnapshot?.events ? { events: protocolSnapshot.events } : {}),
      ...(protocolSnapshot?.runs ? { runs: protocolSnapshot.runs } : {}),
      ...(protocolSnapshot?.activeRunIds
        ? { activeRunIds: protocolSnapshot.activeRunIds }
        : {}),
      ...(protocolSnapshot?.suggestions
        ? { suggestions: protocolSnapshot.suggestions }
        : {}),
      ...(protocolSnapshot?.activities
        ? { activities: protocolSnapshot.activities }
        : {}),
      ...(protocolSnapshot?.annotations
        ? { annotations: protocolSnapshot.annotations }
        : {}),
      toolCalls: [...toolCalls.values()],
      widgets: [...widgets.values()],
    };
  }

  async function snapshot(
    threadId: string,
  ): Promise<AgentThreadSnapshot | null> {
    const stored = await fetchThread(threadId);
    return stored ? projectThread(threadId, stored) : null;
  }

  async function activeRunStatus(threadId: string): Promise<ActiveRunStatus> {
    const response = await fetcher(
      `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
      { headers: await headers({ sessionId: threadId }) },
    );
    if (!response.ok) throw await responseError(response);
    const value = asRecord(await response.json());
    if (!value) {
      throw new TypeError("Agent chat active-run response must be an object.");
    }
    return value;
  }

  async function activeRunSnapshot(
    threadId: string,
    value: ActiveRunStatus,
  ): Promise<AgentRunSnapshot | null | undefined> {
    const status = value.status;
    if (typeof value.active !== "boolean") return undefined;
    // An idle thread has no run; a run that just finished keeps its id and
    // status for replay even though it is no longer `active`.
    if (value.active === false && (status === "idle" || !value.runId)) {
      return null;
    }
    if (typeof value.runId !== "string" || !value.runId) {
      throw new TypeError(
        "Agent chat active-run response must include an active run ID.",
      );
    }
    let runStatus: AgentRunSnapshot["status"];
    let error: AgentRunSnapshot["error"];
    const terminalReason =
      typeof value.terminalReason === "string"
        ? value.terminalReason
        : undefined;
    const legacyTruncated =
      status === "truncated" ||
      (["complete", "completed"].includes(String(status)) &&
        terminalReason !== undefined &&
        terminalReason !== "done");
    if (legacyTruncated && value.awaitingRedispatch === true) {
      runStatus = "running";
    } else if (legacyTruncated) {
      runStatus = "failed";
      error = {
        code:
          terminalReason && terminalReason !== "done"
            ? terminalReason.startsWith("error:")
              ? terminalReason.slice("error:".length)
              : terminalReason
            : "run_truncated",
        message:
          terminalReason === "run_timeout"
            ? "The run reached its time limit before completion was confirmed."
            : "The server stopped the run before it confirmed completion.",
        retryable: true,
        ...(terminalReason ? { metadata: { terminalReason } } : {}),
      };
    } else if (status === "complete" || status === "completed") {
      runStatus = "completed";
    } else if (status === "failed" || status === "errored") {
      runStatus = "failed";
      error = {
        code: terminalReason?.startsWith("error:")
          ? terminalReason.slice("error:".length)
          : (terminalReason ?? "run_failed"),
        message:
          terminalReason === "run_timeout"
            ? "The run reached its time limit before completion was confirmed."
            : "The server reported that this run failed.",
        ...(terminalReason ? { metadata: { terminalReason } } : {}),
      };
    } else if (status === "cancelled" || status === "aborted") {
      runStatus = "cancelled";
    } else if (status === "truncated") {
      runStatus = "failed";
      error = {
        code: "run_truncated",
        message: "The server stopped the run before it confirmed completion.",
        retryable: true,
      };
    } else if (
      status === "queued" ||
      status === "running" ||
      status === "awaiting_approval" ||
      status === "awaiting_input"
    ) {
      runStatus = status;
    } else {
      throw new TypeError(
        "Agent chat active-run response has an invalid status.",
      );
    }
    const localRun = await protocolTransport.getRun?.({
      threadId,
      runId: value.runId,
    });
    if (
      localRun?.status === "awaiting_approval" ||
      localRun?.status === "awaiting_input"
    ) {
      // The Core turn can be terminal while the protocol run still owns a
      // pending approval or input request and its resumable event stream.
      runStatus = localRun.status;
      error = undefined;
    }
    return {
      id: localRun?.id ?? value.runId,
      threadId,
      status: runStatus,
      // The durable SSE endpoint replays from its first event when a browser
      // has no saved AgentKit cursor; the protocol adapter rebuilds the log.
      lastSequence: 0,
      ...(error ? { error } : {}),
    };
  }

  async function threadSnapshotWithActiveRun(
    threadId: string,
  ): Promise<AgentThreadSnapshot | null> {
    const stored = await fetchThread(threadId);
    const thread = stored ? projectThread(threadId, stored) : null;
    if (!stored || !thread) return thread;
    const repository = storedRepository(stored);
    const durableMessages = storedMessages(
      repository.messages,
      now,
      options.adapter?.textFormat,
    );
    for (const message of durableMessages) {
      if (message.role !== "assistant") continue;
      const foldedRunIds = durableRunIds(message);
      if (foldedRunIds.length < 2) continue;
      for (const runId of foldedRunIds) {
        const previous = durableAssistantMessageIdsByRun.get(runId);
        durableAssistantMessageIdsByRun.set(
          runId,
          previous === undefined || previous === message.id ? message.id : null,
        );
      }
    }
    for (const [runId, messageId] of assistantMessageIdsByRun(thread.events)) {
      assistantHistoryMessageIdsByRun.set(runId, messageId);
    }
    const runsWithAssistantHistory = (thread.runs ?? []).map((run) => {
      const activeMessageId =
        run.activeMessageId ?? assistantHistoryMessageIdsByRun.get(run.id);
      return activeMessageId ? { ...run, activeMessageId } : run;
    });
    const assistantMessageIds = new Set(
      thread.messages.flatMap((message) =>
        message.role === "assistant" ? [message.id] : [],
      ),
    );
    for (const run of runsWithAssistantHistory) {
      if (
        typeof run.activeMessageId === "string" &&
        assistantMessageIds.has(run.activeMessageId)
      ) {
        assistantHistoryMessageIdsByRun.set(run.id, run.activeMessageId);
      }
    }
    if (options.runtime && !isAgentNativeChatRuntime(options.runtime)) {
      return thread;
    }
    const completedRunIds = completedDurableRunIds(durableMessages);
    const userStoppedRunIds = userStoppedDurableRunIds(durableMessages);
    const durableFailures = durableRunFailures(durableMessages);
    const activeStatus = await activeRunStatus(threadId);
    const activeRun = await activeRunSnapshot(threadId, activeStatus);
    if (activeRun === undefined) return thread;
    let discoveredRun = activeRun;
    if (discoveredRun && !discoveredRun.activeMessageId) {
      const activeMessageId = assistantHistoryMessageIdsByRun.get(
        discoveredRun.id,
      );
      if (activeMessageId) {
        discoveredRun = { ...discoveredRun, activeMessageId };
      }
    }
    if (discoveredRun?.status === "failed") {
      const durableFailure = durableFailures.get(discoveredRun.id);
      if (durableFailure) {
        discoveredRun = {
          ...discoveredRun,
          error: { ...discoveredRun.error, ...durableFailure },
        };
      }
    }
    const knownActiveRunId =
      discoveredRun &&
      !["completed", "failed", "cancelled"].includes(discoveredRun.status)
        ? discoveredRun.id
        : undefined;
    const submittedTurns = durableSubmittedTurns(durableMessages);
    const replyRunsByTurn = durableReplyRunsByTurn(durableMessages);
    const discoveredTurnId =
      typeof activeStatus.turnId === "string" ? activeStatus.turnId : undefined;
    // The stale-run reaper hands an interrupted turn to a successor run, which
    // then owns the turn's outcome: the server reports it, or it completed a
    // reply. A successor that failed or was stopped leaves the failure showing.
    const carriedOnByNewerRun = (runId: string) => {
      const turnId = submittedTurns.get(runId);
      if (!turnId) return false;
      if (discoveredRun && discoveredTurnId === turnId) return true;
      return [...(replyRunsByTurn.get(turnId) ?? [])].some(
        (id) => id !== runId && completedRunIds.has(id),
      );
    };
    const runs = runsWithAssistantHistory
      .filter((entry) => entry.id !== discoveredRun?.id)
      .map((run) => {
        if (
          (["queued", "running"].includes(run.status) ||
            (run.status === "failed" &&
              runOutcomeForCode(run.error?.code) === "interrupted")) &&
          carriedOnByNewerRun(run.id)
        ) {
          const { error: _error, ...attempt } = run;
          return { ...attempt, status: "completed" as const };
        }
        if (
          activeRun === null &&
          run.status === "running" &&
          userStoppedRunIds.has(run.id)
        ) {
          return { ...run, status: "cancelled" as const };
        }
        if (
          activeRun === null &&
          run.status === "running" &&
          completedRunIds.has(run.id)
        ) {
          return { ...run, status: "completed" as const };
        }
        if (
          activeRun !== undefined &&
          run.id !== knownActiveRunId &&
          ![
            "completed",
            "failed",
            "cancelled",
            "awaiting_approval",
            "awaiting_input",
          ].includes(run.status)
        ) {
          return {
            ...run,
            status: "failed" as const,
            error: {
              ...(durableFailures.get(run.id) ?? {
                code: "run_state_unavailable",
                message:
                  "The server no longer reports this run as active, so its final result could not be confirmed.",
                retryable: true,
              }),
            },
          };
        }
        return run;
      });
    if (discoveredRun) runs.push(discoveredRun);
    const activeRunIds =
      discoveredRun &&
      !["completed", "failed", "cancelled"].includes(discoveredRun.status)
        ? [discoveredRun.id]
        : activeRun === null
          ? runs
              .filter((run) =>
                ["awaiting_approval", "awaiting_input"].includes(run.status),
              )
              .map((run) => run.id)
          : [];
    const failedRunIds = new Set(
      runs.flatMap((run) =>
        run.status === "failed" && run.error ? [run.id] : [],
      ),
    );
    const messages = reconcileDurableMessages(
      thread.messages,
      durableMessages.filter(
        (message) => !isRenderedRunNotStartedNotice(message, failedRunIds),
      ),
      thread.events,
      runs,
      thread.toolCalls,
    );
    const replayFromStart = [
      "running",
      "awaiting_approval",
      "awaiting_input",
    ].includes(discoveredRun?.status ?? "");
    const replayedMessageIds = new Set<string>();
    for (const event of thread.events ?? []) {
      if (
        event.runId === discoveredRun?.id &&
        (event.type === "message.created" ||
          event.type === "message.completed") &&
        event.message.role === "assistant"
      ) {
        replayedMessageIds.add(event.message.id);
      }
    }
    const messagesForReplay = replayFromStart
      ? messages.filter((message) => {
          if (message.role !== "assistant") return true;
          return !(
            durableRunIds(message).includes(discoveredRun?.id ?? "") ||
            replayedMessageIds.has(message.id) ||
            (message.status === "streaming" &&
              typeof asRecord(message.metadata)?.runId !== "string")
          );
        })
      : messages;
    return {
      ...thread,
      // Replay starts at sequence zero, so rebuild an active assistant instead
      // of appending the same prefix to its persisted partial projection.
      messages: messagesForReplay,
      runs,
      activeRunIds,
    };
  }

  async function persistThreadSnapshot(input: {
    threadId: string;
    snapshot: AgentThreadSnapshot;
  }): Promise<void> {
    let stored = await fetchThread(input.threadId);
    let createdByAnotherRequest = false;
    if (!stored) {
      const requestHeaders = await headers({ sessionId: input.threadId });
      requestHeaders.set("content-type", "application/json");
      const response = await fetcher(
        scopedThreadEndpoint(`${apiUrl}/threads`, options),
        {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            id: input.threadId,
            title: input.snapshot.title ?? "",
          }),
        },
      );
      if (response.status === 409) {
        const racedThread = await fetchThread(input.threadId);
        if (!racedThread) throw await responseError(response);
        stored = racedThread;
        createdByAnotherRequest = true;
      } else {
        if (!response.ok) throw await responseError(response);
        const value = await response.json();
        if (!asRecord(value)) {
          throw new TypeError("Agent chat thread response must be an object.");
        }
        stored = value as StoredThread;
      }
    }
    const repository = storedRepository(stored);
    const previousAgentKit = asRecord(repository.agentKit) ?? {};
    const storedSnapshot = createdByAnotherRequest
      ? projectThread(input.threadId, stored)
      : null;
    const snapshotMessages = storedSnapshot
      ? mergeStoredAndIncomingMessages(
          mergeStoredAndIncomingMessages(
            storedSnapshot.messages,
            storedMessages(
              repository.messages,
              now,
              options.adapter?.textFormat,
            ),
          ),
          input.snapshot.messages,
        )
      : input.snapshot.messages;
    const snapshotToolCalls = storedSnapshot
      ? mergeStoredAndIncomingToolCalls(
          storedSnapshot.toolCalls ?? [],
          input.snapshot.toolCalls ?? [],
        )
      : input.snapshot.toolCalls;
    const snapshotWidgets = createdByAnotherRequest
      ? mergeStoredAndIncomingWidgets(
          Array.isArray(previousAgentKit.widgets)
            ? (previousAgentKit.widgets as AgentWidgetSnapshot[])
            : [],
          input.snapshot.widgets ?? [],
        )
      : input.snapshot.widgets;
    const compactEvents = persistedHistoryEvents(input.snapshot.events);
    const runsById = new Map<string, unknown>();
    const previousRuns = Array.isArray(previousAgentKit.runs)
      ? previousAgentKit.runs
      : [];
    for (const run of [...previousRuns, ...(input.snapshot.runs ?? [])]) {
      const record = asRecord(run);
      if (typeof record?.id === "string") runsById.set(record.id, run);
    }
    const snapshotMessageIds = new Set(
      snapshotMessages.map((message) => message.id),
    );
    const previousAgentKitMessageIds = new Set(
      (Array.isArray(previousAgentKit.messages)
        ? previousAgentKit.messages
        : []
      ).flatMap((message) => {
        const id = snapshotEntryId(message);
        return id ? [id] : [];
      }),
    );
    const topLevelMessageProjections = new Map(
      persistedMessages(
        Array.isArray(repository.messages)
          ? storedMessages(
              repository.messages,
              now,
              options.adapter?.textFormat,
            )
          : [],
      ).map((message) => [message.id, message]),
    );
    const persistedSnapshotMessages = persistedMessages(snapshotMessages);
    const changedMessages = changedSnapshotEntries(
      persistedSnapshotMessages,
      previousAgentKit.messages,
      snapshotEntryId,
    ).filter((message) => {
      if (previousAgentKitMessageIds.has(message.id)) return true;
      const topLevelMessage = topLevelMessageProjections.get(message.id);
      return (
        !topLevelMessage ||
        !samePersistedMessageContent(topLevelMessage, message)
      );
    });
    const mergeRootMessages =
      previousAgentKit._mergeRootMessages === true ||
      persistedSnapshotMessages.some((message) => {
        const topLevelMessage = topLevelMessageProjections.get(message.id);
        return (
          !previousAgentKitMessageIds.has(message.id) &&
          topLevelMessage !== undefined &&
          samePersistedMessageContent(topLevelMessage, message)
        );
      });
    const changedWidgets = changedSnapshotEntries(
      persistedActionWidgets(snapshotWidgets, snapshotMessageIds),
      previousAgentKit.widgets,
      snapshotWidgetId,
    );
    const changedToolCalls = changedSnapshotEntries(
      persistedToolCalls(snapshotToolCalls),
      previousAgentKit.toolCalls,
      snapshotEntryId,
    );
    const previousEventsByRun = new Map<string, unknown[]>();
    for (const event of Array.isArray(previousAgentKit.events)
      ? previousAgentKit.events
      : []) {
      const runId = asRecord(event)?.runId;
      if (typeof runId !== "string") continue;
      const events = previousEventsByRun.get(runId);
      if (events) events.push(event);
      else previousEventsByRun.set(runId, [event]);
    }
    const incomingEventsByRun = new Map<string, AgentEvent[]>();
    for (const event of compactEvents) {
      const events = incomingEventsByRun.get(event.runId);
      if (events) events.push(event);
      else incomingEventsByRun.set(event.runId, [event]);
    }
    const changedEventRunIds = new Set<string>();
    for (const [runId, events] of incomingEventsByRun) {
      if (
        JSON.stringify(previousEventsByRun.get(runId) ?? []) ===
        JSON.stringify(events)
      ) {
        continue;
      }
      changedEventRunIds.add(runId);
    }
    const changedEvents = compactEvents.filter((event) =>
      changedEventRunIds.has(event.runId),
    );
    const eventRunLastSequenceById = new Map<string, number>();
    for (const run of input.snapshot.runs ?? []) {
      if (
        typeof run.id === "string" &&
        Number.isSafeInteger(run.lastSequence) &&
        run.lastSequence >= 0
      ) {
        eventRunLastSequenceById.set(run.id, run.lastSequence);
      }
    }
    for (const event of input.snapshot.events ?? []) {
      const previousSequence = eventRunLastSequenceById.get(event.runId) ?? 0;
      if (Number.isSafeInteger(event.sequence)) {
        eventRunLastSequenceById.set(
          event.runId,
          Math.max(previousSequence, event.sequence),
        );
      }
    }
    const changedEventsByRun = new Map<string, AgentEvent[]>();
    for (const event of changedEvents) {
      const runEvents = changedEventsByRun.get(event.runId);
      if (runEvents) runEvents.push(event);
      else changedEventsByRun.set(event.runId, [event]);
    }
    const eventRunSnapshotBatches = new Map<
      string,
      {
        runId: string;
        snapshotId: string;
        lastSequence: number;
        expectedEventCount: number;
      }
    >();
    for (const [runId, events] of changedEventsByRun) {
      const lastSequence = eventRunLastSequenceById.get(runId) ?? events.length;
      const snapshotId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      eventRunSnapshotBatches.set(runId, {
        runId,
        snapshotId,
        lastSequence,
        expectedEventCount: new Set(events.map((event) => event.id)).size,
      });
    }
    const lastChangedEventIndexByRun = new Map<string, number>();
    changedEvents.forEach((event, index) => {
      lastChangedEventIndexByRun.set(event.runId, index);
    });
    const changedEventUpdates = changedEvents.map((event, index) => {
      return {
        key: "events",
        entry: event,
        eventRunSnapshotBatch: eventRunSnapshotBatches.get(event.runId),
        completesEventRunSnapshot:
          lastChangedEventIndexByRun.get(event.runId) === index,
      };
    });
    const persistedRuns = [...runsById.values()].map((run) => {
      const record = asRecord(run);
      return record && record.error !== undefined
        ? { ...record, error: persistedError(record.error) }
        : run;
    });
    const changedRuns = changedSnapshotEntries(
      persistedRuns,
      previousAgentKit.runs,
      snapshotEntryId,
    );
    const latestRun = latestSnapshotRunRecord(persistedRuns);
    const latestRunId = latestRun?.id;
    const previousLatestRun = latestSnapshotRunRecord(previousAgentKit.runs);
    const latestRunSequence =
      typeof latestRun?.lastSequence === "number" &&
      Number.isSafeInteger(latestRun.lastSequence) &&
      latestRun.lastSequence >= 0
        ? latestRun.lastSequence
        : undefined;
    const previousLatestRunSequence =
      typeof previousLatestRun?.lastSequence === "number" &&
      Number.isSafeInteger(previousLatestRun.lastSequence) &&
      previousLatestRun.lastSequence >= 0
        ? previousLatestRun.lastSequence
        : undefined;
    const latestRunIsNew = latestRun?.id !== previousLatestRun?.id;
    const latestRunJustCompleted =
      latestRun?.id === previousLatestRun?.id &&
      previousLatestRun?.status !== "completed" &&
      latestRunSequence !== undefined &&
      previousLatestRunSequence !== undefined &&
      latestRunSequence >= previousLatestRunSequence;
    const latestRunSuggestionsChanged =
      input.snapshot.suggestions !== undefined &&
      JSON.stringify(input.snapshot.suggestions) !==
        JSON.stringify(previousAgentKit.suggestions);
    const shouldPersistLatestRunSuggestions =
      latestRun?.status === "completed" &&
      (latestRunIsNew ||
        latestRunJustCompleted ||
        (latestRunSuggestionsChanged &&
          latestRunSequence !== undefined &&
          previousLatestRunSequence !== undefined &&
          latestRunSequence > previousLatestRunSequence));
    const annotations =
      input.snapshot.annotations ??
      (Array.isArray(previousAgentKit.annotations)
        ? (previousAgentKit.annotations as AgentAnnotationSnapshot[])
        : []);
    const persistedSnapshotAnnotations = persistedAnnotations(
      annotations,
      snapshotMessageIds,
    );
    const previousAnnotationsByMessage = new Map<string, unknown[]>();
    for (const annotation of Array.isArray(previousAgentKit.annotations)
      ? previousAgentKit.annotations
      : []) {
      const messageId = asRecord(annotation)?.messageId;
      if (typeof messageId !== "string") continue;
      const messageAnnotations = previousAnnotationsByMessage.get(messageId);
      if (messageAnnotations) messageAnnotations.push(annotation);
      else previousAnnotationsByMessage.set(messageId, [annotation]);
    }
    const incomingAnnotationsByMessage = new Map<
      string,
      AgentAnnotationSnapshot[]
    >();
    for (const annotation of persistedSnapshotAnnotations) {
      const messageAnnotations = incomingAnnotationsByMessage.get(
        annotation.messageId,
      );
      if (messageAnnotations) messageAnnotations.push(annotation);
      else incomingAnnotationsByMessage.set(annotation.messageId, [annotation]);
    }
    const annotationMessageIdsToReplace: Array<{
      messageId: string;
      annotationsToRemove: Array<{ key: string; baseline: unknown }>;
    }> = [];
    const changedAnnotations: Array<{
      entry: AgentAnnotationSnapshot;
      baseline: unknown | null;
    }> = [];
    const annotationMessageIds = new Set([
      ...previousAnnotationsByMessage.keys(),
      ...incomingAnnotationsByMessage.keys(),
    ]);
    for (const messageId of annotationMessageIds) {
      const previous = previousAnnotationsByMessage.get(messageId) ?? [];
      const incoming = incomingAnnotationsByMessage.get(messageId) ?? [];
      const previousByKey = new Map(
        previous.map((annotation) => [
          snapshotAnnotationKey(annotation),
          annotation,
        ]),
      );
      const incomingKeys = new Set(incoming.map(snapshotAnnotationKey));
      const annotationsToRemove = previous.flatMap((annotation) => {
        const key = snapshotAnnotationKey(annotation);
        return incomingKeys.has(key) ? [] : [{ key, baseline: annotation }];
      });
      const changedIncoming = incoming.flatMap((annotation) => {
        const previousAnnotation = previousByKey.get(
          snapshotAnnotationKey(annotation),
        );
        if (
          previousAnnotation !== undefined &&
          JSON.stringify(previousAnnotation) === JSON.stringify(annotation)
        ) {
          return [];
        }
        return [
          {
            entry: annotation,
            baseline: previousAnnotation ?? null,
          },
        ];
      });
      if (annotationsToRemove.length === 0 && changedIncoming.length === 0) {
        continue;
      }
      if (annotationsToRemove.length > 0) {
        let removals: typeof annotationsToRemove = [];
        for (const removal of annotationsToRemove) {
          const candidate = {
            messageId,
            annotationsToRemove: [...removals, removal],
          };
          if (
            new TextEncoder().encode(JSON.stringify(candidate)).byteLength <=
            MAX_THREAD_SNAPSHOT_ANNOTATION_REPLACEMENT_BYTES
          ) {
            removals.push(removal);
            continue;
          }
          if (removals.length === 0) {
            throw new RangeError(
              "An annotation removal exceeds the persistence request size limit.",
            );
          }
          annotationMessageIdsToReplace.push({
            messageId,
            annotationsToRemove: removals,
          });
          removals = [removal];
          const singleRemoval = { messageId, annotationsToRemove: removals };
          if (
            new TextEncoder().encode(JSON.stringify(singleRemoval)).byteLength >
            MAX_THREAD_SNAPSHOT_ANNOTATION_REPLACEMENT_BYTES
          ) {
            throw new RangeError(
              "An annotation removal exceeds the persistence request size limit.",
            );
          }
        }
        if (removals.length > 0) {
          annotationMessageIdsToReplace.push({
            messageId,
            annotationsToRemove: removals,
          });
        }
      }
      changedAnnotations.push(...changedIncoming);
    }
    type SnapshotUpdate = {
      key: string;
      entry: unknown;
      eventRunSnapshotBatch?: {
        runId: string;
        snapshotId: string;
        lastSequence: number;
        expectedEventCount: number;
      };
      completesEventRunSnapshot?: boolean;
      includeSuggestions?: boolean;
    };
    const updates: SnapshotUpdate[] = [
      ...changedMessages.map((entry) => ({ key: "messages", entry })),
      ...changedWidgets.map((entry) => ({ key: "widgets", entry })),
      ...changedToolCalls.map((entry) => ({ key: "toolCalls", entry })),
      ...changedEventUpdates,
      ...changedAnnotations.map((entry) => ({
        key: "annotationUpserts",
        entry,
      })),
      ...annotationMessageIdsToReplace.map((entry) => ({
        key: "annotationMessageIdsToReplace",
        entry,
      })),
      ...changedRuns.map((entry) => ({
        key: "runs",
        entry,
        ...(shouldPersistLatestRunSuggestions &&
        asRecord(entry)?.id === latestRunId
          ? { includeSuggestions: true }
          : {}),
      })),
    ];
    const fixedAgentKit = {
      _snapshotDelta: true,
      ...(mergeRootMessages ? { _mergeRootMessages: true } : {}),
      messages: [],
      widgets: [],
      toolCalls: [],
      events: [],
      eventRunSnapshotBatches: [],
      annotationMessageIdsToReplace: [],
      annotations: [],
      annotationUpserts: [],
      runs: [],
    };
    const requestHeaders = await headers({ sessionId: input.threadId });
    requestHeaders.set("content-type", "application/json");
    const bodyFor = (entries: typeof updates) => {
      const agentKit: Record<string, unknown> = { ...fixedAgentKit };
      for (const key of [
        "messages",
        "widgets",
        "toolCalls",
        "events",
        "eventRunSnapshotBatches",
        "annotationMessageIdsToReplace",
        "annotations",
        "annotationUpserts",
        "runs",
      ]) {
        agentKit[key] = [];
      }
      const eventSnapshotBatchRunIds = new Set<string>();
      const completedEventRunIds = new Set(
        entries.flatMap((update) =>
          update.key === "events" &&
          update.completesEventRunSnapshot &&
          update.eventRunSnapshotBatch
            ? [update.eventRunSnapshotBatch.runId]
            : [],
        ),
      );
      for (const {
        key,
        entry,
        eventRunSnapshotBatch,
        includeSuggestions,
      } of entries) {
        if (key === "events") {
          (agentKit.events as unknown[]).push(entry);
          if (
            eventRunSnapshotBatch &&
            !eventSnapshotBatchRunIds.has(eventRunSnapshotBatch.runId)
          ) {
            eventSnapshotBatchRunIds.add(eventRunSnapshotBatch.runId);
            (agentKit.eventRunSnapshotBatches as unknown[]).push({
              ...eventRunSnapshotBatch,
              complete: completedEventRunIds.has(eventRunSnapshotBatch.runId),
            });
          }
          continue;
        }
        if (key === "runs") {
          (agentKit.runs as unknown[]).push(entry);
          if (includeSuggestions && input.snapshot.suggestions !== undefined) {
            agentKit.suggestions = input.snapshot.suggestions;
          }
        } else {
          (agentKit[key] as unknown[]).push(entry);
        }
      }
      return threadSnapshotBody({
        stored,
        title: input.snapshot.title,
        snapshotMessages,
        agentKit,
      });
    };
    const chunks: Array<typeof updates> = [];
    let chunk: typeof updates = [];
    const encoder = new TextEncoder();
    const baseBodyBytes = encoder.encode(bodyFor([])).byteLength;
    let chunkBytes = baseBodyBytes;
    const chunkKeyCounts = new Map<string, number>();
    for (const update of updates) {
      const duplicateAnnotationRemoval =
        update.key === "annotationMessageIdsToReplace" &&
        chunk.some(
          (entry) =>
            entry.key === "annotationMessageIdsToReplace" &&
            asRecord(entry.entry)?.messageId ===
              asRecord(update.entry)?.messageId,
        );
      if (duplicateAnnotationRemoval) {
        chunks.push(chunk);
        chunk = [];
        chunkBytes = baseBodyBytes;
        chunkKeyCounts.clear();
      }
      const entryBytes =
        encoder.encode(bodyFor([update])).byteLength - baseBodyBytes;
      const addition = entryBytes + (chunkKeyCounts.has(update.key) ? 1 : 0);
      if (chunkBytes + addition > MAX_THREAD_SNAPSHOT_REQUEST_BYTES) {
        if (chunk.length === 0) {
          throw new RangeError(
            "An Agent chat snapshot entry exceeds the persistence request size limit.",
          );
        }
        chunks.push(chunk);
        chunk = [];
        chunkBytes = baseBodyBytes;
        chunkKeyCounts.clear();
      }
      const firstEntryBytes =
        entryBytes + (chunkKeyCounts.has(update.key) ? 1 : 0);
      if (chunkBytes + firstEntryBytes > MAX_THREAD_SNAPSHOT_REQUEST_BYTES) {
        throw new RangeError(
          "An Agent chat snapshot entry exceeds the persistence request size limit.",
        );
      }
      chunk.push(update);
      chunkBytes += firstEntryBytes;
      chunkKeyCounts.set(update.key, (chunkKeyCounts.get(update.key) ?? 0) + 1);
    }
    if (chunk.length > 0 || chunks.length === 0) chunks.push(chunk);

    const threadUrl = scopedThreadEndpoint(
      apiUrl + "/threads/" + encodeURIComponent(input.threadId),
      options,
    );
    const persistChunk = async (
      entries: typeof updates,
    ): Promise<SnapshotAnnotationConflict[]> => {
      const body = bodyFor(entries);
      if (encoder.encode(body).byteLength > MAX_THREAD_SNAPSHOT_REQUEST_BYTES) {
        if (entries.length > 1) {
          const middle = Math.floor(entries.length / 2);
          return [
            ...(await persistChunk(entries.slice(0, middle))),
            ...(await persistChunk(entries.slice(middle))),
          ];
        }
        throw new RangeError(
          "An Agent chat snapshot entry exceeds the persistence request size limit.",
        );
      }
      for (let attempt = 0; ; attempt += 1) {
        const retryAfterReadFailure = async (error: unknown) => {
          if (
            asRecord(error)?.name === "AbortError" ||
            attempt >= MAX_THREAD_SNAPSHOT_RETRIES
          ) {
            throw error;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * 2 ** attempt),
          );
        };
        let response: Response;
        try {
          response = await fetcher(threadUrl, {
            method: "PUT",
            headers: requestHeaders,
            body,
          });
        } catch (error) {
          await retryAfterReadFailure(error);
          continue;
        }
        if (response.status === 413 && entries.length > 1) {
          const middle = Math.floor(entries.length / 2);
          return [
            ...(await persistChunk(entries.slice(0, middle))),
            ...(await persistChunk(entries.slice(middle))),
          ];
        }
        if (!response.ok) {
          let error: Error;
          try {
            error = await responseError(response);
          } catch (readError) {
            await retryAfterReadFailure(readError);
            continue;
          }
          if (
            asRecord(error)?.retryable !== true ||
            attempt >= MAX_THREAD_SNAPSHOT_RETRIES
          ) {
            throw error;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * 2 ** attempt),
          );
          continue;
        }
        try {
          return snapshotAnnotationConflicts(await response.json());
        } catch (readError) {
          await retryAfterReadFailure(readError);
        }
      }
    };
    const annotationConflicts = new Map<string, SnapshotAnnotationConflict>();
    for (const entries of chunks) {
      for (const conflict of await persistChunk(entries)) {
        annotationConflicts.set(
          JSON.stringify([
            conflict.messageId,
            conflict.annotationId ?? null,
            conflict.operation,
          ]),
          conflict,
        );
      }
    }
    if (annotationConflicts.size > 0) {
      const error = new Error(
        "An annotation changed in another save. The latest saved value was preserved; reload the thread before retrying.",
      );
      error.name = "AgentAnnotationSaveConflictError";
      throw error;
    }
  }

  type QueueMutation =
    | { type: "append"; message: AgentQueuedMessage }
    | { type: "remove"; messageId: string }
    | { type: "moveToTop"; messageId: string }
    | { type: "claim"; messageId: string; claimId: string }
    | { type: "release"; messageId: string; claimId: string };

  async function persistQueueMutation(
    threadId: string,
    mutation: QueueMutation,
  ): Promise<{
    queuedMessages: AgentQueuedMessage[];
    message?: AgentQueuedMessage;
    claimedMessage?: AgentQueuedMessage;
  }> {
    const requestHeaders = await headers({ sessionId: threadId });
    requestHeaders.set("content-type", "application/json");
    const response = await fetcher(
      scopedThreadEndpoint(
        `${apiUrl}/threads/${encodeURIComponent(threadId)}/queued`,
        options,
      ),
      {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ mutation }),
      },
    );
    if (!response.ok) throw await responseError(response);
    const value = asRecord(await response.json());
    if (!value || !Array.isArray(value.queuedMessages)) {
      throw new TypeError("Agent chat queue mutation response is invalid.");
    }
    const message = value.message
      ? storedQueue([value.message], threadId, now())[0]
      : undefined;
    const claimedMessage = value.claimedMessage
      ? storedQueue([value.claimedMessage], threadId, now())[0]
      : undefined;
    return {
      queuedMessages: storedQueue(value.queuedMessages, threadId, now()),
      ...(message ? { message } : {}),
      ...(claimedMessage ? { claimedMessage } : {}),
    };
  }

  // A server that predates `active` meaning "in flight" reports a run inside
  // its reconnect window as `active` with a terminal status.
  function runIsInFlight(status: ActiveRunStatus): boolean {
    return (
      status.active === true &&
      ![
        "completed",
        "complete",
        "failed",
        "cancelled",
        "errored",
        "aborted",
      ].includes(String(status.status ?? ""))
    );
  }

  function runSlotIsClear(status: ActiveRunStatus): boolean {
    return status.awaitingRedispatch !== true && !runIsInFlight(status);
  }

  async function waitForRunSlot(
    threadId: string,
    maxPolls = RUN_SLOT_STABLE_POLLS * 2,
  ): Promise<void> {
    let consecutiveClearPolls = 0;
    let status: ActiveRunStatus | undefined;
    let lastError: unknown;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      try {
        status = await activeRunStatus(threadId);
        lastError = undefined;
        consecutiveClearPolls = runSlotIsClear(status)
          ? consecutiveClearPolls + 1
          : 0;
        if (consecutiveClearPolls >= RUN_SLOT_STABLE_POLLS) return;
      } catch (error) {
        if (asRecord(error)?.retryable !== true) throw error;
        lastError = error;
        consecutiveClearPolls = 0;
      }
      if (poll + 1 < maxPolls) {
        await new Promise((resolve) =>
          setTimeout(resolve, RUN_SLOT_POLL_INTERVAL_MS),
        );
      }
    }
    if (lastError) throw lastError;
    const activeRunId =
      typeof status?.runId === "string" ? status.runId : undefined;
    const localRun = activeRunId
      ? await protocolTransport.getRun?.({ threadId, runId: activeRunId })
      : null;
    throw new AgentKitRunSlotBusyError(localRun?.id ?? activeRunId);
  }

  async function startRunTrackingRunningState(
    input: Parameters<AgentKitProtocolAdapter["startRun"]>[0],
    context: Parameters<AgentKitProtocolAdapter["startRun"]>[1],
  ): ReturnType<AgentKitProtocolAdapter["startRun"]> {
    dispatchAgentChatRunning({
      isRunning: true,
      phase: "working",
      threadId: input.threadId,
      tabId: input.threadId,
    });
    try {
      const run = await startRun(input, context);
      dispatchAgentChatRunning({
        isRunning: true,
        phase: "working",
        threadId: input.threadId,
        tabId: input.threadId,
        runId: run.runId,
      });
      return run;
    } catch (error) {
      dispatchAgentChatRunning({
        isRunning: false,
        phase: "idle",
        threadId: input.threadId,
        tabId: input.threadId,
        reason: "start_failed",
      });
      throw error;
    }
  }

  async function readQueue(threadId: string): Promise<AgentQueuedMessage[]> {
    const thread = await snapshot(threadId);
    if (!thread) {
      throw new Error(
        `Cannot load queued messages because thread ${threadId} does not exist.`,
      );
    }
    return thread.queuedMessages ? [...thread.queuedMessages] : [];
  }

  function submittedQueueMessage(
    thread: AgentThreadSnapshot,
    messageId: string,
  ): AgentMessage | undefined {
    const isSubmitted = (message: AgentMessage) =>
      message.id === messageId ||
      asRecord(message.metadata?.custom)?.agentNativeQueuedMessageId ===
        messageId;
    const messageEvent = thread.events?.find(
      (event) => event.type === "message.created" && isSubmitted(event.message),
    );
    return (
      thread.messages.find(isSubmitted) ??
      (messageEvent?.type === "message.created"
        ? messageEvent.message
        : undefined)
    );
  }

  const runtime = options.runtime ?? createAgentNativeChatRuntime(options);
  const feedbackUrl =
    options.feedbackUrl ??
    agentNativePath("/_agent-native/observability/feedback");
  const onRunOutcome = options.adapter?.onRunOutcome ?? trackRunOutcome;
  const protocolTransport = createAgentKitProtocolAdapter(runtime, {
    ...options.adapter,
    onRunOutcome,
    // A spread would freeze the host's label at its locale when this was built.
    get autoContinueLabel() {
      return options.adapter?.autoContinueLabel;
    },
    metadata: adapterMetadata(options),
    capabilities: {
      ...options.adapter?.capabilities,
      threadHistory: true,
      threadForking: true,
      feedback: true,
      messageQueue: true,
      suggestions: true,
      connectionRequests: true,
    },
    operations: {
      getThread: async ({ threadId }) => {
        const thread = await snapshot(threadId);
        if (!thread) return null;
        const {
          messages: _messages,
          queuedMessages: _queue,
          ...summary
        } = thread;
        return summary;
      },
      getThreadSnapshot: ({ threadId }) =>
        threadSnapshotWithActiveRun(threadId),
      listQueuedMessages: async ({ threadId }) => readQueue(threadId),
      queueMessage: async ({
        threadId,
        id,
        text,
        attachments,
        requestAttachments,
        metadata,
        options: runOptions,
      }) => {
        const message: AgentQueuedMessage = {
          id:
            id ??
            options.adapter?.createId?.("queued-message") ??
            `queued-message-${
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
            }`,
          threadId,
          text,
          createdAt: now(),
          attachments,
          requestAttachments,
          metadata,
          options: runOptions,
        };
        const result = await persistQueueMutation(threadId, {
          type: "append",
          message,
        });
        if (!result.message) {
          throw new TypeError("Agent chat queue mutation omitted its message.");
        }
        return { message: result.message };
      },
      removeQueuedMessage: async ({ threadId, messageId }) => {
        await persistQueueMutation(threadId, { type: "remove", messageId });
      },
      moveQueuedMessageToTop: async ({ threadId, messageId }) => {
        await persistQueueMutation(threadId, { type: "moveToTop", messageId });
      },
      steerQueuedMessage: async ({
        threadId,
        messageId,
        interruptActiveRun,
      }) => {
        const initial = await snapshot(threadId);
        if (!initial) throw new Error(`Unknown agent chat thread: ${threadId}`);
        const queued = (initial.queuedMessages ?? []).find(
          (message) => message.id === messageId,
        );
        if (!queued) {
          const submitted = submittedQueueMessage(initial, messageId);
          const runId = asRecord(submitted?.metadata?.custom)?.submittedRunId;
          if (submitted && typeof runId === "string") {
            clearPromotionClaimId(threadId, messageId);
            return { runId, alreadySubmitted: true };
          }
          return { alreadyRemoved: true as const };
        }
        const claimId = promotionClaimId(threadId, messageId);
        let claim: Awaited<ReturnType<typeof persistQueueMutation>>;
        try {
          claim = await persistQueueMutation(threadId, {
            type: "claim",
            messageId,
            claimId,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes(`Unknown queued message: ${messageId}`)
          ) {
            const latest = await snapshot(threadId);
            const submitted =
              latest && submittedQueueMessage(latest, messageId);
            const runId = asRecord(submitted?.metadata?.custom)?.submittedRunId;
            if (submitted && typeof runId === "string") {
              clearPromotionClaimId(threadId, messageId);
              return { runId, alreadySubmitted: true };
            }
            if (
              latest &&
              !(latest.queuedMessages ?? []).some(
                (message) => message.id === messageId,
              )
            ) {
              clearPromotionClaimId(threadId, messageId);
              return { alreadyRemoved: true as const };
            }
          }
          throw error;
        }
        try {
          if (!claim.claimedMessage) {
            throw new TypeError("Agent chat queue claim response is invalid.");
          }
          if (interruptActiveRun) {
            const activeRun = await activeRunStatus(threadId);
            if (runIsInFlight(activeRun)) {
              if (typeof activeRun.runId !== "string" || !activeRun.runId) {
                throw new TypeError(
                  "Agent chat active-run response must include an active run ID.",
                );
              }
              await transport.cancelRun({
                threadId,
                runId: activeRun.runId,
              });
              await waitForRunSlot(threadId, RUN_SLOT_STABLE_POLLS * 4);
            }
          }
          const thread = await snapshot(threadId);
          if (!thread)
            throw new Error(`Unknown agent chat thread: ${threadId}`);
          const run = await startRunTrackingRunningState(
            {
              threadId,
              messages: [
                ...thread.messages.filter(
                  (message) => message.id !== queued.id,
                ),
                {
                  id: queued.id,
                  role: "user",
                  parts: [
                    { type: "text", text: queued.text },
                    ...(queued.attachments ?? []),
                  ],
                  createdAt: queued.createdAt,
                  metadata: queued.metadata,
                },
              ],
              requestAttachments: queued.requestAttachments,
              options: queued.options,
              metadata: queued.metadata,
              queuePromotion: {
                messageId,
                claimId,
                turnId: `queue-${messageId}`,
              },
            },
            undefined,
          );
          clearPromotionClaimId(threadId, messageId);
          return run;
        } catch (error) {
          try {
            await persistQueueMutation(threadId, {
              type: "release",
              messageId,
              claimId,
            });
          } catch (releaseError) {
            throw new AggregateError(
              [error, releaseError],
              "Queue promotion failed and its lease could not be released.",
            );
          }
          throw error;
        }
      },
      forkThread: async ({ threadId, fromMessageId, title, metadata }) => {
        const source = await fetchThread(threadId);
        if (!source) {
          throw new Error("Unknown agent chat thread: " + threadId);
        }
        const fallbackId =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : Date.now().toString(36) +
              "-" +
              Math.random().toString(36).slice(2, 10);
        const forkId =
          options.adapter?.createId?.("thread") ?? "thread-" + fallbackId;
        let forkSource: Record<string, unknown> | undefined;
        if (fromMessageId) {
          const repository = storedRepository(source);
          const agentKit = asRecord(repository.agentKit);
          const sourceMessages = agentKit
            ? projectThread(threadId, source).messages
            : repository.messages;
          if (!Array.isArray(sourceMessages)) {
            throw new Error(
              "The Agent-Native thread cannot be forked from a message without durable history.",
            );
          }
          const throughIndex = sourceMessages.findIndex(
            (message) => storedMessageId(message) === fromMessageId,
          );
          if (throughIndex < 0) {
            throw new Error("Unknown message for fork: " + fromMessageId);
          }
          const messages = sourceMessages.slice(0, throughIndex + 1);
          const retainedMessageIds = new Set(
            messages
              .map(storedMessageId)
              .filter((id): id is string => Boolean(id)),
          );
          const legacyMessages = Array.isArray(repository.messages)
            ? repository.messages.filter((message) =>
                retainedMessageIds.has(storedMessageId(message) ?? ""),
              )
            : undefined;
          const retainedAgentKit =
            agentKit && Array.isArray(agentKit.messages)
              ? {
                  ...agentKit,
                  messages,
                  ...(Array.isArray(agentKit.widgets)
                    ? {
                        widgets: agentKit.widgets.filter((entry) => {
                          const widget = asRecord(entry);
                          return (
                            typeof widget?.messageId === "string" &&
                            retainedMessageIds.has(widget.messageId)
                          );
                        }),
                      }
                    : {}),
                  ...(Array.isArray(agentKit.toolCalls)
                    ? {
                        toolCalls: agentKit.toolCalls.filter((entry) => {
                          const toolCall = asRecord(entry);
                          return (
                            typeof toolCall?.messageId !== "string" ||
                            retainedMessageIds.has(toolCall.messageId)
                          );
                        }),
                      }
                    : {}),
                }
              : undefined;
          forkSource = {
            threadData: JSON.stringify({
              ...repository,
              ...(legacyMessages ? { messages: legacyMessages } : {}),
              ...(retainedAgentKit ? { agentKit: retainedAgentKit } : {}),
              queuedMessages: [],
            }),
            title:
              title ?? (typeof source.title === "string" ? source.title : ""),
            preview: "",
            messageCount: messages.length,
            fromMessageId,
          };
        }
        const requestHeaders = await headers({ sessionId: threadId });
        requestHeaders.set("content-type", "application/json");
        const response = await fetcher(
          apiUrl + "/threads/" + encodeURIComponent(threadId) + "/fork",
          {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({
              id: forkId,
              ...(forkSource ? { source: forkSource } : {}),
              ...(metadata ? { metadata } : {}),
            }),
          },
        );
        if (!response.ok) throw await responseError(response);
        const value = await response.json();
        if (!asRecord(value)) {
          throw new TypeError("Agent chat fork response must be an object.");
        }
        const stored = value as StoredThread;
        return projectThread(
          typeof stored.id === "string" ? stored.id : forkId,
          stored,
        );
      },
      submitFeedback: async ({
        threadId,
        messageId,
        runId,
        messageSeq,
        value,
        reason,
        metadata,
      }) => {
        const requestHeaders = await headers({ sessionId: threadId });
        requestHeaders.set("content-type", "application/json");
        const response = await fetcher(feedbackUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            threadId,
            ...(runId ? { runId } : {}),
            ...(messageSeq !== undefined ? { messageSeq } : {}),
            feedbackType: value === "positive" ? "thumbs_up" : "thumbs_down",
            value: { messageId, value, reason, metadata },
          }),
        });
        if (!response.ok) throw await responseError(response);
        trackRunFeedback({ runId, threadId, positive: value === "positive" });
      },
      ...options.operations,
      persistThreadSnapshot:
        options.operations?.persistThreadSnapshot ?? persistThreadSnapshot,
    },
  });
  const protocolStartRun = protocolTransport.startRun.bind(protocolTransport);
  // The adapter reports a run once it has started. A turn refused at its
  // start, such as a chat with no model connected, would go unreported.
  const reportStartFailure = (threadId: string, error: unknown) => {
    const record = asRecord(error);
    if (typeof record?.turnId !== "string" || record.name === "AbortError") {
      return;
    }
    const code = typeof record.code === "string" ? record.code : undefined;
    try {
      onRunOutcome({
        runId: record.turnId,
        threadId,
        outcome: runOutcomeForCode(code),
        ...(code ? { code } : {}),
        ...(error instanceof Error && error.message
          ? { message: error.message }
          : {}),
        ...(typeof record.retryable === "boolean"
          ? { retryable: record.retryable }
          : {}),
        terminalSource: "local",
        verifiedAfterPipeClosed: false,
        resumeAttempts: 0,
        quietReads: 0,
        drainAttempts: 0,
      });
    } catch {
      // coercion-ok: telemetry must never change how a start fails.
    }
  };
  const startRun: typeof protocolTransport.startRun = async (
    input,
    context,
  ) => {
    try {
      return await protocolStartRun(input, context);
    } catch (error) {
      const record = asRecord(error);
      const serverActiveRunId =
        typeof record?.activeRunId === "string"
          ? record.activeRunId
          : undefined;
      const localRun = serverActiveRunId
        ? await protocolTransport.getRun?.({
            threadId: input.threadId,
            runId: serverActiveRunId,
          })
        : null;
      const activeRunId = localRun?.id ?? serverActiveRunId;
      const explicitNonSlotCode =
        typeof record?.code === "string" &&
        record.code !== "run_slot_busy" &&
        record.code !== "http_409";
      if (
        record?.status === 409 &&
        (error instanceof AgentKitRunSlotBusyError ||
          record.code === "run_slot_busy" ||
          (typeof activeRunId === "string" && !explicitNonSlotCode))
      ) {
        const busy = new AgentKitRunSlotBusyError(
          typeof activeRunId === "string" ? activeRunId : undefined,
        );
        Object.assign(busy, { status: 409 });
        throw busy;
      }
      reportStartFailure(input.threadId, error);
      throw error;
    }
  };
  const subscribeToRun =
    protocolTransport.subscribeToRun.bind(protocolTransport);
  transport = {
    ...protocolTransport,
    assertAiSetupReady,
    startRun: (input, context) => startRunTrackingRunningState(input, context),
    async *subscribeToRun(input) {
      dispatchAgentChatRunning({
        isRunning: true,
        phase: "working",
        threadId: input.threadId,
        tabId: input.threadId,
        runId: input.runId,
      });
      const assistantMessageIds = new Set<string>();
      // Continuation runs keep the durable identity of their folded reply.
      let durableAssistantMessageId =
        durableAssistantMessageIdsByRun.get(input.runId) ?? undefined;
      let foldedAssistantSourceMessageId: string | undefined;
      const foldedMessageIdFor = (sourceMessageId?: string) => {
        if (!durableAssistantMessageId || !sourceMessageId) return undefined;
        foldedAssistantSourceMessageId ??= sourceMessageId;
        return foldedAssistantSourceMessageId === sourceMessageId
          ? durableAssistantMessageId
          : undefined;
      };
      let responseStarted = false;
      let turnId: string | undefined;
      for await (const sourceEvent of subscribeToRun(input)) {
        const interruptedRunId = protocolInterruptedRunId(sourceEvent.metadata);
        const inheritedMessageId = interruptedRunId
          ? (durableAssistantMessageIdsByRun.get(interruptedRunId) ??
            assistantHistoryMessageIdsByRun.get(interruptedRunId))
          : undefined;
        if (inheritedMessageId) {
          if (durableAssistantMessageId !== inheritedMessageId) {
            foldedAssistantSourceMessageId = undefined;
          }
          durableAssistantMessageId = inheritedMessageId;
          durableAssistantMessageIdsByRun.set(input.runId, inheritedMessageId);
        }
        let event = sourceEvent;
        if (isAgentNativeChatRuntime(runtime)) {
          switch (sourceEvent.type) {
            case "message.created":
            case "message.completed":
              if (sourceEvent.message.role === "assistant") {
                const messageId = foldedMessageIdFor(sourceEvent.message.id);
                if (messageId && messageId !== sourceEvent.message.id) {
                  event = {
                    ...sourceEvent,
                    message: { ...sourceEvent.message, id: messageId },
                  };
                }
              }
              break;
            case "message.delta":
            case "reasoning.delta": {
              const messageId = foldedMessageIdFor(sourceEvent.messageId);
              if (messageId && messageId !== sourceEvent.messageId) {
                event = { ...sourceEvent, messageId };
              }
              break;
            }
            case "tool.started":
            case "tool.updated": {
              if (sourceEvent.toolCall.messageId) {
                const messageId = foldedMessageIdFor(
                  sourceEvent.toolCall.messageId,
                );
                if (messageId && messageId !== sourceEvent.toolCall.messageId) {
                  event = {
                    ...sourceEvent,
                    toolCall: { ...sourceEvent.toolCall, messageId },
                  };
                }
              }
              break;
            }
            case "widget.created":
            case "widget.updated":
            case "annotation.created":
            case "annotation.updated": {
              if (sourceEvent.messageId) {
                const messageId = foldedMessageIdFor(sourceEvent.messageId);
                if (messageId && messageId !== sourceEvent.messageId) {
                  event = { ...sourceEvent, messageId };
                }
              }
              break;
            }
            case "action.started": {
              if (sourceEvent.invocation.messageId) {
                const messageId = foldedMessageIdFor(
                  sourceEvent.invocation.messageId,
                );
                if (
                  messageId &&
                  messageId !== sourceEvent.invocation.messageId
                ) {
                  event = {
                    ...sourceEvent,
                    invocation: { ...sourceEvent.invocation, messageId },
                  };
                }
              }
              break;
            }
          }
        }
        turnId ??= protocolTurnId(event.metadata);
        if (event.type === "run.started" && turnId) {
          dispatchAgentChatRunning({
            isRunning: true,
            phase: "working",
            threadId: input.threadId,
            tabId: input.threadId,
            runId: input.runId,
            turnId,
          });
        }
        if (
          event.type === "message.created" &&
          event.message.role === "assistant"
        ) {
          assistantMessageIds.add(event.message.id);
        }
        const startsVisibleResponse =
          (event.type === "message.created" &&
            event.message.role === "assistant" &&
            event.message.parts.some((part) => part.type !== "reasoning")) ||
          (event.type === "message.delta" &&
            assistantMessageIds.has(event.messageId) &&
            event.text.trim().length > 0) ||
          (event.type === "message.completed" &&
            event.message.role === "assistant");
        if (!responseStarted && startsVisibleResponse) {
          responseStarted = true;
          dispatchAgentChatRunning({
            isRunning: true,
            phase: "responding",
            threadId: input.threadId,
            tabId: input.threadId,
            runId: input.runId,
            ...(turnId ? { turnId } : {}),
            reason: "response_started",
          });
        }
        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.cancelled"
        ) {
          dispatchAgentChatRunning({
            isRunning: false,
            phase: "idle",
            threadId: input.threadId,
            tabId: input.threadId,
            runId: input.runId,
            ...(turnId ? { turnId } : {}),
            reason: event.type,
          });
        }
        yield event;
      }
    },
  };
  return transport;
}
