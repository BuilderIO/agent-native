import { EventSchemas, EventType, type AGUIEvent } from "@ag-ui/core";

import {
  AGENTKIT_METADATA_KEY,
  AGENTKIT_NATIVE_EVENT_TYPES,
  isLosslessEventType,
  isNativeEventType,
  isProfileEventType,
  profileEventName,
  profileEventTypeFromName,
  readProfileExtension,
  writeProfileExtension,
  type AgentKitStreamContext,
} from "./agui.js";
import type { AgentEvent, AgentProtocolMetadata } from "./index.js";
import { AgentProtocolValidationError, parseAgentEvent } from "./validation.js";

/** Base fields every domain event carries; everything else is payload. */
const BASE_EVENT_KEYS = [
  "id",
  "type",
  "threadId",
  "runId",
  "sequence",
  "occurredAt",
  "metadata",
] as const;

type UnknownRecord = Record<string, unknown>;

function payloadOf(event: AgentEvent): UnknownRecord {
  const payload: UnknownRecord = {};
  for (const [key, value] of Object.entries(
    event as unknown as UnknownRecord,
  )) {
    if ((BASE_EVENT_KEYS as readonly string[]).includes(key)) continue;
    payload[key] = value;
  }
  return payload;
}

function asRecord(value: unknown): UnknownRecord {
  return (
    typeof value === "object" && value !== null ? value : {}
  ) as UnknownRecord;
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentProtocolValidationError(path, "must be an object");
  }
  return value as UnknownRecord;
}

