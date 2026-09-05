import {
  type AgentActivity,
  type AgentAnnotation,
  type AgentAnnotationSnapshot,
  type AgentApprovalRequest,
  type AgentApprovalResponse,
  type AgentApprovalSnapshot,
  type AgentConnectionRequest,
  type AgentConnectionRequestSnapshot,
  type AgentConnectionResponse,
  type AgentArtifactReference,
  type CancelRunInput,
  type CompleteUploadInput,
  type CreateThreadInput,
  type CreateUploadInput,
  type DiscoverCapabilitiesInput,
  type ForkThreadInput,
  type GetRunInput,
  type InvokeActionInput,
  type ListThreadsInput,
  type QueueMessageInput,
  type ResolveApprovalInput,
  type ResolveConnectionRequestInput,
  type SubscribeToRunInput,
  type SubmitFeedbackInput,
  type ThreadId,
  type ThreadIdInput,
  type ThreadMessageInput,
  type UpdateThreadInput,
  type AgentCapabilities,
  type AgentCapabilitiesDiscovery,
  type AgentCapabilityDescriptor,
  type AgentActionResult,
  type AgentDurableThreadSnapshot,
  type AgentError,
  type AgentEvent,
  type AgentInteraction,
  type AgentObjectReference,
  type AgentParticipant,
  type AgentProtocolCompatibility,
  type AgentProtocolMetadata,
  type AgentRequestContext,
  type AgentProtocolVersionOffer,
  type AgentQueuedMessage,
  type AgentReplayCheckpoint,
  type RunId,
  type AgentRunSnapshot,
  type AgentSuggestion,
  type AgentTask,
  type AgentTaskGroup,
  type AgentThread,
  type AgentThreadSnapshot,
  type AgentToolCall,
  type AgentUploadTarget,
  type AgentUsage,
  type AgentWidget,
  type AgentWidgetSnapshot,
  type FilePart,
  type ListThreadsResult,
  type AgentMessage,
  type AgentMessagePart,
  type AgentProtocolEnvelope,
  type AgentRunOptions,
  type QueueMessageResult,
  type StartRunInput,
  type StartRunResult,
  type SteerQueuedMessageResult,
} from "./index.js";
import {
  AGENTKIT_PROTOCOL_NAME,
  AGENTKIT_PROTOCOL_VERSION,
  isAgentKitProtocolVersion,
} from "./version.js";

type UnknownRecord = Record<string, unknown>;

export class AgentProtocolValidationError extends Error {
  public readonly path: string;

  public constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "AgentProtocolValidationError";
    this.path = path;
  }
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentProtocolValidationError(path, "expected an object");
  }
  return value as UnknownRecord;
}

function knownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new AgentProtocolValidationError(
        `${path}.${key}`,
        "is not defined by this protocol version",
      );
    }
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentProtocolValidationError(path, "expected a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new AgentProtocolValidationError(path, "expected a string");
  }
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") {
    throw new AgentProtocolValidationError(path, "expected a boolean");
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AgentProtocolValidationError(path, "expected a finite number");
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new AgentProtocolValidationError(
      path,
      "expected a non-negative safe integer",
    );
  }
  return Number(value);
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new AgentProtocolValidationError(
      path,
      "expected a positive safe integer",
    );
  }
  return Number(value);
}

function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      parsed,
    ) ||
    Number.isNaN(Date.parse(parsed))
  ) {
    throw new AgentProtocolValidationError(
      path,
      "expected an RFC 3339 timestamp",
    );
  }
  return parsed;
}

function optionalTimestamp(value: unknown, path: string): void {
  if (value !== undefined) timestamp(value, path);
}

function validateJsonValue(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (depth > 64) {
    throw new AgentProtocolValidationError(path, "exceeded maximum JSON depth");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    finiteNumber(value, path);
    return;
  }
  if (typeof value !== "object") {
    throw new AgentProtocolValidationError(path, "expected a JSON value");
  }
  if (ancestors.has(value)) {
    throw new AgentProtocolValidationError(path, "must not contain cycles");
  }
  if (
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) !== "[object Object]"
  ) {
    throw new AgentProtocolValidationError(
      path,
      "expected a plain JSON object",
    );
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateJsonValue(entry, `${path}[${index}]`, ancestors, depth + 1),
    );
  } else {
    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function validateProtocolReference(value: unknown, path: string): void {
  const reference = record(value, path);
  string(reference.id, `${path}.id`);
  optionalString(reference.kind, `${path}.kind`);
  optionalString(reference.label, `${path}.label`);
  optionalString(reference.uri, `${path}.uri`);
}

export function parseAgentProtocolMetadata(
  value: unknown,
  path = "metadata",
): AgentProtocolMetadata {
  const metadata = record(value, path);
  validateJsonValue(metadata, path);
  if (metadata.actor !== undefined) {
    validateProtocolReference(metadata.actor, `${path}.actor`);
  }
  if (metadata.workspace !== undefined) {
    validateProtocolReference(metadata.workspace, `${path}.workspace`);
  }
  if (metadata.access !== undefined) {
    array(metadata.access, `${path}.access`).forEach((reference, index) =>
      validateProtocolReference(reference, `${path}.access[${index}]`),
    );
  }
  if (metadata.audit !== undefined) {
    validateProtocolReference(metadata.audit, `${path}.audit`);
  }
  if (metadata.trace !== undefined) {
    const trace = record(metadata.trace, `${path}.trace`);
    string(trace.traceId, `${path}.trace.traceId`);
    optionalString(trace.spanId, `${path}.trace.spanId`);
    optionalString(trace.parentSpanId, `${path}.trace.parentSpanId`);
    optionalString(trace.traceState, `${path}.trace.traceState`);
  }
  if (metadata.context !== undefined) {
    array(metadata.context, `${path}.context`).forEach((reference, index) =>
      validateProtocolReference(reference, `${path}.context[${index}]`),
    );
  }
  return value as AgentProtocolMetadata;
}

function optionalMetadata(value: unknown, path: string): void {
  if (value !== undefined) parseAgentProtocolMetadata(value, path);
}

function validateObjectReference(value: unknown, path: string): void {
  const object = record(value, path);
  string(object.id, `${path}.id`);
  string(object.kind, `${path}.kind`);
  string(object.label, `${path}.label`);
  optionalString(object.uri, `${path}.uri`);
  optionalMetadata(object.metadata, `${path}.metadata`);
}

export function parseAgentObjectReference(
  value: unknown,
  path = "objectReference",
): AgentObjectReference {
  validateObjectReference(value, path);
  return value as AgentObjectReference;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AgentProtocolValidationError(path, "expected an array");
  }
  return value;
}

function identifierFields(value: UnknownRecord, path: string): void {
  string(value.id, `${path}.id`);
  string(value.threadId, `${path}.threadId`);
  string(value.runId, `${path}.runId`);
}

function validateAnnotation(value: unknown, path: string): void {
  const annotation = record(value, path);
  string(annotation.id, `${path}.id`);
  string(annotation.kind, `${path}.kind`);
  string(annotation.label, `${path}.label`);
  optionalString(annotation.url, `${path}.url`);
  if (annotation.start !== undefined) {
    nonNegativeSafeInteger(annotation.start, `${path}.start`);
  }
  if (annotation.end !== undefined) {
    nonNegativeSafeInteger(annotation.end, `${path}.end`);
  }
  if (
    annotation.start !== undefined &&
    annotation.end !== undefined &&
    Number(annotation.start) > Number(annotation.end)
  ) {
    throw new AgentProtocolValidationError(
      path,
      "annotation start must not exceed end",
    );
  }
  optionalMetadata(annotation.metadata, `${path}.metadata`);
}

export function parseAgentAnnotation(
  value: unknown,
  path = "annotation",
): AgentAnnotation {
  validateAnnotation(value, path);
  return value as AgentAnnotation;
}

export function parseAgentWidget(value: unknown, path = "widget"): AgentWidget {
  const widget = record(value, path);
  string(widget.id, `${path}.id`);
  string(widget.kind, `${path}.kind`);
  if (!("data" in widget)) {
    throw new AgentProtocolValidationError(`${path}.data`, "is required");
  }
  validateJsonValue(widget.data, `${path}.data`);
  optionalString(widget.title, `${path}.title`);
  if (widget.actions !== undefined) {
    array(widget.actions, `${path}.actions`).forEach((value, index) => {
      const action = record(value, `${path}.actions[${index}]`);
      string(action.id, `${path}.actions[${index}].id`);
      string(action.label, `${path}.actions[${index}].label`);
      optionalString(action.action, `${path}.actions[${index}].action`);
      if (
        action.kind !== undefined &&
        !new Set(["primary", "secondary", "danger"]).has(String(action.kind))
      ) {
        throw new AgentProtocolValidationError(
          `${path}.actions[${index}].kind`,
          "unsupported widget action kind",
        );
      }
      if (action.payload !== undefined) {
        validateJsonValue(action.payload, `${path}.actions[${index}].payload`);
      }
      if (action.disabled !== undefined) {
        boolean(action.disabled, `${path}.actions[${index}].disabled`);
      }
    });
  }
  if (
    widget.state !== undefined &&
    !new Set(["active", "submitted", "dismissed", "expired"]).has(
      String(widget.state),
    )
  ) {
    throw new AgentProtocolValidationError(
      `${path}.state`,
      "unsupported widget state",
    );
  }
  optionalMetadata(widget.metadata, `${path}.metadata`);
  return value as AgentWidget;
}

