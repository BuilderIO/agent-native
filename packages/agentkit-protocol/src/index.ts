import type {
  AgentKitProtocolName,
  AgentKitProtocolVersion,
} from "./version.js";

export {
  AGENTKIT_PROTOCOL_NAME,
  AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS,
  AGENTKIT_PROTOCOL_VERSION,
  isAgentKitProtocolVersion,
  type AgentKitProtocolName,
  type AgentKitProtocolVersion,
} from "./version.js";

/** Stable identifiers are strings so hosts can choose their own ID strategy. */
export type AgentId = string;
export type ThreadId = string;
export type RunId = string;
export type EventId = string;
export type ToolCallId = string;
export type ApprovalId = string;
export type ConnectionRequestId = string;
export type ActionInvocationId = string;
export type UploadId = string;
export type TaskId = string;
export type AgentInteractionId = string;

/**
 * A backend-neutral reference carried across trust, tenancy, and observability
 * boundaries. The referenced system owns resolution and authorization.
 */
export interface AgentProtocolReference {
  id: string;
  kind?: string;
  label?: string;
  uri?: string;
}

/** W3C-compatible trace identity without requiring a tracing implementation. */
export interface AgentTraceReference {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  traceState?: string;
}

/**
 * Portable provenance references for protocol values. Additional legacy keys
 * remain allowed; new non-standard keys should use an `x-*` namespace.
 */
export interface AgentProtocolMetadata extends Record<string, unknown> {
  actor?: AgentProtocolReference;
  workspace?: AgentProtocolReference;
  access?: AgentProtocolReference[];
  audit?: AgentProtocolReference;
  trace?: AgentTraceReference;
  context?: AgentProtocolReference[];
}

export type AgentRole = "user" | "assistant" | "system" | "tool";

export interface TextPart {
  type: "text";
  text: string;
  /** Plain text is the safe default; rich formatting must be explicitly authored. */
  format?: "plain" | "markdown";
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
  /** Concise agent-authored summary shown in the collapsed activity row. */
  label?: string;
  visibility?: "visible" | "summary" | "hidden";
}

export interface CitationPart {
  type: "citation";
  title: string;
  url?: string;
  sourceId?: string;
}

export interface AgentAnnotation {
  id: string;
  kind: "source" | "entity" | "reference" | (string & {});
  label: string;
  url?: string;
  start?: number;
  end?: number;
  metadata?: AgentProtocolMetadata;
}

export interface AnnotationPart {
  type: "annotation";
  annotation: AgentAnnotation;
}

export interface FilePart {
  type: "file";
  name: string;
  mediaType?: string;
  url?: string;
  fileId?: string;
}

export interface AgentWidgetAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger";
  /** Stable action identifier routed through `AgentTransport.invokeAction`. */
  action?: string;
  payload?: unknown;
  disabled?: boolean;
}

export interface AgentWidget {
  id: string;
  kind: string;
  data: unknown;
  title?: string;
  actions?: AgentWidgetAction[];
  state?: "active" | "submitted" | "dismissed" | "expired";
  metadata?: AgentProtocolMetadata;
}

export interface WidgetPart {
  type: "widget";
  widget: AgentWidget;
}

/** Opaque structured content for host-owned renderers and runtime metadata. */
export interface DataPart {
  type: "data";
  data: unknown;
  mediaType?: string;
  title?: string;
}

/** Host-defined message parts keep domain-specific UI out of the base protocol. */
export interface AgentCustomMessagePart {
  type: `x-${string}`;
  [key: string]: unknown;
}

export type AgentMessagePart<
  TCustomPart extends AgentCustomMessagePart = never,
> =
  | TextPart
  | ReasoningPart
  | CitationPart
  | AnnotationPart
  | FilePart
  | WidgetPart
  | DataPart
  | TCustomPart;

export interface AgentMessage<
  TCustomPart extends AgentCustomMessagePart = never,
> {
  id: string;
  role: AgentRole;
  parts: AgentMessagePart<TCustomPart>[];
  createdAt?: string;
  status?: "streaming" | "complete" | "error";
  metadata?: AgentProtocolMetadata;
}

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentToolCall {
  id: ToolCallId;
  name: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: AgentError;
  runId?: RunId;
  messageId?: string;
  agentId?: AgentId;
  metadata?: AgentProtocolMetadata;
}

