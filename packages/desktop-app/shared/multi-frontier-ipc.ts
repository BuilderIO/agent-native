import {
  normalizeSubscriptionStatus,
  type SubscriptionStatus,
} from "./subscription-status";

export const MULTI_FRONTIER_IPC_SCHEMA_VERSION = 1 as const;
export const MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES = 64 * 1024;
export const MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES = 12 * 1024;
export const MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES = 8 * 1024;
export const MULTI_FRONTIER_IPC_MAX_EVENT_TEXT_BYTES = 16 * 1024;

const MAX_ID_BYTES = 192;
const MAX_MODEL_BYTES = 160;
const MAX_MESSAGE_BYTES = 1_024;
const MAX_ARTIFACTS = 12;
const MAX_SUBSCRIPTION_METERS = 8;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MULTI_FRONTIER_PROVIDER_IDS = ["codex", "claude"] as const;
export type MultiFrontierProviderId =
  (typeof MULTI_FRONTIER_PROVIDER_IDS)[number];

export const MULTI_FRONTIER_PHASES = [
  "proposing",
  "cross_review",
  "converging",
  "awaiting_go",
  "implementing",
  "checkpoint_review",
  "paused",
  "completed",
  "failed",
  "canceled",
] as const;
export type MultiFrontierPhase = (typeof MULTI_FRONTIER_PHASES)[number];

export const MULTI_FRONTIER_PARTICIPANT_ROLES = ["driver", "watchdog"] as const;
export type MultiFrontierParticipantRole =
  (typeof MULTI_FRONTIER_PARTICIPANT_ROLES)[number];

export const MULTI_FRONTIER_PARTICIPANT_PERMISSIONS = [
  "read_only",
  "workspace_write",
] as const;
export type MultiFrontierParticipantPermission =
  (typeof MULTI_FRONTIER_PARTICIPANT_PERMISSIONS)[number];

export const MULTI_FRONTIER_PARTICIPANT_STATUSES = [
  "idle",
  "running",
  "waiting",
  "failed",
  "completed",
] as const;
export type MultiFrontierParticipantStatus =
  (typeof MULTI_FRONTIER_PARTICIPANT_STATUSES)[number];

export const MULTI_FRONTIER_PARTICIPANT_CAPABILITIES = [
  "login",
  "usage",
  "live-usage",
  "read-only",
  "workspace-write",
  "session-resume",
] as const;
export type MultiFrontierParticipantCapability =
  (typeof MULTI_FRONTIER_PARTICIPANT_CAPABILITIES)[number];

export const MULTI_FRONTIER_APPROVAL_STATES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
] as const;
export type MultiFrontierApprovalState =
  (typeof MULTI_FRONTIER_APPROVAL_STATES)[number];

export interface MultiFrontierProviderRequest {
  schemaVersion: 1;
  requestId: string;
  action: "get-status" | "begin-login" | "get-usage";
  providerId: MultiFrontierProviderId;
}

export interface MultiFrontierCreateParticipantRequest {
  participantId: string;
  providerId: MultiFrontierProviderId;
  model?: string;
}

export interface MultiFrontierCreateCollaborationRequest {
  schemaVersion: 1;
  requestId: string;
  action: "create";
  workspaceId: string;
  prompt: string;
  autoContinueAfterAgreement?: boolean;
  participants: [
    MultiFrontierCreateParticipantRequest,
    MultiFrontierCreateParticipantRequest,
  ];
}

export interface MultiFrontierCollaborationIdRequest {
  schemaVersion: 1;
  requestId: string;
  action: "start" | "go" | "pause" | "resume" | "cancel" | "subscribe";
  collaborationId: string;
}

export interface MultiFrontierRoleSwapRequest {
  schemaVersion: 1;
  requestId: string;
  action: "role-swap";
  collaborationId: string;
  nextDriverParticipantId: string;
}