function validateMessagePart(value: unknown, path: string): void {
  const part = record(value, path);
  const type = string(part.type, `${path}.type`);

  switch (type) {
    case "text":
      if (typeof part.text !== "string") {
        throw new AgentProtocolValidationError(
          `${path}.text`,
          "expected a string",
        );
      }
      if (
        part.format !== undefined &&
        part.format !== "plain" &&
        part.format !== "markdown"
      ) {
        throw new AgentProtocolValidationError(
          `${path}.format`,
          "expected plain or markdown",
        );
      }
      return;
    case "reasoning":
      if (typeof part.text !== "string") {
        throw new AgentProtocolValidationError(
          `${path}.text`,
          "expected a string",
        );
      }
      optionalString(part.label, `${path}.label`);
      if (
        part.visibility !== undefined &&
        !new Set(["visible", "summary", "hidden"]).has(String(part.visibility))
      ) {
        throw new AgentProtocolValidationError(
          `${path}.visibility`,
          "unsupported reasoning visibility",
        );
      }
      return;
    case "citation":
      string(part.title, `${path}.title`);
      optionalString(part.url, `${path}.url`);
      optionalString(part.sourceId, `${path}.sourceId`);
      return;
    case "annotation": {
      validateAnnotation(part.annotation, `${path}.annotation`);
      return;
    }
    case "file":
      string(part.name, `${path}.name`);
      optionalString(part.url, `${path}.url`);
      optionalString(part.fileId, `${path}.fileId`);
      optionalString(part.mediaType, `${path}.mediaType`);
      if (part.url === undefined && part.fileId === undefined) {
        throw new AgentProtocolValidationError(
          path,
          "a file part requires either url or fileId",
        );
      }
      return;
    case "widget": {
      parseAgentWidget(part.widget, `${path}.widget`);
      return;
    }
    case "data":
      if (!("data" in part)) {
        throw new AgentProtocolValidationError(`${path}.data`, "is required");
      }
      validateJsonValue(part.data, `${path}.data`);
      optionalString(part.mediaType, `${path}.mediaType`);
      optionalString(part.title, `${path}.title`);
      return;
    default:
      if (type.startsWith("x-") && type.length > 2) {
        validateJsonValue(part, path);
        return;
      }
      throw new AgentProtocolValidationError(
        `${path}.type`,
        `unsupported message part type ${JSON.stringify(type)}`,
      );
  }
}

export function parseAgentMessage(
  value: unknown,
  path = "message",
): AgentMessage {
  const message = record(value, path);
  string(message.id, `${path}.id`);
  const role = string(message.role, `${path}.role`);
  if (!new Set(["user", "assistant", "system", "tool"]).has(role)) {
    throw new AgentProtocolValidationError(
      `${path}.role`,
      `unsupported role ${JSON.stringify(role)}`,
    );
  }
  array(message.parts, `${path}.parts`).forEach((part, index) =>
    validateMessagePart(part, `${path}.parts[${index}]`),
  );
  optionalTimestamp(message.createdAt, `${path}.createdAt`);
  if (
    message.status !== undefined &&
    !new Set(["streaming", "complete", "error"]).has(String(message.status))
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported message status",
    );
  }
  optionalMetadata(message.metadata, `${path}.metadata`);
  return value as AgentMessage;
}

export function parseFilePart(value: unknown, path = "file"): FilePart {
  validateMessagePart(value, path);
  if (record(value, path).type !== "file") {
    throw new AgentProtocolValidationError(`${path}.type`, "expected file");
  }
  return value as FilePart;
}

export function parseAgentThread(value: unknown, path = "thread"): AgentThread {
  const thread = record(value, path);
  string(thread.id, `${path}.id`);
  optionalString(thread.title, `${path}.title`);
  timestamp(thread.createdAt, `${path}.createdAt`);
  timestamp(thread.updatedAt, `${path}.updatedAt`);
  if (
    thread.status !== undefined &&
    !new Set(["active", "archived", "deleted"]).has(String(thread.status))
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported thread status",
    );
  }
  optionalMetadata(thread.metadata, `${path}.metadata`);
  return value as AgentThread;
}

export function parseNullableAgentThread(
  value: unknown,
  path = "thread",
): AgentThread | null {
  return value === null ? null : parseAgentThread(value, path);
}

export function parseAgentQueuedMessage(
  value: unknown,
  path = "queuedMessage",
): AgentQueuedMessage {
  const message = record(value, path);
  string(message.id, `${path}.id`);
  string(message.threadId, `${path}.threadId`);
  if (typeof message.text !== "string") {
    throw new AgentProtocolValidationError(`${path}.text`, "expected a string");
  }
  timestamp(message.createdAt, `${path}.createdAt`);
  if (message.attachments !== undefined) {
    array(message.attachments, `${path}.attachments`).forEach(
      (attachment, index) =>
        parseFilePart(attachment, `${path}.attachments[${index}]`),
    );
  }
  optionalMetadata(message.metadata, `${path}.metadata`);
  return value as AgentQueuedMessage;
}

export function parseAgentQueuedMessages(
  value: unknown,
  path = "queuedMessages",
): AgentQueuedMessage[] {
  return array(value, path).map((message, index) =>
    parseAgentQueuedMessage(message, `${path}[${index}]`),
  );
}

const KNOWN_CAPABILITY_IDS = new Set([
  "actions",
  "activities",
  "approvals",
  "artifacts",
  "attachments",
  "citations",
  "clientEffects",
  "codeExecution",
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
]);

function capabilityId(value: unknown, path: string): string {
  const id = string(value, path);
  if (
    !KNOWN_CAPABILITY_IDS.has(id) &&
    !(id.startsWith("x-") && id.length > 2)
  ) {
    throw new AgentProtocolValidationError(
      path,
      "unknown capabilities must use an x- namespace",
    );
  }
  return id;
}

export function parseAgentError(value: unknown, path = "error"): AgentError {
  const error = record(value, path);
  const code = string(error.code, `${path}.code`);
  string(error.message, `${path}.message`);
  if (error.retryable !== undefined) {
    boolean(error.retryable, `${path}.retryable`);
  }
  optionalString(error.correlationId, `${path}.correlationId`);
  if (error.details !== undefined) {
    validateJsonValue(error.details, `${path}.details`);
  }
  optionalMetadata(error.metadata, `${path}.metadata`);
  if (code === "capability_unsupported" || code === "capability_unavailable") {
    capabilityId(error.capability, `${path}.capability`);
    if (typeof error.retryable !== "boolean") {
      throw new AgentProtocolValidationError(
        `${path}.retryable`,
        "is required for capability errors",
      );
    }
    if (code === "capability_unsupported" && error.retryable !== false) {
      throw new AgentProtocolValidationError(
        `${path}.retryable`,
        "unsupported capabilities are not retryable",
      );
    }
  }
  if (code === "operation_unsupported") {
    string(error.operation, `${path}.operation`);
    if (error.retryable !== false) {
      throw new AgentProtocolValidationError(
        `${path}.retryable`,
        "unsupported operations are not retryable",
      );
    }
  }
  if (code === "protocol_version_unsupported") {
    const supportedVersions = array(
      error.supportedVersions,
      `${path}.supportedVersions`,
    );
    supportedVersions.forEach((version, index) => {
      positiveSafeInteger(version, `${path}.supportedVersions[${index}]`);
      if (!isAgentKitProtocolVersion(version)) {
        throw new AgentProtocolValidationError(
          `${path}.supportedVersions[${index}]`,
          "is not supported by this package",
        );
      }
    });
    array(error.receivedVersions, `${path}.receivedVersions`).forEach(
      (version, index) =>
        positiveSafeInteger(version, `${path}.receivedVersions[${index}]`),
    );
    if (error.retryable !== false) {
      throw new AgentProtocolValidationError(
        `${path}.retryable`,
        "protocol incompatibility is not retryable",
      );
    }
  }
  return value as AgentError;
}

export function isAgentProtocolError(value: unknown): value is AgentError {
  try {
    parseAgentError(value);
    return true;
  } catch (error) {
    if (error instanceof AgentProtocolValidationError) return false;
    throw error;
  }
}

function validateUsage(value: unknown, path: string): void {
  const usage = record(value, path);
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    if (usage[key] !== undefined) {
      nonNegativeSafeInteger(usage[key], `${path}.${key}`);
    }
  }
  if (
    usage.cost !== undefined &&
    finiteNumber(usage.cost, `${path}.cost`) < 0
  ) {
    throw new AgentProtocolValidationError(
      `${path}.cost`,
      "must not be negative",
    );
  }
  optionalString(usage.currency, `${path}.currency`);
}

export function parseAgentUsage(value: unknown, path = "usage"): AgentUsage {
  validateUsage(value, path);
  return value as AgentUsage;
}

export function parseAgentToolCall(
  value: unknown,
  path = "toolCall",
): AgentToolCall {
  const toolCall = record(value, path);
  string(toolCall.id, `${path}.id`);
  string(toolCall.name, `${path}.name`);
  if (toolCall.input !== undefined) {
    validateJsonValue(toolCall.input, `${path}.input`);
  }
  if (toolCall.output !== undefined) {
    validateJsonValue(toolCall.output, `${path}.output`);
  }
  const status = string(toolCall.status, `${path}.status`);
  if (!new Set(["running", "completed", "failed", "cancelled"]).has(status)) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported tool status",
    );
  }
  if (toolCall.error !== undefined) {
    parseAgentError(toolCall.error, `${path}.error`);
  }
  optionalString(toolCall.runId, `${path}.runId`);
  optionalString(toolCall.messageId, `${path}.messageId`);
  optionalString(toolCall.agentId, `${path}.agentId`);
  optionalMetadata(toolCall.metadata, `${path}.metadata`);
  return value as AgentToolCall;
}

export function parseAgentParticipant(
  value: unknown,
  path = "agent",
): AgentParticipant {
  const agent = record(value, path);
  string(agent.id, `${path}.id`);
  string(agent.name, `${path}.name`);
  const status = string(agent.status, `${path}.status`);
  if (
    !new Set([
      "idle",
      "working",
      "waiting",
      "paused",
      "completed",
      "failed",
      "closed",
    ]).has(status)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported participant status",
    );
  }
  optionalString(agent.kind, `${path}.kind`);
  optionalString(agent.parentAgentId, `${path}.parentAgentId`);
  optionalString(agent.activeTaskId, `${path}.activeTaskId`);
  optionalString(agent.description, `${path}.description`);
  optionalString(agent.avatarUrl, `${path}.avatarUrl`);
  if (agent.origin !== undefined) {
    validateObjectReference(agent.origin, `${path}.origin`);
  }
  optionalTimestamp(agent.startedAt, `${path}.startedAt`);
  optionalTimestamp(agent.updatedAt, `${path}.updatedAt`);
  optionalTimestamp(agent.completedAt, `${path}.completedAt`);
  optionalMetadata(agent.metadata, `${path}.metadata`);
  return value as AgentParticipant;
}

function validateWorkScope(value: unknown, path: string): void {
  if (
    value !== undefined &&
    !new Set(["thread", "workspace", "external"]).has(String(value))
  ) {
    throw new AgentProtocolValidationError(path, "unsupported work scope");
  }
}

