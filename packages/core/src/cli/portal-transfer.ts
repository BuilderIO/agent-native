import { serializeBoundedRemoteJson } from "../integrations/remote-json-safety.js";
import { appendCodeAgentTranscriptEvent } from "./code-agent-runs.js";

export const PORTAL_TRANSFER_SCHEMA_VERSION = 1 as const;
export const PORTAL_TRANSFER_MAX_CONTEXT_BYTES = 900_000;

const BINARY_FIELD_NAMES = new Set([
  "base64",
  "dataurl",
  "image",
  "imagebase64",
  "imagedata",
  "imagebytes",
  "screenshot",
  "screenshotbase64",
  "screenshotdata",
  "bytes",
  "buffer",
]);

export type PortalTransferEventKind =
  | "user"
  | "system"
  | "note"
  | "artifact"
  | "status";

export interface PortalTransferTranscriptEvent {
  schemaVersion: 1;
  id: string;
  kind: PortalTransferEventKind;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  signal?: "credential-gap";
}

export interface PortalTransferContext {
  schemaVersion: 1;
  sourceRunId: string;
  sourceStatus?: string;
  sourcePhase?: string;
  events: PortalTransferTranscriptEvent[];
}

export interface PortalTransferSourceEvent {
  id?: unknown;
  runId?: unknown;
  kind?: unknown;
  type?: unknown;
  message?: unknown;
  text?: unknown;
  createdAt?: unknown;
  metadata?: unknown;
  signal?: unknown;
}

export function createPortalTransferContext(input: {
  sourceRunId: string;
  sourceStatus?: string;
  sourcePhase?: string;
  events: readonly PortalTransferSourceEvent[];
}): PortalTransferContext {
  const sourceRunId = requireString(input.sourceRunId, "source run id");
  const context: PortalTransferContext = {
    schemaVersion: PORTAL_TRANSFER_SCHEMA_VERSION,
    sourceRunId,
    ...(input.sourceStatus
      ? { sourceStatus: requireString(input.sourceStatus, "source status") }
      : {}),
    ...(input.sourcePhase
      ? { sourcePhase: requireString(input.sourcePhase, "source phase") }
      : {}),
    events: input.events.map((event, index) =>
      normalizeSourceEvent(event, index),
    ),
  };

  serializeBoundedRemoteJson(context, {
    label: "Portal transcript context",
    maxBytes: PORTAL_TRANSFER_MAX_CONTEXT_BYTES,
  });
  return context;
}

export function parsePortalTransferContext(
  value: unknown,
): PortalTransferContext | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Portal transfer context has an unsupported version.");
  }
  const sourceRunId = requireString(value.sourceRunId, "source run id");
  if (!Array.isArray(value.events)) {
    throw new Error("Portal transfer context is missing transcript events.");
  }
  const events = value.events.map((event, index) => {
    if (!isRecord(event)) {
      throw new Error(`Portal transcript event ${index + 1} is invalid.`);
    }
    return normalizeSourceEvent(event, index);
  });
  const sourceStatus = optionalString(value.sourceStatus);
  const sourcePhase = optionalString(value.sourcePhase);
  const context: PortalTransferContext = {
    schemaVersion: 1,
    sourceRunId,
    ...(sourceStatus ? { sourceStatus } : {}),
    ...(sourcePhase ? { sourcePhase } : {}),
    events,
  };
  serializeBoundedRemoteJson(context, {
    label: "Portal transcript context",
    maxBytes: PORTAL_TRANSFER_MAX_CONTEXT_BYTES,
  });
  return context;
}

export function appendPortalTransferTranscript(
  context: PortalTransferContext,
  runId: string,
): number {
  const targetRunId = requireString(runId, "target run id");
  let appended = 0;
  for (const event of context.events) {
    appendCodeAgentTranscriptEvent({
      id: event.id,
      runId: targetRunId,
      kind: event.kind,
      message: event.message,
      createdAt: event.createdAt,
      ...(event.metadata
        ? {
            metadata: {
              ...event.metadata,
              portalTransfer: {
                sourceRunId: context.sourceRunId,
                sourceEventId: event.id,
              },
            },
          }
        : {
            metadata: {
              portalTransfer: {
                sourceRunId: context.sourceRunId,
                sourceEventId: event.id,
              },
            },
          }),
      ...(event.signal ? { signal: event.signal } : {}),
    });
    appended++;
  }
  return appended;
}

export function portalTransferContinuationPrompt(input: {
  hostLabel: string;
  handoffId: string;
  eventCount: number;
}): string {
  return [
    "[Portal session continuation]",
    `This coding session was moved to ${requireString(input.hostLabel, "Portal host label")}.`,
    `Portal handoff: ${requireString(input.handoffId, "Portal handoff id")}`,
    `The preceding ${input.eventCount} transcript event${input.eventCount === 1 ? "" : "s"} came from the original computer and is part of this session context.`,
    "Review the transferred transcript and Portal workspace before acting. Continue the unfinished task from the latest state, and do not repeat work that is already complete.",
  ].join("\n");
}

function normalizeSourceEvent(
  value: PortalTransferSourceEvent,
  index: number,
): PortalTransferTranscriptEvent {
  const id = requireString(value.id, `transcript event ${index + 1} id`);
  const kind = normalizeKind(value.kind ?? value.type, index);
  const messageValue = value.message ?? value.text;
  if (typeof messageValue !== "string") {
    throw new Error(`Portal transcript event ${index + 1} is missing text.`);
  }
  const createdAt = requireString(
    value.createdAt,
    `transcript event ${index + 1} timestamp`,
  );
  const metadata = sanitizeMetadata(value.metadata);
  const signal =
    value.signal === "credential-gap" ? "credential-gap" : undefined;
  return {
    schemaVersion: 1,
    id,
    kind,
    message: messageValue,
    createdAt,
    ...(metadata ? { metadata } : {}),
    ...(signal ? { signal } : {}),
  };
}

function normalizeKind(value: unknown, index: number): PortalTransferEventKind {
  const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    kind === "user" ||
    kind === "system" ||
    kind === "note" ||
    kind === "artifact" ||
    kind === "status"
  ) {
    return kind;
  }
  if (kind === "assistant" || kind === "human" || kind === "prompt") {
    return kind === "assistant" ? "system" : "user";
  }
  throw new Error(`Portal transcript event ${index + 1} has an invalid kind.`);
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized = sanitizeObject(value);
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let binaryOmitted = false;
  for (const [key, child] of Object.entries(value)) {
    if (isBinaryFieldName(key)) {
      binaryOmitted = true;
      continue;
    }
    const sanitized = sanitizeValue(child);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  if (binaryOmitted) result.binaryContentOmitted = true;
  return result;
}

function sanitizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter(
        (item): item is Exclude<unknown, undefined> => item !== undefined,
      );
  }
  if (isRecord(value)) return sanitizeObject(value);
  return undefined;
}

function isBinaryFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BINARY_FIELD_NAMES.has(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`Portal ${label} is missing.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}