export type MultiFrontierCollaborationRequest =
  | MultiFrontierCreateCollaborationRequest
  | MultiFrontierCollaborationIdRequest
  | MultiFrontierRoleSwapRequest;

export interface MultiFrontierRendererParticipant {
  participantId: string;
  providerId: MultiFrontierProviderId;
  model?: string;
  role: MultiFrontierParticipantRole;
  permission: MultiFrontierParticipantPermission;
  status: MultiFrontierParticipantStatus;
  capabilities: MultiFrontierParticipantCapability[];
}

export interface MultiFrontierArtifactSummary {
  id: string;
  kind: "proposal" | "review" | "checkpoint" | "summary";
  summary: string;
  participantId?: string;
}

/**
 * Presentation data emitted by Electron main. The renderer must never use it
 * as command authority; every command is revalidated against main-process state.
 */
export interface MultiFrontierRendererState {
  rendererStateIsAuthoritative: false;
  collaborationId: string;
  phase: MultiFrontierPhase;
  round: number;
  autoContinueAfterAgreement?: boolean;
  participants: [
    MultiFrontierRendererParticipant,
    MultiFrontierRendererParticipant,
  ];
  driverParticipantId?: string;
  driverGeneration?: number;
  approvalState: MultiFrontierApprovalState;
  artifacts: MultiFrontierArtifactSummary[];
  subscriptions: Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>;
}

export interface MultiFrontierIpcError {
  code:
    | "invalid-request"
    | "not-available"
    | "not-found"
    | "invalid-transition"
    | "operation-failed";
  message: string;
}

export interface MultiFrontierProviderResult {
  schemaVersion: 1;
  requestId: string;
  providerId: MultiFrontierProviderId;
  status: SubscriptionStatus | null;
  error?: MultiFrontierIpcError;
}

export interface MultiFrontierCollaborationResult {
  schemaVersion: 1;
  requestId: string;
  snapshot?: MultiFrontierRendererState;
  error?: MultiFrontierIpcError;
}

export interface MultiFrontierIpcEvent {
  schemaVersion: 1;
  type: "snapshot" | "event";
  collaborationId: string;
  sequence: number;
  snapshot?: MultiFrontierRendererState;
  event?: {
    kind: "lifecycle" | "artifact" | "participant" | "notice";
    participantId?: string;
    text: string;
    artifact?: MultiFrontierArtifactSummary;
  };
}

export function parseMultiFrontierProviderRequest(
  value: unknown,
): MultiFrontierProviderRequest | null {
  if (!isBoundedPayload(value)) return null;
  const input = asRecord(value);
  const requestId = readId(input?.requestId);
  const providerId = readEnum(input?.providerId, MULTI_FRONTIER_PROVIDER_IDS);
  const action = readEnum(input?.action, [
    "get-status",
    "begin-login",
    "get-usage",
  ] as const);
  if (
    input?.schemaVersion !== MULTI_FRONTIER_IPC_SCHEMA_VERSION ||
    !requestId ||
    !providerId ||
    !action
  ) {
    return null;
  }
  return {
    schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
    requestId,
    action,
    providerId,
  };
}

export function parseMultiFrontierCollaborationRequest(
  value: unknown,
): MultiFrontierCollaborationRequest | null {
  if (!isBoundedPayload(value)) return null;
  const input = asRecord(value);
  const requestId = readId(input?.requestId);
  const action = readEnum(input?.action, [
    "create",
    "start",
    "go",
    "pause",
    "resume",
    "cancel",
    "role-swap",
    "subscribe",
  ] as const);
  if (
    input?.schemaVersion !== MULTI_FRONTIER_IPC_SCHEMA_VERSION ||
    !requestId ||
    !action
  ) {
    return null;
  }

  if (action === "create") {
    const workspaceId = readId(input.workspaceId);
    const prompt = readText(input.prompt, MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES);
    const participants = parseCreateParticipants(input.participants);
    const autoContinueAfterAgreement = readOptionalBoolean(
      input.autoContinueAfterAgreement,
    );
    if (
      !workspaceId ||
      !prompt ||
      !participants ||
      autoContinueAfterAgreement === null
    ) {
      return null;
    }
    return {
      schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
      requestId,
      action,
      workspaceId,
      prompt,
      autoContinueAfterAgreement,
      participants,
    };
  }

  const collaborationId = readId(input.collaborationId);
  if (!collaborationId) return null;
  if (action === "role-swap") {
    const nextDriverParticipantId = readId(input.nextDriverParticipantId);
    if (!nextDriverParticipantId) return null;
    return {
      schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
      requestId,
      action,
      collaborationId,
      nextDriverParticipantId,
    };
  }
  return {
    schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
    requestId,
    action,
    collaborationId,
  };
}