export function parseAgentInteraction(
  value: unknown,
  path = "interaction",
): AgentInteraction {
  const interaction = record(value, path);
  string(interaction.id, `${path}.id`);
  string(interaction.kind, `${path}.kind`);
  string(interaction.agentId, `${path}.agentId`);
  optionalString(interaction.targetAgentId, `${path}.targetAgentId`);
  optionalString(interaction.label, `${path}.label`);
  optionalString(interaction.detail, `${path}.detail`);
  validateWorkScope(interaction.scope, `${path}.scope`);
  if (interaction.object !== undefined) {
    validateObjectReference(interaction.object, `${path}.object`);
  }
  if (interaction.source !== undefined) {
    validateObjectReference(interaction.source, `${path}.source`);
  }
  optionalTimestamp(interaction.occurredAt, `${path}.occurredAt`);
  optionalMetadata(interaction.metadata, `${path}.metadata`);
  return value as AgentInteraction;
}

export function parseAgentActivity(
  value: unknown,
  path = "activity",
): AgentActivity {
  const activity = record(value, path);
  string(activity.id, `${path}.id`);
  string(activity.kind, `${path}.kind`);
  string(activity.label, `${path}.label`);
  optionalString(activity.detail, `${path}.detail`);
  const status = string(activity.status, `${path}.status`);
  if (!new Set(["running", "completed", "failed", "cancelled"]).has(status)) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported activity status",
    );
  }
  optionalString(activity.agentId, `${path}.agentId`);
  optionalString(activity.runId, `${path}.runId`);
  validateWorkScope(activity.scope, `${path}.scope`);
  if (activity.object !== undefined) {
    validateObjectReference(activity.object, `${path}.object`);
  }
  if (activity.source !== undefined) {
    validateObjectReference(activity.source, `${path}.source`);
  }
  if (activity.summary !== undefined) {
    array(activity.summary, `${path}.summary`).forEach((part, index) =>
      validateMessagePart(part, `${path}.summary[${index}]`),
    );
  }
  optionalTimestamp(activity.startedAt, `${path}.startedAt`);
  optionalTimestamp(activity.completedAt, `${path}.completedAt`);
  optionalMetadata(activity.metadata, `${path}.metadata`);
  return value as AgentActivity;
}

export function parseAgentTask(value: unknown, path = "task"): AgentTask {
  const task = record(value, path);
  string(task.id, `${path}.id`);
  string(task.title, `${path}.title`);
  const status = string(task.status, `${path}.status`);
  if (
    !new Set([
      "pending",
      "running",
      "awaiting_input",
      "completed",
      "failed",
      "cancelled",
    ]).has(status)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported task status",
    );
  }
  optionalString(task.kind, `${path}.kind`);
  optionalString(task.parentTaskId, `${path}.parentTaskId`);
  optionalString(task.assignedAgentId, `${path}.assignedAgentId`);
  optionalString(task.runId, `${path}.runId`);
  optionalString(task.detail, `${path}.detail`);
  if (task.progress !== undefined) {
    const progress = record(task.progress, `${path}.progress`);
    const completed = nonNegativeSafeInteger(
      progress.completed,
      `${path}.progress.completed`,
    );
    const total = nonNegativeSafeInteger(
      progress.total,
      `${path}.progress.total`,
    );
    if (completed > total) {
      throw new AgentProtocolValidationError(
        `${path}.progress`,
        "completed and total must be non-negative integers with completed no greater than total",
      );
    }
  }
  if (task.object !== undefined) {
    validateObjectReference(task.object, `${path}.object`);
  }
  if (task.source !== undefined) {
    validateObjectReference(task.source, `${path}.source`);
  }
  if (task.summary !== undefined) {
    array(task.summary, `${path}.summary`).forEach((part, index) =>
      validateMessagePart(part, `${path}.summary[${index}]`),
    );
  }
  optionalTimestamp(task.createdAt, `${path}.createdAt`);
  optionalTimestamp(task.updatedAt, `${path}.updatedAt`);
  optionalTimestamp(task.completedAt, `${path}.completedAt`);
  optionalMetadata(task.metadata, `${path}.metadata`);
  return value as AgentTask;
}

export function parseAgentTaskGroup(
  value: unknown,
  path = "taskGroup",
): AgentTaskGroup {
  const taskGroup = record(value, path);
  string(taskGroup.id, `${path}.id`);
  const taskIds = new Set<string>();
  array(taskGroup.taskIds, `${path}.taskIds`).forEach((taskId, index) => {
    const parsed = string(taskId, `${path}.taskIds[${index}]`);
    if (taskIds.has(parsed)) {
      throw new AgentProtocolValidationError(
        `${path}.taskIds[${index}]`,
        "must be unique within the task group",
      );
    }
    taskIds.add(parsed);
  });
  optionalString(taskGroup.title, `${path}.title`);
  if (taskGroup.status !== undefined) {
    const status = string(taskGroup.status, `${path}.status`);
    if (
      !new Set([
        "pending",
        "running",
        "awaiting_input",
        "completed",
        "failed",
        "cancelled",
      ]).has(status)
    ) {
      throw new AgentProtocolValidationError(
        `${path}.status`,
        "unsupported task group status",
      );
    }
  }
  optionalString(taskGroup.runId, `${path}.runId`);
  if (taskGroup.object !== undefined) {
    validateObjectReference(taskGroup.object, `${path}.object`);
  }
  if (taskGroup.source !== undefined) {
    validateObjectReference(taskGroup.source, `${path}.source`);
  }
  optionalTimestamp(taskGroup.createdAt, `${path}.createdAt`);
  optionalTimestamp(taskGroup.updatedAt, `${path}.updatedAt`);
  optionalTimestamp(taskGroup.completedAt, `${path}.completedAt`);
  optionalMetadata(taskGroup.metadata, `${path}.metadata`);
  return value as AgentTaskGroup;
}

export function parseAgentApprovalRequest(
  value: unknown,
  path = "approval",
): AgentApprovalRequest {
  const request = record(value, path);
  string(request.id, `${path}.id`);
  string(request.title, `${path}.title`);
  optionalString(request.description, `${path}.description`);
  if (
    request.kind !== undefined &&
    !new Set(["approval", "choice", "input"]).has(String(request.kind))
  ) {
    throw new AgentProtocolValidationError(
      `${path}.kind`,
      "unsupported approval kind",
    );
  }
  if (request.allowMultiple !== undefined) {
    boolean(request.allowMultiple, `${path}.allowMultiple`);
  }
  if (request.allowOther !== undefined) {
    boolean(request.allowOther, `${path}.allowOther`);
  }
  if (request.options !== undefined) {
    const seen = new Set<string>();
    array(request.options, `${path}.options`).forEach((value, index) => {
      const option = record(value, `${path}.options[${index}]`);
      const id = string(option.id, `${path}.options[${index}].id`);
      if (seen.has(id)) {
        throw new AgentProtocolValidationError(
          `${path}.options[${index}].id`,
          "must be unique",
        );
      }
      seen.add(id);
      string(option.label, `${path}.options[${index}].label`);
      optionalString(
        option.description,
        `${path}.options[${index}].description`,
      );
      if (
        option.kind !== undefined &&
        !new Set(["primary", "secondary", "danger"]).has(String(option.kind))
      ) {
        throw new AgentProtocolValidationError(
          `${path}.options[${index}].kind`,
          "unsupported approval option kind",
        );
      }
    });
  }
  if (request.input !== undefined) {
    const input = record(request.input, `${path}.input`);
    string(input.id, `${path}.input.id`);
    optionalString(input.label, `${path}.input.label`);
    optionalString(input.placeholder, `${path}.input.placeholder`);
    if (
      input.type !== undefined &&
      !new Set(["text", "number", "url"]).has(String(input.type))
    ) {
      throw new AgentProtocolValidationError(
        `${path}.input.type`,
        "unsupported input type",
      );
    }
    if (input.required !== undefined) {
      boolean(input.required, `${path}.input.required`);
    }
  }
  optionalTimestamp(request.expiresAt, `${path}.expiresAt`);
  optionalMetadata(request.metadata, `${path}.metadata`);
  return value as AgentApprovalRequest;
}

function validateApprovalResponse(value: unknown, path: string): void {
  const response = record(value, path);
  const decision = string(response.decision, `${path}.decision`);
  if (decision !== "approve" && decision !== "deny") {
    throw new AgentProtocolValidationError(
      `${path}.decision`,
      'expected "approve" or "deny"',
    );
  }
  if (response.optionIds !== undefined) {
    array(response.optionIds, `${path}.optionIds`).forEach((optionId, index) =>
      string(optionId, `${path}.optionIds[${index}]`),
    );
  }
  if (response.other !== undefined) {
    string(response.other, `${path}.other`);
  }
  if (response.input !== undefined) {
    record(response.input, `${path}.input`);
    validateJsonValue(response.input, `${path}.input`);
  }
}

export function parseAgentApprovalResponse(
  value: unknown,
  path = "approvalResponse",
): AgentApprovalResponse {
  validateApprovalResponse(value, path);
  return value as AgentApprovalResponse;
}

export function parseAgentApprovalSnapshot(
  value: unknown,
  path = "approvalSnapshot",
): AgentApprovalSnapshot {
  const snapshot = record(value, path);
  parseAgentApprovalRequest(snapshot.request, `${path}.request`);
  const status = string(snapshot.status, `${path}.status`);
  if (
    !new Set(["pending", "approved", "denied", "expired", "cancelled"]).has(
      status,
    )
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported approval snapshot status",
    );
  }
  optionalString(snapshot.runId, `${path}.runId`);
  if (status === "approved" || status === "denied") {
    validateApprovalResponse(snapshot.response, `${path}.response`);
    const response = record(snapshot.response, `${path}.response`);
    const expectedDecision = status === "approved" ? "approve" : "deny";
    if (response.decision !== expectedDecision) {
      throw new AgentProtocolValidationError(
        `${path}.response.decision`,
        `must be ${expectedDecision} when status is ${status}`,
      );
    }
  } else if (snapshot.response !== undefined) {
    validateApprovalResponse(snapshot.response, `${path}.response`);
  }
  optionalTimestamp(snapshot.resolvedAt, `${path}.resolvedAt`);
  optionalMetadata(snapshot.metadata, `${path}.metadata`);
  return value as AgentApprovalSnapshot;
}

