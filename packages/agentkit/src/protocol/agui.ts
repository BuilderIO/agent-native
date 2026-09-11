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

/**
 * The profile identifier carried on every frame. AG-UI has no protocol version
 * of its own, so a reader that cannot recognise this string must not assume the
 * Builder extensions below are absent — it must refuse the stream.
 */
export const AGENTKIT_PROFILE_NAME = "builder.agentkit";
export const AGENTKIT_PROFILE_VERSION = 1;
export const AGENTKIT_PROFILE_ID = `${AGENTKIT_PROFILE_NAME}.v${AGENTKIT_PROFILE_VERSION}`;

/**
 * Namespace for the Builder events that AG-UI has no counterpart for. They ride
 * on `CUSTOM` as `<AGENTKIT_PROFILE_ID>/<domain event type>`.
 */
export const AGENTKIT_PROFILE_EVENT_PREFIX = `${AGENTKIT_PROFILE_ID}/`;

/**
 * Single metadata key holding every Builder extension. `@ag-ui/core` reserves
 * `AGUI_METADATA_KEY` ("ag-ui") for itself, so nesting under one owned key
 * keeps the two from colliding as either side adds fields.
 */
export const AGENTKIT_METADATA_KEY = AGENTKIT_PROFILE_NAME;

/** HTTP header advertising the profile so negotiation fails before streaming. */
export const AGENTKIT_PROFILE_HEADER = "x-agentkit-profile";

/**
 * The Builder extensions to a base protocol that defines none of them.
 *
 * `seq` is the load-bearing one: `@ag-ui/core@0.0.59` documents a `resumable`
 * transport capability but never defines a sequence, event id, or replay cursor
 * anywhere on the wire, so two AG-UI implementations that both advertise it
 * would have invented incompatible schemes. Everything else here exists because
 * AG-UI's native event for the same value cannot carry it losslessly.
 */
export interface AgentKitProfileExtension {
  /** Profile version, so a frame remains self-describing outside its stream. */
  v: number;
  /**
   * Domain event type. Carried even for native mappings because three domain
   * types share `ACTIVITY_SNAPSHOT` and two share `RUN_FINISHED`, so the AG-UI
   * `type` alone cannot identify the frame on the way back.
   */
  t: string;
  /** Per-`(threadId, runId)` monotonic cursor. Also emitted as the SSE `id:`. */
  seq: number;
  id: EventId;
  /**
   * The domain timestamp verbatim. AG-UI's `timestamp` is epoch milliseconds,
   * which cannot round-trip an offset, so the original string travels too.
   */
  at: string;
  meta?: AgentProtocolMetadata;
  /**
   * Fields the native AG-UI event has no slot for. Present only on the six
   * events the mapping table marks partial; a direct mapping omits it entirely.
   */
  residual?: Record<string, unknown>;
}

/**
 * Domain event types that reach a native AG-UI event, and which one.
 *
 * Reaching a native event is not the same as fitting in it. Only the types in
 * {@link AGENTKIT_LOSSLESS_EVENT_TYPES} survive the trip on native fields
 * alone; every other entry here also ships its domain payload in
 * `residual`, because AG-UI's event carries a strict subset of the fields.
 * `activity.updated` is the sharpest case: AG-UI's `ACTIVITY_DELTA` is a JSON
 * Patch against prior state, which a stateless encoder cannot produce, so all
 * three activity events map to `ACTIVITY_SNAPSHOT` instead.
 */
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

/**
 * The mappings that need no residual. Two, out of the twelve the evaluation
 * table calls "Direct" — the rest carry structure AG-UI's event has no slot
 * for, so "direct" describes the event name, not the payload.
 */
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

/**
 * `message.delta` only fits when it does not set `format`; AG-UI's
 * `TEXT_MESSAGE_CONTENT` has no formatting field.
 */
export function isLosslessEventType(type: string): boolean {
  return LOSSLESS_EVENT_TYPE_SET.has(type);
}

/**
 * Everything else. These have no AG-UI counterpart at all and are the reason
 * the profile exists: adopting AG-UI wholesale would delete the capabilities
 * behind them, not express them differently.
 *
 * `approval.resolved` sits here rather than with the native mappings because
 * AG-UI models resolution only as a `resume[]` command on the next run input.
 * The command exists, but there is no event announcing it to other observers of
 * the thread, so the profile keeps one.
 */
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

/** Host-defined `x-*` events also travel as profile events. */
export function isProfileEventType(type: string): boolean {
  return PROFILE_EVENT_TYPE_SET.has(type) || type.startsWith("x-");
}

export function profileEventName(type: string): string {
  return `${AGENTKIT_PROFILE_EVENT_PREFIX}${type}`;
}

/**
 * Returns the domain event type for a `CUSTOM` name, or `undefined` when the
 * name belongs to another profile. A foreign `CUSTOM` is another producer's
 * business, not a malformed frame, so it is skipped rather than rejected.
 */
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

/**
 * Reads the Builder extension off an AG-UI frame. A frame that reached an
 * AgentKit consumer without it is unreadable, not empty: silently defaulting
 * `seq` would let the reducer accept a stream it can no longer detect gaps in.
 */
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

/**
 * Approval decisions travel as AG-UI resume entries. Both directions live here
 * so the client that writes an entry and the runtime that reads one cannot
 * drift into two different payload shapes.
 */
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