export function normalizeMultiFrontierRendererState(
  value: unknown,
): MultiFrontierRendererState | null {
  if (!isBoundedPayload(value)) return null;
  const input = asRecord(value);
  const collaborationId = readId(input?.collaborationId);
  const phase = readEnum(input?.phase, MULTI_FRONTIER_PHASES);
  const round = readSafeInteger(input?.round, 1, 1_000);
  const autoContinueAfterAgreement = readOptionalBoolean(
    input?.autoContinueAfterAgreement,
  );
  const participants = parseRendererParticipants(input?.participants);
  const approvalState = readEnum(
    input?.approvalState,
    MULTI_FRONTIER_APPROVAL_STATES,
  );
  if (
    !collaborationId ||
    !phase ||
    !round ||
    !participants ||
    !approvalState ||
    autoContinueAfterAgreement === null
  ) {
    return null;
  }

  const driverParticipantId = readId(input?.driverParticipantId);
  const driverGeneration = readSafeInteger(
    input?.driverGeneration,
    0,
    MAX_SEQUENCE,
  );
  if (
    !isConsistentRendererCollaborationState({
      phase,
      approvalState,
      participants,
      driverParticipantId,
      driverGeneration,
    })
  ) {
    return null;
  }

  const state: MultiFrontierRendererState = {
    rendererStateIsAuthoritative: false,
    collaborationId,
    phase,
    round,
    autoContinueAfterAgreement,
    participants,
    approvalState,
    artifacts: parseArtifacts(input?.artifacts),
    subscriptions: parseSubscriptions(input?.subscriptions),
  };
  if (driverParticipantId) {
    state.driverParticipantId = driverParticipantId;
    state.driverGeneration = driverGeneration!;
  }
  return isBoundedPayload(state) ? state : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return value === undefined
    ? false
    : typeof value === "boolean"
      ? value
      : null;
}

export function normalizeMultiFrontierIpcEvent(
  value: unknown,
): MultiFrontierIpcEvent | null {
  if (!isBoundedPayload(value)) return null;
  const input = asRecord(value);
  const type = readEnum(input?.type, ["snapshot", "event"] as const);
  const collaborationId = readId(input?.collaborationId);
  const sequence = readSafeInteger(input?.sequence, 0, MAX_SEQUENCE);
  if (
    input?.schemaVersion !== MULTI_FRONTIER_IPC_SCHEMA_VERSION ||
    !type ||
    !collaborationId ||
    sequence === null
  ) {
    return null;
  }
  if (type === "snapshot") {
    const snapshot = normalizeMultiFrontierRendererState(input.snapshot);
    return snapshot?.collaborationId === collaborationId
      ? {
          schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
          type,
          collaborationId,
          sequence,
          snapshot,
        }
      : null;
  }

  const eventInput = asRecord(input.event);
  const kind = readEnum(eventInput?.kind, [
    "lifecycle",
    "artifact",
    "participant",
    "notice",
  ] as const);
  const text = readText(
    eventInput?.text,
    MULTI_FRONTIER_IPC_MAX_EVENT_TEXT_BYTES,
  );
  if (!kind || !text) return null;
  const event: MultiFrontierIpcEvent["event"] = { kind, text };
  const participantId = readId(eventInput?.participantId);
  if (participantId) event.participantId = participantId;
  const artifact = normalizeArtifact(eventInput?.artifact);
  if (artifact) event.artifact = artifact;
  return {
    schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
    type,
    collaborationId,
    sequence,
    event,
  };
}