export function parseAgentConnectionRequest(
  value: unknown,
  path = "connectionRequest",
): AgentConnectionRequest {
  const request = record(value, path);
  knownKeys(
    request,
    [
      "id",
      "provider",
      "reason",
      "status",
      "appId",
      "detail",
      "source",
      "createdAt",
      "updatedAt",
      "metadata",
    ],
    path,
  );
  string(request.id, `${path}.id`);
  string(request.provider, `${path}.provider`);
  const reason = string(request.reason, `${path}.reason`);
  if (
    !new Set(["connect", "grant", "reauthorize", "admin_required"]).has(reason)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.reason`,
      "unsupported connection request reason",
    );
  }
  const status = string(request.status, `${path}.status`);
  if (
    !new Set([
      "requested",
      "connecting",
      "connected",
      "declined",
      "failed",
    ]).has(status)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported connection request status",
    );
  }
  optionalString(request.appId, `${path}.appId`);
  optionalString(request.detail, `${path}.detail`);
  if (request.source !== undefined) {
    validateProtocolReference(request.source, `${path}.source`);
  }
  optionalTimestamp(request.createdAt, `${path}.createdAt`);
  optionalTimestamp(request.updatedAt, `${path}.updatedAt`);
  optionalMetadata(request.metadata, `${path}.metadata`);
  return value as AgentConnectionRequest;
}

export function parseAgentConnectionResponse(
  value: unknown,
  path = "connectionResponse",
): AgentConnectionResponse {
  const response = record(value, path);
  knownKeys(response, ["status", "connectionId", "message"], path);
  const status = string(response.status, `${path}.status`);
  if (!new Set(["connected", "declined", "failed"]).has(status)) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported connection response status",
    );
  }
  optionalString(response.connectionId, `${path}.connectionId`);
  optionalString(response.message, `${path}.message`);
  return value as AgentConnectionResponse;
}

export function parseAgentConnectionRequestSnapshot(
  value: unknown,
  path = "connectionRequestSnapshot",
): AgentConnectionRequestSnapshot {
  const snapshot = record(value, path);
  parseAgentConnectionRequest(snapshot.request, `${path}.request`);
  optionalString(snapshot.runId, `${path}.runId`);
  return value as AgentConnectionRequestSnapshot;
}

export function parseAgentArtifactReference(
  value: unknown,
  path = "artifact",
): AgentArtifactReference {
  const artifact = record(value, path);
  string(artifact.id, `${path}.id`);
  string(artifact.kind, `${path}.kind`);
  optionalString(artifact.title, `${path}.title`);
  optionalString(artifact.url, `${path}.url`);
  optionalString(artifact.runId, `${path}.runId`);
  optionalTimestamp(artifact.createdAt, `${path}.createdAt`);
  optionalMetadata(artifact.metadata, `${path}.metadata`);
  return value as AgentArtifactReference;
}

export function parseAgentSuggestion(
  value: unknown,
  path = "suggestion",
): AgentSuggestion {
  const suggestion = record(value, path);
  string(suggestion.id, `${path}.id`);
  string(suggestion.label, `${path}.label`);
  optionalString(suggestion.prompt, `${path}.prompt`);
  optionalString(suggestion.runId, `${path}.runId`);
  optionalTimestamp(suggestion.updatedAt, `${path}.updatedAt`);
  optionalMetadata(suggestion.metadata, `${path}.metadata`);
  return value as AgentSuggestion;
}

export function parseAgentWidgetSnapshot(
  value: unknown,
  path = "widgetSnapshot",
): AgentWidgetSnapshot {
  const snapshot = record(value, path);
  string(snapshot.messageId, `${path}.messageId`);
  parseAgentWidget(snapshot.widget, `${path}.widget`);
  return value as AgentWidgetSnapshot;
}

export function parseAgentAnnotationSnapshot(
  value: unknown,
  path = "annotationSnapshot",
): AgentAnnotationSnapshot {
  const snapshot = record(value, path);
  string(snapshot.messageId, `${path}.messageId`);
  validateAnnotation(snapshot.annotation, `${path}.annotation`);
  return value as AgentAnnotationSnapshot;
}

export function parseAgentReplayCheckpoint(
  value: unknown,
  path = "checkpoint",
): AgentReplayCheckpoint {
  const checkpoint = record(value, path);
  string(checkpoint.id, `${path}.id`);
  timestamp(checkpoint.capturedAt, `${path}.capturedAt`);
  const sequenceByRun = record(
    checkpoint.sequenceByRun,
    `${path}.sequenceByRun`,
  );
  for (const [runId, sequence] of Object.entries(sequenceByRun)) {
    string(runId, `${path}.sequenceByRun key`);
    nonNegativeSafeInteger(sequence, `${path}.sequenceByRun.${runId}`);
  }
  optionalString(checkpoint.cursor, `${path}.cursor`);
  optionalMetadata(checkpoint.metadata, `${path}.metadata`);
  return value as AgentReplayCheckpoint;
}

export function parseAgentThreadSnapshot(
  value: unknown,
  path = "threadSnapshot",
): AgentThreadSnapshot {
  const snapshot = record(parseAgentThread(value, path), path);
  const threadId = string(snapshot.id, `${path}.id`);
  const messageIds = new Set<string>();
  array(snapshot.messages, `${path}.messages`).forEach((message, index) => {
    const parsed = parseAgentMessage(message, `${path}.messages[${index}]`);
    if (messageIds.has(parsed.id)) {
      throw new AgentProtocolValidationError(
        `${path}.messages[${index}].id`,
        "must be unique within the snapshot",
      );
    }
    messageIds.add(parsed.id);
  });
  if (snapshot.queuedMessages !== undefined) {
    parseAgentQueuedMessages(
      snapshot.queuedMessages,
      `${path}.queuedMessages`,
    ).forEach((message, index) => {
      if (message.threadId !== threadId) {
        throw new AgentProtocolValidationError(
          `${path}.queuedMessages[${index}].threadId`,
          "must match the snapshot thread",
        );
      }
    });
  }
  const lastSequenceByRun = new Map<string, number>();
  if (snapshot.events !== undefined) {
    const eventIds = new Set<string>();
    array(snapshot.events, `${path}.events`).forEach((event, index) => {
      const parsed = parseAgentEvent(event, `${path}.events[${index}]`);
      if (parsed.threadId !== threadId) {
        throw new AgentProtocolValidationError(
          `${path}.events[${index}].threadId`,
          "must match the snapshot thread",
        );
      }
      const previous = lastSequenceByRun.get(parsed.runId) ?? 0;
      const expectedSequence = previous + 1;
      if (parsed.sequence !== expectedSequence) {
        throw new AgentProtocolValidationError(
          `${path}.events[${index}].sequence`,
          `must be contiguous within each run; expected ${expectedSequence}`,
        );
      }
      if (eventIds.has(parsed.id)) {
        throw new AgentProtocolValidationError(
          `${path}.events[${index}].id`,
          "must be unique within the snapshot",
        );
      }
      eventIds.add(parsed.id);
      lastSequenceByRun.set(parsed.runId, parsed.sequence);
    });
  }
  const runIds = new Set<string>();
  const runsById = new Map<string, AgentRunSnapshot>();
  if (snapshot.runs !== undefined) {
    array(snapshot.runs, `${path}.runs`).forEach((run, index) => {
      const parsed = parseAgentRunSnapshot(run, `${path}.runs[${index}]`);
      if (parsed.threadId !== threadId) {
        throw new AgentProtocolValidationError(
          `${path}.runs[${index}].threadId`,
          "must match the snapshot thread",
        );
      }
      if (runIds.has(parsed.id)) {
        throw new AgentProtocolValidationError(
          `${path}.runs[${index}].id`,
          "must be unique within the snapshot",
        );
      }
      runIds.add(parsed.id);
      runsById.set(parsed.id, parsed);
    });
  }
  if (snapshot.activeRunIds !== undefined) {
    const activeRunIds = new Set<string>();
    array(snapshot.activeRunIds, `${path}.activeRunIds`).forEach(
      (runId, index) => {
        const parsed = string(runId, `${path}.activeRunIds[${index}]`);
        if (activeRunIds.has(parsed)) {
          throw new AgentProtocolValidationError(
            `${path}.activeRunIds[${index}]`,
            "must be unique within the snapshot",
          );
        }
        activeRunIds.add(parsed);
        if (snapshot.runs !== undefined && !runIds.has(parsed)) {
          throw new AgentProtocolValidationError(
            `${path}.activeRunIds[${index}]`,
            "must reference a run included in the snapshot",
          );
        }
        const run = runsById.get(parsed);
        if (
          run &&
          (run.status === "completed" ||
            run.status === "failed" ||
            run.status === "cancelled")
        ) {
          throw new AgentProtocolValidationError(
            `${path}.activeRunIds[${index}]`,
            "must not reference a terminal run",
          );
        }
      },
    );
  }
  if (snapshot.checkpoint !== undefined) {
    const checkpoint = parseAgentReplayCheckpoint(
      snapshot.checkpoint,
      `${path}.checkpoint`,
    );
    for (const [runId, lastSequence] of lastSequenceByRun) {
      const checkpointSequence = checkpoint.sequenceByRun[runId];
      if (
        checkpointSequence === undefined ||
        checkpointSequence < lastSequence
      ) {
        throw new AgentProtocolValidationError(
          `${path}.checkpoint.sequenceByRun.${runId}`,
          "must include every replayed event sequence",
        );
      }
    }
    for (const run of runsById.values()) {
      if (checkpoint.sequenceByRun[run.id] !== run.lastSequence) {
        throw new AgentProtocolValidationError(
          `${path}.checkpoint.sequenceByRun.${run.id}`,
          "must equal the run lastSequence",
        );
      }
    }
  }

  const projectionParsers: Array<
    [string, (value: unknown, path: string) => { id: string }]
  > = [
    ["toolCalls", parseAgentToolCall],
    ["activities", parseAgentActivity],
    ["tasks", parseAgentTask],
    ["taskGroups", parseAgentTaskGroup],
    ["agents", parseAgentParticipant],
    ["interactions", parseAgentInteraction],
    ["artifacts", parseAgentArtifactReference],
    ["suggestions", parseAgentSuggestion],
  ];
  for (const [key, parse] of projectionParsers) {
    if (snapshot[key] === undefined) continue;
    const ids = new Set<string>();
    array(snapshot[key], `${path}.${key}`).forEach((entry, index) => {
      const parsed = parse(entry, `${path}.${key}[${index}]`);
      if (ids.has(parsed.id)) {
        throw new AgentProtocolValidationError(
          `${path}.${key}[${index}].id`,
          "must be unique within the snapshot",
        );
      }
      ids.add(parsed.id);
    });
  }
  if (snapshot.approvals !== undefined) {
    const ids = new Set<string>();
    array(snapshot.approvals, `${path}.approvals`).forEach((entry, index) => {
      const parsed = parseAgentApprovalSnapshot(
        entry,
        `${path}.approvals[${index}]`,
      );
      if (ids.has(parsed.request.id)) {
        throw new AgentProtocolValidationError(
          `${path}.approvals[${index}].request.id`,
          "must be unique within the snapshot",
        );
      }
      ids.add(parsed.request.id);
    });
  }
  if (snapshot.connectionRequests !== undefined) {
    const ids = new Set<string>();
    array(snapshot.connectionRequests, `${path}.connectionRequests`).forEach(
      (entry, index) => {
        const parsed = parseAgentConnectionRequestSnapshot(
          entry,
          `${path}.connectionRequests[${index}]`,
        );
        if (ids.has(parsed.request.id)) {
          throw new AgentProtocolValidationError(
            `${path}.connectionRequests[${index}].request.id`,
            "must be unique within the snapshot",
          );
        }
        ids.add(parsed.request.id);
      },
    );
  }
  if (snapshot.widgets !== undefined) {
    const ids = new Set<string>();
    array(snapshot.widgets, `${path}.widgets`).forEach((entry, index) => {
      const parsed = parseAgentWidgetSnapshot(
        entry,
        `${path}.widgets[${index}]`,
      );
      if (!messageIds.has(parsed.messageId)) {
        throw new AgentProtocolValidationError(
          `${path}.widgets[${index}].messageId`,
          "must reference a message included in the snapshot",
        );
      }
      if (ids.has(parsed.widget.id)) {
        throw new AgentProtocolValidationError(
          `${path}.widgets[${index}].widget.id`,
          "must be unique within the snapshot",
        );
      }
      ids.add(parsed.widget.id);
    });
  }
  if (snapshot.annotations !== undefined) {
    const ids = new Set<string>();
    array(snapshot.annotations, `${path}.annotations`).forEach(
      (entry, index) => {
        const parsed = parseAgentAnnotationSnapshot(
          entry,
          `${path}.annotations[${index}]`,
        );
        if (!messageIds.has(parsed.messageId)) {
          throw new AgentProtocolValidationError(
            `${path}.annotations[${index}].messageId`,
            "must reference a message included in the snapshot",
          );
        }
        if (ids.has(parsed.annotation.id)) {
          throw new AgentProtocolValidationError(
            `${path}.annotations[${index}].annotation.id`,
            "must be unique within the snapshot",
          );
        }
        ids.add(parsed.annotation.id);
      },
    );
  }
  return value as AgentThreadSnapshot;
}

export function parseAgentDurableThreadSnapshot(
  value: unknown,
  path = "durableThreadSnapshot",
): AgentDurableThreadSnapshot {
  const snapshot = record(parseAgentThreadSnapshot(value, path), path);
  const requiredArrays = [
    "queuedMessages",
    "events",
    "runs",
    "activeRunIds",
    "toolCalls",
    "activities",
    "tasks",
    "taskGroups",
    "approvals",
    "widgets",
    "annotations",
    "agents",
    "interactions",
    "artifacts",
    "suggestions",
  ];
  for (const key of requiredArrays) {
    if (snapshot[key] === undefined) {
      throw new AgentProtocolValidationError(
        `${path}.${key}`,
        "is required for a durable snapshot",
      );
    }
    array(snapshot[key], `${path}.${key}`);
  }
  if (snapshot.checkpoint === undefined) {
    throw new AgentProtocolValidationError(
      `${path}.checkpoint`,
      "is required for a durable snapshot",
    );
  }
  const checkpoint = parseAgentReplayCheckpoint(
    snapshot.checkpoint,
    `${path}.checkpoint`,
  );
  const runs = snapshot.runs as AgentRunSnapshot[];
  const runIds = new Set(runs.map((run) => run.id));
  for (const runId of Object.keys(checkpoint.sequenceByRun)) {
    if (!runIds.has(runId)) {
      throw new AgentProtocolValidationError(
        `${path}.checkpoint.sequenceByRun.${runId}`,
        "must reference a run included in the snapshot",
      );
    }
  }
  for (const run of runs) {
    if (!(run.id in checkpoint.sequenceByRun)) {
      throw new AgentProtocolValidationError(
        `${path}.checkpoint.sequenceByRun.${run.id}`,
        "must include every run in the snapshot",
      );
    }
  }
  return value as AgentDurableThreadSnapshot;
}

export function parseNullableAgentThreadSnapshot(
  value: unknown,
  path = "threadSnapshot",
): AgentThreadSnapshot | null {
  return value === null ? null : parseAgentThreadSnapshot(value, path);
}

export function parseNullableAgentDurableThreadSnapshot(
  value: unknown,
  path = "durableThreadSnapshot",
): AgentDurableThreadSnapshot | null {
  return value === null ? null : parseAgentDurableThreadSnapshot(value, path);
}

export function parseListThreadsResult(
  value: unknown,
  path = "threads",
): ListThreadsResult {
  const result = record(value, path);
  array(result.threads, `${path}.threads`).forEach((thread, index) =>
    parseAgentThread(thread, `${path}.threads[${index}]`),
  );
  optionalString(result.nextCursor, `${path}.nextCursor`);
  return value as ListThreadsResult;
}

export function parseQueueMessageResult(
  value: unknown,
  path = "queueMessageResult",
): QueueMessageResult {
  const result = record(value, path);
  parseAgentQueuedMessage(result.message, `${path}.message`);
  return value as QueueMessageResult;
}

export function parseStartRunResult(
  value: unknown,
  path = "startRunResult",
): StartRunResult {
  const result = record(value, path);
  string(result.runId, `${path}.runId`);
  if (result.capabilities !== undefined) {
    parseAgentCapabilities(result.capabilities, `${path}.capabilities`);
  }
  return value as StartRunResult;
}

export function parseSteerQueuedMessageResult(
  value: unknown,
  path = "steerQueuedMessageResult",
): SteerQueuedMessageResult {
  if (value === null || value === undefined) return undefined;
  return parseStartRunResult(value, path);
}

export function parseAgentRunSnapshot(
  value: unknown,
  path = "runSnapshot",
): AgentRunSnapshot {
  const run = record(value, path);
  string(run.id, `${path}.id`);
  string(run.threadId, `${path}.threadId`);
  const status = string(run.status, `${path}.status`);
  if (
    !new Set([
      "queued",
      "running",
      "awaiting_approval",
      "awaiting_input",
      "completed",
      "failed",
      "cancelled",
    ]).has(status)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported run status",
    );
  }
  nonNegativeSafeInteger(run.lastSequence, `${path}.lastSequence`);
  optionalTimestamp(run.startedAt, `${path}.startedAt`);
  optionalTimestamp(run.completedAt, `${path}.completedAt`);
  if (run.usage !== undefined) validateUsage(run.usage, `${path}.usage`);
  if (run.error !== undefined) parseAgentError(run.error, `${path}.error`);
  optionalMetadata(run.metadata, `${path}.metadata`);
  return value as AgentRunSnapshot;
}

export function parseNullableAgentRunSnapshot(
  value: unknown,
  path = "runSnapshot",
): AgentRunSnapshot | null {
  return value === null ? null : parseAgentRunSnapshot(value, path);
}

export function parseAgentActionResult(
  value: unknown,
  path = "actionResult",
): AgentActionResult {
  const result = record(value, path);
  string(result.invocationId, `${path}.invocationId`);
  if (
    result.status !== "completed" &&
    result.status !== "failed" &&
    result.status !== "cancelled"
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "unsupported action status",
    );
  }
  if (result.data !== undefined) {
    validateJsonValue(result.data, `${path}.data`);
  }
  if (result.error !== undefined) {
    parseAgentError(result.error, `${path}.error`);
  }
  if (result.status === "failed" && result.error === undefined) {
    throw new AgentProtocolValidationError(
      `${path}.error`,
      "is required when an action failed",
    );
  }
  optionalMetadata(result.metadata, `${path}.metadata`);
  return value as AgentActionResult;
}

export function parseAgentUploadTarget(
  value: unknown,
  path = "uploadTarget",
): AgentUploadTarget {
  const target = record(value, path);
  string(target.uploadId, `${path}.uploadId`);
  if (target.method !== "POST" && target.method !== "PUT") {
    throw new AgentProtocolValidationError(
      `${path}.method`,
      "expected POST or PUT",
    );
  }
  string(target.url, `${path}.url`);
  for (const key of ["headers", "fields"] as const) {
    if (target[key] === undefined) continue;
    const entries = record(target[key], `${path}.${key}`);
    for (const [name, entry] of Object.entries(entries)) {
      string(name, `${path}.${key} key`);
      if (typeof entry !== "string") {
        throw new AgentProtocolValidationError(
          `${path}.${key}.${name}`,
          "expected a string",
        );
      }
    }
  }
  optionalTimestamp(target.expiresAt, `${path}.expiresAt`);
  return value as AgentUploadTarget;
}

export function parseVoidResponse(
  value: unknown,
  path = "response",
): undefined {
  if (value !== null) {
    throw new AgentProtocolValidationError(path, "expected null");
  }
  return undefined;
}

function validateEventPayload(event: UnknownRecord, path: string): void {
  const type = string(event.type, `${path}.type`);
  switch (type) {
    case "run.started":
      optionalString(event.agentId, `${path}.agentId`);
      return;
    case "run.status":
      if (
        !new Set([
          "queued",
          "running",
          "awaiting_approval",
          "awaiting_input",
          "completed",
          "failed",
          "cancelled",
        ]).has(string(event.status, `${path}.status`))
      ) {
        throw new AgentProtocolValidationError(
          `${path}.status`,
          "unsupported run status",
        );
      }
      return;
    case "agent.registered":
    case "agent.updated":
    case "agent.unregistered": {
      parseAgentParticipant(event.agent, `${path}.agent`);
      return;
    }
    case "agent.interaction": {
      parseAgentInteraction(event.interaction, `${path}.interaction`);
      return;
    }
    case "message.created":
    case "message.completed":
      parseAgentMessage(event.message, `${path}.message`);
      return;
    case "message.delta":
      string(event.messageId, `${path}.messageId`);
      if (typeof event.text !== "string") {
        throw new AgentProtocolValidationError(
          `${path}.text`,
          "expected a string",
        );
      }
      if (
        event.format !== undefined &&
        event.format !== "plain" &&
        event.format !== "markdown"
      ) {
        throw new AgentProtocolValidationError(
          `${path}.format`,
          "expected plain or markdown",
        );
      }
      return;
    case "reasoning.delta":
      string(event.messageId, `${path}.messageId`);
      if (typeof event.text !== "string") {
        throw new AgentProtocolValidationError(
          `${path}.text`,
          "expected a string",
        );
      }
      return;
    case "tool.started":
    case "tool.updated": {
      const toolCall = parseAgentToolCall(event.toolCall, `${path}.toolCall`);
      if (toolCall.runId !== undefined && toolCall.runId !== event.runId) {
        throw new AgentProtocolValidationError(
          `${path}.toolCall.runId`,
          "must match the event run",
        );
      }
      return;
    }
    case "tool.delta":
      string(event.toolCallId, `${path}.toolCallId`);
      optionalString(event.inputTextDelta, `${path}.inputTextDelta`);
      optionalString(event.outputTextDelta, `${path}.outputTextDelta`);
      if (
        event.inputTextDelta === undefined &&
        event.outputTextDelta === undefined
      ) {
        throw new AgentProtocolValidationError(
          path,
          "a tool delta requires inputTextDelta or outputTextDelta",
        );
      }
      return;
    case "activity.started":
    case "activity.updated":
    case "activity.completed": {
      const activity = parseAgentActivity(event.activity, `${path}.activity`);
      if (activity.runId !== undefined && activity.runId !== event.runId) {
        throw new AgentProtocolValidationError(
          `${path}.activity.runId`,
          "must match the event run",
        );
      }
      return;
    }
    case "task.created":
    case "task.updated":
    case "task.completed": {
      const task = parseAgentTask(event.task, `${path}.task`);
      if (task.runId !== undefined && task.runId !== event.runId) {
        throw new AgentProtocolValidationError(
          `${path}.task.runId`,
          "must match the event run",
        );
      }
      return;
    }
    case "task-group.created":
    case "task-group.updated":
    case "task-group.completed": {
      const taskGroup = parseAgentTaskGroup(
        event.taskGroup,
        `${path}.taskGroup`,
      );
      if (taskGroup.runId !== undefined && taskGroup.runId !== event.runId) {
        throw new AgentProtocolValidationError(
          `${path}.taskGroup.runId`,
          "must match the event run",
        );
      }
      return;
    }
    case "task-group.removed":
      string(event.taskGroupId, `${path}.taskGroupId`);
      return;
    case "approval.requested": {
      parseAgentApprovalRequest(event.request, `${path}.request`);
      return;
    }
    case "approval.resolved":
      string(event.approvalId, `${path}.approvalId`);
      optionalString(event.optionId, `${path}.optionId`);
      validateApprovalResponse(event.response, `${path}.response`);
      return;
    case "connection.requested":
    case "connection.updated":
      parseAgentConnectionRequest(event.request, `${path}.request`);
      return;
    case "artifact.created": {
      const artifact = parseAgentArtifactReference(
        event.artifact,
        `${path}.artifact`,
      );
      if (artifact.runId !== undefined && artifact.runId !== event.runId) {
        throw new AgentProtocolValidationError(
          `${path}.artifact.runId`,
          "must match the event run",
        );
      }
      return;
    }
    case "widget.created":
    case "widget.updated": {
      optionalString(event.messageId, `${path}.messageId`);
      parseAgentWidget(event.widget, `${path}.widget`);
      return;
    }
    case "widget.removed":
      string(event.widgetId, `${path}.widgetId`);
      return;
    case "annotation.created":
    case "annotation.updated": {
      optionalString(event.messageId, `${path}.messageId`);
      validateAnnotation(event.annotation, `${path}.annotation`);
      return;
    }
    case "annotation.removed":
      string(event.annotationId, `${path}.annotationId`);
      return;
    case "suggestions.updated":
      array(event.suggestions, `${path}.suggestions`).forEach(
        (suggestion, index) => {
          const parsed = parseAgentSuggestion(
            suggestion,
            `${path}.suggestions[${index}]`,
          );
          if (parsed.runId !== undefined && parsed.runId !== event.runId) {
            throw new AgentProtocolValidationError(
              `${path}.suggestions[${index}].runId`,
              "must match the event run",
            );
          }
        },
      );
      return;
    case "action.started": {
      const invocation = record(event.invocation, `${path}.invocation`);
      string(invocation.id, `${path}.invocation.id`);
      string(invocation.action, `${path}.invocation.action`);
      string(invocation.threadId, `${path}.invocation.threadId`);
      if (invocation.threadId !== event.threadId) {
        throw new AgentProtocolValidationError(
          `${path}.invocation.threadId`,
          "must match the event thread",
        );
      }
      optionalString(invocation.runId, `${path}.invocation.runId`);
      optionalString(invocation.messageId, `${path}.invocation.messageId`);
      optionalString(invocation.widgetId, `${path}.invocation.widgetId`);
      optionalString(invocation.itemId, `${path}.invocation.itemId`);
      if (invocation.payload !== undefined) {
        validateJsonValue(invocation.payload, `${path}.invocation.payload`);
      }
      optionalMetadata(invocation.metadata, `${path}.invocation.metadata`);
      return;
    }
    case "action.completed":
    case "action.failed": {
      parseAgentActionResult(event.result, `${path}.result`);
      return;
    }
    case "upload.progress": {
      const progress = record(event.progress, `${path}.progress`);
      string(progress.uploadId, `${path}.progress.uploadId`);
      const loaded = finiteNumber(progress.loaded, `${path}.progress.loaded`);
      const total = finiteNumber(progress.total, `${path}.progress.total`);
      if (loaded < 0 || total < 0 || loaded > total) {
        throw new AgentProtocolValidationError(
          `${path}.progress`,
          "loaded and total must be non-negative with loaded no greater than total",
        );
      }
      return;
    }
    case "client.effect":
    case "client.deeplink":
      string(event.name, `${path}.name`);
      if (event.data !== undefined) {
        record(event.data, `${path}.data`);
        validateJsonValue(event.data, `${path}.data`);
      }
      return;
    case "thread.updated": {
      const thread = parseAgentThread(event.thread, `${path}.thread`);
      if (thread.id !== event.threadId) {
        throw new AgentProtocolValidationError(
          `${path}.thread.id`,
          "must match the event thread",
        );
      }
      return;
    }
    case "queue.updated":
      parseAgentQueuedMessages(event.messages, `${path}.messages`).forEach(
        (message, index) => {
          if (message.threadId !== event.threadId) {
            throw new AgentProtocolValidationError(
              `${path}.messages[${index}].threadId`,
              "must match the event thread",
            );
          }
        },
      );
      return;
    case "run.completed":
      if (event.usage !== undefined)
        validateUsage(event.usage, `${path}.usage`);
      return;
    case "run.failed": {
      parseAgentError(event.error, `${path}.error`);
      return;
    }
    case "run.cancelled":
      return;
    default:
      if (type.startsWith("x-") && type.length > 2) {
        if (!("payload" in event)) {
          throw new AgentProtocolValidationError(
            `${path}.payload`,
            "is required for extension events",
          );
        }
        validateJsonValue(event.payload, `${path}.payload`);
        return;
      }
      throw new AgentProtocolValidationError(
        `${path}.type`,
        `unsupported event type ${JSON.stringify(type)}`,
      );
  }
}

export function parseAgentEvent(value: unknown, path = "event"): AgentEvent {
  const event = record(value, path);
  identifierFields(event, path);
  positiveSafeInteger(event.sequence, `${path}.sequence`);
  timestamp(event.occurredAt, `${path}.occurredAt`);
  optionalMetadata(event.metadata, `${path}.metadata`);
  validateEventPayload(event, path);
  return value as AgentEvent;
}

export interface ParseAgentEventSequenceOptions {
  afterSequence?: number;
  threadId?: ThreadId;
  runId?: RunId;
  path?: string;
}

/**
 * Validates a complete replay batch before a consumer advances its cursor.
 * Returning only after the entire batch is contiguous prevents a later event
 * from making an earlier missing event permanently unreachable.
 */
export function parseAgentEventSequence(
  value: unknown,
  options: ParseAgentEventSequenceOptions = {},
): AgentEvent[] {
  const path = options.path ?? "events";
  const afterSequence = options.afterSequence ?? 0;
  nonNegativeSafeInteger(afterSequence, `${path}.afterSequence`);
  const parsed = array(value, path).map((event, index) =>
    parseAgentEvent(event, `${path}[${index}]`),
  );
  parsed.forEach((event, index) => {
    const expectedSequence = afterSequence + index + 1;
    if (event.sequence !== expectedSequence) {
      throw new AgentProtocolValidationError(
        `${path}[${index}].sequence`,
        `must be contiguous; expected ${expectedSequence}`,
      );
    }
    if (options.threadId !== undefined && event.threadId !== options.threadId) {
      throw new AgentProtocolValidationError(
        `${path}[${index}].threadId`,
        `must match ${JSON.stringify(options.threadId)}`,
      );
    }
    if (options.runId !== undefined && event.runId !== options.runId) {
      throw new AgentProtocolValidationError(
        `${path}[${index}].runId`,
        `must match ${JSON.stringify(options.runId)}`,
      );
    }
  });
  return parsed;
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  try {
    parseAgentEvent(value);
    return true;
  } catch (error) {
    if (error instanceof AgentProtocolValidationError) return false;
    throw error;
  }
}

export function parseAgentCapabilities(
  value: unknown,
  path = "capabilities",
): AgentCapabilities {
  const capabilities = record(value, path);
  const booleanCapabilities = new Set([
    "actions",
    "activities",
    "approvals",
    "artifacts",
    "attachments",
    "citations",
    "codeExecution",
    "connectionRequests",
    "durableThreadSnapshots",
    "feedback",
    "widgets",
    "uploads",
    "clientEffects",
    "modelSelection",
    "toolSelection",
    "threadHistory",
    "threadForking",
    "messageQueue",
    "multiAgentActivity",
    "resumableRuns",
    "taskGroups",
    "suggestions",
    "smartObjects",
  ]);
  for (const [key, entry] of Object.entries(capabilities)) {
    if (key === "reasoning") {
      if (!new Set(["none", "summary", "full"]).has(String(entry))) {
        throw new AgentProtocolValidationError(
          `${path}.${key}`,
          "expected none, summary, or full",
        );
      }
      continue;
    }
    if (key === "protocolVersion") {
      if (!isAgentKitProtocolVersion(entry)) {
        throw new AgentProtocolValidationError(
          `${path}.${key}`,
          `unsupported protocol version ${JSON.stringify(entry)}`,
        );
      }
      continue;
    }
    if (key.startsWith("x-") && key.length > 2) {
      validateJsonValue(entry, `${path}.${key}`);
      continue;
    }
    if (!booleanCapabilities.has(key)) {
      throw new AgentProtocolValidationError(
        `${path}.${key}`,
        "unknown capabilities must use an x- namespace",
      );
    }
    boolean(entry, `${path}.${key}`);
  }
  return value as AgentCapabilities;
}

export function parseAgentProtocolVersionOffer(
  value: unknown,
  path = "protocolOffer",
): AgentProtocolVersionOffer {
  const offer = record(value, path);
  if (offer.protocol !== AGENTKIT_PROTOCOL_NAME) {
    throw new AgentProtocolValidationError(
      `${path}.protocol`,
      `expected ${AGENTKIT_PROTOCOL_NAME}`,
    );
  }
  const seen = new Set<number>();
  const versions = array(offer.versions, `${path}.versions`);
  if (versions.length === 0) {
    throw new AgentProtocolValidationError(
      `${path}.versions`,
      "must contain at least one version",
    );
  }
  versions.forEach((version, index) => {
    const parsed = positiveSafeInteger(version, `${path}.versions[${index}]`);
    if (seen.has(parsed)) {
      throw new AgentProtocolValidationError(
        `${path}.versions[${index}]`,
        "must be unique",
      );
    }
    seen.add(parsed);
  });
  return value as AgentProtocolVersionOffer;
}

export function parseAgentProtocolCompatibility(
  value: unknown,
  path = "compatibility",
): AgentProtocolCompatibility {
  const compatibility = record(value, path);
  const status = string(compatibility.status, `${path}.status`);
  if (status !== "compatible" && status !== "incompatible") {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "expected compatible or incompatible",
    );
  }
  const localVersions = array(
    compatibility.localVersions,
    `${path}.localVersions`,
  );
  if (localVersions.length === 0) {
    throw new AgentProtocolValidationError(
      `${path}.localVersions`,
      "must contain at least one version",
    );
  }
  const seenLocalVersions = new Set<number>();
  localVersions.forEach((version, index) => {
    if (!isAgentKitProtocolVersion(version)) {
      throw new AgentProtocolValidationError(
        `${path}.localVersions[${index}]`,
        "is not supported by this package",
      );
    }
    if (seenLocalVersions.has(version)) {
      throw new AgentProtocolValidationError(
        `${path}.localVersions[${index}]`,
        "must be unique",
      );
    }
    seenLocalVersions.add(version);
  });
  const peerVersions = array(
    compatibility.peerVersions,
    `${path}.peerVersions`,
  );
  if (peerVersions.length === 0) {
    throw new AgentProtocolValidationError(
      `${path}.peerVersions`,
      "must contain at least one version",
    );
  }
  const seenPeerVersions = new Set<number>();
  peerVersions.forEach((version, index) => {
    const parsed = positiveSafeInteger(
      version,
      `${path}.peerVersions[${index}]`,
    );
    if (seenPeerVersions.has(parsed)) {
      throw new AgentProtocolValidationError(
        `${path}.peerVersions[${index}]`,
        "must be unique",
      );
    }
    seenPeerVersions.add(parsed);
  });
  if (status === "compatible") {
    if (!isAgentKitProtocolVersion(compatibility.selectedVersion)) {
      throw new AgentProtocolValidationError(
        `${path}.selectedVersion`,
        "is not supported by this package",
      );
    }
    if (!localVersions.includes(compatibility.selectedVersion)) {
      throw new AgentProtocolValidationError(
        `${path}.selectedVersion`,
        "must be included in localVersions",
      );
    }
    if (
      !(compatibility.peerVersions as unknown[]).includes(
        compatibility.selectedVersion,
      )
    ) {
      throw new AgentProtocolValidationError(
        `${path}.selectedVersion`,
        "must be included in peerVersions",
      );
    }
  } else {
    const error = record(
      parseAgentError(compatibility.error, `${path}.error`),
      `${path}.error`,
    );
    if (error.code !== "protocol_version_unsupported") {
      throw new AgentProtocolValidationError(
        `${path}.error.code`,
        "expected protocol_version_unsupported",
      );
    }
    if (
      JSON.stringify(error.supportedVersions) !== JSON.stringify(localVersions)
    ) {
      throw new AgentProtocolValidationError(
        `${path}.error.supportedVersions`,
        "must match localVersions",
      );
    }
    if (
      JSON.stringify(error.receivedVersions) !== JSON.stringify(peerVersions)
    ) {
      throw new AgentProtocolValidationError(
        `${path}.error.receivedVersions`,
        "must match peerVersions",
      );
    }
  }
  return value as AgentProtocolCompatibility;
}

export function parseAgentCapabilityDescriptor(
  value: unknown,
  path = "capability",
): AgentCapabilityDescriptor {
  const descriptor = record(value, path);
  const id = capabilityId(descriptor.id, `${path}.id`);
  const state = string(descriptor.state, `${path}.state`);
  if (
    !new Set(["available", "degraded", "unavailable", "unsupported"]).has(state)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.state`,
      "unsupported capability state",
    );
  }
  optionalString(descriptor.description, `${path}.description`);
  if (descriptor.error !== undefined) {
    const error = record(
      parseAgentError(descriptor.error, `${path}.error`),
      `${path}.error`,
    );
    if (error.capability !== id) {
      throw new AgentProtocolValidationError(
        `${path}.error.capability`,
        "must match the descriptor id",
      );
    }
    if (
      (state === "unsupported" && error.code !== "capability_unsupported") ||
      ((state === "unavailable" || state === "degraded") &&
        error.code !== "capability_unavailable")
    ) {
      throw new AgentProtocolValidationError(
        `${path}.error.code`,
        "must match the capability state",
      );
    }
  }
  if (state !== "available" && descriptor.error === undefined) {
    throw new AgentProtocolValidationError(
      `${path}.error`,
      "is required for every non-available capability",
    );
  }
  if (state === "available" && descriptor.error !== undefined) {
    throw new AgentProtocolValidationError(
      `${path}.error`,
      "must be omitted for an available capability",
    );
  }
  optionalMetadata(descriptor.metadata, `${path}.metadata`);
  return value as AgentCapabilityDescriptor;
}