function assertPayloadDoesNotRedefineBase(
  payload: UnknownRecord,
  path: string,
): void {
  for (const key of BASE_EVENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new AgentProtocolValidationError(
        `${path}.${key}`,
        "cannot redefine a protocol envelope field",
      );
    }
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Projects a domain event onto the fields of its native AG-UI event. This is
 * what an AG-UI-only consumer reads; an AgentKit consumer rebuilds from the
 * profile residual instead, so a lossy projection here is a rendering
 * concession for foreign clients, never a loss of protocol state.
 */
function nativeProjection(event: AgentEvent): UnknownRecord {
  switch (event.type) {
    case "run.started":
      return { threadId: event.threadId, runId: event.runId };
    case "run.completed":
      return {
        threadId: event.threadId,
        runId: event.runId,
        outcome: { type: "success" },
      };
    case "run.failed":
      return { message: event.error.message, code: event.error.code };
    case "run.status":
      return { stepName: event.status };
    case "message.created":
      return {
        messageId: event.message.id,
        role: event.message.role === "tool" ? "assistant" : event.message.role,
      };
    case "message.delta":
      return { messageId: event.messageId, delta: event.text };
    case "message.completed":
      return { messageId: event.message.id };
    case "reasoning.delta":
      return { messageId: event.messageId, delta: event.text };
    case "tool.started":
      return {
        toolCallId: event.toolCall.id,
        toolCallName: event.toolCall.name,
        parentMessageId: event.toolCall.messageId,
      };
    case "tool.delta":
      return {
        toolCallId: event.toolCallId,
        delta: event.inputTextDelta ?? "",
      };
    case "tool.updated":
      return {
        messageId: event.toolCall.messageId ?? event.toolCall.id,
        toolCallId: event.toolCall.id,
        content:
          typeof event.toolCall.output === "string"
            ? event.toolCall.output
            : JSON.stringify(event.toolCall.output ?? null),
      };
    case "activity.started":
    case "activity.updated":
    case "activity.completed":
      return {
        messageId: event.activity.id,
        activityType: event.activity.kind,
        content: { ...event.activity } as UnknownRecord,
        replace: event.type !== "activity.started",
      };
    case "agent.registered":
      return {
        subagentRunId: event.agent.id,
        name: event.agent.name,
        description: event.agent.description,
        parentSubagentRunId: event.agent.parentAgentId,
      };
    case "agent.unregistered":
      return { subagentRunId: event.agent.id };
    case "approval.requested":
      return {
        threadId: event.threadId,
        runId: event.runId,
        outcome: {
          type: "interrupt",
          interrupts: [
            {
              id: event.request.id,
              reason: event.request.title,
              message: event.request.description,
              expiresAt: event.request.expiresAt,
            },
          ],
        },
      };
    default:
      return {};
  }
}

/**
 * Encodes one domain event as exactly one AG-UI event.
 *
 * The 1:1 rule is deliberate. The sequence lives on the AG-UI frame, so fanning
 * a domain event out into several frames would either duplicate a cursor value
 * or consume slots the producer's own numbering knows nothing about, and the
 * reducer's gap detection is only as trustworthy as that numbering.
 */
export function encodeAgentEvent(event: AgentEvent): AGUIEvent {
  const type = event.type;
  const extension = writeProfileExtension({
    t: type,
    seq: event.sequence,
    id: event.id,
    at: event.occurredAt,
    meta: event.metadata,
    residual:
      isLosslessEventType(type) &&
      !(event.type === "message.delta" && event.format !== undefined)
        ? undefined
        : payloadOf(event),
  });

  const frame: UnknownRecord = {
    timestamp: Date.parse(event.occurredAt),
    metadata: extension,
  };

  if (isNativeEventType(type)) {
    return {
      ...frame,
      ...nativeProjection(event),
      type: AGENTKIT_NATIVE_EVENT_TYPES[type],
    } as AGUIEvent;
  }

  if (!isProfileEventType(type)) {
    throw new AgentProtocolValidationError(
      "event.type",
      `no AG-UI mapping is defined for ${JSON.stringify(type)}`,
    );
  }

  return {
    ...frame,
    type: EventType.CUSTOM,
    name: profileEventName(type),
    value: payloadOf(event),
  } as AGUIEvent;
}

/**
 * Rebuilds a domain event from an AG-UI frame.
 *
 * Returns `undefined` only for frames that carry no Builder extension — another
 * producer's `CUSTOM`, or an AG-UI event type Builder never emits. Those are
 * outside the profile and outside its numbering, so skipping them cannot open a
 * gap. A frame that *does* carry the extension must decode or throw; treating
 * an unreadable Builder frame as absent is what would hide a real gap.
 */
export function decodeAgUiEvent(
  value: unknown,
  context: AgentKitStreamContext,
  path = "event",
): AgentEvent | undefined {
  const parsed = EventSchemas.safeParse(value);
  if (!parsed.success) {
    throw new AgentProtocolValidationError(
      path,
      `is not a valid AG-UI event: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
    );
  }

  const frame = parsed.data as UnknownRecord;
  const metadata = asRecord(frame.metadata);
  if (!(AGENTKIT_METADATA_KEY in metadata)) return undefined;

  const extension = readProfileExtension(metadata, `${path}.metadata`);

  const base = {
    id: extension.id,
    threadId: context.threadId,
    runId: context.runId,
    sequence: extension.seq,
    occurredAt: extension.at,
    ...(extension.meta === undefined
      ? {}
      : { metadata: extension.meta as AgentProtocolMetadata }),
  };

  if (frame.type === EventType.CUSTOM) {
    const name = typeof frame.name === "string" ? frame.name : "";
    const domainType = profileEventTypeFromName(name);
    if (domainType === undefined) {
      throw new AgentProtocolValidationError(
        `${path}.name`,
        `is not an AgentKit profile event name`,
      );
    }
    if (domainType !== extension.t) {
      throw new AgentProtocolValidationError(
        `${path}.name`,
        `disagrees with the profile event type ${JSON.stringify(extension.t)}`,
      );
    }
    if (isNativeEventType(domainType)) {
      throw new AgentProtocolValidationError(
        `${path}.type`,
        `must use the native AG-UI mapping for ${JSON.stringify(domainType)}`,
      );
    }
    const payload = requireRecord(frame.value, `${path}.value`);
    assertPayloadDoesNotRedefineBase(payload, `${path}.value`);
    return parseAgentEvent({ ...payload, ...base, type: domainType }, path);
  }

  if (!isNativeEventType(extension.t)) {
    throw new AgentProtocolValidationError(
      `${path}.type`,
      `has no native mapping for profile event type ${JSON.stringify(extension.t)}`,
    );
  }
  if (frame.type !== AGENTKIT_NATIVE_EVENT_TYPES[extension.t]) {
    throw new AgentProtocolValidationError(
      `${path}.type`,
      `disagrees with the native mapping for ${JSON.stringify(extension.t)}`,
    );
  }

  if (extension.residual !== undefined) {
    assertPayloadDoesNotRedefineBase(
      extension.residual,
      `${path}.metadata.${AGENTKIT_METADATA_KEY}.residual`,
    );
    return parseAgentEvent(
      { ...extension.residual, ...base, type: extension.t },
      path,
    );
  }

  return parseAgentEvent(
    decodeLosslessNative(frame, base, extension.t, path),
    path,
  );
}

function decodeLosslessNative(
  frame: UnknownRecord,
  base: UnknownRecord,
  type: string,
  path: string,
): AgentEvent {
  switch (type) {
    case "reasoning.delta":
    case "message.delta":
      return {
        ...base,
        type,
        messageId: optionalString(frame.messageId) ?? "",
        text: typeof frame.delta === "string" ? frame.delta : "",
      } as AgentEvent;
    default:
      throw new AgentProtocolValidationError(
        `${path}.metadata`,
        `event type ${JSON.stringify(type)} requires a residual payload`,
      );
  }
}

/**
 * Validates that a frame is legal AG-UI regardless of the profile, so a
 * conformance suite can prove Builder streams stay readable by stock clients.
 */
export function isAgUiEvent(value: unknown): value is AGUIEvent {
  return EventSchemas.safeParse(value).success;
}
