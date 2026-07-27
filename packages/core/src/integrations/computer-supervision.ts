import type {
  ComputerCommandEnvelope,
  ComputerOperationClass,
} from "./remote-types.js";

const OPERATION_CLASSES = new Set<ComputerOperationClass>([
  "browser.observe",
  "browser.control",
  "desktop.observe",
  "desktop.control",
]);
const APPROVAL_SCOPES = new Set(["once", "run", "task"] as const);
const MAX_ACTION_BYTES = 32_768;
const MAX_LEASE_MS = 24 * 60 * 60_000;

export class ComputerSupervisionError extends Error {
  constructor(
    public readonly code:
      | "invalid-envelope"
      | "expired-lease"
      | "action-hash-mismatch"
      | "approval-required"
      | "approval-denied"
      | "approval-mismatch"
      | "replay",
    message: string,
  ) {
    super(message);
    this.name = "ComputerSupervisionError";
  }
}

export function computerOperationRequiresApproval(
  operationClass: ComputerOperationClass,
): boolean {
  return operationClass.endsWith(".control");
}

export async function computeComputerActionHash(
  envelope: Pick<
    ComputerCommandEnvelope,
    "version" | "taskId" | "runId" | "sequence" | "operationClass" | "action"
  >,
): Promise<string> {
  const canonical = stableJson({
    version: envelope.version,
    taskId: envelope.taskId,
    runId: envelope.runId,
    sequence: envelope.sequence,
    operationClass: envelope.operationClass,
    action: envelope.action,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function assertValidComputerCommandEnvelope(
  value: unknown,
  options?: { now?: number },
): Promise<ComputerCommandEnvelope> {
  if (!isRecord(value)) {
    throw invalid("Computer command envelope must be an object");
  }
  if (value.version !== 1) {
    throw invalid("Unsupported computer command envelope version");
  }
  const taskId = boundedString(value.taskId, "taskId", 200);
  const runId = boundedString(value.runId, "runId", 200);
  const idempotencyKey = boundedString(
    value.idempotencyKey,
    "idempotencyKey",
    200,
  );
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) {
    throw invalid("sequence must be a non-negative safe integer");
  }
  if (!OPERATION_CLASSES.has(value.operationClass as ComputerOperationClass)) {
    throw invalid("Unknown computer operation class");
  }
  if (!isRecord(value.action)) {
    throw invalid("action must be an object");
  }
  boundedString(value.action.type, "action.type", 120);
  const actionJson = stableJson(value.action);
  if (new TextEncoder().encode(actionJson).byteLength > MAX_ACTION_BYTES) {
    throw invalid("Computer action exceeds the 32 KiB metadata limit");
  }
  if (!isRecord(value.approval)) {
    throw invalid("approval binding is required");
  }
  if (!APPROVAL_SCOPES.has(value.approval.scope as any)) {
    throw invalid("Unknown computer approval scope");
  }
  const actionHash = boundedString(
    value.approval.actionHash,
    "approval.actionHash",
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(actionHash)) {
    throw invalid("approval.actionHash must be a SHA-256 hex digest");
  }
  const approvalId =
    value.approval.id == null
      ? null
      : boundedString(value.approval.id, "approval.id", 240);
  if (!Number.isSafeInteger(value.issuedAt) || Number(value.issuedAt) < 0) {
    throw invalid("issuedAt must be a valid epoch timestamp");
  }
  if (
    !Number.isSafeInteger(value.leaseExpiresAt) ||
    Number(value.leaseExpiresAt) < 0
  ) {
    throw invalid("leaseExpiresAt must be a valid epoch timestamp");
  }
  const now = options?.now ?? Date.now();
  const issuedAt = Number(value.issuedAt);
  const leaseExpiresAt = Number(value.leaseExpiresAt);
  if (leaseExpiresAt <= now || leaseExpiresAt <= issuedAt) {
    throw new ComputerSupervisionError(
      "expired-lease",
      "Computer operation lease has expired",
    );
  }
  if (leaseExpiresAt - issuedAt > MAX_LEASE_MS) {
    throw invalid("Computer operation lease cannot exceed 24 hours");
  }

  const envelope: ComputerCommandEnvelope = {
    version: 1,
    taskId,
    runId,
    sequence: Number(value.sequence),
    idempotencyKey,
    operationClass: value.operationClass as ComputerOperationClass,
    action: value.action as ComputerCommandEnvelope["action"],
    approval: {
      id: approvalId,
      scope: value.approval
        .scope as ComputerCommandEnvelope["approval"]["scope"],
      actionHash,
    },
    issuedAt,
    leaseExpiresAt,
  };
  const expectedHash = await computeComputerActionHash(envelope);
  if (expectedHash !== actionHash) {
    throw new ComputerSupervisionError(
      "action-hash-mismatch",
      "Computer operation does not match its approved action hash",
    );
  }
  return envelope;
}

function stableJson(value: unknown): string {
  const seen = new Set<object>();
  const normalize = (entry: unknown, depth: number): unknown => {
    if (depth > 12) throw invalid("Computer action is nested too deeply");
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      if (
        typeof entry === "string" &&
        (/^data:/i.test(entry) || looksLikeLargeBase64(entry))
      ) {
        throw invalid("Binary or data URL payloads are not allowed");
      }
      return entry;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (Array.isArray(entry)) {
      return entry.map((item) => normalize(item, depth + 1));
    }
    if (!isRecord(entry)) {
      throw invalid("Computer actions must contain only JSON values");
    }
    if (seen.has(entry)) throw invalid("Computer action contains a cycle");
    seen.add(entry);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(entry).sort()) {
      result[key] = normalize(entry[key], depth + 1);
    }
    seen.delete(entry);
    return result;
  };
  return JSON.stringify(normalize(value, 0));
}

function looksLikeLargeBase64(value: string): boolean {
  return value.length > 512 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw invalid(`${name} must be a non-empty string of at most ${max} chars`);
  }
  return value.trim();
}

function invalid(message: string): ComputerSupervisionError {
  return new ComputerSupervisionError("invalid-envelope", message);
}