export function parseDiscoverCapabilitiesInput(
  value: unknown,
  path = "discoverCapabilities",
): DiscoverCapabilitiesInput {
  const input = record(value, path);
  parseAgentProtocolVersionOffer(input.protocol, `${path}.protocol`);
  if (input.requested !== undefined) {
    const seen = new Set<string>();
    array(input.requested, `${path}.requested`).forEach((entry, index) => {
      const id = capabilityId(entry, `${path}.requested[${index}]`);
      if (seen.has(id)) {
        throw new AgentProtocolValidationError(
          `${path}.requested[${index}]`,
          "must be unique",
        );
      }
      seen.add(id);
    });
  }
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as DiscoverCapabilitiesInput;
}

export function parseAgentCapabilitiesDiscovery(
  value: unknown,
  path = "capabilitiesDiscovery",
): AgentCapabilitiesDiscovery {
  const discovery = record(value, path);
  const compatibility = parseAgentProtocolCompatibility(
    discovery.protocol,
    `${path}.protocol`,
  );
  const seen = new Set<string>();
  const capabilities = array(discovery.capabilities, `${path}.capabilities`);
  if (compatibility.status === "incompatible" && capabilities.length > 0) {
    throw new AgentProtocolValidationError(
      `${path}.capabilities`,
      "must be empty when protocol versions are incompatible",
    );
  }
  capabilities.forEach((entry, index) => {
    const parsed = parseAgentCapabilityDescriptor(
      entry,
      `${path}.capabilities[${index}]`,
    );
    if (seen.has(parsed.id)) {
      throw new AgentProtocolValidationError(
        `${path}.capabilities[${index}].id`,
        "must be unique",
      );
    }
    seen.add(parsed.id);
  });
  const discoveredAt = timestamp(
    discovery.discoveredAt,
    `${path}.discoveredAt`,
  );
  optionalTimestamp(discovery.expiresAt, `${path}.expiresAt`);
  if (
    discovery.expiresAt !== undefined &&
    Date.parse(String(discovery.expiresAt)) <= Date.parse(discoveredAt)
  ) {
    throw new AgentProtocolValidationError(
      `${path}.expiresAt`,
      "must be later than discoveredAt",
    );
  }
  if (discovery.legacy !== undefined) {
    parseAgentCapabilities(discovery.legacy, `${path}.legacy`);
  }
  optionalMetadata(discovery.metadata, `${path}.metadata`);
  return value as AgentCapabilitiesDiscovery;
}

