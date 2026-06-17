import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import type { ActionChatUIConfig } from "../../action-ui.js";
import type { ReasoningEffort } from "../../shared/reasoning-effort.js";

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
  readonly turnId?: AgentChatRuntimeTurnId;
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
  readonly events: AsyncIterable<TEvent>;
  cancel?(
    input?: AgentChatRuntimeCancelInput,
  ): Promise<AgentChatRuntimeCancelResult>;
}

export interface AgentChatRuntimeSession<
  TEvent extends AgentChatRuntimeEventBase = AgentChatRuntimeKnownEvent,
> {
  readonly id: AgentChatRuntimeSessionId;
  readonly runtimeId: AgentChatRuntimeId;
  readonly threadId?: string;
  readonly capabilities?: Partial<AgentChatRuntimeCapabilities>;
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
}
