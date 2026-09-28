import { EventType } from "@ag-ui/core";

import type {
  AgentApprovalResponse,
  AgentEvent,
  AgentProtocolMetadata,
  AgentResumeEntry,
  ApprovalId,
  EventId,
  RunId,
  ThreadId,
} from "./index.js";
import {
  AgentProtocolValidationError,
  parseAgentApprovalResponse,
} from "./validation.js";

export const AGENTKIT_PROFILE_NAME = "builder.agentkit";
export const AGENTKIT_PROFILE_VERSION = 1;
export const AGENTKIT_PROFILE_ID = `${AGENTKIT_PROFILE_NAME}.v${AGENTKIT_PROFILE_VERSION}`;

export const AGENTKIT_PROFILE_EVENT_PREFIX = `${AGENTKIT_PROFILE_ID}/`;

export const AGENTKIT_METADATA_KEY = AGENTKIT_PROFILE_NAME;

export const AGENTKIT_PROFILE_HEADER = "x-agentkit-profile";

export interface AgentKitProfileExtension {
  v: number;
  t: string;
  seq: number;
  id: EventId;
  at: string;
  meta?: AgentProtocolMetadata;
  residual?: Record<string, unknown>;
}

export const AGENTKIT_NATIVE_EVENT_TYPES = {
  "run.started": EventType.RUN_STARTED,
  "run.completed": EventType.RUN_FINISHED,
  "run.failed": EventType.RUN_ERROR,
  "run.status": EventType.STEP_STARTED,
  "message.created": EventType.TEXT_MESSAGE_START,
  "message.delta": EventType.TEXT_MESSAGE_CONTENT,
  "message.completed": EventType.TEXT_MESSAGE_END,
  "reasoning.delta": EventType.REASONING_MESSAGE_CONTENT,
  "tool.started": EventType.TOOL_CALL_START,
  "tool.delta": EventType.TOOL_CALL_ARGS,
  "tool.updated": EventType.TOOL_CALL_RESULT,
  "activity.started": EventType.ACTIVITY_SNAPSHOT,
  "activity.updated": EventType.ACTIVITY_SNAPSHOT,
  "activity.completed": EventType.ACTIVITY_SNAPSHOT,
  "agent.registered": EventType.SUBAGENT_STARTED,
  "agent.unregistered": EventType.SUBAGENT_FINISHED,
  "approval.requested": EventType.RUN_FINISHED,
} as const satisfies Partial<Record<AgentEvent["type"], EventType>>;

export const AGENTKIT_LOSSLESS_EVENT_TYPES = [
  "reasoning.delta",
  "message.delta",
] as const satisfies readonly AgentEvent["type"][];

export type AgentKitNativeEventType = keyof typeof AGENTKIT_NATIVE_EVENT_TYPES;

const LOSSLESS_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  AGENTKIT_LOSSLESS_EVENT_TYPES,
);

export function isNativeEventType(
  type: string,
): type is AgentKitNativeEventType {
  return type in AGENTKIT_NATIVE_EVENT_TYPES;
}

export function isLosslessEventType(type: string): boolean {
  return LOSSLESS_EVENT_TYPE_SET.has(type);
}

export const AGENTKIT_PROFILE_EVENT_TYPES = [
  "run.cancelled",
  "approval.resolved",
  "agent.updated",
  "agent.interaction",
  "connection.requested",
  "connection.updated",
  "task.created",
  "task.updated",
  "task.completed",
  "task-group.created",
  "task-group.updated",
  "task-group.completed",
  "task-group.removed",
  "artifact.created",
  "widget.created",
  "widget.updated",
  "widget.removed",
  "annotation.created",
  "annotation.updated",
  "annotation.removed",
  "suggestions.updated",
  "action.started",
  "action.completed",
  "action.failed",
  "upload.progress",
  "client.effect",
  "client.deeplink",
  "thread.updated",
  "queue.updated",
] as const satisfies readonly AgentEvent["type"][];

export type AgentKitProfileEventType =
  (typeof AGENTKIT_PROFILE_EVENT_TYPES)[number];

const PROFILE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  AGENTKIT_PROFILE_EVENT_TYPES,
);

export function isProfileEventType(type: string): boolean {
  return PROFILE_EVENT_TYPE_SET.has(type) || type.startsWith("x-");
}

export function profileEventName(type: string): string {
  return `${AGENTKIT_PROFILE_EVENT_PREFIX}${type}`;
}

export function profileEventTypeFromName(name: string): string | undefined {
  if (!name.startsWith(AGENTKIT_PROFILE_EVENT_PREFIX)) return undefined;
  return name.slice(AGENTKIT_PROFILE_EVENT_PREFIX.length);
}