export function parseAgentRunOptions(
  value: unknown,
  path = "runOptions",
): AgentRunOptions {
  const options = record(value, path);
  optionalString(options.agentId, `${path}.agentId`);
  optionalString(options.model, `${path}.model`);
  optionalString(options.locale, `${path}.locale`);
  optionalString(options.mode, `${path}.mode`);
  optionalMetadata(options.metadata, `${path}.metadata`);
  if (
    options.reasoningEffort !== undefined &&
    !new Set(["none", "minimal", "low", "medium", "high", "xhigh"]).has(
      String(options.reasoningEffort),
    )
  ) {
    throw new AgentProtocolValidationError(
      `${path}.reasoningEffort`,
      "unsupported reasoning effort",
    );
  }
  if (options.toolChoice !== undefined) {
    if (typeof options.toolChoice === "string") {
      if (!new Set(["auto", "none", "required"]).has(options.toolChoice)) {
        throw new AgentProtocolValidationError(
          `${path}.toolChoice`,
          "unsupported tool choice",
        );
      }
    } else {
      const choice = record(options.toolChoice, `${path}.toolChoice`);
      string(choice.name, `${path}.toolChoice.name`);
    }
  }
  if (
    options.temperature !== undefined &&
    (typeof options.temperature !== "number" ||
      !Number.isFinite(options.temperature))
  ) {
    throw new AgentProtocolValidationError(
      `${path}.temperature`,
      "expected a number",
    );
  }
  if (
    options.parallelToolCalls !== undefined &&
    typeof options.parallelToolCalls !== "boolean"
  ) {
    throw new AgentProtocolValidationError(
      `${path}.parallelToolCalls`,
      "expected a boolean",
    );
  }
  return value as AgentRunOptions;
}

