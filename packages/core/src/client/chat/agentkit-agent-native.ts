import type {
  AgentMessage,
  AgentMessagePart,
  AgentObjectReference,
  AgentRunSnapshot,
  AgentQueuedMessage,
  AgentThreadSnapshot,
  TextPart,
} from "@agent-native/agentkit/protocol";
import { parseAgentThreadSnapshot } from "@agent-native/agentkit/protocol";

import { agentNativePath } from "../api-path.js";
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
import {
  createAgentNativeChatRuntime,
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
  /** Override the framework feedback endpoint for a custom host mount. */
  readonly feedbackUrl?: string;
}

interface StoredThread {
  id?: unknown;
  title?: unknown;
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
}

const RUN_SLOT_TIMEOUT_MS = 5_000;
const RUN_SLOT_POLL_INTERVAL_MS = 150;
const RUN_SLOT_STABLE_POLLS = 2;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
    };
  }
  return {
    type: "data",
    data: part,
    mediaType: "application/x-agent-native-repository-part",
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
    return [
      {
        id:
          typeof message.id === "string"
            ? message.id
            : `repository-message-${index}`,
        role,
        parts,
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

function messageStatus(value: unknown): AgentMessage["status"] | undefined {
  return value === "streaming" || value === "complete" || value === "error"
    ? value
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
    return {
      id: queued.id,
      threadId,
      text: queued.text,
      createdAt: timestamp(queued.createdAt, fallbackCreatedAt),
      ...(attachments?.length ? { attachments } : {}),
      ...(asRecord(queued.metadata)
        ? { metadata: asRecord(queued.metadata)! }
        : {}),
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

function storedMessageId(value: unknown): string | undefined {
  const outer = asRecord(value);
  const message = asRecord(outer?.message ?? outer);
  return typeof message?.id === "string" ? message.id : undefined;
}

async function responseError(response: Response): Promise<Error> {
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
  const error = new Error(
    nestedMessage ??
      (body.trim() || `Agent chat request failed with ${response.status}.`),
  );
  Object.assign(error, {
    code:
      (typeof data?.code === "string" && data.code) ||
      (typeof payload?.code === "string" && payload.code) ||
      (typeof payload?.errorCode === "string" && payload.errorCode) ||
      (typeof nestedError?.code === "string" && nestedError.code) ||
      httpErrorCode(response.status),
    status: response.status,
    retryable:
      typeof explicitRetryable === "boolean"
        ? explicitRetryable
        : isRetryableHttpStatus(response.status),
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

/**
 * Creates the production AgentKit transport for Agent-Native applications.
 * It binds the portable protocol to durable Agent-Native threads, queue
 * persistence, approval continuation, and the built-in streaming endpoint.
 */
export function createAgentNativeAgentKitTransport(
  options: CreateAgentNativeAgentKitTransportOptions = {},
): AgentKitProtocolAdapter {
  const apiUrl = options.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const fetcher = options.fetch ?? fetch;
  const now = options.adapter?.now ?? (() => new Date().toISOString());
  let transport: AgentKitProtocolAdapter;

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
    const queuedMessages = storedQueue(
      repository.queuedMessages,
      threadId,
      updatedAt,
    );
    const agentKit = asRecord(repository.agentKit);
    const protocolSnapshot = agentKit
      ? parseAgentThreadSnapshot({
          id: threadId,
          title: typeof stored.title === "string" ? stored.title : undefined,
          createdAt,
          updatedAt,
          metadata: asRecord(stored.metadata) ?? undefined,
          messages: agentKit.messages,
          events: agentKit.events,
          runs: agentKit.runs,
          activeRunIds: agentKit.activeRunIds,
          toolCalls: agentKit.toolCalls,
          activities: agentKit.activities,
        })
      : undefined;
    const messages =
      protocolSnapshot?.messages ??
      storedMessages(repository.messages, now, options.adapter?.textFormat);
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
      ...(protocolSnapshot?.toolCalls
        ? { toolCalls: protocolSnapshot.toolCalls }
        : {}),
      ...(protocolSnapshot?.activities
        ? { activities: protocolSnapshot.activities }
        : {}),
    };
  }

  async function snapshot(
    threadId: string,
  ): Promise<AgentThreadSnapshot | null> {
    const stored = await fetchThread(threadId);
    return stored ? projectThread(threadId, stored) : null;
  }

  async function activeRunSnapshot(
    threadId: string,
  ): Promise<AgentRunSnapshot | undefined> {
    const response = await fetcher(
      `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
      { headers: await headers({ sessionId: threadId }) },
    );
    if (!response.ok) throw await responseError(response);
    const value = asRecord(await response.json());
    if (!value) {
      throw new TypeError("Agent chat active-run response must be an object.");
    }
    const status = value.status;
    if (
      value.active !== true ||
      typeof value.runId !== "string" ||
      !value.runId ||
      status === "completed" ||
      status === "complete" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return undefined;
    }
    const runStatus: AgentRunSnapshot["status"] =
      status === "queued" ||
      status === "running" ||
      status === "awaiting_approval" ||
      status === "awaiting_input"
        ? status
        : "running";
    return {
      id: value.runId,
      threadId,
      status: runStatus,
      // The durable SSE endpoint replays from its first event when a browser
      // has no saved AgentKit cursor; the protocol adapter rebuilds the log.
      lastSequence: 0,
    };
  }

  async function threadSnapshotWithActiveRun(
    threadId: string,
  ): Promise<AgentThreadSnapshot | null> {
    const thread = await snapshot(threadId);
    if (!thread || options.runtime) return thread;
    const activeRun = await activeRunSnapshot(threadId);
    if (!activeRun) return thread;
    const runs = [
      ...(thread.runs ?? []).filter((entry) => entry.id !== activeRun.id),
      activeRun,
    ];
    return {
      ...thread,
      runs,
      activeRunIds: [
        ...new Set([...(thread.activeRunIds ?? []), activeRun.id]),
      ],
    };
  }

  type QueueMutation =
    | { type: "append"; message: AgentQueuedMessage }
    | { type: "remove"; messageId: string }
    | { type: "moveToTop"; messageId: string }
    | { type: "claim"; messageId: string }
    | { type: "restore"; message: AgentQueuedMessage; index: number };

  async function persistQueueMutation(
    threadId: string,
    mutation: QueueMutation,
  ): Promise<{
    queuedMessages: AgentQueuedMessage[];
    message?: AgentQueuedMessage;
    removedMessage?: AgentQueuedMessage;
    index?: number;
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
    const removedMessage = value.removedMessage
      ? storedQueue([value.removedMessage], threadId, now())[0]
      : undefined;
    return {
      queuedMessages: storedQueue(value.queuedMessages, threadId, now()),
      ...(message ? { message } : {}),
      ...(removedMessage ? { removedMessage } : {}),
      ...(typeof value.index === "number" ? { index: value.index } : {}),
    };
  }

  async function waitForRunSlot(threadId: string): Promise<void> {
    const deadline = Date.now() + RUN_SLOT_TIMEOUT_MS;
    let consecutiveClearPolls = 0;
    while (Date.now() < deadline) {
      const response = await fetcher(
        `${apiUrl}/runs/active?threadId=${encodeURIComponent(threadId)}`,
        { headers: await headers({ sessionId: threadId }) },
      );
      if (!response.ok) throw await responseError(response);
      const status = asRecord(await response.json()) as ActiveRunStatus | null;
      if (!status) {
        throw new TypeError(
          "Agent chat active-run response must be an object.",
        );
      }
      if (status.awaitingRedispatch === true) {
        throw new Error(
          "The agent runtime owns a continuation for this thread; the queued message remains pending.",
        );
      }
      const clear =
        status.active !== true ||
        status.status === "completed" ||
        status.status === "complete" ||
        status.status === "failed" ||
        status.status === "cancelled" ||
        status.status === "errored" ||
        status.status === "aborted";
      consecutiveClearPolls = clear ? consecutiveClearPolls + 1 : 0;
      if (consecutiveClearPolls >= RUN_SLOT_STABLE_POLLS) return;
      await new Promise((resolve) =>
        setTimeout(resolve, RUN_SLOT_POLL_INTERVAL_MS),
      );
    }
    throw new Error(
      "The current agent run did not release the thread; the queued message remains pending.",
    );
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

  const runtime = options.runtime ?? createAgentNativeChatRuntime(options);
  const feedbackUrl =
    options.feedbackUrl ??
    agentNativePath("/_agent-native/observability/feedback");
  const protocolTransport = createAgentKitProtocolAdapter(runtime, {
    ...options.adapter,
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
      ...options.operations,
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
      queueMessage: async ({ threadId, text, attachments, metadata }) => {
        const message: AgentQueuedMessage = {
          id:
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
          metadata,
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
      steerQueuedMessage: async ({ threadId, messageId }) => {
        const current = await readQueue(threadId);
        if (!current.some((message) => message.id === messageId)) {
          throw new Error(`Unknown queued message: ${messageId}`);
        }
        await waitForRunSlot(threadId);
        const thread = await snapshot(threadId);
        if (!thread) throw new Error(`Unknown agent chat thread: ${threadId}`);
        const claim = await persistQueueMutation(threadId, {
          type: "claim",
          messageId,
        });
        const queued = claim.removedMessage;
        if (!queued || typeof claim.index !== "number") {
          throw new TypeError("Agent chat queue claim response is invalid.");
        }
        try {
          return await transport.startRun({
            threadId,
            messages: [
              ...thread.messages,
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
            metadata: queued.metadata,
          });
        } catch (error) {
          try {
            await persistQueueMutation(threadId, {
              type: "restore",
              message: queued,
              index: claim.index,
            });
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              "Queue promotion failed and its durable rollback also failed.",
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
          if (!Array.isArray(repository.messages)) {
            throw new Error(
              "The Agent-Native thread cannot be forked from a message without durable history.",
            );
          }
          const throughIndex = repository.messages.findIndex(
            (message) => storedMessageId(message) === fromMessageId,
          );
          if (throughIndex < 0) {
            throw new Error("Unknown message for fork: " + fromMessageId);
          }
          const messages = repository.messages.slice(0, throughIndex + 1);
          forkSource = {
            threadData: JSON.stringify({
              ...repository,
              messages,
              queuedMessages: [],
            }),
            title:
              title ?? (typeof source.title === "string" ? source.title : ""),
            preview: "",
            messageCount: messages.length,
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
      },
      ...options.operations,
    },
  });
  const startRun = protocolTransport.startRun.bind(protocolTransport);
  const subscribeToRun =
    protocolTransport.subscribeToRun.bind(protocolTransport);
  transport = {
    ...protocolTransport,
    async startRun(input, context) {
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
    },
    async *subscribeToRun(input) {
      dispatchAgentChatRunning({
        isRunning: true,
        phase: "working",
        threadId: input.threadId,
        tabId: input.threadId,
        runId: input.runId,
      });
      const assistantMessageIds = new Set<string>();
      let responseStarted = false;
      let turnId: string | undefined;
      for await (const event of subscribeToRun(input)) {
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
