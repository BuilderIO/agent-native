import type {
  AgentActionInvocation,
  AgentActionResult,
  AgentActivity,
  AgentAnnotation,
  AgentApprovalRequest,
  AgentApprovalResponse,
  AgentConnectionRequest,
  AgentArtifactReference,
  AgentCapabilities,
  AgentCapabilityDescriptor,
  AgentCapabilityId,
  AgentError,
  AgentEvent,
  AgentInteraction,
  AgentMessage,
  AgentObjectReference,
  AgentParticipant,
  AgentRunStatus,
  AgentTask,
  AgentTaskGroup,
  AgentToolCall,
  AgentTransport,
  AgentTransportThreadOperations,
  AgentUsage,
  AgentWidget,
  TextPart,
  DataPart,
  FilePart,
} from "@agent-native/agentkit-protocol";
import {
  AGENTKIT_PROTOCOL_VERSION,
  createCapabilityUnavailableError,
  createCapabilityUnsupportedError,
  inferAgentActivityKind,
  negotiateAgentKitProtocolVersion,
} from "@agent-native/agentkit-protocol";

import type {
  AgentChatRuntime,
  AgentChatRuntimeCapabilities,
  AgentChatRuntimeContentPart,
  AgentChatRuntimeEvent,
  AgentChatRuntimeKnownContentPart,
  AgentChatRuntimeMessage,
  AgentChatRuntimeObjectReference,
  AgentChatRuntimeSession,
  AgentChatRuntimeSessionSummary,
  AgentChatRuntimeToolStatus,
  AgentChatRuntimeToolCall,
  AgentChatRuntimeTurn,
  AgentChatRuntimeUsage,
} from "./runtime.js";