export function parseStartRunInput(
  value: unknown,
  path = "startRun",
): StartRunInput {
  const input = record(value, path);
  string(input.threadId, `${path}.threadId`);
  array(input.messages, `${path}.messages`).forEach((message, index) =>
    parseAgentMessage(message, `${path}.messages[${index}]`),
  );
  if (input.options !== undefined) {
    parseAgentRunOptions(input.options, `${path}.options`);
  }
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as StartRunInput;
}

export function parseSubscribeToRunInput(
  value: unknown,
  path = "subscribeToRun",
): SubscribeToRunInput {
  const input = record(value, path);
  string(input.threadId, `${path}.threadId`);
  string(input.runId, `${path}.runId`);
  if (input.afterSequence !== undefined) {
    nonNegativeSafeInteger(input.afterSequence, `${path}.afterSequence`);
  }
  if (input.signal !== undefined) {
    const signal = record(input.signal, `${path}.signal`);
    if (
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function"
    ) {
      throw new AgentProtocolValidationError(
        `${path}.signal`,
        "expected an AbortSignal-compatible value",
      );
    }
  }
  return value as unknown as SubscribeToRunInput;
}

export function parseAgentRequestContext(
  value: unknown,
  path = "requestContext",
): AgentRequestContext {
  const context = record(value, path);
  knownKeys(context, ["signal", "correlationId"], path);
  optionalString(context.correlationId, `${path}.correlationId`);
  if (context.signal !== undefined) {
    const signal = record(context.signal, `${path}.signal`);
    if (
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function"
    ) {
      throw new AgentProtocolValidationError(
        `${path}.signal`,
        "expected an AbortSignal-compatible value",
      );
    }
  }
  return value as AgentRequestContext;
}