export function normalizeMultiFrontierProviderResult(
  value: unknown,
): MultiFrontierProviderResult | null {
  if (!isBoundedPayload(value)) return null;
  const input = asRecord(value);
  const requestId = readId(input?.requestId);
  const providerId = readEnum(input?.providerId, MULTI_FRONTIER_PROVIDER_IDS);
  if (
    input?.schemaVersion !== MULTI_FRONTIER_IPC_SCHEMA_VERSION ||
    !requestId ||
    !providerId
  ) {
    return null;
  }
  const result: MultiFrontierProviderResult = {
    schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
    requestId,
    providerId,
    status: sanitizeSubscriptionStatus(input.status),
  };
  const error = normalizeIpcError(input.error);
  if (error) result.error = error;
  return result;
}

export function normalizeMultiFrontierCollaborationResult(
  value: unknown,
): MultiFrontierCollaborationResult | null {
  if (!isBoundedPayload(value)) return null;
  const input = asRecord(value);
  const requestId = readId(input?.requestId);
  if (
    input?.schemaVersion !== MULTI_FRONTIER_IPC_SCHEMA_VERSION ||
    !requestId
  ) {
    return null;
  }
  const result: MultiFrontierCollaborationResult = {
    schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
    requestId,
  };
  const snapshot = normalizeMultiFrontierRendererState(input.snapshot);
  if (snapshot) result.snapshot = snapshot;
  const error = normalizeIpcError(input.error);
  if (error) result.error = error;
  return result;
}

export function formatUnknownMultiFrontierMetadata(value: unknown): string {
  if (typeof value === "string") {
    return (
      readText(value, MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES) ??
      "Unrecognized multi-frontier metadata."
    );
  }
  return "Unrecognized multi-frontier metadata.";
}

function parseCreateParticipants(
  value: unknown,
): MultiFrontierCreateCollaborationRequest["participants"] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const participants = value.map((candidate) => {
    const input = asRecord(candidate);
    const participantId = readId(input?.participantId);
    const providerId = readEnum(input?.providerId, MULTI_FRONTIER_PROVIDER_IDS);
    const model = readText(input?.model, MAX_MODEL_BYTES);
    if (!participantId || !providerId) return null;
    return {
      participantId,
      providerId,
      ...(model ? { model } : {}),
    };
  });
  if (
    participants.some((participant) => participant === null) ||
    new Set(participants.map((participant) => participant?.participantId))
      .size !== 2 ||
    new Set(participants.map((participant) => participant?.providerId)).size !==
      2
  ) {
    return null;
  }
  return participants as MultiFrontierCreateCollaborationRequest["participants"];
}

function parseRendererParticipants(
  value: unknown,
): MultiFrontierRendererState["participants"] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const participants = value.map((candidate) => {
    const input = asRecord(candidate);
    const participantId = readId(input?.participantId);
    const providerId = readEnum(input?.providerId, MULTI_FRONTIER_PROVIDER_IDS);
    const role = readEnum(input?.role, MULTI_FRONTIER_PARTICIPANT_ROLES);
    const permission = readEnum(
      input?.permission,
      MULTI_FRONTIER_PARTICIPANT_PERMISSIONS,
    );
    const status = readEnum(input?.status, MULTI_FRONTIER_PARTICIPANT_STATUSES);
    if (!participantId || !providerId || !role || !permission || !status) {
      return null;
    }
    const model = readText(input?.model, MAX_MODEL_BYTES);
    return {
      participantId,
      providerId,
      ...(model ? { model } : {}),
      role,
      permission,
      status,
      capabilities: parseCapabilities(input?.capabilities),
    };
  });
  if (
    participants.some((participant) => participant === null) ||
    new Set(participants.map((participant) => participant?.participantId))
      .size !== 2 ||
    new Set(participants.map((participant) => participant?.providerId)).size !==
      2 ||
    participants.filter((participant) => participant?.role === "driver")
      .length > 1 ||
    participants.filter(
      (participant) => participant?.permission === "workspace_write",
    ).length > 1
  ) {
    return null;
  }
  return participants as MultiFrontierRendererState["participants"];
}

