import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

import type { ActionChatUIConfig } from "../../action-ui.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import type { ReasoningEffort } from "../../shared/reasoning-effort.js";
import { agentNativePath } from "../api-path.js";
import { formatChatErrorText, normalizeChatError } from "../error-format.js";
import {
  settleInterruptedToolCalls,
  type ContentPart,
  type SSEEvent,
} from "../sse-event-processor.js";

export type AgentChatRuntimeId = string;
export type AgentChatRuntimeSessionId = string;
export type AgentChatRuntimeTurnId = string;
export type AgentChatRuntimeMessageId = string;
export type AgentChatRuntimeToolCallId = string;
export type AgentChatRuntimeMetadata = Record<string, unknown>;
export type AgentChatRuntimeAwaitable<T> = T | Promise<T>;

export type AgentChatRuntimeKind =
  | "agent-native"
  | "external-agent"
  | "code-agent"
  | (string & {});

export type AgentChatRuntimeRole = "system" | "user" | "assistant" | "tool";

export interface AgentChatRuntimeContentPartBase<
  TType extends string = string,
> {
  readonly type: TType;
  readonly id?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeTextPart extends AgentChatRuntimeContentPartBase<"text"> {
  readonly text: string;
}

export interface AgentChatRuntimeReasoningPart extends AgentChatRuntimeContentPartBase<"reasoning"> {
  readonly text: string;
  readonly signature?: string;
}

export interface AgentChatRuntimeImagePart extends AgentChatRuntimeContentPartBase<"image"> {
  readonly data?: string;
  readonly url?: string;
  readonly mediaType?: string;
  readonly alt?: string;
}

export interface AgentChatRuntimeFilePart extends AgentChatRuntimeContentPartBase<"file"> {
  readonly data?: string;
  readonly url?: string;
  readonly mediaType?: string;
  readonly filename?: string;
}

export interface AgentChatRuntimeToolCallPart extends AgentChatRuntimeContentPartBase<"tool-call"> {
  readonly toolCallId: AgentChatRuntimeToolCallId;
  readonly toolName: string;
  readonly input?: unknown;
  readonly inputText?: string;
}

export interface AgentChatRuntimeToolResultPart extends AgentChatRuntimeContentPartBase<"tool-result"> {
  readonly toolCallId: AgentChatRuntimeToolCallId;
  readonly toolName?: string;
  readonly result?: unknown;
  readonly resultText?: string;
  readonly isError?: boolean;
  readonly mcpApp?: AgentMcpAppPayload;
  readonly chatUI?: ActionChatUIConfig;
}

export interface AgentChatRuntimeDataPart extends AgentChatRuntimeContentPartBase<"data"> {
  readonly data: unknown;
  readonly mediaType?: string;
  readonly title?: string;
}

export interface AgentChatRuntimeCustomContentPart extends AgentChatRuntimeContentPartBase {
  readonly [key: string]: unknown;
}

export type AgentChatRuntimeKnownContentPart =
  | AgentChatRuntimeTextPart
  | AgentChatRuntimeReasoningPart
  | AgentChatRuntimeImagePart
  | AgentChatRuntimeFilePart
  | AgentChatRuntimeToolCallPart
  | AgentChatRuntimeToolResultPart
  | AgentChatRuntimeDataPart;

export type AgentChatRuntimeContentPart<
  TCustomPart extends AgentChatRuntimeCustomContentPart = never,
> = AgentChatRuntimeKnownContentPart | TCustomPart;

export interface AgentChatRuntimeMessage<
  TContentPart extends AgentChatRuntimeContentPartBase =
    AgentChatRuntimeKnownContentPart,
> {
  readonly id: AgentChatRuntimeMessageId;
  readonly role: AgentChatRuntimeRole;
  readonly content: readonly TContentPart[];
  readonly createdAt?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeAttachment {
  readonly id?: string;
  readonly name: string;
  readonly mediaType?: string;
  readonly data?: string;
  readonly url?: string;
  readonly text?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeToolCall {
  readonly id: AgentChatRuntimeToolCallId;
  readonly name: string;
  readonly input?: unknown;
  readonly inputText?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export type AgentChatRuntimeToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentChatRuntimeUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costCents?: number;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeMessageCapabilities {
  readonly streaming: boolean;
  readonly history?: boolean;
  readonly structuredContent?: boolean;
  readonly multimodal?: boolean;
  readonly attachments?: boolean;
}

export interface AgentChatRuntimeToolCapabilities {
  readonly events: boolean;
  readonly hostTools?: boolean;
  readonly inputStreaming?: boolean;
  readonly resultStreaming?: boolean;
  readonly approvals?: boolean;
  readonly mcpApps?: boolean;
}

export interface AgentChatRuntimeSessionCapabilities {
  readonly create: boolean;
  readonly restore?: boolean;
  readonly list?: boolean;
  readonly fork?: boolean;
  readonly detach?: boolean;
  readonly persistent?: boolean;
}

export interface AgentChatRuntimeCancellationCapabilities {
  readonly abortSignal?: boolean;
  readonly explicitCancel?: boolean;
  readonly interrupt?: boolean;
}

export interface AgentChatRuntimeModelCapabilities {
  readonly selectable?: boolean;
  readonly reasoningEffort?: boolean;
  readonly temperature?: boolean;
  readonly providerOptions?: boolean;
}

export interface AgentChatRuntimeArtifactCapabilities {
  readonly files?: boolean;
  readonly links?: boolean;
  readonly patches?: boolean;
  readonly progress?: boolean;
}

export interface AgentChatRuntimeCapabilities {
  readonly messages: AgentChatRuntimeMessageCapabilities;
  readonly tools?: AgentChatRuntimeToolCapabilities;
  readonly sessions?: AgentChatRuntimeSessionCapabilities;
  readonly cancellation?: AgentChatRuntimeCancellationCapabilities;
  readonly models?: AgentChatRuntimeModelCapabilities;
  readonly artifacts?: AgentChatRuntimeArtifactCapabilities;
  readonly custom?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeCreateSessionInput {
  readonly id?: AgentChatRuntimeSessionId;
  readonly threadId?: string;
  readonly title?: string;
  readonly messages?: readonly AgentChatRuntimeMessage[];
  readonly resumeState?: unknown;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly abortSignal?: AbortSignal;
}

export interface AgentChatRuntimeListSessionsInput {
  readonly threadId?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly abortSignal?: AbortSignal;
}

export type AgentChatRuntimeSessionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "cancelled"
  | "completed"
  | "error";

export interface AgentChatRuntimeSessionSummary {
  readonly id: AgentChatRuntimeSessionId;
  readonly runtimeId: AgentChatRuntimeId;
  readonly threadId?: string;
  readonly title?: string;
  readonly status?: AgentChatRuntimeSessionStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeSessionSnapshot extends AgentChatRuntimeSessionSummary {
  readonly messages?: readonly AgentChatRuntimeMessage[];
  readonly resumeState?: unknown;
}

export interface AgentChatRuntimeTurnInput {
  readonly prompt?: string;
  readonly messages?: readonly AgentChatRuntimeMessage[];
  readonly attachments?: readonly AgentChatRuntimeAttachment[];
  readonly tools?: readonly AgentChatRuntimeToolDefinition[];
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly temperature?: number;
  readonly providerOptions?: Record<string, unknown>;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly abortSignal?: AbortSignal;
}

export interface AgentChatRuntimeApprovalResponse {
  readonly id: string;
  readonly approved: boolean;
  readonly message?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeContinueInput {
  readonly turnId?: AgentChatRuntimeTurnId;
  readonly prompt?: string;
  readonly approval?: AgentChatRuntimeApprovalResponse;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly abortSignal?: AbortSignal;
}

export interface AgentChatRuntimeCancelInput {
  readonly sessionId?: AgentChatRuntimeSessionId;
  readonly turnId?: AgentChatRuntimeTurnId;
  readonly runId?: string;
  readonly reason?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly abortSignal?: AbortSignal;
}

export type AgentChatRuntimeCancelStatus =
  | "cancelled"
  | "not-found"
  | "already-finished"
  | "unsupported";

export interface AgentChatRuntimeCancelResult {
  readonly status: AgentChatRuntimeCancelStatus;
  readonly message?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeEventBase<TType extends string = string> {
  readonly type: TType;
  readonly id?: string;
  readonly sessionId?: AgentChatRuntimeSessionId;
  readonly turnId?: AgentChatRuntimeTurnId;
  readonly timestamp?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
}

export interface AgentChatRuntimeMessageStartEvent extends AgentChatRuntimeEventBase<"message-start"> {
  readonly message: AgentChatRuntimeMessage;
}

export type AgentChatRuntimeMessageDelta =
  | {
      readonly type: "text";
      readonly text: string;
      readonly partId?: string;
    }
  | {
      readonly type: "reasoning";
      readonly text: string;
      readonly partId?: string;
      readonly signature?: string;
    }
  | {
      readonly type: "data";
      readonly data: unknown;
      readonly partId?: string;
      readonly mediaType?: string;
    };

export interface AgentChatRuntimeMessageDeltaEvent extends AgentChatRuntimeEventBase<"message-delta"> {
  readonly messageId: AgentChatRuntimeMessageId;
  readonly delta: AgentChatRuntimeMessageDelta;
}

export interface AgentChatRuntimeMessageDoneEvent extends AgentChatRuntimeEventBase<"message-done"> {
  readonly message: AgentChatRuntimeMessage;
}

export interface AgentChatRuntimeToolStartEvent extends AgentChatRuntimeEventBase<"tool-start"> {
  readonly toolCall: AgentChatRuntimeToolCall;
}

export interface AgentChatRuntimeToolDeltaEvent extends AgentChatRuntimeEventBase<"tool-delta"> {
  readonly toolCallId: AgentChatRuntimeToolCallId;
  readonly toolName?: string;
  readonly inputTextDelta?: string;
  readonly resultTextDelta?: string;
}

export interface AgentChatRuntimeToolDoneEvent extends AgentChatRuntimeEventBase<"tool-done"> {
  readonly toolCallId: AgentChatRuntimeToolCallId;
  readonly toolName: string;
  readonly status: AgentChatRuntimeToolStatus;
  readonly result?: unknown;
  readonly resultText?: string;
  readonly error?: string;
  readonly mcpApp?: AgentMcpAppPayload;
  readonly chatUI?: ActionChatUIConfig;
}

export interface AgentChatRuntimeApprovalRequestEvent extends AgentChatRuntimeEventBase<"approval-request"> {
  readonly approvalId: string;
  readonly toolCallId?: AgentChatRuntimeToolCallId;
  readonly toolName?: string;
  readonly message: string;
  readonly input?: unknown;
}

export interface AgentChatRuntimeApprovalResolvedEvent extends AgentChatRuntimeEventBase<"approval-resolved"> {
  readonly approvalId: string;
  readonly approved: boolean;
  readonly message?: string;
}

export interface AgentChatRuntimeStatusEvent extends AgentChatRuntimeEventBase<"status"> {
  readonly level?: "info" | "warning" | "error";
  readonly message: string;
  readonly code?: string;
}

export interface AgentChatRuntimeArtifactEvent extends AgentChatRuntimeEventBase<"artifact"> {
  readonly artifact: {
    readonly id?: string;
    readonly kind: string;
    readonly title?: string;
    readonly url?: string;
    readonly path?: string;
    readonly data?: unknown;
    readonly metadata?: AgentChatRuntimeMetadata;
  };
}

export interface AgentChatRuntimeFileEvent extends AgentChatRuntimeEventBase<"file"> {
  readonly path: string;
  readonly operation?: "create" | "update" | "delete" | "rename" | "unknown";
  readonly summary?: string;
}

export interface AgentChatRuntimeUsageEvent extends AgentChatRuntimeEventBase<"usage"> {
  readonly usage: AgentChatRuntimeUsage;
}

export interface AgentChatRuntimeErrorEvent extends AgentChatRuntimeEventBase<"error"> {
  readonly error: string;
  readonly code?: string;
  readonly recoverable?: boolean;
  readonly cause?: unknown;
}

export type AgentChatRuntimeDoneReason =
  | "complete"
  | "cancelled"
  | "error"
  | "interrupted"
  | "length"
  | "tool-use"
  | (string & {});

export interface AgentChatRuntimeDoneEvent extends AgentChatRuntimeEventBase<"done"> {
  readonly reason?: AgentChatRuntimeDoneReason;
}

export interface AgentChatRuntimeCustomEvent extends AgentChatRuntimeEventBase {
  readonly [key: string]: unknown;
}

export type AgentChatRuntimeKnownEvent =
  | AgentChatRuntimeMessageStartEvent
  | AgentChatRuntimeMessageDeltaEvent
  | AgentChatRuntimeMessageDoneEvent
  | AgentChatRuntimeToolStartEvent
  | AgentChatRuntimeToolDeltaEvent
  | AgentChatRuntimeToolDoneEvent
  | AgentChatRuntimeApprovalRequestEvent
  | AgentChatRuntimeApprovalResolvedEvent
  | AgentChatRuntimeStatusEvent
  | AgentChatRuntimeArtifactEvent
  | AgentChatRuntimeFileEvent
  | AgentChatRuntimeUsageEvent
  | AgentChatRuntimeErrorEvent
  | AgentChatRuntimeDoneEvent;

export type AgentChatRuntimeEvent<
  TCustomEvent extends AgentChatRuntimeCustomEvent = never,
> = AgentChatRuntimeKnownEvent | TCustomEvent;

export interface AgentChatRuntimeTurn<
  TEvent extends AgentChatRuntimeEventBase = AgentChatRuntimeKnownEvent,
> {
  readonly id?: AgentChatRuntimeTurnId;
  readonly sessionId: AgentChatRuntimeSessionId;
  readonly runId?: string;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly events: AsyncIterable<TEvent>;
  cancel?(
    input?: AgentChatRuntimeCancelInput,
  ): Promise<AgentChatRuntimeCancelResult>;
}

export interface AgentChatRuntimeSendMessageInput extends AgentChatRuntimeTurnInput {
  readonly sessionId?: AgentChatRuntimeSessionId;
}

export interface AgentChatRuntimeSubscribeInput {
  readonly sessionId?: AgentChatRuntimeSessionId;
  readonly turnId?: AgentChatRuntimeTurnId;
  readonly runId?: string;
  readonly after?: number;
  readonly metadata?: AgentChatRuntimeMetadata;
  readonly abortSignal?: AbortSignal;
}

export interface AgentChatRuntimeResumeInput extends AgentChatRuntimeSubscribeInput {
  readonly prompt?: string;
}

export interface AgentChatRuntimeSession<
  TEvent extends AgentChatRuntimeEventBase = AgentChatRuntimeKnownEvent,
> {
  readonly id: AgentChatRuntimeSessionId;
  readonly runtimeId: AgentChatRuntimeId;
  readonly threadId?: string;
  readonly capabilities?: Partial<AgentChatRuntimeCapabilities>;
  sendMessage?(
    input: AgentChatRuntimeTurnInput,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeTurn<TEvent>>;
  startTurn(
    input: AgentChatRuntimeTurnInput,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeTurn<TEvent>>;
  continueTurn?(
    input?: AgentChatRuntimeContinueInput,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeTurn<TEvent>>;
  cancelTurn?(
    input?: AgentChatRuntimeCancelInput,
  ): Promise<AgentChatRuntimeCancelResult>;
  snapshot?(): AgentChatRuntimeAwaitable<AgentChatRuntimeSessionSnapshot>;
  dispose?(): AgentChatRuntimeAwaitable<void>;
}

export interface AgentChatRuntime<
  TEvent extends AgentChatRuntimeEventBase = AgentChatRuntimeKnownEvent,
> {
  readonly id: AgentChatRuntimeId;
  readonly kind: AgentChatRuntimeKind;
  readonly label: string;
  readonly description?: string;
  readonly capabilities: AgentChatRuntimeCapabilities;
  createSession(
    input?: AgentChatRuntimeCreateSessionInput,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeSession<TEvent>>;
  restoreSession?(
    snapshot: AgentChatRuntimeSessionSnapshot,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeSession<TEvent>>;
  getSession?(input: {
    readonly sessionId: AgentChatRuntimeSessionId;
    readonly abortSignal?: AbortSignal;
  }): AgentChatRuntimeAwaitable<AgentChatRuntimeSession<TEvent> | null>;
  listSessions?(
    input?: AgentChatRuntimeListSessionsInput,
  ): AgentChatRuntimeAwaitable<readonly AgentChatRuntimeSessionSummary[]>;
  sendMessage?(
    input: AgentChatRuntimeSendMessageInput,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeTurn<TEvent>>;
  subscribe?(
    input: AgentChatRuntimeSubscribeInput,
  ): AgentChatRuntimeAwaitable<AsyncIterable<TEvent>>;
  resume?(
    input: AgentChatRuntimeResumeInput,
  ): AgentChatRuntimeAwaitable<AgentChatRuntimeTurn<TEvent>>;
  cancel?(
    input: AgentChatRuntimeCancelInput,
  ): Promise<AgentChatRuntimeCancelResult>;
}

type FetchLike = typeof fetch;
type HeadersFactory =
  | HeadersInit
  | ((input: {
      sessionId?: AgentChatRuntimeSessionId;
      turnId?: AgentChatRuntimeTurnId;
      runId?: string;
    }) => HeadersInit | Promise<HeadersInit>);

export interface CreateHttpAgentChatRuntimeOptions<
  TEvent extends AgentChatRuntimeEventBase = AgentChatRuntimeKnownEvent,
> {
  readonly id?: AgentChatRuntimeId;
  readonly kind?: AgentChatRuntimeKind;
  readonly label?: string;
  readonly description?: string;
  readonly endpoint:
    | string
    | ((input: {
        session: AgentChatRuntimeSessionSummary;
        turn: AgentChatRuntimeTurnInput;
      }) => string | URL);
  readonly method?: "POST" | "PUT";
  readonly headers?: HeadersFactory;
  readonly credentials?: RequestCredentials;
  readonly fetch?: FetchLike;
  readonly capabilities?: Partial<AgentChatRuntimeCapabilities>;
  readonly mapRequest?: (input: {
    session: AgentChatRuntimeSessionSummary;
    turn: AgentChatRuntimeTurnInput;
    turnId: AgentChatRuntimeTurnId;
  }) => unknown;
  readonly mapEvent?: (
    event: unknown,
    context: {
      sessionId: AgentChatRuntimeSessionId;
      turnId?: AgentChatRuntimeTurnId;
      runId?: string;
    },
  ) => TEvent | readonly TEvent[] | null;
  readonly cancelEndpoint?:
    | string
    | ((input: AgentChatRuntimeCancelInput) => string | URL | null);
  readonly resumeEndpoint?:
    | string
    | ((input: AgentChatRuntimeSubscribeInput) => string | URL | null);
  readonly listSessionsEndpoint?: string | URL;
  readonly getSessionEndpoint?:
    | string
    | ((input: { sessionId: AgentChatRuntimeSessionId }) => string | URL);
}

export interface CreateAgentNativeChatRuntimeOptions {
  readonly id?: AgentChatRuntimeId;
  readonly label?: string;
  readonly description?: string;
  readonly apiUrl?: string;
  readonly headers?: HeadersFactory;
  readonly fetch?: FetchLike;
  readonly threadId?: string;
  readonly browserTabId?: string;
  readonly surface?: "app" | "dev-frame";
  readonly mode?: "act" | "plan";
  readonly model?: string;
  readonly engine?: string;
  readonly effort?: ReasoningEffort;
  readonly scope?: unknown;
}

export interface CreateAgentChatRuntimeAdapterOptions {
  readonly sessionId?: AgentChatRuntimeSessionId;
  readonly threadId?: string;
  readonly modelRef?: { current: string | undefined };
  readonly effortRef?: { current: ReasoningEffort | undefined };
  readonly metadata?: AgentChatRuntimeMetadata;
}

const DEFAULT_RUNTIME_CAPABILITIES: AgentChatRuntimeCapabilities = {
  messages: {
    streaming: true,
    history: true,
    structuredContent: true,
    attachments: true,
  },
  tools: {
    events: true,
    hostTools: true,
    resultStreaming: true,
    mcpApps: true,
  },
  sessions: {
    create: true,
    restore: true,
    persistent: true,
  },
  cancellation: {
    abortSignal: true,
    explicitCancel: true,
  },
  models: {
    selectable: true,
    reasoningEffort: true,
  },
  artifacts: {
    files: true,
    links: true,
    progress: true,
  },
};

function mergeCapabilities(
  overrides?: Partial<AgentChatRuntimeCapabilities>,
): AgentChatRuntimeCapabilities {
  return {
    ...DEFAULT_RUNTIME_CAPABILITIES,
    ...overrides,
    messages: {
      ...DEFAULT_RUNTIME_CAPABILITIES.messages,
      ...overrides?.messages,
    },
    tools: {
      ...DEFAULT_RUNTIME_CAPABILITIES.tools,
      ...overrides?.tools,
      events:
        overrides?.tools?.events ?? DEFAULT_RUNTIME_CAPABILITIES.tools!.events,
    },
    sessions: {
      ...DEFAULT_RUNTIME_CAPABILITIES.sessions,
      ...overrides?.sessions,
      create:
        overrides?.sessions?.create ??
        DEFAULT_RUNTIME_CAPABILITIES.sessions!.create,
    },
    cancellation: {
      ...DEFAULT_RUNTIME_CAPABILITIES.cancellation,
      ...overrides?.cancellation,
    },
    models: { ...DEFAULT_RUNTIME_CAPABILITIES.models, ...overrides?.models },
    artifacts: {
      ...DEFAULT_RUNTIME_CAPABILITIES.artifacts,
      ...overrides?.artifacts,
    },
  };
}

function createRuntimeId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createAbortController(signal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  if (!signal) return { controller, cleanup: () => {} };
  if (signal.aborted) controller.abort();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  return {
    controller,
    cleanup: () => signal.removeEventListener("abort", abort),
  };
}

async function resolveHeaders(
  headers: HeadersFactory | undefined,
  input: {
    sessionId?: AgentChatRuntimeSessionId;
    turnId?: AgentChatRuntimeTurnId;
    runId?: string;
  },
): Promise<Headers> {
  const resolved =
    typeof headers === "function" ? await headers(input) : headers;
  return new Headers(resolved);
}

function normalizeEndpoint(value: string | URL): string {
  return typeof value === "string" ? value : value.toString();
}

function isRuntimeEvent(value: unknown): value is AgentChatRuntimeEventBase {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function parseJsonEvent(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function* readJsonEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingSseData: string[] = [];

  const flushSseData = function* (): Generator<unknown> {
    if (pendingSseData.length === 0) return;
    const parsed = parseJsonEvent(pendingSseData.join("\n"));
    pendingSseData = [];
    if (parsed) yield parsed;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          pendingSseData.push(line.slice(5).trimStart());
          continue;
        }
        if (line.trim() === "") {
          yield* flushSseData();
          continue;
        }
        const parsed = parseJsonEvent(line);
        if (parsed) yield parsed;
      }
    }

    if (buffer.trim()) {
      const parsed = parseJsonEvent(buffer);
      if (parsed) yield parsed;
    }
    yield* flushSseData();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Some browser runtimes consider a cancelled stream locked for a tick.
    }
  }
}

function textResponseEvents(
  text: string,
  sessionId: AgentChatRuntimeSessionId,
  turnId?: AgentChatRuntimeTurnId,
): AgentChatRuntimeKnownEvent[] {
  const message: AgentChatRuntimeMessage = {
    id: createRuntimeId("message"),
    role: "assistant",
    content: [],
  };
  return [
    { type: "message-start", sessionId, turnId, message },
    ...(text
      ? [
          {
            type: "message-delta" as const,
            sessionId,
            turnId,
            messageId: message.id,
            delta: { type: "text" as const, text },
          },
        ]
      : []),
    { type: "message-done", sessionId, turnId, message },
    { type: "done", sessionId, turnId, reason: "complete" },
  ];
}

async function* eventsFromJsonResponse(
  value: unknown,
  sessionId: AgentChatRuntimeSessionId,
  turnId?: AgentChatRuntimeTurnId,
): AsyncGenerator<AgentChatRuntimeEvent> {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRuntimeEvent(item)) yield item as AgentChatRuntimeEvent;
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.events)) {
    for (const item of record.events) {
      if (isRuntimeEvent(item)) yield item as AgentChatRuntimeEvent;
    }
    return;
  }
  const text =
    typeof record.message === "string"
      ? record.message
      : typeof record.text === "string"
        ? record.text
        : "";
  if (text) {
    for (const event of textResponseEvents(text, sessionId, turnId)) {
      yield event;
    }
  }
}

function defaultMapHttpRuntimeEvent(
  event: unknown,
  _context?: {
    sessionId: AgentChatRuntimeSessionId;
    turnId?: AgentChatRuntimeTurnId;
    runId?: string;
  },
): AgentChatRuntimeEvent | readonly AgentChatRuntimeEvent[] | null {
  if (!isRuntimeEvent(event)) return null;
  return event as AgentChatRuntimeEvent;
}

function normalizeMappedEvents<TEvent extends AgentChatRuntimeEventBase>(
  mapped: TEvent | readonly TEvent[] | null,
): readonly TEvent[] {
  if (!mapped) return [];
  return Array.isArray(mapped)
    ? (mapped as readonly TEvent[])
    : [mapped as TEvent];
}

async function* streamResponseEvents<TEvent extends AgentChatRuntimeEventBase>(
  response: Response,
  input: {
    sessionId: AgentChatRuntimeSessionId;
    turnId?: AgentChatRuntimeTurnId;
    runId?: string;
    mapEvent: (
      event: unknown,
      context: {
        sessionId: AgentChatRuntimeSessionId;
        turnId?: AgentChatRuntimeTurnId;
        runId?: string;
      },
    ) => TEvent | readonly TEvent[] | null;
  },
): AsyncGenerator<TEvent> {
  const context = {
    sessionId: input.sessionId,
    turnId: input.turnId,
    runId: input.runId,
  };
  const contentType = response.headers.get("content-type") ?? "";
  if (response.body && !contentType.includes("application/json")) {
    for await (const raw of readJsonEventStream(response.body)) {
      for (const event of normalizeMappedEvents(input.mapEvent(raw, context))) {
        yield event;
      }
    }
    return;
  }

  const json = await response.json().catch(() => null);
  for await (const event of eventsFromJsonResponse(
    json,
    input.sessionId,
    input.turnId,
  )) {
    for (const mapped of normalizeMappedEvents(
      input.mapEvent(event, context),
    )) {
      yield mapped;
    }
  }
}

function defaultHttpRuntimeRequest(input: {
  session: AgentChatRuntimeSessionSummary;
  turn: AgentChatRuntimeTurnInput;
  turnId: AgentChatRuntimeTurnId;
}) {
  return {
    sessionId: input.session.id,
    threadId: input.session.threadId,
    turnId: input.turnId,
    prompt: input.turn.prompt,
    messages: input.turn.messages,
    attachments: input.turn.attachments,
    tools: input.turn.tools,
    model: input.turn.model,
    reasoningEffort: input.turn.reasoningEffort,
    temperature: input.turn.temperature,
    providerOptions: input.turn.providerOptions,
    metadata: input.turn.metadata,
  };
}

async function readErrorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Keep raw text.
  }
  return text.slice(0, 500);
}

export function createHttpAgentChatRuntime<
  TEvent extends AgentChatRuntimeEventBase = AgentChatRuntimeKnownEvent,
>(
  options: CreateHttpAgentChatRuntimeOptions<TEvent>,
): AgentChatRuntime<TEvent> {
  const fetchImpl = options.fetch ?? fetch;
  const capabilities = mergeCapabilities(options.capabilities);
  const runtimeId = options.id ?? "external:http";
  const mapEvent =
    options.mapEvent ??
    (defaultMapHttpRuntimeEvent as (
      event: unknown,
      context: {
        sessionId: AgentChatRuntimeSessionId;
        turnId?: AgentChatRuntimeTurnId;
        runId?: string;
      },
    ) => TEvent | readonly TEvent[] | null);

  const createSessionObject = (
    input?: AgentChatRuntimeCreateSessionInput,
  ): AgentChatRuntimeSession<TEvent> => {
    const sessionId =
      input?.id ?? input?.threadId ?? createRuntimeId("session");
    const summary: AgentChatRuntimeSessionSummary = {
      id: sessionId,
      runtimeId,
      threadId: input?.threadId,
      title: input?.title,
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: input?.metadata,
    };

    const startTurn = async (
      turn: AgentChatRuntimeTurnInput,
    ): Promise<AgentChatRuntimeTurn<TEvent>> => {
      const turnId = createRuntimeId("turn");
      const { controller, cleanup } = createAbortController(turn.abortSignal);
      const endpoint =
        typeof options.endpoint === "function"
          ? options.endpoint({ session: summary, turn })
          : options.endpoint;
      const headers = await resolveHeaders(options.headers, {
        sessionId,
        turnId,
      });
      if (!headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      const response = await fetchImpl(normalizeEndpoint(endpoint), {
        method: options.method ?? "POST",
        headers,
        credentials: options.credentials,
        body: JSON.stringify(
          options.mapRequest
            ? options.mapRequest({ session: summary, turn, turnId })
            : defaultHttpRuntimeRequest({ session: summary, turn, turnId }),
        ),
        signal: controller.signal,
      });
      if (!response.ok) {
        cleanup();
        throw new Error(await readErrorText(response));
      }

      const runId = response.headers.get("X-Run-Id") ?? undefined;
      const events = (async function* () {
        try {
          yield* streamResponseEvents(response, {
            sessionId,
            turnId,
            runId,
            mapEvent,
          });
        } finally {
          cleanup();
        }
      })();

      return {
        id: turnId,
        sessionId,
        runId,
        events,
        cancel: async (cancelInput) => {
          controller.abort();
          if (!options.cancelEndpoint) return { status: "cancelled" };
          const endpoint =
            typeof options.cancelEndpoint === "function"
              ? options.cancelEndpoint({
                  ...cancelInput,
                  sessionId,
                  turnId,
                  runId,
                })
              : options.cancelEndpoint;
          if (!endpoint) return { status: "unsupported" };
          const cancelHeaders = await resolveHeaders(options.headers, {
            sessionId,
            turnId,
          });
          if (!cancelHeaders.has("Content-Type")) {
            cancelHeaders.set("Content-Type", "application/json");
          }
          const cancelResponse = await fetchImpl(normalizeEndpoint(endpoint), {
            method: "POST",
            headers: cancelHeaders,
            credentials: options.credentials,
            body: JSON.stringify({
              sessionId,
              turnId,
              runId,
              reason: cancelInput?.reason ?? "user",
              metadata: cancelInput?.metadata,
            }),
            signal: cancelInput?.abortSignal,
          });
          return cancelResponse.ok
            ? { status: "cancelled" }
            : {
                status: "unsupported",
                message: await readErrorText(cancelResponse),
              };
        },
      };
    };

    return {
      id: sessionId,
      runtimeId,
      threadId: input?.threadId,
      capabilities,
      sendMessage: startTurn,
      startTurn,
      snapshot: () => ({
        ...summary,
        status: "idle",
        updatedAt: new Date().toISOString(),
        messages: input?.messages,
        resumeState: input?.resumeState,
      }),
      dispose: () => undefined,
    };
  };

  const runtime: AgentChatRuntime<TEvent> = {
    id: runtimeId,
    kind: options.kind ?? "external-agent",
    label: options.label ?? "External agent",
    description: options.description,
    capabilities,
    createSession: createSessionObject,
    restoreSession: (snapshot) =>
      createSessionObject({
        id: snapshot.id,
        threadId: snapshot.threadId,
        title: snapshot.title,
        messages: snapshot.messages,
        resumeState: snapshot.resumeState,
        metadata: snapshot.metadata,
      }),
    sendMessage: async (input) => {
      const session = createSessionObject({
        id: input.sessionId,
        threadId: input.sessionId,
        metadata: input.metadata,
      });
      return session.startTurn(input);
    },
    subscribe: async (input) => {
      if (!options.resumeEndpoint) return (async function* () {})();
      const endpoint =
        typeof options.resumeEndpoint === "function"
          ? options.resumeEndpoint(input)
          : options.resumeEndpoint;
      if (!endpoint) return (async function* () {})();
      const headers = await resolveHeaders(options.headers, input);
      const response = await fetchImpl(normalizeEndpoint(endpoint), {
        headers,
        credentials: options.credentials,
        signal: input.abortSignal,
      });
      if (!response.ok) throw new Error(await readErrorText(response));
      return streamResponseEvents(response, {
        sessionId: input.sessionId ?? "session",
        turnId: input.turnId,
        runId: input.runId,
        mapEvent,
      });
    },
    resume: async (input) => {
      const sessionId = input.sessionId ?? createRuntimeId("session");
      const events = runtime.subscribe
        ? await runtime.subscribe(input)
        : (async function* () {})();
      return {
        id: input.turnId,
        sessionId,
        runId: input.runId,
        events,
      };
    },
    cancel: async (input) => {
      if (!options.cancelEndpoint) return { status: "unsupported" };
      const endpoint =
        typeof options.cancelEndpoint === "function"
          ? options.cancelEndpoint(input)
          : options.cancelEndpoint;
      if (!endpoint) return { status: "unsupported" };
      const headers = await resolveHeaders(options.headers, input);
      if (!headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      const response = await fetchImpl(normalizeEndpoint(endpoint), {
        method: "POST",
        headers,
        credentials: options.credentials,
        body: JSON.stringify(input),
        signal: input.abortSignal,
      });
      return response.ok
        ? { status: "cancelled" }
        : { status: "unsupported", message: await readErrorText(response) };
    },
  };

  return runtime;
}

function runtimeMessageText(message: AgentChatRuntimeMessage): string {
  return message.content
    .map((part) =>
      part.type === "text" || part.type === "reasoning" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

function nativeHistoryFromMessages(
  messages: readonly AgentChatRuntimeMessage[] | undefined,
  currentPrompt: string,
) {
  const history = (messages ?? [])
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: runtimeMessageText(message),
    }))
    .filter((message) => message.content.trim());
  if (!currentPrompt.trim()) return history;
  const last = history[history.length - 1];
  return last?.role === "user" && last.content === currentPrompt
    ? history.slice(0, -1)
    : history;
}

type AgentNativeMessageContentState =
  | { type: "text"; text: string; id?: string }
  | {
      type: "reasoning";
      text: string;
      id?: string;
      signature?: string;
    };

function mapAgentNativeEvent(
  raw: unknown,
  input: {
    sessionId: AgentChatRuntimeSessionId;
    turnId?: AgentChatRuntimeTurnId;
    messageId: string;
    message: {
      content: AgentNativeMessageContentState[];
      started: boolean;
    };
  },
): AgentChatRuntimeKnownEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const ev = raw as SSEEvent;
  const base = {
    sessionId: input.sessionId,
    turnId: input.turnId,
  };
  if (ev.seq !== undefined) {
    (base as { metadata?: AgentChatRuntimeMetadata }).metadata = {
      seq: ev.seq,
    };
  }
  if (ev.type === "text" || ev.type === "thinking" || ev.type === "reasoning") {
    const text = ev.text ?? "";
    const type = ev.type === "text" ? "text" : "reasoning";
    const extended = ev as SSEEvent & {
      partId?: string;
      signature?: string;
    };
    const partId = extended.partId;
    const events: AgentChatRuntimeKnownEvent[] = [];
    if (!input.message.started) {
      input.message.started = true;
      events.push({
        type: "message-start",
        ...base,
        message: {
          id: input.messageId,
          role: "assistant",
          content: [],
        },
      });
    }
    const last = input.message.content.at(-1);
    let part = partId
      ? input.message.content.find(
          (candidate) => candidate.type === type && candidate.id === partId,
        )
      : last?.type === type && !last.id
        ? last
        : undefined;
    if (!part) {
      const nextPart: AgentNativeMessageContentState =
        type === "reasoning"
          ? {
              type: "reasoning",
              text: "",
              ...(partId ? { id: partId } : {}),
            }
          : {
              type: "text",
              text: "",
              ...(partId ? { id: partId } : {}),
            };
      input.message.content.push(nextPart);
      part = nextPart;
    }
    part.text += text;
    if (part.type === "reasoning" && extended.signature) {
      part.signature = extended.signature;
    }
    events.push({
      type: "message-delta",
      ...base,
      messageId: input.messageId,
      delta:
        type === "reasoning"
          ? {
              type: "reasoning",
              text,
              partId,
              signature: extended.signature,
            }
          : { type: "text", text, partId },
    });
    return events;
  }
  if (ev.type === "activity") {
    return [
      {
        type: "status",
        ...base,
        message: ev.label ?? ev.tool ?? "Working",
        metadata: ev.tool ? { tool: ev.tool } : undefined,
      },
    ];
  }
  if (ev.type === "tool_start") {
    return [
      {
        type: "tool-start",
        ...base,
        toolCall: {
          id: ev.id ?? createRuntimeId("tool"),
          name: ev.tool ?? "unknown",
          input: ev.input,
          inputText: ev.input ? JSON.stringify(ev.input) : undefined,
        },
      },
    ];
  }
  if (ev.type === "tool_done") {
    return [
      {
        type: "tool-done",
        ...base,
        toolCallId: ev.id ?? "",
        toolName: ev.tool ?? "unknown",
        status: ev.error ? "failed" : "completed",
        result: ev.result,
        resultText:
          typeof ev.result === "string"
            ? ev.result
            : ev.result !== undefined
              ? JSON.stringify(ev.result)
              : undefined,
        error: ev.error,
        mcpApp: ev.mcpApp,
        chatUI: ev.chatUI,
      },
    ];
  }
  if (ev.type === "approval_required") {
    return [
      {
        type: "approval-request",
        ...base,
        approvalId: ev.approvalKey ?? ev.id ?? createRuntimeId("approval"),
        toolCallId: ev.id,
        toolName: ev.tool,
        message: ev.label ?? "Approve this tool call?",
        input: ev.input,
      },
    ];
  }
  if (ev.type === "error" || ev.type === "missing_api_key") {
    return [
      {
        type: "error",
        ...base,
        error: ev.error ?? "Agent chat failed.",
        code: ev.errorCode,
        recoverable: ev.recoverable,
      },
      { type: "done", ...base, reason: "error" },
    ];
  }
  if (ev.type === "done") {
    const message: AgentChatRuntimeMessage = {
      id: input.messageId,
      role: "assistant",
      content: input.message.content.map((part) => ({ ...part })),
    };
    return [
      ...(input.message.started
        ? [{ type: "message-done" as const, ...base, message }]
        : []),
      { type: "done", ...base, reason: "complete" },
    ];
  }
  return [];
}

export function createAgentNativeChatRuntime(
  options: CreateAgentNativeChatRuntimeOptions = {},
): AgentChatRuntime<AgentChatRuntimeKnownEvent> {
  const apiUrl = options.apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const runtimeId = options.id ?? "agent-native";
  const fetchImpl = options.fetch ?? fetch;

  return createHttpAgentChatRuntime({
    id: runtimeId,
    kind: "agent-native",
    label: options.label ?? "Agent Native",
    description:
      options.description ?? "Agent-Native's built-in chat transport.",
    endpoint: apiUrl,
    fetch: fetchImpl,
    headers: async (input) => {
      const headers = await resolveHeaders(options.headers, input);
      headers.set("x-agent-native-surface", options.surface ?? "app");
      return headers;
    },
    capabilities: DEFAULT_RUNTIME_CAPABILITIES,
    mapRequest: ({ session, turn, turnId }) => {
      const prompt =
        turn.prompt ??
        [...(turn.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user")
          ?.content.map((part) => (part.type === "text" ? part.text : ""))
          .join("\n") ??
        "";
      return {
        message: prompt,
        displayMessage: prompt,
        history: nativeHistoryFromMessages(turn.messages, prompt),
        turnId,
        threadId: session.threadId ?? options.threadId,
        ...(options.mode ? { mode: options.mode } : {}),
        ...((turn.model ?? options.model)
          ? { model: turn.model ?? options.model }
          : {}),
        ...(options.engine ? { engine: options.engine } : {}),
        ...((turn.reasoningEffort ?? options.effort)
          ? { effort: turn.reasoningEffort ?? options.effort }
          : {}),
        ...(options.browserTabId ? { browserTabId: options.browserTabId } : {}),
        ...(options.scope ? { scope: options.scope } : {}),
        ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
        ...(turn.metadata ? { metadata: turn.metadata } : {}),
      };
    },
    mapEvent: (() => {
      const states = new Map<
        string,
        {
          messageId: string;
          message: {
            content: AgentNativeMessageContentState[];
            started: boolean;
          };
        }
      >();
      return (
        event: unknown,
        context: {
          sessionId: AgentChatRuntimeSessionId;
          turnId?: AgentChatRuntimeTurnId;
        },
      ) => {
        const stateKey = context.turnId ?? context.sessionId;
        let state = states.get(stateKey);
        if (!state) {
          state = {
            messageId: createRuntimeId("message"),
            message: { content: [], started: false },
          };
          states.set(stateKey, state);
        }
        const mapped = mapAgentNativeEvent(event, {
          sessionId: context.sessionId,
          turnId: context.turnId,
          messageId: state.messageId,
          message: state.message,
        });
        const type =
          event && typeof event === "object"
            ? (event as { type?: unknown }).type
            : undefined;
        if (type === "done" || type === "error" || type === "missing_api_key") {
          states.delete(stateKey);
        }
        return mapped;
      };
    })(),
    cancelEndpoint: (input) =>
      input.runId
        ? `${apiUrl}/runs/${encodeURIComponent(input.runId)}/abort`
        : null,
    resumeEndpoint: (input) =>
      input.runId
        ? `${apiUrl}/runs/${encodeURIComponent(input.runId)}/events?after=${input.after ?? 0}`
        : null,
  });
}

function toContentPartInput(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = typeof item === "string" ? item : JSON.stringify(item);
  }
  return out;
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface RuntimeContentProjection {
  content: ContentPart[];
  partsById: Map<string, Extract<ContentPart, { type: "text" | "reasoning" }>>;
}

function appendRuntimeContentPart(
  projection: RuntimeContentProjection,
  input: {
    type: "text" | "reasoning";
    text: string;
    partId?: string;
  },
): void {
  const key = input.partId ? `${input.type}:${input.partId}` : undefined;
  const last = projection.content.at(-1);
  let part = key ? projection.partsById.get(key) : undefined;
  if (
    !part &&
    !key &&
    last &&
    (last.type === "text" || last.type === "reasoning") &&
    last.type === input.type
  ) {
    part = last;
  }
  if (!part) {
    const nextPart: Extract<ContentPart, { type: "text" | "reasoning" }> =
      input.type === "reasoning"
        ? { type: "reasoning", text: "" }
        : { type: "text", text: "" };
    projection.content.push(nextPart);
    if (key) projection.partsById.set(key, nextPart);
    part = nextPart;
  }
  part.text += input.text;
}

function applyRuntimeEventToContent(
  event: AgentChatRuntimeEventBase,
  projection: RuntimeContentProjection,
): ChatModelRunResult | null {
  const { content } = projection;
  const typed = event as AgentChatRuntimeKnownEvent;
  if (typed.type === "message-start") {
    for (const part of typed.message.content) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        appendRuntimeContentPart(projection, {
          type: part.type,
          text: part.text,
          partId: part.id,
        });
      }
    }
    return { content: [...content] } as ChatModelRunResult;
  }
  if (typed.type === "message-delta") {
    if (typed.delta.type === "text" || typed.delta.type === "reasoning") {
      appendRuntimeContentPart(projection, {
        type: typed.delta.type,
        text: typed.delta.text,
        partId: typed.delta.partId,
      });
      return { content: [...content] } as ChatModelRunResult;
    }
    return null;
  }
  if (typed.type === "message-done") {
    return { content: [...content] } as ChatModelRunResult;
  }
  if (typed.type === "tool-start") {
    content.push({
      type: "tool-call",
      toolCallId: typed.toolCall.id,
      toolName: typed.toolCall.name,
      argsText:
        typed.toolCall.inputText ?? JSON.stringify(typed.toolCall.input ?? {}),
      args: toContentPartInput(typed.toolCall.input),
    });
    return { content: [...content] } as ChatModelRunResult;
  }
  if (typed.type === "tool-delta") {
    const part = [...content]
      .reverse()
      .find(
        (candidate): candidate is Extract<ContentPart, { type: "tool-call" }> =>
          candidate.type === "tool-call" &&
          candidate.toolCallId === typed.toolCallId,
      );
    if (!part) return null;
    if (typed.inputTextDelta) {
      part.argsText += typed.inputTextDelta;
    }
    if (typed.resultTextDelta) {
      part.result = `${part.result ?? ""}${typed.resultTextDelta}`;
    }
    return { content: [...content] } as ChatModelRunResult;
  }
  if (typed.type === "tool-done") {
    const part = [...content]
      .reverse()
      .find(
        (candidate): candidate is Extract<ContentPart, { type: "tool-call" }> =>
          candidate.type === "tool-call" &&
          candidate.toolCallId === typed.toolCallId,
      );
    if (part) {
      part.result =
        typed.error ?? typed.resultText ?? toolResultText(typed.result);
      if (typed.mcpApp) part.mcpApp = typed.mcpApp;
      if (typed.chatUI) part.chatUI = typed.chatUI;
    }
    return { content: [...content] } as ChatModelRunResult;
  }
  if (typed.type === "approval-request") {
    const part = [...content]
      .reverse()
      .find(
        (candidate): candidate is Extract<ContentPart, { type: "tool-call" }> =>
          candidate.type === "tool-call" &&
          (candidate.toolCallId === typed.toolCallId ||
            candidate.toolName === typed.toolName),
      );
    if (part) {
      part.approval = { approvalKey: typed.approvalId };
    } else {
      content.push({
        type: "tool-call",
        toolCallId: typed.toolCallId ?? typed.approvalId,
        toolName: typed.toolName ?? "approval",
        argsText: typed.input ? JSON.stringify(typed.input) : "",
        args: toContentPartInput(typed.input),
        approval: { approvalKey: typed.approvalId },
      });
    }
    return { content: [...content] } as ChatModelRunResult;
  }
  if (typed.type === "error") {
    const normalized = normalizeChatError(typed.error, typed.code);
    settleInterruptedToolCalls(content);
    content.push({
      type: "text",
      text: formatChatErrorText(typed.error, undefined, typed.code),
    });
    return {
      content: [...content],
      status: { type: "incomplete", reason: "error" },
      metadata: {
        custom: {
          runError: {
            message: normalized.message,
            ...(normalized.details ? { details: normalized.details } : {}),
            ...(typed.code ? { errorCode: typed.code } : {}),
            ...(typed.recoverable ? { recoverable: typed.recoverable } : {}),
          },
        },
      },
    } as ChatModelRunResult;
  }
  if (typed.type === "done") {
    return {
      content: [...content],
      status:
        typed.reason === "error"
          ? { type: "incomplete", reason: "error" }
          : { type: "complete", reason: "stop" },
    } as ChatModelRunResult;
  }
  return null;
}

function assistantMessageText(message: {
  content?: readonly { type: string; text?: string }[];
}): string {
  return (message.content ?? [])
    .filter(
      (part): part is { type: string; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function assistantMessagesToRuntimeMessages(
  messages: readonly {
    role: string;
    content?: readonly { type: string; text?: string; image?: string }[];
  }[],
): AgentChatRuntimeMessage[] {
  return messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message, index) => {
      const content: AgentChatRuntimeKnownContentPart[] = [];
      for (const part of message.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") {
          content.push({ type: "text", text: part.text });
        } else if (part.type === "image" && typeof part.image === "string") {
          content.push({ type: "image", data: part.image });
        }
      }
      return {
        id: `assistant-ui-${index}`,
        role: message.role as "user" | "assistant",
        content,
      };
    });
}

function latestUserPrompt(
  messages: readonly {
    role: string;
    content?: readonly { type: string; text?: string }[];
  }[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    return assistantMessageText(message);
  }
  return "";
}

export function createAgentChatRuntimeAdapter(
  runtime: AgentChatRuntime,
  options: CreateAgentChatRuntimeAdapterOptions = {},
): ChatModelAdapter {
  let sessionPromise: Promise<AgentChatRuntimeSession> | null = null;
  const getSession = () => {
    sessionPromise ??= Promise.resolve(
      runtime.createSession({
        id: options.sessionId ?? options.threadId,
        threadId: options.threadId,
        metadata: options.metadata,
      }),
    );
    return sessionPromise;
  };

  return {
    async *run({ messages, abortSignal }) {
      const adapterMessages = messages as readonly {
        role: string;
        content?: readonly { type: string; text?: string; image?: string }[];
      }[];
      const session = await getSession();
      const prompt = latestUserPrompt(adapterMessages);
      const turn = await session.startTurn({
        prompt,
        messages: assistantMessagesToRuntimeMessages(adapterMessages),
        model: options.modelRef?.current,
        reasoningEffort: options.effortRef?.current,
        abortSignal,
        metadata: options.metadata,
      });
      const projection: RuntimeContentProjection = {
        content: [],
        partsById: new Map(),
      };
      try {
        for await (const event of turn.events) {
          const result = applyRuntimeEventToContent(event, projection);
          if (result) {
            const metadata = (result.metadata ?? {}) as Record<string, unknown>;
            const custom =
              metadata.custom && typeof metadata.custom === "object"
                ? (metadata.custom as Record<string, unknown>)
                : {};
            yield {
              ...result,
              metadata: {
                ...metadata,
                custom: {
                  ...custom,
                  runtimeId: runtime.id,
                  ...(turn.runId ? { runId: turn.runId } : {}),
                },
              },
            } as ChatModelRunResult;
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          await turn.cancel?.({ reason: "abort" });
          return;
        }
        throw error;
      }
    },
  };
}