export function parseThreadIdInput(
  value: unknown,
  path = "thread",
): ThreadIdInput {
  const input = record(value, path);
  string(input.threadId, `${path}.threadId`);
  return value as ThreadIdInput;
}

export function parseThreadMessageInput(
  value: unknown,
  path = "threadMessage",
): ThreadMessageInput {
  const input = record(parseThreadIdInput(value, path), path);
  string(input.messageId, `${path}.messageId`);
  return value as ThreadMessageInput;
}

export function parseGetRunInput(value: unknown, path = "getRun"): GetRunInput {
  const input = record(parseThreadIdInput(value, path), path);
  string(input.runId, `${path}.runId`);
  return value as GetRunInput;
}

export function parseListThreadsInput(
  value: unknown,
  path = "listThreads",
): ListThreadsInput {
  const input = record(value, path);
  if (input.limit !== undefined) {
    positiveSafeInteger(input.limit, `${path}.limit`);
  }
  optionalString(input.cursor, `${path}.cursor`);
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as ListThreadsInput;
}

export function parseCreateThreadInput(
  value: unknown,
  path = "createThread",
): CreateThreadInput {
  const input = record(value, path);
  optionalString(input.id, `${path}.id`);
  optionalString(input.title, `${path}.title`);
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as CreateThreadInput;
}

export function parseUpdateThreadInput(
  value: unknown,
  path = "updateThread",
): UpdateThreadInput {
  const input = record(parseThreadIdInput(value, path), path);
  optionalString(input.title, `${path}.title`);
  optionalMetadata(input.metadata, `${path}.metadata`);
  if (
    input.status !== undefined &&
    input.status !== "active" &&
    input.status !== "archived"
  ) {
    throw new AgentProtocolValidationError(
      `${path}.status`,
      "expected active or archived",
    );
  }
  return value as UpdateThreadInput;
}

export function parseForkThreadInput(
  value: unknown,
  path = "forkThread",
): ForkThreadInput {
  const input = record(parseThreadIdInput(value, path), path);
  optionalString(input.fromMessageId, `${path}.fromMessageId`);
  optionalString(input.title, `${path}.title`);
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as ForkThreadInput;
}

export function parseQueueMessageInput(
  value: unknown,
  path = "queueMessage",
): QueueMessageInput {
  const input = record(parseThreadIdInput(value, path), path);
  if (typeof input.text !== "string") {
    throw new AgentProtocolValidationError(`${path}.text`, "expected a string");
  }
  if (input.attachments !== undefined) {
    array(input.attachments, `${path}.attachments`).forEach(
      (attachment, index) => {
        validateMessagePart(attachment, `${path}.attachments[${index}]`);
        if (
          record(attachment, `${path}.attachments[${index}]`).type !== "file"
        ) {
          throw new AgentProtocolValidationError(
            `${path}.attachments[${index}].type`,
            "expected file",
          );
        }
      },
    );
  }
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as QueueMessageInput;
}

export function parseCancelRunInput(
  value: unknown,
  path = "cancelRun",
): CancelRunInput {
  const input = record(parseThreadIdInput(value, path), path);
  string(input.runId, `${path}.runId`);
  return value as CancelRunInput;
}

export function parseResolveApprovalInput(
  value: unknown,
  path = "resolveApproval",
): ResolveApprovalInput {
  const input = record(parseCancelRunInput(value, path), path);
  string(input.approvalId, `${path}.approvalId`);
  optionalString(input.optionId, `${path}.optionId`);
  validateApprovalResponse(input.response, `${path}.response`);
  return value as ResolveApprovalInput;
}

export function parseResolveConnectionRequestInput(
  value: unknown,
  path = "resolveConnectionRequest",
): ResolveConnectionRequestInput {
  const input = record(parseCancelRunInput(value, path), path);
  string(input.requestId, `${path}.requestId`);
  parseAgentConnectionResponse(input.response, `${path}.response`);
  return value as ResolveConnectionRequestInput;
}

export function parseInvokeActionInput(
  value: unknown,
  path = "invokeAction",
): InvokeActionInput {
  const input = record(value, path);
  const invocation = record(input.invocation, `${path}.invocation`);
  string(invocation.id, `${path}.invocation.id`);
  string(invocation.action, `${path}.invocation.action`);
  string(invocation.threadId, `${path}.invocation.threadId`);
  optionalString(invocation.runId, `${path}.invocation.runId`);
  optionalString(invocation.messageId, `${path}.invocation.messageId`);
  optionalString(invocation.widgetId, `${path}.invocation.widgetId`);
  optionalString(invocation.itemId, `${path}.invocation.itemId`);
  if (invocation.payload !== undefined) {
    validateJsonValue(invocation.payload, `${path}.invocation.payload`);
  }
  optionalMetadata(invocation.metadata, `${path}.invocation.metadata`);
  return value as InvokeActionInput;
}

export function parseCreateUploadInput(
  value: unknown,
  path = "createUpload",
): CreateUploadInput {
  const input = record(parseThreadIdInput(value, path), path);
  const descriptor = record(input.descriptor, `${path}.descriptor`);
  string(descriptor.name, `${path}.descriptor.name`);
  string(descriptor.mediaType, `${path}.descriptor.mediaType`);
  nonNegativeSafeInteger(descriptor.size, `${path}.descriptor.size`);
  optionalString(descriptor.checksum, `${path}.descriptor.checksum`);
  optionalString(descriptor.purpose, `${path}.descriptor.purpose`);
  optionalMetadata(descriptor.metadata, `${path}.descriptor.metadata`);
  return value as CreateUploadInput;
}

export function parseCompleteUploadInput(
  value: unknown,
  path = "completeUpload",
): CompleteUploadInput {
  const input = record(parseThreadIdInput(value, path), path);
  string(input.uploadId, `${path}.uploadId`);
  return value as CompleteUploadInput;
}

export function parseSubmitFeedbackInput(
  value: unknown,
  path = "submitFeedback",
): SubmitFeedbackInput {
  const input = record(parseThreadIdInput(value, path), path);
  string(input.messageId, `${path}.messageId`);
  if (
    input.value !== "positive" &&
    input.value !== "negative" &&
    input.value !== "dismissed"
  ) {
    throw new AgentProtocolValidationError(
      `${path}.value`,
      "expected positive, negative, or dismissed",
    );
  }
  optionalString(input.reason, `${path}.reason`);
  optionalMetadata(input.metadata, `${path}.metadata`);
  return value as SubmitFeedbackInput;
}

export function parseAgentProtocolEnvelope<TPayload = unknown>(
  value: unknown,
  parsePayload?: (payload: unknown, path: string) => TPayload,
  path = "envelope",
): AgentProtocolEnvelope<TPayload> {
  const envelope = record(value, path);
  knownKeys(
    envelope,
    ["protocol", "version", "kind", "correlationId", "metadata", "payload"],
    path,
  );
  if (envelope.protocol !== AGENTKIT_PROTOCOL_NAME) {
    throw new AgentProtocolValidationError(
      `${path}.protocol`,
      `expected ${AGENTKIT_PROTOCOL_NAME}`,
    );
  }
  if (!isAgentKitProtocolVersion(envelope.version)) {
    throw new AgentProtocolValidationError(
      `${path}.version`,
      `unsupported protocol version ${JSON.stringify(envelope.version)}`,
    );
  }
  const kind = string(envelope.kind, `${path}.kind`);
  if (!new Set(["request", "response", "event", "error"]).has(kind)) {
    throw new AgentProtocolValidationError(
      `${path}.kind`,
      `unsupported envelope kind ${JSON.stringify(kind)}`,
    );
  }
  if (!("payload" in envelope)) {
    throw new AgentProtocolValidationError(`${path}.payload`, "is required");
  }
  optionalString(envelope.correlationId, `${path}.correlationId`);
  optionalMetadata(envelope.metadata, `${path}.metadata`);
  validateJsonValue(envelope.payload, `${path}.payload`);

  const payload = parsePayload
    ? parsePayload(envelope.payload, `${path}.payload`)
    : kind === "error"
      ? (parseAgentError(envelope.payload, `${path}.payload`) as TPayload)
      : (envelope.payload as TPayload);

  return {
    protocol: AGENTKIT_PROTOCOL_NAME,
    version: AGENTKIT_PROTOCOL_VERSION,
    kind: kind as AgentProtocolEnvelope["kind"],
    correlationId: envelope.correlationId as string | undefined,
    metadata: envelope.metadata as AgentProtocolMetadata | undefined,
    payload,
  };
}

export function createAgentProtocolEnvelope<TPayload>(
  kind: AgentProtocolEnvelope["kind"],
  payload: TPayload,
  correlationId?: string,
  metadata?: AgentProtocolMetadata,
): AgentProtocolEnvelope<TPayload> {
  return {
    protocol: AGENTKIT_PROTOCOL_NAME,
    version: AGENTKIT_PROTOCOL_VERSION,
    kind,
    correlationId,
    metadata,
    payload,
  };
}

/** Narrows a message part after validating it at a transport boundary. */
export function parseAgentMessagePart(
  value: unknown,
  path = "part",
): AgentMessagePart {
  validateMessagePart(value, path);
  return value as AgentMessagePart;
}