/** A portable reference that hosts can resolve into files, records, or views. */
export interface AgentObjectReference {
  id: string;
  kind: string;
  label: string;
  uri?: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentWorkScope = "thread" | "workspace" | "external";

export type AgentParticipantStatus =
  | "idle"
  | "working"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "closed";

/**
 * Portable identity and live state for one agent participating in a thread.
 * `origin` identifies the app, workspace, or remote runtime that owns it;
 * hosts retain control of navigation and presentation for that reference.
 */
export interface AgentParticipant {
  id: AgentId;
  name: string;
  kind?: "primary" | "subagent" | "peer" | "external" | (string & {});
  status: AgentParticipantStatus;
  parentAgentId?: AgentId;
  activeTaskId?: TaskId;
  description?: string;
  avatarUrl?: string;
  origin?: AgentObjectReference;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentInteractionKind =
  | "started"
  | "resumed"
  | "messaged"
  | "delegated"
  | "paused"
  | "completed"
  | "failed"
  | "closed"
  | (string & {});

/**
 * Append-only collaboration evidence. Participant events describe current
 * state; interactions explain how agents entered, coordinated, or left work.
 */
export interface AgentInteraction {
  id: AgentInteractionId;
  kind: AgentInteractionKind;
  agentId: AgentId;
  targetAgentId?: AgentId;
  label?: string;
  detail?: string;
  scope?: AgentWorkScope;
  object?: AgentObjectReference;
  source?: AgentObjectReference;
  occurredAt?: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentActivityKind =
  | "status"
  | "reasoning"
  | "model"
  | "search"
  | "read"
  | "write"
  | "edit"
  | "command"
  | "check"
  | "mcp"
  | "connection"
  | "navigation"
  | "delegation"
  | "approval"
  | "tool"
  | (string & {});

/**
 * Infers a conservative presentation kind from a stable tool identifier.
 * Adapters should prefer an explicitly authored activity kind when available.
 */
export function inferAgentActivityKind(toolName: string): AgentActivityKind {
  const normalized = toolName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const tokens = new Set(normalized.split("-").filter(Boolean));
  const hasAny = (...values: string[]) =>
    values.some((value) => tokens.has(value));

  if (
    hasAny("mcp") ||
    (tokens.has("provider") && tokens.has("api") && hasAny("request", "call"))
  ) {
    return "mcp";
  }
  if (
    hasAny(
      "connect",
      "connection",
      "authenticate",
      "authentication",
      "authorize",
      "authorization",
      "reauthorize",
      "oauth",
    )
  ) {
    return "connection";
  }
  if (hasAny("approve", "approval", "consent", "permission")) {
    return "approval";
  }
  if (
    hasAny("delegate", "delegation", "handoff", "subagent") ||
    (tokens.has("agent") && hasAny("message", "resume", "close"))
  ) {
    return "delegation";
  }
  if (hasAny("navigate", "navigation", "route", "open")) {
    return "navigation";
  }
  if (hasAny("search", "searches", "lookup", "find", "query")) {
    return "search";
  }
  if (hasAny("read", "reads", "get", "list", "fetch", "inspect", "view")) {
    return "read";
  }
  if (hasAny("edit", "patch", "replace")) return "edit";
  if (
    hasAny(
      "write",
      "create",
      "update",
      "delete",
      "save",
      "send",
      "publish",
      "upload",
    )
  ) {
    return "write";
  }
  if (hasAny("check", "checks", "verify", "test", "tests", "validate")) {
    return "check";
  }
  if (hasAny("command", "exec", "execute", "shell", "terminal", "bash")) {
    return "command";
  }
  return "tool";
}

export interface AgentActivity {
  id: string;
  kind: AgentActivityKind;
  label: string;
  detail?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  /** Agent responsible for this activity when work is delegated or parallel. */
  agentId?: AgentId;
  runId?: RunId;
  /** Distinguishes transcript-local work from workspace or remote execution. */
  scope?: AgentWorkScope;
  object?: AgentObjectReference;
  source?: AgentObjectReference;
  summary?: AgentMessagePart[];
  startedAt?: string;
  completedAt?: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentTaskStatus =
  | "pending"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A durable unit of agent work. Tasks are intentionally distinct from
 * activities: activities explain execution, while tasks expose delegable work
 * that a host can organize across agents and parent/child workflows.
 */
export interface AgentTask {
  id: TaskId;
  title: string;
  status: AgentTaskStatus;
  kind?: string;
  parentTaskId?: TaskId;
  assignedAgentId?: AgentId;
  runId?: RunId;
  detail?: string;
  progress?: {
    completed: number;
    total: number;
  };
  object?: AgentObjectReference;
  source?: AgentObjectReference;
  summary?: AgentMessagePart[];
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  metadata?: AgentProtocolMetadata;
}

/**
 * Explicit, durable organization for related tasks. A group is presentation
 * metadata over task identities; tasks remain the canonical units of work.
 */
export interface AgentTaskGroup {
  id: string;
  taskIds: TaskId[];
  title?: string;
  status?: AgentTaskStatus;
  runId?: RunId;
  object?: AgentObjectReference;
  source?: AgentObjectReference;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentApprovalRequest {
  id: ApprovalId;
  title: string;
  description?: string;
  kind?: "approval" | "choice" | "input";
  allowMultiple?: boolean;
  /** Choice prompts accept a user-authored alternative by default. */
  allowOther?: boolean;
  options?: Array<{
    id: string;
    label: string;
    description?: string;
    kind?: "primary" | "secondary" | "danger";
  }>;
  input?: {
    id: string;
    label?: string;
    placeholder?: string;
    type?: "text" | "number" | "url";
    required?: boolean;
  };
  expiresAt?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentApprovalResponse {
  decision: "approve" | "deny";
  optionIds?: string[];
  /** User-authored alternative to the predefined options. */
  other?: string;
  input?: Record<string, unknown>;
}

/**
 * Why a host-managed provider connection is required. Action approval remains
 * a separate workflow: this contract only establishes usable connectivity.
 */
export type AgentConnectionRequestReason =
  | "connect"
  | "grant"
  | "reauthorize"
  | "admin_required";

export type AgentConnectionRequestStatus =
  | "requested"
  | "connecting"
  | "connected"
  | "declined"
  | "failed";

/**
 * A provider-agnostic request resolved by the host's trusted connection
 * catalog. URLs, credentials, and OAuth scopes are deliberately absent so an
 * agent cannot author connection authority.
 */
export interface AgentConnectionRequest {
  id: ConnectionRequestId;
  provider: string;
  reason: AgentConnectionRequestReason;
  status: AgentConnectionRequestStatus;
  appId?: string;
  detail?: string;
  source?: AgentProtocolReference;
  createdAt?: string;
  updatedAt?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentConnectionResponse {
  status: "connected" | "declined" | "failed";
  connectionId?: string;
  message?: string;
}

export interface AgentArtifactReference {
  id: string;
  kind: string;
  title?: string;
  url?: string;
  runId?: RunId;
  createdAt?: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type AgentToolChoice = "auto" | "none" | "required" | { name: string };

/** Typed inference and workflow controls attached to one run. */
export interface AgentRunOptions {
  agentId?: AgentId;
  model?: string;
  reasoningEffort?: AgentReasoningEffort;
  toolChoice?: AgentToolChoice;
  temperature?: number;
  locale?: string;
  mode?: string;
  parallelToolCalls?: boolean;
  metadata?: AgentProtocolMetadata;
}

export interface AgentActionInvocation {
  id: ActionInvocationId;
  action: string;
  threadId: ThreadId;
  runId?: RunId;
  messageId?: string;
  widgetId?: string;
  itemId?: string;
  payload?: unknown;
  metadata?: AgentProtocolMetadata;
}

export interface AgentActionResult {
  invocationId: ActionInvocationId;
  status: "completed" | "failed" | "cancelled";
  data?: unknown;
  error?: AgentError;
  metadata?: AgentProtocolMetadata;
}

export interface AgentUploadDescriptor {
  name: string;
  mediaType: string;
  size: number;
  checksum?: string;
  purpose?: "message" | "context" | "artifact" | (string & {});
  metadata?: AgentProtocolMetadata;
}

/**
 * Negotiated upload destination. The protocol never places binary bodies in
 * events or messages; clients upload bytes to this target and then complete it.
 */
export interface AgentUploadTarget {
  uploadId: UploadId;
  method: "POST" | "PUT";
  url: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  expiresAt?: string;
}

export interface AgentUploadProgress {
  uploadId: UploadId;
  loaded: number;
  total: number;
}

/** A provider-neutral next action an agent can publish after a turn. */
export interface AgentSuggestion {
  id: string;
  /** Concise, single-line action label. Put the full instruction in `prompt`. */
  label: string;
  /** Prompt submitted when selected. Defaults to `label`. */
  prompt?: string;
  runId?: RunId;
  updatedAt?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentError {
  code: string;
  message: string;
  retryable?: boolean;
  correlationId?: string;
  details?: unknown;
  metadata?: AgentProtocolMetadata;
}

export interface AgentCapabilityUnsupportedError extends AgentError {
  code: "capability_unsupported";
  capability: AgentCapabilityId;
  retryable: false;
}

export interface AgentCapabilityUnavailableError extends AgentError {
  code: "capability_unavailable";
  capability: AgentCapabilityId;
  retryable: boolean;
}

export interface AgentOperationUnsupportedError extends AgentError {
  code: "operation_unsupported";
  operation: string;
  retryable: false;
}

export interface AgentProtocolVersionUnsupportedError extends AgentError {
  code: "protocol_version_unsupported";
  supportedVersions: AgentKitProtocolVersion[];
  receivedVersions: number[];
  retryable: false;
}

export interface AgentRequestAbortedError extends AgentError {
  code: "request_aborted";
  retryable: false;
}

/**
 * Ephemeral execution context for one transport operation. This context is not
 * part of the JSON wire payload: adapters project it onto their native request
 * mechanism and providers use it to stop abandoned work and correlate traces.
 */
export interface AgentRequestContext {
  /** Cancels this operation only; it never implies cancellation of a run. */
  signal?: AbortSignal;
  /** Stable identity shared by every layer participating in this operation. */
  correlationId?: string;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
  currency?: string;
}

export type AgentCapabilityId =
  | "actions"
  | "activities"
  | "approvals"
  | "artifacts"
  | "attachments"
  | "citations"
  | "clientEffects"
  | "codeExecution"
  | "connectionRequests"
  | "durableThreadSnapshots"
  | "feedback"
  | "messageQueue"
  | "modelSelection"
  | "multiAgentActivity"
  | "reasoning"
  | "resumableRuns"
  | "smartObjects"
  | "suggestions"
  | "taskGroups"
  | "threadForking"
  | "threadHistory"
  | "toolSelection"
  | "uploads"
  | "widgets"
  | `x-${string}`;

/**
 * Capability status is explicit: unsupported is permanent for this protocol
 * endpoint, while unavailable may recover without renegotiating the protocol.
 */
export type AgentCapabilityState =
  | "available"
  | "degraded"
  | "unavailable"
  | "unsupported";

export interface AgentCapabilityDescriptorBase {
  id: AgentCapabilityId;
  /** Human-readable operational context; clients must branch on `state`. */
  description?: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentCapabilityDescriptor =
  | (AgentCapabilityDescriptorBase & {
      state: "available";
      error?: never;
    })
  | (AgentCapabilityDescriptorBase & {
      state: "degraded" | "unavailable";
      error: AgentCapabilityUnavailableError;
    })
  | (AgentCapabilityDescriptorBase & {
      state: "unsupported";
      error: AgentCapabilityUnsupportedError;
    });

export interface AgentProtocolVersionOffer {
  protocol: AgentKitProtocolName;
  /** Positive, unique protocol versions understood by the caller. */
  versions: number[];
}

export type AgentProtocolCompatibility =
  | {
      status: "compatible";
      selectedVersion: AgentKitProtocolVersion;
      localVersions: AgentKitProtocolVersion[];
      peerVersions: number[];
    }
  | {
      status: "incompatible";
      localVersions: AgentKitProtocolVersion[];
      peerVersions: number[];
      error: AgentProtocolVersionUnsupportedError;
    };

export interface DiscoverCapabilitiesInput {
  protocol: AgentProtocolVersionOffer;
  requested?: AgentCapabilityId[];
  metadata?: AgentProtocolMetadata;
}

export interface AgentCapabilitiesDiscovery {
  protocol: AgentProtocolCompatibility;
  capabilities: AgentCapabilityDescriptor[];
  discoveredAt: string;
  expiresAt?: string;
  /** Optional projection for clients implementing the original boolean map. */
  legacy?: AgentCapabilities;
  metadata?: AgentProtocolMetadata;
}

/**
 * Backward-compatible capability projection. `true` means available, `false`
 * means unsupported, and omission means unknown. New transports should also
 * expose `discoverCapabilities` for degraded and temporarily unavailable state.
 */
export interface AgentCapabilities {
  protocolVersion?: AgentKitProtocolVersion;
  actions?: boolean;
  activities?: boolean;
  approvals?: boolean;
  artifacts?: boolean;
  attachments?: boolean;
  citations?: boolean;
  codeExecution?: boolean;
  connectionRequests?: boolean;
  durableThreadSnapshots?: boolean;
  feedback?: boolean;
  widgets?: boolean;
  uploads?: boolean;
  clientEffects?: boolean;
  modelSelection?: boolean;
  toolSelection?: boolean;
  threadHistory?: boolean;
  threadForking?: boolean;
  messageQueue?: boolean;
  multiAgentActivity?: boolean;
  reasoning?: "none" | "summary" | "full";
  resumableRuns?: boolean;
  taskGroups?: boolean;
  suggestions?: boolean;
  smartObjects?: boolean;
  [extension: `x-${string}`]: unknown;
}

export interface AgentEventBase {
  id: EventId;
  threadId: ThreadId;
  runId: RunId;
  sequence: number;
  occurredAt: string;
  metadata?: AgentProtocolMetadata;
}

export type AgentEvent =
  | (AgentEventBase & { type: "run.started"; agentId?: AgentId })
  | (AgentEventBase & { type: "run.status"; status: AgentRunStatus })
  | (AgentEventBase & {
      type: "agent.registered" | "agent.updated" | "agent.unregistered";
      agent: AgentParticipant;
    })
  | (AgentEventBase & {
      type: "agent.interaction";
      interaction: AgentInteraction;
    })
  | (AgentEventBase & { type: "message.created"; message: AgentMessage })
  | (AgentEventBase & {
      type: "message.delta";
      messageId: string;
      text: string;
      format?: TextPart["format"];
    })
  | (AgentEventBase & {
      type: "message.completed";
      message: AgentMessage;
    })
  | (AgentEventBase & {
      type: "reasoning.delta";
      messageId: string;
      text: string;
    })
  | (AgentEventBase & { type: "tool.started"; toolCall: AgentToolCall })
  | (AgentEventBase & {
      type: "tool.delta";
      toolCallId: ToolCallId;
      inputTextDelta?: string;
      outputTextDelta?: string;
    })
  | (AgentEventBase & { type: "tool.updated"; toolCall: AgentToolCall })
  | (AgentEventBase & {
      type: "activity.started" | "activity.updated" | "activity.completed";
      activity: AgentActivity;
    })
  | (AgentEventBase & {
      type: "task.created" | "task.updated" | "task.completed";
      task: AgentTask;
    })
  | (AgentEventBase & {
      type:
        | "task-group.created"
        | "task-group.updated"
        | "task-group.completed";
      taskGroup: AgentTaskGroup;
    })
  | (AgentEventBase & {
      type: "task-group.removed";
      taskGroupId: string;
    })
  | (AgentEventBase & {
      type: "approval.requested";
      request: AgentApprovalRequest;
    })
  | (AgentEventBase & {
      type: "approval.resolved";
      approvalId: ApprovalId;
      optionId?: string;
      response: AgentApprovalResponse;
    })
  | (AgentEventBase & {
      type: "connection.requested" | "connection.updated";
      request: AgentConnectionRequest;
    })
  | (AgentEventBase & {
      type: "artifact.created";
      artifact: AgentArtifactReference;
    })
  | (AgentEventBase & {
      type: "widget.created" | "widget.updated";
      messageId?: string;
      widget: AgentWidget;
    })
  | (AgentEventBase & {
      type: "widget.removed";
      widgetId: string;
    })
  | (AgentEventBase & {
      type: "annotation.created";
      messageId?: string;
      annotation: AgentAnnotation;
    })
  | (AgentEventBase & {
      type: "annotation.updated";
      messageId?: string;
      annotation: AgentAnnotation;
    })
  | (AgentEventBase & {
      type: "annotation.removed";
      annotationId: string;
    })
  | (AgentEventBase & {
      type: "suggestions.updated";
      suggestions: AgentSuggestion[];
    })
  | (AgentEventBase & {
      type: "action.started";
      invocation: AgentActionInvocation;
    })
  | (AgentEventBase & {
      type: "action.completed" | "action.failed";
      result: AgentActionResult;
    })
  | (AgentEventBase & {
      type: "upload.progress";
      progress: AgentUploadProgress;
    })
  | (AgentEventBase & {
      type: "client.effect" | "client.deeplink";
      name: string;
      data?: Record<string, unknown>;
    })
  | (AgentEventBase & {
      type: "thread.updated";
      thread: AgentThread;
    })
  | (AgentEventBase & {
      type: "queue.updated";
      messages: AgentQueuedMessage[];
    })
  | (AgentEventBase & { type: "run.completed"; usage?: AgentUsage })
  | (AgentEventBase & { type: "run.failed"; error: AgentError })
  | (AgentEventBase & { type: "run.cancelled" })
  | (AgentEventBase & { type: `x-${string}`; payload: unknown });

export interface AgentThread {
  id: ThreadId;
  title?: string;
  createdAt: string;
  updatedAt: string;
  status?: "active" | "archived" | "deleted";
  metadata?: AgentProtocolMetadata;
}

export interface AgentApprovalSnapshot {
  request: AgentApprovalRequest;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  runId?: RunId;
  response?: AgentApprovalResponse;
  resolvedAt?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentConnectionRequestSnapshot {
  request: AgentConnectionRequest;
  runId?: RunId;
}

export interface AgentWidgetSnapshot {
  messageId: string;
  widget: AgentWidget;
}

export interface AgentAnnotationSnapshot {
  messageId: string;
  annotation: AgentAnnotation;
}

/** Cursor proving exactly how far each run is represented by a snapshot. */
export interface AgentReplayCheckpoint {
  id: string;
  capturedAt: string;
  sequenceByRun: Record<RunId, number>;
  cursor?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentThreadSnapshot extends AgentThread {
  messages: AgentMessage[];
  queuedMessages?: AgentQueuedMessage[];
  /**
   * Ordered durable events used to rebuild rich activity, approvals, widgets,
   * agents, and suggestions without inventing a second projection format.
   */
  events?: AgentEvent[];
  /** Run checkpoints paired with the event log for efficient reconnects. */
  runs?: AgentRunSnapshot[];
  activeRunIds?: RunId[];
  checkpoint?: AgentReplayCheckpoint;
  toolCalls?: AgentToolCall[];
  activities?: AgentActivity[];
  tasks?: AgentTask[];
  taskGroups?: AgentTaskGroup[];
  approvals?: AgentApprovalSnapshot[];
  connectionRequests?: AgentConnectionRequestSnapshot[];
  widgets?: AgentWidgetSnapshot[];
  annotations?: AgentAnnotationSnapshot[];
  agents?: AgentParticipant[];
  interactions?: AgentInteraction[];
  artifacts?: AgentArtifactReference[];
  suggestions?: AgentSuggestion[];
}

/**
 * Canonical, restart-safe thread state. Every projection is required so an
 * empty list is distinguishable from data omitted by a partial legacy host.
 */
export interface AgentDurableThreadSnapshot extends AgentThreadSnapshot {
  checkpoint: AgentReplayCheckpoint;
  queuedMessages: AgentQueuedMessage[];
  events: AgentEvent[];
  runs: AgentRunSnapshot[];
  activeRunIds: RunId[];
  toolCalls: AgentToolCall[];
  activities: AgentActivity[];
  tasks: AgentTask[];
  taskGroups: AgentTaskGroup[];
  approvals: AgentApprovalSnapshot[];
  widgets: AgentWidgetSnapshot[];
  annotations: AgentAnnotationSnapshot[];
  agents: AgentParticipant[];
  interactions: AgentInteraction[];
  artifacts: AgentArtifactReference[];
  suggestions: AgentSuggestion[];
}

export interface AgentRunSnapshot {
  id: RunId;
  threadId: ThreadId;
  status: AgentRunStatus;
  lastSequence: number;
  startedAt?: string;
  completedAt?: string;
  usage?: AgentUsage;
  error?: AgentError;
  metadata?: AgentProtocolMetadata;
}

export interface AgentQueuedMessage {
  id: string;
  threadId: ThreadId;
  text: string;
  createdAt: string;
  attachments?: FilePart[];
  metadata?: AgentProtocolMetadata;
}

export interface ListThreadsInput {
  limit?: number;
  cursor?: string;
  metadata?: AgentProtocolMetadata;
}

export interface ListThreadsResult {
  threads: AgentThread[];
  nextCursor?: string;
}

export interface ThreadIdInput {
  threadId: ThreadId;
}

export interface ThreadMessageInput extends ThreadIdInput {
  messageId: string;
}

export interface CreateThreadInput {
  id?: ThreadId;
  title?: string;
  metadata?: AgentProtocolMetadata;
}

export interface UpdateThreadInput extends ThreadIdInput {
  title?: string;
  status?: "active" | "archived";
  metadata?: AgentProtocolMetadata;
}

export interface ForkThreadInput extends ThreadIdInput {
  fromMessageId?: string;
  title?: string;
  metadata?: AgentProtocolMetadata;
}

export interface QueueMessageInput {
  threadId: ThreadId;
  text: string;
  attachments?: FilePart[];
  metadata?: AgentProtocolMetadata;
}

export interface QueueMessageResult {
  message: AgentQueuedMessage;
}

/**
 * A queue promotion may join an already-streaming run or start a new run.
 * Returning a run result tells the client to subscribe to that promoted work;
 * returning void preserves transports that acknowledge through queue events.
 */
export type SteerQueuedMessageResult = StartRunResult | void;

export interface AgentTransportThreadOperations {
  createThread?(
    input?: CreateThreadInput,
    context?: AgentRequestContext,
  ): Promise<AgentThread>;
  listThreads?(
    input?: ListThreadsInput,
    context?: AgentRequestContext,
  ): Promise<ListThreadsResult>;
  getThread?(
    input: ThreadIdInput,
    context?: AgentRequestContext,
  ): Promise<AgentThread | null>;
  getThreadSnapshot?(
    input: ThreadIdInput,
    context?: AgentRequestContext,
  ): Promise<AgentThreadSnapshot | null>;
  updateThread?(
    input: UpdateThreadInput,
    context?: AgentRequestContext,
  ): Promise<AgentThread>;
  forkThread?(
    input: ForkThreadInput,
    context?: AgentRequestContext,
  ): Promise<AgentThread>;
  deleteThread?(
    input: ThreadIdInput,
    context?: AgentRequestContext,
  ): Promise<void>;
  listQueuedMessages?(
    input: ThreadIdInput,
    context?: AgentRequestContext,
  ): Promise<AgentQueuedMessage[]>;
  queueMessage?(
    input: QueueMessageInput,
    context?: AgentRequestContext,
  ): Promise<QueueMessageResult>;
  /**
   * Accepts a queued item into agent work. A transport can return a new run to
   * subscribe to, or acknowledge through `message.created` and `queue.updated`
   * events on an existing run. A rejected command leaves the item queued.
   */
  steerQueuedMessage?(
    input: ThreadMessageInput,
    context?: AgentRequestContext,
  ): Promise<SteerQueuedMessageResult>;
  removeQueuedMessage?(
    input: ThreadMessageInput,
    context?: AgentRequestContext,
  ): Promise<void>;
}

export interface AgentTransport extends AgentTransportThreadOperations {
  /**
   * Releases resources owned by this transport. Clients must call this only
   * when they explicitly own the transport; shared transports are borrowed.
   */
  dispose?(): void | Promise<void>;
  capabilities?: AgentCapabilities;
  /** @deprecated Prefer `discoverCapabilities` for explicit status semantics. */
  getCapabilities?(context?: AgentRequestContext): Promise<AgentCapabilities>;
  discoverCapabilities?(
    input: DiscoverCapabilitiesInput,
    context?: AgentRequestContext,
  ): Promise<AgentCapabilitiesDiscovery>;
  startRun(
    input: StartRunInput,
    context?: AgentRequestContext,
  ): Promise<StartRunResult>;
  subscribeToRun(input: SubscribeToRunInput): AsyncIterable<AgentEvent>;
  cancelRun(
    input: CancelRunInput,
    context?: AgentRequestContext,
  ): Promise<void>;
  resolveApproval?(
    input: ResolveApprovalInput,
    context?: AgentRequestContext,
  ): Promise<void>;
  resolveConnectionRequest?(
    input: ResolveConnectionRequestInput,
    context?: AgentRequestContext,
  ): Promise<void>;
  getRun?(
    input: GetRunInput,
    context?: AgentRequestContext,
  ): Promise<AgentRunSnapshot | null>;
  invokeAction?(
    input: InvokeActionInput,
    context?: AgentRequestContext,
  ): Promise<AgentActionResult>;
  createUpload?(
    input: CreateUploadInput,
    context?: AgentRequestContext,
  ): Promise<AgentUploadTarget>;
  completeUpload?(
    input: CompleteUploadInput,
    context?: AgentRequestContext,
  ): Promise<FilePart>;
  cancelUpload?(
    input: CancelUploadInput,
    context?: AgentRequestContext,
  ): Promise<void>;
  submitFeedback?(
    input: SubmitFeedbackInput,
    context?: AgentRequestContext,
  ): Promise<void>;
}

export interface StartRunInput {
  threadId: ThreadId;
  messages: AgentMessage[];
  options?: AgentRunOptions;
  metadata?: AgentProtocolMetadata;
}

export interface StartRunResult {
  runId: RunId;
  capabilities?: AgentCapabilities;
}

export interface SubscribeToRunInput {
  threadId: ThreadId;
  runId: RunId;
  afterSequence?: number;
  /**
   * Cancels only this subscription. Implementations must stop iteration and
   * release transport resources; they must not cancel the remote run.
   */
  signal?: AbortSignal;
}

export interface CancelRunInput {
  threadId: ThreadId;
  runId: RunId;
}

export interface ResolveApprovalInput {
  threadId: ThreadId;
  runId: RunId;
  approvalId: ApprovalId;
  /** Kept for simple approval consumers; use `response` for choices or input. */
  optionId?: string;
  response: AgentApprovalResponse;
}

export interface ResolveConnectionRequestInput {
  threadId: ThreadId;
  runId: RunId;
  requestId: ConnectionRequestId;
  response: AgentConnectionResponse;
}

export interface GetRunInput {
  threadId: ThreadId;
  runId: RunId;
}

export interface InvokeActionInput {
  invocation: AgentActionInvocation;
}

export interface CreateUploadInput {
  threadId: ThreadId;
  descriptor: AgentUploadDescriptor;
}

export interface CompleteUploadInput {
  threadId: ThreadId;
  uploadId: UploadId;
}

export interface CancelUploadInput extends CompleteUploadInput {}

export interface SubmitFeedbackInput {
  threadId: ThreadId;
  messageId: string;
  value: "positive" | "negative" | "dismissed";
  reason?: string;
  metadata?: AgentProtocolMetadata;
}

export interface AgentProtocolEnvelope<TPayload = unknown> {
  protocol: AgentKitProtocolName;
  version: AgentKitProtocolVersion;
  kind: "request" | "response" | "event" | "error";
  correlationId?: string;
  metadata?: AgentProtocolMetadata;
  payload: TPayload;
}

export * from "./validation.js";
export * from "./compatibility.js";
export * from "./errors.js";