function isConsistentRendererCollaborationState(input: {
  phase: MultiFrontierPhase;
  approvalState: MultiFrontierApprovalState;
  participants: MultiFrontierRendererState["participants"];
  driverParticipantId: string | null;
  driverGeneration: number | null;
}): boolean {
  const drivers = input.participants.filter(
    (participant) => participant.role === "driver",
  );
  const writers = input.participants.filter(
    (participant) => participant.permission === "workspace_write",
  );
  const hasActiveDriver = input.driverParticipantId !== null;

  if (
    drivers.length > 1 ||
    writers.length > 1 ||
    drivers.some(
      (participant) => participant.permission !== "workspace_write",
    ) ||
    writers.some((participant) => participant.role !== "driver")
  ) {
    return false;
  }

  if (input.phase === "implementing") {
    return Boolean(
      input.approvalState === "approved" &&
      hasActiveDriver &&
      input.driverGeneration !== null &&
      input.driverGeneration > 0 &&
      drivers.length === 1 &&
      writers.length === 1 &&
      drivers[0]?.participantId === input.driverParticipantId,
    );
  }

  if (
    hasActiveDriver ||
    input.driverGeneration !== null ||
    drivers.length > 0 ||
    writers.length > 0
  ) {
    return false;
  }

  if (input.phase === "awaiting_go") {
    return input.approvalState === "pending";
  }
  if (input.phase === "checkpoint_review") {
    return input.approvalState === "pending";
  }
  if (
    input.phase === "proposing" ||
    input.phase === "cross_review" ||
    input.phase === "converging"
  ) {
    return input.approvalState === "not_required";
  }
  return true;
}

function parseCapabilities(
  value: unknown,
): MultiFrontierParticipantCapability[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => readEnum(item, MULTI_FRONTIER_PARTICIPANT_CAPABILITIES))
        .filter(Boolean),
    ),
  ] as MultiFrontierParticipantCapability[];
}

function parseArtifacts(value: unknown): MultiFrontierArtifactSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ARTIFACTS)
    .map(normalizeArtifact)
    .filter(
      (artifact): artifact is MultiFrontierArtifactSummary => artifact !== null,
    );
}

function normalizeArtifact(
  value: unknown,
): MultiFrontierArtifactSummary | null {
  const input = asRecord(value);
  const id = readId(input?.id);
  const kind = readEnum(input?.kind, [
    "proposal",
    "review",
    "checkpoint",
    "summary",
  ] as const);
  const summary = readText(
    input?.summary,
    MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  );
  if (!id || !kind || !summary) return null;
  const participantId = readId(input?.participantId);
  return { id, kind, summary, ...(participantId ? { participantId } : {}) };
}

function parseSubscriptions(
  value: unknown,
): MultiFrontierRendererState["subscriptions"] {
  const input = asRecord(value);
  const subscriptions: MultiFrontierRendererState["subscriptions"] = {};
  for (const providerId of MULTI_FRONTIER_PROVIDER_IDS) {
    const status = sanitizeSubscriptionStatus(input?.[providerId]);
    if (status?.providerId === providerId) subscriptions[providerId] = status;
  }
  return subscriptions;
}

function sanitizeSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  const status = normalizeSubscriptionStatus(value);
  if (!status) return null;
  const sanitizeText = (text: string | undefined) =>
    text ? sanitizePublicText(text, MAX_MESSAGE_BYTES) : undefined;
  return {
    ...status,
    ...(status.authMethod
      ? { authMethod: sanitizeText(status.authMethod) }
      : {}),
    ...(status.connectionMessage
      ? { connectionMessage: sanitizeText(status.connectionMessage) }
      : {}),
    ...(status.plan
      ? {
          plan: {
            ...(status.plan.type
              ? { type: sanitizeText(status.plan.type) }
              : {}),
            ...(status.plan.label
              ? { label: sanitizeText(status.plan.label) }
              : {}),
          },
        }
      : {}),
    telemetry: {
      ...status.telemetry,
      meters: status.telemetry.meters
        .slice(0, MAX_SUBSCRIPTION_METERS)
        .map((meter) => ({
          ...meter,
          ...(meter.id
            ? { id: sanitizePublicText(meter.id, MAX_ID_BYTES) }
            : {}),
          ...(meter.label ? { label: sanitizeText(meter.label) } : {}),
          ...(meter.modelTier
            ? { modelTier: sanitizeText(meter.modelTier) }
            : {}),
          ...(meter.message ? { message: sanitizeText(meter.message) } : {}),
        })),
      ...(status.telemetry.contextWindow
        ? {
            contextWindow: {
              ...status.telemetry.contextWindow,
              ...(status.telemetry.contextWindow.message
                ? {
                    message: sanitizeText(
                      status.telemetry.contextWindow.message,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(status.telemetry.credits
        ? {
            credits: {
              ...status.telemetry.credits,
              ...(status.telemetry.credits.unit
                ? { unit: sanitizeText(status.telemetry.credits.unit) }
                : {}),
              ...(status.telemetry.credits.currency
                ? { currency: sanitizeText(status.telemetry.credits.currency) }
                : {}),
              ...(status.telemetry.credits.message
                ? { message: sanitizeText(status.telemetry.credits.message) }
                : {}),
            },
          }
        : {}),
      ...(status.telemetry.error
        ? {
            error: {
              ...status.telemetry.error,
              message: sanitizePublicText(
                status.telemetry.error.message,
                MAX_MESSAGE_BYTES,
              ),
              ...(status.telemetry.error.code
                ? { code: sanitizeText(status.telemetry.error.code) }
                : {}),
            },
          }
        : {}),
    },
  };
}

function normalizeIpcError(value: unknown): MultiFrontierIpcError | null {
  const input = asRecord(value);
  const code = readEnum(input?.code, [
    "invalid-request",
    "not-available",
    "not-found",
    "invalid-transition",
    "operation-failed",
  ] as const);
  const message = readText(input?.message, MAX_MESSAGE_BYTES);
  return code && message
    ? { code, message: sanitizePublicText(message, MAX_MESSAGE_BYTES) }
    : null;
}

function readId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    byteLength(trimmed) <= MAX_ID_BYTES &&
    SAFE_ID.test(trimmed)
    ? trimmed
    : null;
}

function readText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && byteLength(text) <= maxBytes
    ? sanitizePublicText(text, maxBytes)
    : null;
}

function readSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : null;
}

function isBoundedPayload(value: unknown): boolean {
  try {
    return (
      byteLength(JSON.stringify(value)) <= MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizePublicText(value: string, maxBytes: number): string {
  const redacted = value
    .replace(
      /\b(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]?\s*(?:bearer\s+)?\S+/gi,
      "[redacted]",
    )
    .replace(/\bbearer\s+\S+/gi, "[redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted]",
    )
    .replace(
      /\b(?:sk|pk|rk)(?:-[A-Za-z0-9_-]+|_[A-Za-z0-9_-]+)\b/gi,
      "[redacted]",
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  return truncateUtf8(redacted.trim(), maxBytes);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  const suffix = "…";
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && byteLength(value.slice(0, end) + suffix) > maxBytes)
    end -= 1;
  return value.slice(0, end) + suffix;
}