export interface CreateAgentKitProtocolAdapterOptions {
  /** Stable clock used for event timestamps and thread fallbacks. */
  readonly now?: () => string;
  /** Allows a host to use its own stable IDs when the runtime omits one. */
  readonly createId?: (prefix: string) => string;
  /** Optional capability overrides for host-owned protocol features. */
  readonly capabilities?: AgentCapabilities;
  /** Format for assistant text when the runtime omits an explicit format. */
  readonly textFormat?: TextPart["format"];
  /** Host-owned operations layered onto Core's run and thread runtime. */
  readonly operations?: Partial<
    AgentTransportThreadOperations &
      Pick<
        AgentTransport,
        | "invokeAction"
        | "createUpload"
        | "completeUpload"
        | "cancelUpload"
        | "submitFeedback"
      >
  >;
  /** Maximum replay events retained for each process-local run. */
  readonly maxRetainedEvents?: number;
  /**
   * Maximum completed runs retained for process-local replay. Active runs are
   * never evicted. Least-recently-accessed completed runs are removed first.
   */
  readonly maxRetainedRuns?: number;
  /**
   * Milliseconds a completed run remains eligible for process-local replay.
   * The count bound may evict it sooner when newer completed runs arrive.
   */
  readonly retainedRunTtlMs?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentKitProtocolAdapter extends AgentTransport {
  dispose(): Promise<void>;
}

interface ProtocolEventInput {
  type: AgentEvent["type"];
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ProtocolRun {
  readonly runId: string;
  readonly threadId: string;
  readonly session: AgentChatRuntimeSession;
  turn: AgentChatRuntimeTurn;
  events: AgentEvent[];
  firstRetainedSequence: number;
  sequence: number;
  status: AgentRunStatus;
  startedAt?: string;
  completedAt?: string;
  terminalAtMs?: number;
  lastAccessedAtMs: number;
  activeReaders: number;
  error?: AgentError;
  usage?: AgentUsage;
  metadata?: Record<string, unknown>;
  activeMessageId?: string;
  actions: Map<string, AgentActionInvocation>;
  activeActivities: Map<string, AgentActivity>;
  pumpPromise: Promise<void> | null;
  continuationPromise: Promise<void> | null;
  terminal: boolean;
  waitingForContinuation: boolean;
  pendingApprovalId?: string;
  pendingConnectionRequestId?: string;
  listeners: Set<() => void>;
}

const TOOL_RESULT_MEDIA_TYPE = "application/x-agent-native-tool-result";
const TOOL_CALL_MEDIA_TYPE = "application/x-agent-native-tool-call";
const RUNTIME_PART_MEDIA_TYPE = "application/x-agent-native-runtime-part";
const RUNTIME_EVENT_TYPE = "x-core.runtime-event";
const RUNTIME_USAGE_EVENT_TYPE = "x-core.usage";
const DEFAULT_MAX_RETAINED_EVENTS = 1_000;
const DEFAULT_MAX_RETAINED_RUNS = 100;
const DEFAULT_RETAINED_RUN_TTL_MS = 30 * 60 * 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const DISCOVERABLE_CAPABILITIES = [
  "actions",
  "activities",
  "approvals",
  "artifacts",
  "attachments",
  "citations",
  "clientEffects",
  "codeExecution",
  "connectionRequests",
  "durableThreadSnapshots",
  "feedback",
  "messageQueue",
  "modelSelection",
  "multiAgentActivity",
  "reasoning",
  "resumableRuns",
  "smartObjects",
  "suggestions",
  "taskGroups",
  "threadForking",
  "threadHistory",
  "toolSelection",
  "uploads",
  "widgets",
] as const satisfies readonly AgentCapabilityId[];

export const AGENT_NATIVE_PROTOCOL_METADATA_KEY = "x-agent-native";

/**
 * Structured Agent-Native references carried through the protocol's metadata
 * extension point. Values remain references and identifiers; credential or
 * large content bodies do not belong here. These fields describe the context
 * used by an authorized runtime; receiving them never replaces server-side
 * authentication, row scoping, or action authorization.
 */
export interface AgentNativeProtocolMetadata {
  context?: {
    route?: AgentObjectReference;
    screen?: AgentObjectReference;
    focusedObjects?: AgentObjectReference[];
    browserTabId?: string;
    [key: string]: unknown;
  };
  identity?: {
    actor?: AgentObjectReference;
    workspace?: AgentObjectReference;
    organization?: AgentObjectReference;
    [key: string]: unknown;
  };
  access?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  trace?: Record<string, unknown>;
  delegation?: Record<string, unknown>;
  action?: {
    name: string;
    invocationId?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    readOnly?: boolean;
    destructive?: boolean;
    resultLinks?: AgentObjectReference[];
    [key: string]: unknown;
  };
  activity?: Record<string, unknown>;
  smartObjects?: AgentObjectReference[];
  observability?: Record<string, unknown>;
  [key: string]: unknown;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultCreateId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mergeProtocolMetadata(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  let merged: Record<string, unknown> | undefined;
  for (const source of sources) {
    if (!source) continue;
    const previousNative = asRecord(
      merged?.[AGENT_NATIVE_PROTOCOL_METADATA_KEY],
    );
    const nextNative = asRecord(source[AGENT_NATIVE_PROTOCOL_METADATA_KEY]);
    merged = { ...merged, ...source };
    if (!nextNative) continue;
    const native: Record<string, unknown> = {
      ...previousNative,
      ...nextNative,
    };
    for (const key of [
      "context",
      "identity",
      "access",
      "audit",
      "trace",
      "delegation",
      "action",
      "activity",
      "observability",
    ]) {
      const previous = asRecord(previousNative?.[key]);
      const next = asRecord(nextNative[key]);
      if (previous && next) native[key] = { ...previous, ...next };
    }
    merged[AGENT_NATIVE_PROTOCOL_METADATA_KEY] = native;
  }
  return merged;
}

const PROTECTED_PROTOCOL_METADATA_KEYS = [
  "actor",
  "workspace",
  "organization",
  "access",
  "audit",
  "trace",
] as const;

const PROTECTED_AGENT_NATIVE_METADATA_KEYS = [
  "access",
  "audit",
  "trace",
] as const;

const PROTECTED_AGENT_NATIVE_IDENTITY_KEYS = [
  "actor",
  "workspace",
  "organization",
] as const;

function hasDefinedOwnValue(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined
  );
}

/**
 * Merges caller-authored metadata over host defaults while restoring every
 * host-resolved trust field. Metadata is context, never authentication, but a
 * caller must still be unable to replace the identity and audit references the
 * authorized host attached to a session operation.
 */
function mergeTrustedProtocolMetadata(
  trusted: Record<string, unknown> | undefined,
  ...untrusted: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged = mergeProtocolMetadata(trusted, ...untrusted);
  if (!trusted || !merged) return merged;

  for (const key of PROTECTED_PROTOCOL_METADATA_KEYS) {
    if (hasDefinedOwnValue(trusted, key)) merged[key] = trusted[key];
  }

  const trustedNative = asRecord(trusted[AGENT_NATIVE_PROTOCOL_METADATA_KEY]);
  if (!trustedNative) return merged;
  const mergedNative = {
    ...asRecord(merged[AGENT_NATIVE_PROTOCOL_METADATA_KEY]),
  };
  for (const key of PROTECTED_AGENT_NATIVE_METADATA_KEYS) {
    if (hasDefinedOwnValue(trustedNative, key)) {
      mergedNative[key] = trustedNative[key];
    }
  }

  const trustedIdentity = asRecord(trustedNative.identity);
  if (trustedIdentity) {
    const mergedIdentity = { ...asRecord(mergedNative.identity) };
    for (const key of PROTECTED_AGENT_NATIVE_IDENTITY_KEYS) {
      if (hasDefinedOwnValue(trustedIdentity, key)) {
        mergedIdentity[key] = trustedIdentity[key];
      }
    }
    mergedNative.identity = mergedIdentity;
  }
  merged[AGENT_NATIVE_PROTOCOL_METADATA_KEY] = mergedNative;
  return merged;
}

function explicitApprovalDecision(
  response: AgentApprovalResponse | undefined,
): "approve" | "deny" {
  const decision = response?.decision;
  if (decision === "approve" || decision === "deny") return decision;
  throw new Error(
    'An approval response must include decision "approve" or "deny".',
  );
}

function agentNativeMetadata(
  metadata: Record<string, unknown> | undefined,
): AgentNativeProtocolMetadata | undefined {
  return asRecord(metadata?.[AGENT_NATIVE_PROTOCOL_METADATA_KEY]) as
    | AgentNativeProtocolMetadata
    | undefined;
}

function objectReference(value: unknown): AgentObjectReference | undefined {
  const object = asRecord(value);
  if (
    !object ||
    typeof object.id !== "string" ||
    typeof object.kind !== "string" ||
    typeof object.label !== "string"
  ) {
    return undefined;
  }
  return {
    id: object.id,
    kind: object.kind,
    label: object.label,
    ...(typeof object.uri === "string" ? { uri: object.uri } : {}),
    ...(asRecord(object.metadata)
      ? { metadata: asRecord(object.metadata) }
      : {}),
  };
}

function runtimeObjectReference(
  value: AgentChatRuntimeObjectReference | undefined,
): AgentObjectReference | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    kind: value.kind,
    label: value.label ?? value.id,
    ...(value.uri ? { uri: value.uri } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function runtimeEventMessageId(
  run: ProtocolRun,
  ...metadata: Array<Record<string, unknown> | undefined>
): string | undefined {
  for (const value of metadata) {
    const messageId = metadataString(value, "messageId");
    if (messageId) return messageId;
  }
  return run.activeMessageId;
}

function runtimeAnnotationToProtocol(
  annotation: Extract<
    AgentChatRuntimeEvent,
    { type: "annotation" }
  >["annotation"],
): AgentAnnotation {
  return {
    id: annotation.id,
    kind: annotation.kind,
    label: annotation.label,
    ...(annotation.url ? { url: annotation.url } : {}),
    ...(annotation.start === undefined ? {} : { start: annotation.start }),
    ...(annotation.end === undefined ? {} : { end: annotation.end }),
    metadata: mergeProtocolMetadata(
      annotation.metadata,
      annotation.object
        ? {
            [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: {
              smartObjects: [runtimeObjectReference(annotation.object)],
            },
          }
        : undefined,
    ),
  };
}

function runtimeWidgetToProtocol(
  widget: Extract<AgentChatRuntimeEvent, { type: "widget" }>["widget"],
): AgentWidget {
  return {
    id: widget.id,
    kind: widget.kind,
    data: widget.data,
    ...(widget.title ? { title: widget.title } : {}),
    metadata: mergeProtocolMetadata(
      widget.metadata,
      widget.state ? { runtimeState: widget.state } : undefined,
      widget.object
        ? {
            [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: {
              smartObjects: [runtimeObjectReference(widget.object)],
            },
          }
        : undefined,
    ),
  };
}

function runtimeParticipantToProtocol(
  participant: Extract<
    AgentChatRuntimeEvent,
    { type: "participant" }
  >["participant"],
): AgentParticipant | undefined {
  if (!participant.status) return undefined;
  return {
    id: participant.id,
    name: participant.name,
    status: participant.status,
    ...(participant.kind ? { kind: participant.kind } : {}),
    ...(participant.parentParticipantId
      ? { parentAgentId: participant.parentParticipantId }
      : {}),
    ...(participant.activeTaskId
      ? { activeTaskId: participant.activeTaskId }
      : {}),
    ...(participant.description
      ? { description: participant.description }
      : {}),
    ...(participant.origin
      ? { origin: runtimeObjectReference(participant.origin) }
      : {}),
    ...(participant.startedAt ? { startedAt: participant.startedAt } : {}),
    ...(participant.updatedAt ? { updatedAt: participant.updatedAt } : {}),
    ...(participant.completedAt
      ? { completedAt: participant.completedAt }
      : {}),
    ...(participant.metadata ? { metadata: participant.metadata } : {}),
  };
}

function runtimeInteractionToProtocol(
  interaction: Extract<
    AgentChatRuntimeEvent,
    { type: "interaction" }
  >["interaction"],
): AgentInteraction | undefined {
  if (!interaction.participantId) return undefined;
  return {
    id: interaction.id,
    kind: interaction.kind,
    agentId: interaction.participantId,
    ...(interaction.targetParticipantId
      ? { targetAgentId: interaction.targetParticipantId }
      : {}),
    ...(interaction.label ? { label: interaction.label } : {}),
    ...(interaction.detail ? { detail: interaction.detail } : {}),
    ...(interaction.scope ? { scope: interaction.scope } : {}),
    ...(interaction.object
      ? { object: runtimeObjectReference(interaction.object) }
      : {}),
    ...(interaction.source
      ? { source: runtimeObjectReference(interaction.source) }
      : {}),
    ...(interaction.occurredAt ? { occurredAt: interaction.occurredAt } : {}),
    ...(interaction.metadata ? { metadata: interaction.metadata } : {}),
  };
}

function runtimeStructuredActivity(
  activity: Extract<AgentChatRuntimeEvent, { type: "activity" }>["activity"],
): AgentActivity {
  return {
    id: activity.id,
    kind: activity.kind,
    label: activity.label,
    status: activity.status,
    ...(activity.detail ? { detail: activity.detail } : {}),
    ...(activity.participantId ? { agentId: activity.participantId } : {}),
    ...(activity.scope ? { scope: activity.scope } : {}),
    ...(activity.object
      ? { object: runtimeObjectReference(activity.object) }
      : {}),
    ...(activity.source
      ? { source: runtimeObjectReference(activity.source) }
      : {}),
    ...(activity.data === undefined
      ? {}
      : {
          summary: [
            {
              type: "data",
              data: activity.data,
              mediaType: "application/x-agent-native-activity",
            },
          ],
        }),
    ...(activity.metadata ? { metadata: activity.metadata } : {}),
  };
}

function runtimeTaskToProtocol(
  task: Extract<AgentChatRuntimeEvent, { type: "task" }>["task"],
): AgentTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status === "awaiting-input" ? "awaiting_input" : task.status,
    ...(task.kind ? { kind: task.kind } : {}),
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.assignedParticipantId
      ? { assignedAgentId: task.assignedParticipantId }
      : {}),
    ...(task.runId ? { runId: task.runId } : {}),
    ...(task.detail ? { detail: task.detail } : {}),
    ...(task.object ? { object: runtimeObjectReference(task.object) } : {}),
    ...(task.source ? { source: runtimeObjectReference(task.source) } : {}),
    ...(task.summary
      ? { summary: [{ type: "text", text: task.summary, format: "plain" }] }
      : {}),
    ...(task.startedAt ? { createdAt: task.startedAt } : {}),
    ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    metadata: mergeProtocolMetadata(
      task.metadata,
      task.progress === undefined && !task.threadId
        ? undefined
        : {
            ...(task.progress === undefined
              ? {}
              : { runtimeProgress: task.progress }),
            ...(task.threadId ? { runtimeThreadId: task.threadId } : {}),
          },
    ),
  };
}

function runtimeTaskGroupToProtocol(
  taskGroup: Extract<
    AgentChatRuntimeEvent,
    { type: "task-group" }
  >["taskGroup"],
): AgentTaskGroup {
  return {
    id: taskGroup.id,
    taskIds: [...taskGroup.taskIds],
    ...(taskGroup.title ? { title: taskGroup.title } : {}),
    ...(taskGroup.status
      ? {
          status:
            taskGroup.status === "awaiting-input"
              ? "awaiting_input"
              : taskGroup.status,
        }
      : {}),
    ...(taskGroup.metadata ? { metadata: taskGroup.metadata } : {}),
  };
}

function extensionEventType(namespace: string, name: string): `x-${string}` {
  const segment = `${namespace}.${name}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `x-${segment || "core.extension"}`;
}

function serializeValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Approval input must be JSON-serializable.");
  }
  return serialized;
}

function runtimePartToProtocolPart(
  part: AgentChatRuntimeContentPart,
  fallbackTextFormat?: TextPart["format"],
): AgentMessage["parts"][number] {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        ...((part.format ?? fallbackTextFormat)
          ? { format: part.format ?? fallbackTextFormat }
          : {}),
      };
    case "reasoning":
      return { type: "reasoning", text: part.text, visibility: "summary" };
    case "image":
      return {
        type: "file",
        name: part.alt ?? part.id ?? "image",
        mediaType: part.mediaType,
        url: part.url,
      } satisfies FilePart;
    case "file":
      return {
        type: "file",
        name: part.filename ?? part.id ?? "file",
        mediaType: part.mediaType,
        url: part.url,
      } satisfies FilePart;
    case "tool-call":
      return {
        type: "data",
        mediaType: TOOL_CALL_MEDIA_TYPE,
        data: {
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
          inputText: part.inputText,
        },
      } satisfies DataPart;
    case "tool-result":
      return {
        type: "data",
        mediaType: TOOL_RESULT_MEDIA_TYPE,
        data: {
          id: part.toolCallId,
          name: part.toolName,
          result: part.result,
          resultText: part.resultText,
          isError: part.isError,
        },
      } satisfies DataPart;
    case "data":
      return {
        type: "data",
        data: part.data,
        mediaType: part.mediaType,
        title: part.title,
      } satisfies DataPart;
    default:
      return {
        type: "data",
        data: part,
        mediaType: RUNTIME_PART_MEDIA_TYPE,
      } satisfies DataPart;
  }
}

function runtimeMessageToProtocolMessage(
  message: AgentChatRuntimeMessage,
  fallbackTextFormat?: TextPart["format"],
): AgentMessage {
  const textFormat =
    message.role === "assistant" ? fallbackTextFormat : undefined;
  return {
    id: message.id,
    role: message.role,
    parts: message.content.map((part) =>
      runtimePartToProtocolPart(part, textFormat),
    ),
    createdAt: message.createdAt,
    metadata: message.metadata,
  };
}

function protocolPartToRuntimePart(
  part: AgentMessage["parts"][number],
): AgentChatRuntimeKnownContentPart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        ...(part.format ? { format: part.format } : {}),
      };
    case "reasoning":
      return { type: "reasoning", text: part.text };
    case "file":
      return {
        type: "file",
        filename: part.name,
        mediaType: part.mediaType,
        url: part.url,
      };
    default:
      return {
        type: "data",
        data: part,
        mediaType: "application/x-agentkit-protocol-part",
      };
  }
}

function protocolMessageToRuntimeMessage(
  message: AgentMessage,
): AgentChatRuntimeMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.parts.map(protocolPartToRuntimePart),
    createdAt: message.createdAt,
    metadata: message.metadata,
  };
}

function latestUserPrompt(
  messages: readonly AgentMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.parts
      .filter(
        (part): part is Extract<typeof part, { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n");
    return text || undefined;
  }
  return undefined;
}

function runtimeToolStatus(
  status: AgentChatRuntimeToolStatus,
): AgentToolCall["status"] {
  return status === "pending" ? "running" : status;
}

function runtimeActivityLabel(name: string): string {
  const label = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Use tool";
}

function runtimeActivity(input: {
  id: string;
  name: string;
  label?: string;
  status: AgentActivity["status"];
  detail?: string;
  metadata?: Record<string, unknown>;
}): AgentActivity {
  const structured = asRecord(agentNativeMetadata(input.metadata)?.activity);
  const kind =
    typeof structured?.kind === "string"
      ? structured.kind
      : inferAgentActivityKind(input.name);
  const scope =
    structured?.scope === "thread" ||
    structured?.scope === "workspace" ||
    structured?.scope === "external"
      ? structured.scope
      : undefined;
  const object = objectReference(structured?.object);
  const source = objectReference(structured?.source);
  return {
    id: typeof structured?.id === "string" ? structured.id : input.id,
    kind,
    label:
      typeof structured?.label === "string"
        ? structured.label
        : (input.label ?? runtimeActivityLabel(input.name)),
    status: input.status,
    ...(typeof structured?.agentId === "string"
      ? { agentId: structured.agentId }
      : {}),
    ...(scope ? { scope } : {}),
    ...(object ? { object } : {}),
    ...(source ? { source } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(asRecord(structured?.metadata)
      ? { metadata: asRecord(structured?.metadata) }
      : {}),
  };
}

function actionInvocationFromTool(
  run: ProtocolRun,
  tool: AgentChatRuntimeToolCall,
  metadata: Record<string, unknown> | undefined,
): AgentActionInvocation | undefined {
  const action = asRecord(agentNativeMetadata(metadata)?.action);
  if (!action || typeof action.name !== "string" || !action.name.trim()) {
    return undefined;
  }
  return {
    id:
      typeof action.invocationId === "string" && action.invocationId
        ? action.invocationId
        : tool.id,
    action: action.name,
    threadId: run.threadId,
    runId: run.runId,
    ...(typeof action.messageId === "string"
      ? { messageId: action.messageId }
      : {}),
    ...(typeof action.widgetId === "string"
      ? { widgetId: action.widgetId }
      : {}),
    ...(typeof action.itemId === "string" ? { itemId: action.itemId } : {}),
    ...(tool.input === undefined ? {} : { payload: tool.input }),
    ...(metadata ? { metadata } : {}),
  };
}

function actionResultFromTool(input: {
  invocation: AgentActionInvocation;
  status: AgentToolCall["status"];
  result?: unknown;
  resultText?: string;
  error?: AgentError;
  metadata?: Record<string, unknown>;
}): AgentActionResult {
  return {
    invocationId: input.invocation.id,
    status:
      input.status === "completed"
        ? "completed"
        : input.status === "cancelled"
          ? "cancelled"
          : "failed",
    ...(input.result !== undefined
      ? { data: input.result }
      : input.resultText !== undefined
        ? { data: input.resultText }
        : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function runtimeToolToProtocolTool(
  tool: AgentChatRuntimeToolCall,
  status: AgentToolCall["status"] = "running",
  result?: unknown,
  error?: AgentError,
): AgentToolCall {
  return {
    id: tool.id,
    name: tool.name,
    input: tool.input,
    status,
    output: result,
    error,
  };
}

function runtimeUsageToProtocolUsage(usage: AgentChatRuntimeUsage): AgentUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cost: usage.costCents === undefined ? undefined : usage.costCents / 100,
    currency: usage.costCents === undefined ? undefined : "USD",
  };
}

function runtimeCapabilitiesToProtocolCapabilities(
  capabilities: AgentChatRuntimeCapabilities,
): AgentCapabilities {
  const citations =
    capabilities.rich?.citations === true ||
    capabilities.rich?.annotations === true
      ? true
      : capabilities.rich?.citations === false &&
          capabilities.rich?.annotations === false
        ? false
        : undefined;
  const multiAgentActivity =
    capabilities.rich?.participants === true ||
    capabilities.rich?.interactions === true ||
    capabilities.rich?.tasks === true
      ? true
      : capabilities.rich?.participants === false &&
          capabilities.rich?.interactions === false &&
          capabilities.rich?.tasks === false
        ? false
        : undefined;
  return {
    protocolVersion: AGENTKIT_PROTOCOL_VERSION,
    activities: capabilities.tools?.events,
    attachments: capabilities.messages.attachments,
    widgets: capabilities.rich?.widgets,
    approvals: capabilities.tools?.approvals,
    connectionRequests: capabilities.rich?.connectionRequests,
    citations,
    clientEffects: capabilities.rich?.clientEffects,
    multiAgentActivity,
    taskGroups: capabilities.rich?.taskGroups,
    // This adapter can replay while its process is alive, but it does not own a
    // durable event store and must not advertise restart-safe run resumption.
    resumableRuns: false,
    "x-resumable-runs-reason":
      "Core runtime replay is process-local until a durable event store is configured.",
    threadHistory: capabilities.messages.history,
    threadForking: capabilities.sessions?.fork,
    modelSelection: capabilities.models?.selectable,
    toolSelection: capabilities.tools?.hostTools,
    codeExecution: capabilities.tools?.hostTools,
    artifacts: Boolean(capabilities.artifacts),
    smartObjects: Boolean(capabilities.artifacts),
  };
}

function capabilityDescriptor(
  id: AgentCapabilityId,
  state: "available" | "degraded" | "unavailable" | "unsupported",
  description?: string,
): AgentCapabilityDescriptor {
  if (state === "available") return { id, state, description };
  if (state === "unsupported") {
    return {
      id,
      state,
      description,
      error: createCapabilityUnsupportedError(id, {
        message: description ?? `The ${id} capability is unsupported.`,
      }),
    };
  }
  return {
    id,
    state,
    description,
    error: createCapabilityUnavailableError(id, {
      message: description ?? `The ${id} capability is currently unavailable.`,
      retryable: state === "unavailable",
    }),
  };
}

function runtimeBooleanCapabilityState(
  value: boolean | undefined,
): "available" | "unavailable" | "unsupported" {
  return value === true
    ? "available"
    : value === false
      ? "unsupported"
      : "unavailable";
}

function runtimeSessionToThread(
  session: AgentChatRuntimeSessionSummary,
  now: () => string,
): {
  id: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  status: "active";
  metadata?: Record<string, unknown>;
} {
  const createdAt = session.createdAt ?? now();
  return {
    id: session.threadId ?? session.id,
    createdAt,
    updatedAt: session.updatedAt ?? createdAt,
    title: session.title,
    status: "active",
    metadata: {
      ...session.metadata,
      runtimeId: session.runtimeId,
      ...(session.status ? { runtimeStatus: session.status } : {}),
    },
  };
}

function isTerminalReason(reason: string | undefined): boolean {
  return reason !== "tool-use";
}

function protocolError(error: unknown, code = "runtime_error"): AgentError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Adapts Core's session/turn runtime into the standalone AgentKit transport.
 * The event log is intentionally owned here: Core turns are one-shot streams,
 * while protocol subscribers may reconnect with an `afterSequence` cursor.
 */
export function createAgentKitProtocolAdapter(
  runtime: AgentChatRuntime,
  options: CreateAgentKitProtocolAdapterOptions = {},
): AgentKitProtocolAdapter {
  const now = options.now ?? defaultNow;
  const createId = options.createId ?? defaultCreateId;
  const textFormat = options.textFormat;
  const maxRetainedEvents =
    options.maxRetainedEvents ?? DEFAULT_MAX_RETAINED_EVENTS;
  if (!Number.isInteger(maxRetainedEvents) || maxRetainedEvents < 1) {
    throw new TypeError("maxRetainedEvents must be a positive integer.");
  }
  const maxRetainedRuns = options.maxRetainedRuns ?? DEFAULT_MAX_RETAINED_RUNS;
  if (!Number.isInteger(maxRetainedRuns) || maxRetainedRuns < 1) {
    throw new TypeError("maxRetainedRuns must be a positive integer.");
  }
  const retainedRunTtlMs =
    options.retainedRunTtlMs ?? DEFAULT_RETAINED_RUN_TTL_MS;
  if (!Number.isFinite(retainedRunTtlMs) || retainedRunTtlMs < 1) {
    throw new TypeError("retainedRunTtlMs must be a positive number.");
  }
  const sessions = new Map<string, Promise<AgentChatRuntimeSession>>();
  const runs = new Map<string, ProtocolRun>();
  const disposedSessions = new WeakSet<AgentChatRuntimeSession>();
  let retentionTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function timeMs(value = now()): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function touchRun(run: ProtocolRun): void {
    run.lastAccessedAtMs = timeMs();
  }

  function clearRetentionTimer(): void {
    if (retentionTimer === undefined) return;
    clearTimeout(retentionTimer);
    retentionTimer = undefined;
  }

  function scheduleRetentionSweep(referenceTimeMs: number): void {
    clearRetentionTimer();
    if (disposed) return;
    const nextExpiry = [...runs.values()]
      .filter(
        (run) =>
          run.terminal &&
          run.activeReaders === 0 &&
          run.terminalAtMs !== undefined,
      )
      .reduce<number | undefined>((earliest, run) => {
        const expiry = run.terminalAtMs! + retainedRunTtlMs;
        return earliest === undefined || expiry < earliest ? expiry : earliest;
      }, undefined);
    if (nextExpiry === undefined) return;
    retentionTimer = setTimeout(
      () => {
        retentionTimer = undefined;
        pruneRetainedRuns();
      },
      Math.min(Math.max(0, nextExpiry - referenceTimeMs), MAX_TIMER_DELAY_MS),
    );
    const timer = retentionTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  function pruneRetainedRuns(referenceTimeMs = timeMs()): void {
    const evictable = [...runs.values()].filter(
      (run) => run.terminal && run.activeReaders === 0,
    );
    for (const run of evictable) {
      if (
        run.terminalAtMs !== undefined &&
        referenceTimeMs - run.terminalAtMs >= retainedRunTtlMs
      ) {
        runs.delete(run.runId);
      }
    }

    const retainedCompleted = [...runs.values()]
      .filter((run) => run.terminal && run.activeReaders === 0)
      .sort((left, right) => left.lastAccessedAtMs - right.lastAccessedAtMs);
    while (retainedCompleted.length > maxRetainedRuns) {
      const run = retainedCompleted.shift();
      if (run) runs.delete(run.runId);
    }
    scheduleRetentionSweep(referenceTimeMs);
  }

  const derivedCapabilities: AgentCapabilities = {
    ...runtimeCapabilitiesToProtocolCapabilities(runtime.capabilities),
  };
  const capabilities: AgentCapabilities = {
    ...derivedCapabilities,
    ...options.capabilities,
    actions: Boolean(
      options.operations?.invokeAction &&
      options.capabilities?.actions !== false,
    ),
    feedback: Boolean(
      options.operations?.submitFeedback &&
      options.capabilities?.feedback !== false,
    ),
    uploads: Boolean(
      options.operations?.createUpload &&
      options.operations.completeUpload &&
      options.capabilities?.uploads !== false,
    ),
    durableThreadSnapshots: Boolean(
      (options.operations?.getThreadSnapshot ||
        (runtime.getSession && runtime.capabilities.sessions?.persistent)) &&
      options.capabilities?.durableThreadSnapshots !== false,
    ),
    messageQueue: Boolean(
      options.operations?.listQueuedMessages &&
      options.operations.queueMessage &&
      options.operations.steerQueuedMessage &&
      options.operations.removeQueuedMessage &&
      options.capabilities?.messageQueue !== false,
    ),
    threadHistory: Boolean(
      (options.operations?.getThread ||
        options.operations?.getThreadSnapshot ||
        options.operations?.listThreads ||
        ((runtime.getSession || runtime.listSessions) &&
          derivedCapabilities.threadHistory)) &&
      options.capabilities?.threadHistory !== false,
    ),
    threadForking: Boolean(
      (options.operations?.forkThread ||
        (derivedCapabilities.threadForking && runtime.getSession)) &&
      options.capabilities?.threadForking !== false,
    ),
    approvals: Boolean(
      derivedCapabilities.approvals &&
      options.capabilities?.approvals !== false,
    ),
    connectionRequests: Boolean(
      derivedCapabilities.connectionRequests &&
      runtime.capabilities.rich?.connectionRequests !== false,
    ),
    resumableRuns: false,
    "x-resumable-runs-reason":
      "Core runtime replay is bounded and process-local; reconnect after a process restart requires a durable event transport.",
    "x-run-replay-retention": {
      maxEventsPerRun: maxRetainedEvents,
      maxCompletedRuns: maxRetainedRuns,
      completedRunTtlMs: retainedRunTtlMs,
      guarantee:
        "Active runs are never evicted. Completed runs remain replayable until their TTL expires unless the completed-run LRU bound is reached first.",
    },
    "x-extensions": runtime.capabilities.rich?.extensions,
    "x-upload-progress": runtime.capabilities.rich?.uploadProgress,
  };

  function descriptorForCapability(
    id: AgentCapabilityId,
  ): AgentCapabilityDescriptor {
    if (id === "resumableRuns") {
      return capabilityDescriptor(
        id,
        "degraded",
        "Run replay is bounded and process-local; restart-safe resumption requires a durable event transport.",
      );
    }
    if (id === "uploads" && capabilities.uploads !== true) {
      if (runtime.capabilities.rich?.uploadProgress === true) {
        return capabilityDescriptor(
          id,
          "degraded",
          "Upload progress events are available, but upload lifecycle operations are not wired.",
        );
      }
      return capabilityDescriptor(
        id,
        "unsupported",
        "Upload lifecycle operations are not wired.",
      );
    }
    if (id === "widgets") {
      return capabilityDescriptor(
        id,
        runtimeBooleanCapabilityState(runtime.capabilities.rich?.widgets),
      );
    }
    if (id === "citations") {
      return capabilityDescriptor(
        id,
        runtimeBooleanCapabilityState(derivedCapabilities.citations),
      );
    }
    if (id === "clientEffects") {
      return capabilityDescriptor(
        id,
        runtimeBooleanCapabilityState(runtime.capabilities.rich?.clientEffects),
      );
    }
    if (id === "multiAgentActivity") {
      return capabilityDescriptor(
        id,
        runtimeBooleanCapabilityState(derivedCapabilities.multiAgentActivity),
      );
    }
    if (id === "taskGroups") {
      return capabilityDescriptor(
        id,
        runtimeBooleanCapabilityState(runtime.capabilities.rich?.taskGroups),
      );
    }
    if (id.startsWith("x-")) {
      const value = capabilities[id];
      return capabilityDescriptor(
        id,
        runtimeBooleanCapabilityState(
          typeof value === "boolean" ? value : undefined,
        ),
      );
    }
    const value = capabilities[id as keyof AgentCapabilities];
    const available =
      id === "reasoning"
        ? value === "summary" || value === "full"
        : value === true;
    const unsupported = id === "reasoning" ? value === "none" : value === false;
    return capabilityDescriptor(
      id,
      available ? "available" : unsupported ? "unsupported" : "unavailable",
    );
  }

  function getSession(
    threadId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AgentChatRuntimeSession> {
    if (disposed) {
      return Promise.reject(new Error("The AgentKit adapter is disposed."));
    }
    let session = sessions.get(threadId);
    if (!session) {
      session = (async () => {
        const existing = runtime.getSession
          ? await runtime.getSession({ sessionId: threadId })
          : null;
        const resolved =
          existing ??
          (await runtime.createSession({
            id: threadId,
            threadId,
            metadata: mergeTrustedProtocolMetadata(options.metadata, metadata),
          }));
        if (disposed) {
          await disposeSession(resolved);
          throw new Error(
            "The AgentKit adapter was disposed during session creation.",
          );
        }
        return resolved;
      })();
      sessions.set(threadId, session);
      void session.catch(() => {
        if (sessions.get(threadId) === session) sessions.delete(threadId);
      });
    }
    return session;
  }

  async function disposeSession(
    session: AgentChatRuntimeSession,
  ): Promise<void> {
    if (disposedSessions.has(session)) return;
    disposedSessions.add(session);
    await session.dispose?.();
  }

  function append(run: ProtocolRun, event: ProtocolEventInput): void {
    const lastType = run.events.at(-1)?.type;
    if (
      lastType === "run.completed" ||
      lastType === "run.failed" ||
      lastType === "run.cancelled"
    ) {
      return;
    }
    const terminalActivityStatus =
      event.type === "run.completed" ||
      (event.type === "run.status" && event.status === "completed")
        ? "completed"
        : event.type === "run.failed" ||
            (event.type === "run.status" && event.status === "failed")
          ? "failed"
          : event.type === "run.cancelled" ||
              (event.type === "run.status" && event.status === "cancelled")
            ? "cancelled"
            : undefined;
    if (terminalActivityStatus && run.activeActivities.size > 0) {
      const completedAt = event.occurredAt ?? now();
      for (const activity of [...run.activeActivities.values()]) {
        append(run, {
          type: "activity.completed",
          occurredAt: completedAt,
          metadata: event.metadata,
          activity: {
            ...activity,
            status: terminalActivityStatus,
            completedAt,
          },
        });
      }
    }
    const { occurredAt: eventTime, ...payload } = event;
    const sequence = run.sequence + 1;
    run.sequence = sequence;
    const protocolEvent = {
      ...payload,
      id: `${run.runId}:${sequence}`,
      threadId: run.threadId,
      runId: run.runId,
      sequence,
      occurredAt: eventTime ?? now(),
      metadata: mergeProtocolMetadata(run.metadata, event.metadata),
    } as AgentEvent;
    run.events.push(protocolEvent);
    if (
      protocolEvent.type === "activity.started" ||
      protocolEvent.type === "activity.updated" ||
      protocolEvent.type === "activity.completed"
    ) {
      if (protocolEvent.activity.status === "running") {
        run.activeActivities.set(
          protocolEvent.activity.id,
          protocolEvent.activity,
        );
      } else {
        run.activeActivities.delete(protocolEvent.activity.id);
      }
    }
    if (run.events.length > maxRetainedEvents) {
      run.events.splice(0, run.events.length - maxRetainedEvents);
      run.firstRetainedSequence = run.events[0]?.sequence ?? run.sequence + 1;
    }
    let becameTerminal = false;
    if (protocolEvent.type === "run.status") {
      run.status = protocolEvent.status;
    } else if (protocolEvent.type === "run.started") {
      run.startedAt = protocolEvent.occurredAt;
    } else if (protocolEvent.type === "run.completed") {
      run.status = "completed";
      run.completedAt = protocolEvent.occurredAt;
      run.terminalAtMs = timeMs(protocolEvent.occurredAt);
      run.actions.clear();
      becameTerminal = true;
    } else if (protocolEvent.type === "run.cancelled") {
      run.status = "cancelled";
      run.completedAt = protocolEvent.occurredAt;
      run.terminalAtMs = timeMs(protocolEvent.occurredAt);
      run.actions.clear();
      becameTerminal = true;
    } else if (protocolEvent.type === "run.failed") {
      run.status = "failed";
      run.completedAt = protocolEvent.occurredAt;
      run.terminalAtMs = timeMs(protocolEvent.occurredAt);
      run.error = protocolEvent.error;
      run.actions.clear();
      becameTerminal = true;
    }
    for (const listener of run.listeners) listener();
    if (becameTerminal) pruneRetainedRuns(run.terminalAtMs);
  }

  function runtimeEventToProtocolEvents(
    run: ProtocolRun,
    event: AgentChatRuntimeEvent,
  ): ProtocolEventInput[] {
    const base = {
      occurredAt: event.timestamp,
      metadata: mergeProtocolMetadata(run.metadata, event.metadata),
    };
    switch (event.type) {
      case "message-start":
        run.activeMessageId = event.message.id;
        return [
          {
            type: "message.created",
            ...base,
            message: runtimeMessageToProtocolMessage(event.message, textFormat),
          },
        ];
      case "message-delta":
        if (event.delta.type === "text") {
          return [
            {
              type: "message.delta",
              ...base,
              messageId: event.messageId,
              text: event.delta.text,
              ...((event.delta.format ?? textFormat)
                ? { format: event.delta.format ?? textFormat }
                : {}),
            },
          ];
        }
        if (event.delta.type === "reasoning") {
          return [
            {
              type: "reasoning.delta",
              ...base,
              messageId: event.messageId,
              text: event.delta.text,
            },
          ];
        }
        return [
          {
            type: "x-core.message-part",
            ...base,
            payload: {
              messageId: event.messageId,
              delta: event.delta,
            },
          },
        ];
      case "message-done":
        run.activeMessageId = event.message.id;
        return [
          {
            type: "message.completed",
            ...base,
            message: runtimeMessageToProtocolMessage(event.message, textFormat),
          },
        ];
      case "tool-start": {
        const metadata = mergeProtocolMetadata(
          base.metadata,
          event.toolCall.metadata,
        );
        const invocation = actionInvocationFromTool(
          run,
          event.toolCall,
          metadata,
        );
        if (invocation) run.actions.set(event.toolCall.id, invocation);
        return [
          {
            type: "tool.started",
            ...base,
            metadata,
            toolCall: runtimeToolToProtocolTool(event.toolCall),
          },
          ...(invocation
            ? [
                {
                  type: "action.started" as const,
                  ...base,
                  metadata,
                  invocation,
                },
              ]
            : []),
          {
            type: "activity.started",
            ...base,
            metadata,
            activity: runtimeActivity({
              id: event.toolCall.id,
              name: event.toolCall.name,
              status: "running",
              metadata,
            }),
          },
        ];
      }
      case "tool-delta":
        return [
          {
            type: "tool.delta",
            ...base,
            toolCallId: event.toolCallId,
            inputTextDelta: event.inputTextDelta,
            outputTextDelta: event.resultTextDelta,
            metadata: {
              ...event.metadata,
              ...(event.toolName ? { toolName: event.toolName } : {}),
            },
          },
        ];
      case "tool-done": {
        const status = runtimeToolStatus(event.status);
        const error = event.error
          ? protocolError(event.error, "tool_error")
          : undefined;
        const invocation = run.actions.get(event.toolCallId);
        const metadata = mergeProtocolMetadata(
          invocation?.metadata,
          base.metadata,
        );
        const actionResult = invocation
          ? actionResultFromTool({
              invocation,
              status,
              result: event.result,
              resultText: event.resultText,
              error,
              metadata,
            })
          : undefined;
        if (invocation) run.actions.delete(event.toolCallId);
        return [
          {
            type: "tool.updated",
            ...base,
            metadata,
            toolCall: {
              id: event.toolCallId,
              name: event.toolName,
              status,
              output: event.result ?? event.resultText,
              error,
            },
          },
          ...(actionResult
            ? [
                {
                  type:
                    actionResult.status === "completed"
                      ? ("action.completed" as const)
                      : ("action.failed" as const),
                  ...base,
                  metadata,
                  result: actionResult,
                },
              ]
            : []),
          {
            type: "activity.completed",
            ...base,
            metadata,
            activity: runtimeActivity({
              id: event.toolCallId,
              name: event.toolName,
              detail: event.resultText,
              status:
                status === "completed"
                  ? "completed"
                  : status === "cancelled"
                    ? "cancelled"
                    : "failed",
              metadata,
            }),
          },
        ];
      }
      case "approval-request": {
        if (
          run.pendingApprovalId !== undefined &&
          run.pendingApprovalId !== event.approvalId
        ) {
          throw new Error(
            `AgentKit run ${run.runId} received approval ${event.approvalId} while approval ${run.pendingApprovalId} is still pending.`,
          );
        }
        run.waitingForContinuation = true;
        run.pendingApprovalId = event.approvalId;
        return [
          {
            type: "run.status",
            ...base,
            status: "awaiting_approval",
          },
          {
            type: "approval.requested",
            ...base,
            request: {
              id: event.approvalId,
              title: event.message,
              kind: "approval",
              description: event.toolName
                ? `${event.toolName}${event.toolCallId ? ` · ${event.toolCallId}` : ""}`
                : undefined,
              metadata: {
                ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
                ...(event.toolName ? { toolName: event.toolName } : {}),
                ...(event.input === undefined ? {} : { input: event.input }),
              },
            } satisfies AgentApprovalRequest,
          },
        ];
      }
      case "approval-resolved":
        return [
          {
            type: "approval.resolved",
            ...base,
            approvalId: event.approvalId,
            response: {
              decision: event.approved ? "approve" : "deny",
              optionIds: [event.approved ? "approve" : "deny"],
              ...(event.message ? { input: { message: event.message } } : {}),
            },
          },
        ];
      case "connection-request": {
        if (
          run.pendingConnectionRequestId !== undefined &&
          run.pendingConnectionRequestId !== event.requestId
        ) {
          throw new Error(
            `AgentKit run ${run.runId} received connection request ${event.requestId} while ${run.pendingConnectionRequestId} is still pending.`,
          );
        }
        run.waitingForContinuation = true;
        run.pendingConnectionRequestId = event.requestId;
        return [
          { type: "run.status", ...base, status: "awaiting_input" },
          {
            type: "connection.requested",
            ...base,
            request: {
              id: event.requestId,
              provider: event.provider,
              reason: event.reason,
              status: "requested",
              appId: event.appId,
              detail: event.detail,
              source: event.source
                ? {
                    id: event.source.id,
                    kind: event.source.kind,
                    label: event.source.label,
                    uri: event.source.uri,
                  }
                : undefined,
              createdAt: base.occurredAt,
            } satisfies AgentConnectionRequest,
          },
        ];
      }
      case "status":
        if (event.metadata?.compatibilityMirror === "activity") return [];
        return [
          {
            type: "activity.updated",
            ...base,
            activity: runtimeActivity({
              id: event.id ?? createId("activity"),
              name: event.message,
              label: event.message,
              status: event.level === "error" ? "failed" : "running",
              metadata: mergeProtocolMetadata(
                base.metadata,
                event.code ? { code: event.code } : undefined,
              ),
            }),
          },
        ];
      case "suggestions":
        return [
          {
            type: "suggestions.updated",
            ...base,
            suggestions: event.suggestions,
          },
        ];
      case "annotation": {
        const messageId =
          event.annotation.messageId ??
          runtimeEventMessageId(run, event.annotation.metadata, event.metadata);
        if (event.operation === "remove") {
          return [
            {
              type: "annotation.removed",
              ...base,
              annotationId: event.annotation.id,
            },
          ];
        }
        return [
          {
            type:
              event.operation === "create"
                ? "annotation.created"
                : "annotation.updated",
            ...base,
            ...(messageId ? { messageId } : {}),
            annotation: runtimeAnnotationToProtocol(event.annotation),
          },
        ];
      }
      case "widget": {
        const messageId = runtimeEventMessageId(
          run,
          event.widget.metadata,
          event.metadata,
        );
        if (event.operation === "remove") {
          return [
            {
              type: "widget.removed",
              ...base,
              widgetId: event.widget.id,
            },
          ];
        }
        return [
          {
            type:
              event.operation === "create"
                ? "widget.created"
                : "widget.updated",
            ...base,
            ...(messageId ? { messageId } : {}),
            widget: runtimeWidgetToProtocol(event.widget),
          },
        ];
      }
      case "participant": {
        const participant = runtimeParticipantToProtocol(event.participant);
        if (!participant) {
          return [
            {
              type: `x-core.participant.${event.operation}`,
              ...base,
              payload: event,
            },
          ];
        }
        const type =
          event.operation === "register"
            ? "agent.registered"
            : event.operation === "unregister"
              ? "agent.unregistered"
              : "agent.updated";
        return [{ type, ...base, agent: participant }];
      }
      case "interaction": {
        const interaction = runtimeInteractionToProtocol(event.interaction);
        return interaction
          ? [{ type: "agent.interaction", ...base, interaction }]
          : [
              {
                type: "x-core.interaction",
                ...base,
                payload: event,
              },
            ];
      }
      case "activity": {
        const type =
          event.operation === "start"
            ? "activity.started"
            : event.operation === "complete"
              ? "activity.completed"
              : "activity.updated";
        return [
          {
            type,
            ...base,
            activity: runtimeStructuredActivity(event.activity),
          },
        ];
      }
      case "task": {
        const type =
          event.operation === "create"
            ? "task.created"
            : event.operation === "complete"
              ? "task.completed"
              : "task.updated";
        return [
          {
            type,
            ...base,
            task: runtimeTaskToProtocol(event.task),
          },
        ];
      }
      case "task-group": {
        const type =
          event.operation === "create"
            ? "task-group.created"
            : event.operation === "complete"
              ? "task-group.completed"
              : "task-group.updated";
        return [
          {
            type,
            ...base,
            taskGroup: runtimeTaskGroupToProtocol(event.taskGroup),
          },
        ];
      }
      case "upload-progress":
        if (event.bytesSent === undefined || event.bytesTotal === undefined) {
          return [
            {
              type: "x-core.upload-progress",
              ...base,
              payload: event,
            },
          ];
        }
        return [
          {
            type: "upload.progress",
            ...base,
            metadata: mergeProtocolMetadata(
              base.metadata,
              {
                runtimeStatus: event.status,
                ...(event.error ? { error: event.error } : {}),
              },
              event.object
                ? {
                    [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: {
                      smartObjects: [runtimeObjectReference(event.object)],
                    },
                  }
                : undefined,
            ),
            progress: {
              uploadId: event.uploadId,
              loaded: event.bytesSent,
              total: event.bytesTotal,
            },
          },
        ];
      case "client-effect": {
        if (event.kind !== "effect" && event.kind !== "deeplink") {
          return [
            {
              type: "x-core.client-effect",
              ...base,
              payload: event,
            },
          ];
        }
        const data = asRecord(event.data);
        return [
          {
            type:
              event.kind === "deeplink" ? "client.deeplink" : "client.effect",
            ...base,
            metadata: mergeProtocolMetadata(
              base.metadata,
              event.object
                ? {
                    [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: {
                      smartObjects: [runtimeObjectReference(event.object)],
                    },
                  }
                : undefined,
            ),
            name: event.name,
            ...(event.data === undefined
              ? {}
              : { data: data ?? { value: event.data } }),
          },
        ];
      }
      case "extension":
        return [
          {
            type: extensionEventType(event.namespace, event.name),
            ...base,
            payload: {
              namespace: event.namespace,
              name: event.name,
              ...(event.version === undefined
                ? {}
                : { version: event.version }),
              ...(event.data === undefined ? {} : { data: event.data }),
              ...(event.references
                ? {
                    references: event.references.map((reference) => ({
                      id: reference.id,
                      kind: reference.kind,
                      label: reference.label ?? reference.id,
                      ...(reference.uri ? { uri: reference.uri } : {}),
                    })),
                  }
                : {}),
            },
          },
        ];
      case "artifact": {
        const artifact: AgentArtifactReference = {
          id: event.artifact.id ?? createId("artifact"),
          kind: event.artifact.kind,
          title: event.artifact.title,
          url: event.artifact.url,
          metadata: {
            ...event.artifact.metadata,
            ...(event.artifact.path ? { path: event.artifact.path } : {}),
            ...(event.artifact.data === undefined
              ? {}
              : { hasInlineData: true }),
          },
        };
        return [{ type: "artifact.created", ...base, artifact }];
      }
      case "file":
        return [
          {
            type: "artifact.created",
            ...base,
            artifact: {
              id: createId("file"),
              kind: "file",
              title: event.path,
              metadata: {
                path: event.path,
                ...(event.operation ? { operation: event.operation } : {}),
                ...(event.summary ? { summary: event.summary } : {}),
              },
            },
          },
          {
            type: "activity.completed",
            ...base,
            activity: {
              id: event.id ?? createId("activity"),
              kind: event.operation === "unknown" ? "read" : "write",
              label:
                event.operation === "unknown"
                  ? "Read file"
                  : `${event.operation ?? "update"} file`,
              status: "completed",
              object: {
                id: event.path,
                kind: "file",
                label: event.path,
                uri: event.path,
              },
              detail: event.summary,
            },
          },
        ];
      case "usage":
        run.usage = runtimeUsageToProtocolUsage(event.usage);
        return [
          {
            type: RUNTIME_USAGE_EVENT_TYPE,
            ...base,
            payload: run.usage,
          },
        ];
      case "error":
        run.terminal = true;
        return [
          { type: "run.status", ...base, status: "failed" },
          {
            type: "run.failed",
            ...base,
            error: {
              code: event.code ?? "runtime_error",
              message: event.error,
              retryable: event.recoverable,
              details: event.cause,
            },
          },
        ];
      case "done":
        if (!isTerminalReason(event.reason)) {
          run.waitingForContinuation = true;
          return [
            {
              type: "run.status",
              ...base,
              status: run.pendingConnectionRequestId
                ? "awaiting_input"
                : "awaiting_approval",
            },
          ];
        }
        run.terminal = true;
        if (event.reason === "cancelled" || event.reason === "interrupted") {
          return [
            { type: "run.status", ...base, status: "cancelled" },
            { type: "run.cancelled", ...base },
          ];
        }
        if (event.reason === "error") {
          return [
            { type: "run.status", ...base, status: "failed" },
            {
              type: "run.failed",
              ...base,
              error: protocolError(
                "The runtime ended with an error.",
                "runtime_error",
              ),
            },
          ];
        }
        return [
          { type: "run.status", ...base, status: "completed" },
          { type: "run.completed", ...base, usage: run.usage },
        ];
      default:
        // Core runtimes can widen their event generic with namespaced events.
        // This branch is unreachable for the built-in union but remains the
        // lossless runtime boundary for those host-defined events.
        const customEvent = event as unknown as {
          type: string;
          [key: string]: unknown;
        };
        return [
          {
            type: customEvent.type.startsWith("x-")
              ? (customEvent.type as `x-${string}`)
              : RUNTIME_EVENT_TYPE,
            ...base,
            payload: customEvent,
          },
        ];
    }
  }

  function notifyWhenChanged(
    run: ProtocolRun,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const listener = () => {
        run.listeners.delete(listener);
        signal?.removeEventListener("abort", listener);
        resolve();
      };
      run.listeners.add(listener);
      signal?.addEventListener("abort", listener, { once: true });
    });
  }

  function ensurePump(run: ProtocolRun): void {
    if (run.pumpPromise || run.terminal || !run.turn) return;
    run.pumpPromise = (async () => {
      try {
        for await (const event of run.turn.events) {
          for (const protocolEvent of runtimeEventToProtocolEvents(
            run,
            event,
          )) {
            append(run, protocolEvent);
          }
          if (run.waitingForContinuation) break;
        }
        if (!run.terminal && !run.waitingForContinuation) {
          run.terminal = true;
          append(run, {
            type: "run.failed",
            error: {
              code: "stream_ended",
              message:
                "The runtime stream ended before it reported completion.",
            },
          });
        }
      } catch (error) {
        if (run.terminal) return;
        run.terminal = true;
        append(run, {
          type: "run.failed",
          error: protocolError(error),
        });
      } finally {
        run.pumpPromise = null;
        for (const listener of run.listeners) listener();
        if (!run.terminal && !run.waitingForContinuation) ensurePump(run);
      }
    })();
  }

  async function* readRun(
    run: ProtocolRun,
    afterSequence = 0,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    run.activeReaders += 1;
    touchRun(run);
    let nextSequence = Math.max(1, afterSequence + 1);
    try {
      while (!signal?.aborted) {
        if (nextSequence < run.firstRetainedSequence) {
          throw new Error(
            `AgentKit run ${run.runId} no longer retains sequence ${nextSequence}; the earliest available sequence is ${run.firstRetainedSequence}.`,
          );
        }
        while (nextSequence <= run.sequence) {
          const event = run.events[nextSequence - run.firstRetainedSequence];
          nextSequence += 1;
          if (!event) {
            throw new Error(
              `AgentKit run ${run.runId} is missing retained sequence ${nextSequence - 1}.`,
            );
          }
          yield event;
        }
        if (run.terminal) return;
        await notifyWhenChanged(run, signal);
      }
    } finally {
      run.activeReaders -= 1;
      touchRun(run);
      pruneRetainedRuns();
    }
  }

  async function cancelCoreTurn(
    run: ProtocolRun,
    reason: string,
  ): Promise<Awaited<ReturnType<NonNullable<AgentChatRuntime["cancel"]>>>> {
    if (run.turn.cancel) return run.turn.cancel({ reason });
    if (run.session.cancelTurn) {
      return run.session.cancelTurn({
        turnId: run.turn.id,
        runId: run.turn.runId,
        reason,
      });
    }
    if (runtime.cancel) {
      return runtime.cancel({
        sessionId: run.session.id,
        turnId: run.turn.id,
        runId: run.turn.runId,
        reason,
      });
    }
    return { status: "unsupported" };
  }

  const transport: AgentKitProtocolAdapter = {
    capabilities,
    async getCapabilities() {
      return capabilities;
    },
    async discoverCapabilities(input) {
      const requested = input.requested ?? [...DISCOVERABLE_CAPABILITIES];
      return {
        protocol: negotiateAgentKitProtocolVersion(input.protocol),
        capabilities: requested.map(descriptorForCapability),
        discoveredAt: now(),
        legacy: capabilities,
        metadata: mergeTrustedProtocolMetadata(
          options.metadata,
          input.metadata,
        ),
      };
    },
    async startRun(input) {
      if (disposed) throw new Error("The AgentKit adapter is disposed.");
      const turnMetadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
        input.options?.metadata,
        input.options?.agentId ? { agentId: input.options.agentId } : undefined,
        input.options?.locale ? { locale: input.options.locale } : undefined,
        input.options?.mode ? { mode: input.options.mode } : undefined,
      );
      const session = await getSession(input.threadId, turnMetadata);
      const messages = input.messages.map(protocolMessageToRuntimeMessage);
      const turn = await session.startTurn({
        prompt: latestUserPrompt(input.messages),
        messages,
        model: input.options?.model,
        reasoningEffort: input.options?.reasoningEffort,
        temperature: input.options?.temperature,
        providerOptions: {
          ...(input.options?.toolChoice === undefined
            ? {}
            : { toolChoice: input.options.toolChoice }),
          ...(input.options?.parallelToolCalls === undefined
            ? {}
            : { parallelToolCalls: input.options.parallelToolCalls }),
        },
        metadata: turnMetadata,
      });
      const runId = turn.runId ?? turn.id ?? createId("run");
      const runMetadata = mergeTrustedProtocolMetadata(
        options.metadata,
        turnMetadata,
        turn.metadata,
        {
          [AGENT_NATIVE_PROTOCOL_METADATA_KEY]: {
            observability: {
              protocolRunId: runId,
              runtimeRunId: turn.runId,
              runtimeId: runtime.id,
              sessionId: session.id,
              turnId: turn.id,
              threadId: input.threadId,
            },
          } satisfies AgentNativeProtocolMetadata,
        },
      );
      const run: ProtocolRun = {
        runId,
        threadId: input.threadId,
        session,
        turn,
        events: [],
        firstRetainedSequence: 1,
        sequence: 0,
        status: "queued",
        lastAccessedAtMs: timeMs(),
        activeReaders: 0,
        metadata: runMetadata,
        actions: new Map(),
        activeActivities: new Map(),
        pumpPromise: null,
        continuationPromise: null,
        terminal: false,
        waitingForContinuation: false,
        listeners: new Set(),
      };
      if (disposed) {
        await cancelCoreTurn(run, "adapter-dispose").catch(() => undefined);
        await disposeSession(session).catch(() => undefined);
        throw new Error(
          "The AgentKit adapter was disposed during turn creation.",
        );
      }
      pruneRetainedRuns(run.lastAccessedAtMs);
      runs.set(runId, run);
      append(run, {
        type: "run.started",
        agentId: runtime.id,
        metadata: runMetadata,
      });
      append(run, { type: "run.status", status: "running" });
      ensurePump(run);
      return { runId, capabilities };
    },
    subscribeToRun(input) {
      pruneRetainedRuns();
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId) {
        throw new Error(`Unknown AgentKit run: ${input.runId}`);
      }
      touchRun(run);
      ensurePump(run);
      return readRun(run, input.afterSequence, input.signal);
    },
    async getRun(input) {
      pruneRetainedRuns();
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId) return null;
      touchRun(run);
      return {
        id: run.runId,
        threadId: run.threadId,
        status: run.status,
        lastSequence: run.sequence,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        usage: run.usage,
        error: run.error,
        metadata: run.metadata,
      };
    },
    async cancelRun(input) {
      pruneRetainedRuns();
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId) {
        throw new Error(`Unknown AgentKit run: ${input.runId}`);
      }
      touchRun(run);
      if (run.terminal) return;
      const cancellation = cancelCoreTurn(run, "protocol-cancel");
      run.terminal = true;
      let result;
      try {
        result = await cancellation;
      } catch (error) {
        run.terminal = false;
        ensurePump(run);
        throw error;
      }
      if (result.status === "unsupported") {
        run.terminal = false;
        ensurePump(run);
        throw new Error("The Core runtime does not support run cancellation.");
      }
      append(run, { type: "run.status", status: "cancelled" });
      append(run, { type: "run.cancelled" });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearRetentionTimer();
      const cancellations: Promise<unknown>[] = [];
      for (const run of runs.values()) {
        if (!run.terminal) {
          cancellations.push(cancelCoreTurn(run, "adapter-dispose"));
          append(run, { type: "run.status", status: "cancelled" });
          append(run, { type: "run.cancelled" });
        }
        run.terminal = true;
        for (const listener of run.listeners) listener();
      }
      await Promise.allSettled(cancellations);
      await Promise.allSettled(
        [...sessions.values()].map(async (session) => {
          const resolved = await session;
          await disposeSession(resolved);
        }),
      );
      runs.clear();
      sessions.clear();
    },
  };

  const listSessions = runtime.listSessions;
  if (listSessions) {
    transport.listThreads = async (input) => {
      const sessionsResult = await listSessions({
        threadId: undefined,
        limit: input?.limit,
        cursor: input?.cursor,
        metadata: input?.metadata,
      });
      return {
        threads: sessionsResult.map((session) =>
          runtimeSessionToThread(session, now),
        ),
      };
    };
  }

  if (runtime.capabilities.sessions?.create !== false) {
    transport.createThread = async (input = {}) => {
      const threadId = input.id ?? createId("thread");
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      const session = await runtime.createSession({
        id: threadId,
        threadId,
        title: input.title,
        metadata,
      });
      sessions.set(threadId, Promise.resolve(session));
      const snapshot = session.snapshot ? await session.snapshot() : undefined;
      return runtimeSessionToThread(
        snapshot ?? {
          id: session.id,
          runtimeId: session.runtimeId,
          threadId: session.threadId ?? threadId,
          title: input.title,
          metadata,
        },
        now,
      );
    };
  }

  const getRuntimeSession = runtime.getSession;
  if (getRuntimeSession) {
    transport.getThread = async ({ threadId }) => {
      const session = await getRuntimeSession({ sessionId: threadId });
      if (!session) return null;
      const snapshot = session.snapshot ? await session.snapshot() : undefined;
      return runtimeSessionToThread(
        snapshot ?? {
          id: session.id,
          runtimeId: session.runtimeId,
          threadId: session.threadId,
        },
        now,
      );
    };
    transport.getThreadSnapshot = async ({ threadId }) => {
      const session = await getRuntimeSession({ sessionId: threadId });
      if (!session) return null;
      const snapshot = session.snapshot ? await session.snapshot() : undefined;
      const thread = runtimeSessionToThread(
        snapshot ?? {
          id: session.id,
          runtimeId: session.runtimeId,
          threadId: session.threadId,
        },
        now,
      );
      return {
        ...thread,
        messages: (snapshot?.messages ?? []).map((message) =>
          runtimeMessageToProtocolMessage(message, textFormat),
        ),
      };
    };
    if (runtime.capabilities.sessions?.fork) {
      transport.forkThread = async (input) => {
        const source = await getRuntimeSession({ sessionId: input.threadId });
        if (!source?.snapshot) {
          throw new Error(
            "The Core session cannot be forked without a snapshot.",
          );
        }
        const snapshot = await source.snapshot();
        const sourceMessages = snapshot.messages;
        if (input.fromMessageId && !sourceMessages) {
          throw new Error(
            "The Core session snapshot does not include messages.",
          );
        }
        const throughIndex = input.fromMessageId
          ? sourceMessages?.findIndex(
              (message) => message.id === input.fromMessageId,
            )
          : undefined;
        if (input.fromMessageId && throughIndex === -1) {
          throw new Error(`Unknown message for fork: ${input.fromMessageId}`);
        }
        const messages =
          throughIndex === undefined
            ? sourceMessages
            : sourceMessages?.slice(0, throughIndex + 1);
        const threadId = createId("thread");
        const metadata = mergeTrustedProtocolMetadata(
          options.metadata,
          snapshot.metadata,
          input.metadata,
        );
        const fork = await runtime.createSession({
          id: threadId,
          threadId,
          title: input.title,
          messages,
          resumeState: snapshot.resumeState,
          metadata,
        });
        sessions.set(threadId, Promise.resolve(fork));
        const forkSnapshot = fork.snapshot ? await fork.snapshot() : undefined;
        return runtimeSessionToThread(
          forkSnapshot ?? {
            id: fork.id,
            runtimeId: fork.runtimeId,
            threadId: fork.threadId ?? threadId,
            title: input.title,
            metadata,
          },
          now,
        );
      };
    }
  }

  if (runtime.capabilities.tools?.approvals) {
    transport.resolveApproval = async (input) => {
      pruneRetainedRuns();
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId) {
        throw new Error(`Unknown AgentKit run: ${input.runId}`);
      }
      touchRun(run);
      if (!run.session.continueTurn) {
        throw new Error(
          "The Core runtime does not support approval continuation.",
        );
      }
      if (run.continuationPromise) {
        throw new Error("An approval continuation is already in progress.");
      }
      const continuation = (async () => {
        const activePump = run.pumpPromise;
        if (activePump) await activePump;
        if (run.terminal) {
          throw new Error("The AgentKit run is already terminal.");
        }
        if (!run.waitingForContinuation) {
          throw new Error("The AgentKit run is not awaiting approval.");
        }
        if (run.pendingApprovalId !== input.approvalId) {
          throw new Error(
            `Approval response ${input.approvalId} does not match pending approval ${run.pendingApprovalId ?? "<none>"}.`,
          );
        }
        const decision = explicitApprovalDecision(input.response);
        const approvalInput =
          input.response.other !== undefined
            ? { ...input.response.input, other: input.response.other }
            : input.response.input;
        const nextTurn = await run.session.continueTurn!({
          turnId: run.turn.id,
          approval: {
            id: input.approvalId,
            approved: decision === "approve",
            message: serializeValue(approvalInput),
          },
        });
        run.waitingForContinuation = false;
        run.pendingApprovalId = undefined;
        run.turn = nextTurn;
        append(run, {
          type: "approval.resolved",
          approvalId: input.approvalId,
          optionId: input.optionId,
          response: input.response,
        });
        append(run, { type: "run.status", status: "running" });
        ensurePump(run);
      })();
      run.continuationPromise = continuation;
      try {
        await continuation;
      } finally {
        if (run.continuationPromise === continuation) {
          run.continuationPromise = null;
        }
      }
    };
  }

  if (runtime.capabilities.rich?.connectionRequests) {
    transport.resolveConnectionRequest = async (input) => {
      pruneRetainedRuns();
      const run = runs.get(input.runId);
      if (!run || run.threadId !== input.threadId) {
        throw new Error(`Unknown AgentKit run: ${input.runId}`);
      }
      touchRun(run);
      if (run.pendingConnectionRequestId !== input.requestId) {
        throw new Error(
          `Connection response ${input.requestId} does not match pending request ${run.pendingConnectionRequestId ?? "<none>"}.`,
        );
      }
      const pendingEvent = [...run.events]
        .reverse()
        .find(
          (event) =>
            event.type === "connection.requested" &&
            event.request.id === input.requestId,
        );
      if (!pendingEvent || pendingEvent.type !== "connection.requested") {
        throw new Error(`Unknown connection request: ${input.requestId}`);
      }
      const update = (status: AgentConnectionRequest["status"]) =>
        append(run, {
          type: "connection.updated",
          request: {
            ...pendingEvent.request,
            status,
            updatedAt: now(),
          },
        });
      if (input.response.status === "failed") {
        update("failed");
        return;
      }
      if (!run.session.continueTurn) {
        throw new Error(
          "The Core runtime does not support connection continuation.",
        );
      }
      if (run.continuationPromise) {
        throw new Error("A connection continuation is already in progress.");
      }
      update("connecting");
      const continuation = (async () => {
        const activePump = run.pumpPromise;
        if (activePump) await activePump;
        if (run.terminal) {
          throw new Error("The AgentKit run is already terminal.");
        }
        const nextTurn = await run.session.continueTurn!({
          turnId: run.turn.id,
          connection: {
            id: pendingEvent.request.provider,
            status:
              input.response.status === "connected" ? "connected" : "declined",
            connectionId: input.response.connectionId,
            message: input.response.message,
          },
        });
        run.waitingForContinuation = false;
        run.pendingConnectionRequestId = undefined;
        run.turn = nextTurn;
        update(input.response.status);
        append(run, { type: "run.status", status: "running" });
        ensurePump(run);
      })();
      run.continuationPromise = continuation;
      try {
        await continuation;
      } catch (error) {
        update("failed");
        throw error;
      } finally {
        if (run.continuationPromise === continuation) {
          run.continuationPromise = null;
        }
      }
    };
  }

  const hostOperations = options.operations;
  if (hostOperations?.createThread) {
    transport.createThread = (input = {}, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      const trustedInput = {
        ...input,
        ...(metadata ? { metadata } : {}),
      };
      return context
        ? hostOperations.createThread!(trustedInput, context)
        : hostOperations.createThread!(trustedInput);
    };
  }
  if (hostOperations?.listThreads) {
    transport.listThreads = (input, context) => {
      if (!input) {
        return context
          ? hostOperations.listThreads!(input, context)
          : hostOperations.listThreads!(input);
      }
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      const trustedInput = {
        ...input,
        ...(metadata ? { metadata } : {}),
      };
      return context
        ? hostOperations.listThreads!(trustedInput, context)
        : hostOperations.listThreads!(trustedInput);
    };
  }
  if (hostOperations?.getThread) transport.getThread = hostOperations.getThread;
  if (hostOperations?.getThreadSnapshot)
    transport.getThreadSnapshot = hostOperations.getThreadSnapshot;
  if (hostOperations?.updateThread) {
    transport.updateThread = (input, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      const trustedInput = {
        ...input,
        ...(metadata ? { metadata } : {}),
      };
      return context
        ? hostOperations.updateThread!(trustedInput, context)
        : hostOperations.updateThread!(trustedInput);
    };
  }
  if (hostOperations?.deleteThread)
    transport.deleteThread = hostOperations.deleteThread;
  if (hostOperations?.invokeAction) {
    transport.invokeAction = (input, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.invocation.metadata,
      );
      return hostOperations.invokeAction!(
        {
          ...input,
          invocation: {
            ...input.invocation,
            ...(metadata ? { metadata } : {}),
          },
        },
        context,
      );
    };
  }
  if (hostOperations?.createUpload) {
    transport.createUpload = (input, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.descriptor.metadata,
      );
      return hostOperations.createUpload!(
        {
          ...input,
          descriptor: {
            ...input.descriptor,
            ...(metadata ? { metadata } : {}),
          },
        },
        context,
      );
    };
  }
  if (hostOperations?.completeUpload)
    transport.completeUpload = hostOperations.completeUpload;
  if (hostOperations?.cancelUpload)
    transport.cancelUpload = hostOperations.cancelUpload;
  if (hostOperations?.listQueuedMessages)
    transport.listQueuedMessages = hostOperations.listQueuedMessages;
  if (hostOperations?.queueMessage) {
    transport.queueMessage = (input, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      return hostOperations.queueMessage!(
        {
          ...input,
          ...(metadata ? { metadata } : {}),
        },
        context,
      );
    };
  }
  if (hostOperations?.steerQueuedMessage)
    transport.steerQueuedMessage = hostOperations.steerQueuedMessage;
  if (hostOperations?.removeQueuedMessage)
    transport.removeQueuedMessage = hostOperations.removeQueuedMessage;
  if (hostOperations?.submitFeedback) {
    transport.submitFeedback = (input, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      return hostOperations.submitFeedback!(
        {
          ...input,
          ...(metadata ? { metadata } : {}),
        },
        context,
      );
    };
  }
  if (hostOperations?.forkThread) {
    transport.forkThread = (input, context) => {
      const metadata = mergeTrustedProtocolMetadata(
        options.metadata,
        input.metadata,
      );
      const trustedInput = {
        ...input,
        ...(metadata ? { metadata } : {}),
      };
      return context
        ? hostOperations.forkThread!(trustedInput, context)
        : hostOperations.forkThread!(trustedInput);
    };
  }

  return transport;
}