export interface AgentKitStreamContext {
  threadId: ThreadId;
  runId: RunId;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentProtocolValidationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

export function readProfileExtension(
  metadata: unknown,
  path = "metadata",
): AgentKitProfileExtension {
  const container = requireRecord(metadata, path);
  const extension = requireRecord(
    container[AGENTKIT_METADATA_KEY],
    `${path}.${AGENTKIT_METADATA_KEY}`,
  );
  const extensionPath = `${path}.${AGENTKIT_METADATA_KEY}`;

  const version = extension.v;
  if (version !== AGENTKIT_PROFILE_VERSION) {
    throw new AgentProtocolValidationError(
      `${extensionPath}.v`,
      `unsupported profile version ${JSON.stringify(version)}; expected ${AGENTKIT_PROFILE_VERSION}`,
    );
  }

  const domainType = extension.t;
  if (typeof domainType !== "string" || domainType.length === 0) {
    throw new AgentProtocolValidationError(
      `${extensionPath}.t`,
      "expected a domain event type",
    );
  }

  const seq = extension.seq;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
    throw new AgentProtocolValidationError(
      `${extensionPath}.seq`,
      "expected a positive safe integer sequence",
    );
  }

  const id = extension.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new AgentProtocolValidationError(
      `${extensionPath}.id`,
      "expected a non-empty event id",
    );
  }

  const at = extension.at;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    throw new AgentProtocolValidationError(
      `${extensionPath}.at`,
      "expected an ISO-8601 timestamp",
    );
  }

  const meta =
    extension.meta === undefined
      ? undefined
      : (requireRecord(
          extension.meta,
          `${extensionPath}.meta`,
        ) as AgentProtocolMetadata);

  const residual =
    extension.residual === undefined
      ? undefined
      : requireRecord(extension.residual, `${extensionPath}.residual`);

  return {
    v: AGENTKIT_PROFILE_VERSION,
    t: domainType,
    seq,
    id,
    at,
    meta,
    residual,
  };
}

export function writeProfileExtension(
  extension: Omit<AgentKitProfileExtension, "v">,
): Record<string, unknown> {
  const value: AgentKitProfileExtension = {
    v: AGENTKIT_PROFILE_VERSION,
    t: extension.t,
    seq: extension.seq,
    id: extension.id,
    at: extension.at,
  };
  if (extension.meta !== undefined) value.meta = extension.meta;
  if (extension.residual !== undefined) value.residual = extension.residual;
  return { [AGENTKIT_METADATA_KEY]: value };
}

export function resumeEntryFromApproval(input: {
  approvalId: ApprovalId;
  optionId?: string;
  response: AgentApprovalResponse;
}): AgentResumeEntry {
  return {
    interruptId: input.approvalId,
    status: "resolved",
    payload: {
      ...input.response,
      ...(input.optionId === undefined ? {} : { optionId: input.optionId }),
    },
  };
}

function resumePayload(entry: AgentResumeEntry): Record<string, unknown> {
  return requireRecord(entry.payload, "resume.payload");
}

function approvalResponseFromPayload(
  payload: Record<string, unknown>,
): AgentApprovalResponse {
  if (payload.decision !== "approve" && payload.decision !== "deny") {
    throw new AgentProtocolValidationError(
      "resume.payload.decision",
      'An approval response must include decision "approve" or "deny".',
    );
  }
  return parseAgentApprovalResponse(
    {
      decision: payload.decision,
      ...(payload.optionIds === undefined
        ? {}
        : { optionIds: payload.optionIds }),
      ...(payload.other === undefined ? {} : { other: payload.other }),
      ...(payload.input === undefined ? {} : { input: payload.input }),
    },
    "resume.payload",
  );
}

export function approvalResponseFromResume(
  entry: AgentResumeEntry,
): AgentApprovalResponse {
  if (entry.status === "cancelled") {
    if (entry.payload === undefined) return { decision: "deny" };
    const payload = resumePayload(entry);
    if (payload.decision !== undefined && payload.decision !== "deny") {
      throw new AgentProtocolValidationError(
        "resume.payload.decision",
        'A cancelled interrupt cannot contain an "approve" decision.',
      );
    }
    return approvalResponseFromPayload({ ...payload, decision: "deny" });
  }
  const payload = resumePayload(entry);
  return approvalResponseFromPayload(payload);
}

export function resumeOptionId(entry: AgentResumeEntry): string | undefined {
  if (entry.payload === undefined) return undefined;
  const optionId = resumePayload(entry).optionId;
  if (optionId === undefined) return undefined;
  if (typeof optionId !== "string" || optionId.length === 0) {
    throw new AgentProtocolValidationError(
      "resume.payload.optionId",
      "expected a non-empty string",
    );
  }
  return optionId;
}
