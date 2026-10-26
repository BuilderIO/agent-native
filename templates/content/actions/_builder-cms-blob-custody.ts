import { createHash, randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { asc, eq, lte } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BUILDER_PRIVATE_PAYLOAD_CLEANUP_BATCH_SIZE = 50;
const BUILDER_PRIVATE_PAYLOAD_CLEANUP_RETRY_BASE_MS = 30_000;
const BUILDER_PRIVATE_PAYLOAD_CLEANUP_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export const BUILDER_EXECUTION_PAYLOAD_BLOB_KEY =
  "__builder.execution.privatePayload";

type BuilderBlobBinding = Record<string, string>;

interface BuilderBlobReference {
  kind: "agent-native.builder-private-payload";
  version: 1;
  binding: BuilderBlobBinding;
  sha256: string;
  handle: PrivateBlobHandle;
}

interface BuilderBlobEnvelope<T> {
  kind: "agent-native.builder-private-payload";
  version: 1;
  binding: BuilderBlobBinding;
  payload: T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function builderPrivatePayloadUnavailable(
  message: string,
  _cause?: unknown,
): never {
  throw new ActionContractError(message, {
    errorCode: "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE",
    statusCode: 409,
  });
}

function logBuilderPrivatePayloadCleanupFailure(
  label: string,
  handle: PrivateBlobHandle,
  reason: string,
) {
  console.error(`[builder-private-payload] ${label} cleanup failed`, {
    provider: handle.provider,
    handleId: handle.id,
    reason,
  });
}

function parseReference(value: unknown): BuilderBlobReference | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as BuilderBlobReference;
    if (
      parsed?.kind !== "agent-native.builder-private-payload" ||
      parsed.version !== 1 ||
      !parsed.binding ||
      typeof parsed.binding !== "object" ||
      typeof parsed.sha256 !== "string" ||
      !parsed.handle ||
      typeof parsed.handle.id !== "string" ||
      typeof parsed.handle.provider !== "string" ||
      parsed.handle.opaque !== true ||
      typeof parsed.handle.encrypted !== "boolean"
    ) {
      return null;
    }
    return parsed;
    // coercion-ok: null is the explicit invalid-reference marker; reads reject it and cleanup never authorizes deletion from it.
  } catch {
    return null;
  }
}

function sameBinding(actual: BuilderBlobBinding, expected: BuilderBlobBinding) {
  return stableJson(actual) === stableJson(expected);
}

export async function readBuilderPrivatePayload<T>(args: {
  reference: unknown;
  binding: BuilderBlobBinding;
  label: string;
}): Promise<T> {
  const reference = parseReference(args.reference);
  if (!reference)
    builderPrivatePayloadUnavailable(
      `${args.label} private blob reference is missing or malformed.`,
    );
  if (!sameBinding(reference.binding, args.binding)) {
    builderPrivatePayloadUnavailable(
      `${args.label} private blob reference belongs to a different Builder operation.`,
    );
  }
  let result;
  try {
    result = await readPrivateBlob(reference.handle);
  } catch (error) {
    builderPrivatePayloadUnavailable(
      `${args.label} private blob could not be read.`,
      error,
    );
  }
  if (digest(result.data) !== reference.sha256) {
    builderPrivatePayloadUnavailable(
      `${args.label} private blob failed integrity verification.`,
    );
  }
  try {
    const envelope = JSON.parse(
      textDecoder.decode(result.data),
    ) as BuilderBlobEnvelope<T>;
    if (
      envelope?.kind !== "agent-native.builder-private-payload" ||
      envelope.version !== 1 ||
      !sameBinding(envelope.binding, args.binding)
    ) {
      builderPrivatePayloadUnavailable(
        `${args.label} private blob identity is invalid.`,
      );
    }
    return envelope.payload;
  } catch (error) {
    if (error instanceof ActionContractError) throw error;
    builderPrivatePayloadUnavailable(
      `${args.label} private blob payload is malformed.`,
      error,
    );
  }
}

export async function putBuilderPrivatePayload<T>(args: {
  payload: T;
  binding: BuilderBlobBinding;
  label: string;
  ownerEmail?: string;
}): Promise<string> {
  const bytes = textEncoder.encode(
    JSON.stringify({
      kind: "agent-native.builder-private-payload",
      version: 1,
      binding: args.binding,
      payload: args.payload,
    } satisfies BuilderBlobEnvelope<T>),
  );
  let handle: PrivateBlobHandle | null;
  try {
    handle = await putPrivateBlob({
      data: bytes,
      key: `content/builder/${createHash("sha256").update(stableJson(args.binding)).digest("hex")}/${randomUUID()}.json`,
      filename: "builder-private-payload.json",
      mimeType: "application/json",
      ownerEmail: args.ownerEmail,
      metadata: { kind: "builder-private-payload", version: 1 },
    });
  } catch (error) {
    builderPrivatePayloadUnavailable(
      `${args.label} could not be stored in private blob custody.`,
      error,
    );
  }
  if (!handle)
    builderPrivatePayloadUnavailable(
      `${args.label} requires configured private blob custody.`,
    );
  const reference = JSON.stringify({
    kind: "agent-native.builder-private-payload",
    version: 1,
    binding: args.binding,
    sha256: digest(bytes),
    handle,
  } satisfies BuilderBlobReference);
  try {
    await readBuilderPrivatePayload({
      reference,
      binding: args.binding,
      label: args.label,
    });
  } catch (error) {
    let cleanupReason: string | null = null;
    try {
      const cleanup = await deletePrivateBlob(handle);
      if (!cleanup.deleted) {
        cleanupReason = cleanup.reason ?? "Deletion was declined";
      }
    } catch (cleanupError) {
      cleanupReason =
        cleanupError instanceof Error ? cleanupError.name : "Unknown error";
    }
    if (cleanupReason) {
      try {
        await enqueueBuilderPrivatePayloadCleanup(getDb(), reference);
      } catch {
        // Keep the provider failure visible if durable tracking is unavailable.
      }
      logBuilderPrivatePayloadCleanupFailure(args.label, handle, cleanupReason);
    }
    throw error;
  }
  return reference;
}

export async function deleteBuilderPrivatePayload(reference: unknown) {
  const parsed = parseReference(reference);
  if (!parsed) return false;
  const result = await deletePrivateBlob(parsed.handle);
  return result.deleted;
}

export async function enqueueBuilderPrivatePayloadCleanup(
  db: ReturnType<typeof getDb>,
  reference: unknown,
) {
  if (!isBuilderPrivatePayloadReference(reference)) return;
  await db
    .insert(schema.contentDatabaseBuilderBlobCleanup)
    .values({ blobReference: reference as string })
    .onConflictDoNothing();
}

async function drainBuilderPrivatePayloadCleanupQueue(args: {
  db: ReturnType<typeof getDb>;
  label: string;
  deadlineAt?: number;
  signal?: AbortSignal;
}) {
  const cleanupQueue = schema.contentDatabaseBuilderBlobCleanup;

  let pending: Array<{ blobReference: string; attemptCount: number }>;
  try {
    pending = await args.db
      .select({
        blobReference: cleanupQueue.blobReference,
        attemptCount: cleanupQueue.attemptCount,
      })
      .from(cleanupQueue)
      .where(lte(cleanupQueue.nextAttemptAt, new Date().toISOString()))
      .orderBy(asc(cleanupQueue.nextAttemptAt), asc(cleanupQueue.createdAt))
      .limit(BUILDER_PRIVATE_PAYLOAD_CLEANUP_BATCH_SIZE);
  } catch (error) {
    console.error(
      `[builder-private-payload] ${args.label} cleanup queue could not be read`,
      error,
    );
    return;
  }

  for (const queued of pending) {
    if (
      args.signal?.aborted ||
      (args.deadlineAt !== undefined && Date.now() >= args.deadlineAt)
    ) {
      return;
    }
    try {
      const deleted = await deleteBuilderPrivatePayload(queued.blobReference);
      if (!deleted) {
        console.error(
          `[builder-private-payload] ${args.label} cleanup was declined; retry retained`,
        );
        await scheduleBuilderPrivatePayloadCleanupRetry(args, queued);
        continue;
      }
      await args.db
        .delete(cleanupQueue)
        .where(eq(cleanupQueue.blobReference, queued.blobReference));
    } catch (error) {
      console.error(
        `[builder-private-payload] ${args.label} cleanup remains queued`,
        error,
      );
      await scheduleBuilderPrivatePayloadCleanupRetry(args, queued);
    }
  }
}

async function scheduleBuilderPrivatePayloadCleanupRetry(
  args: {
    db: ReturnType<typeof getDb>;
    label: string;
  },
  queued: { blobReference: string; attemptCount: number },
) {
  const attemptCount = queued.attemptCount + 1;
  const delayMs = Math.min(
    BUILDER_PRIVATE_PAYLOAD_CLEANUP_RETRY_BASE_MS *
      2 ** Math.min(attemptCount - 1, 10),
    BUILDER_PRIVATE_PAYLOAD_CLEANUP_RETRY_MAX_MS,
  );
  try {
    await args.db
      .update(schema.contentDatabaseBuilderBlobCleanup)
      .set({
        attemptCount,
        nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      })
      .where(
        eq(
          schema.contentDatabaseBuilderBlobCleanup.blobReference,
          queued.blobReference,
        ),
      );
  } catch (error) {
    console.error(
      `[builder-private-payload] ${args.label} cleanup retry could not be scheduled`,
      error,
    );
  }
}

export async function drainBuilderPrivatePayloadCleanup(
  args: {
    deadlineAt?: number;
    signal?: AbortSignal;
  } = {},
) {
  await drainBuilderPrivatePayloadCleanupQueue({
    db: getDb(),
    label: "scheduled",
    deadlineAt: args.deadlineAt,
    signal: args.signal,
  });
}

export async function cleanupBuilderPrivatePayload(
  reference: unknown,
  _label: string,
) {
  if (!isBuilderPrivatePayloadReference(reference)) return;
  const blobReference = reference as string;
  await enqueueBuilderPrivatePayloadCleanup(getDb(), blobReference);
}

export function isBuilderPrivatePayloadReference(value: unknown) {
  return parseReference(value) !== null;
}

export function isBuilderPrivatePayloadBoundToSource(
  value: unknown,
  ownerEmail: string,
  sourceId: string,
) {
  const reference = parseReference(value);
  return (
    reference?.binding.ownerEmail === ownerEmail &&
    reference.binding.sourceId === sourceId
  );
}

export function builderExecutionPayloadReference(
  payloadJson: string,
): string | null {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const reference = payload?.[BUILDER_EXECUTION_PAYLOAD_BLOB_KEY];
    return isBuilderPrivatePayloadReference(reference)
      ? (reference as string)
      : null;
    // coercion-ok: malformed compact SQL cannot authorize execution-blob deletion.
  } catch {
    return null;
  }
}

export interface BuilderExecutionPayloadBinding {
  ownerEmail: string;
  sourceId: string;
  changeSetId: string;
  executionId: string;
  idempotencyKey: string;
}

function executionBinding(
  value: BuilderExecutionPayloadBinding,
): BuilderBlobBinding {
  return { ...value };
}

export async function storeBuilderExecutionPayload(args: {
  payload: unknown;
  binding: BuilderExecutionPayloadBinding;
}) {
  if (
    !args.payload ||
    typeof args.payload !== "object" ||
    Array.isArray(args.payload)
  ) {
    builderPrivatePayloadUnavailable("Builder execution payload is malformed.");
  }
  const payload = args.payload as Record<string, unknown>;
  const reference = await putBuilderPrivatePayload({
    payload,
    binding: executionBinding(args.binding),
    label: "Builder prepared request and receipt",
    ownerEmail: args.binding.ownerEmail,
  });
  const response =
    payload.response && typeof payload.response === "object"
      ? { stored: true }
      : undefined;
  return JSON.stringify({
    [BUILDER_EXECUTION_PAYLOAD_BLOB_KEY]: reference,
    ...(response ? { response } : {}),
  });
}

export async function readBuilderExecutionPayload(args: {
  payloadJson: string;
  binding: BuilderExecutionPayloadBinding;
}): Promise<Record<string, unknown>> {
  let stored: Record<string, unknown>;
  try {
    const parsed = JSON.parse(args.payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      builderPrivatePayloadUnavailable(
        "Builder execution payload JSON is malformed.",
      );
    }
    stored = parsed as Record<string, unknown>;
  } catch {
    builderPrivatePayloadUnavailable(
      "Builder execution payload JSON is malformed.",
    );
  }
  const reference = stored[BUILDER_EXECUTION_PAYLOAD_BLOB_KEY];
  if (reference === undefined) return stored;
  const payload = await readBuilderPrivatePayload<unknown>({
    reference,
    binding: executionBinding(args.binding),
    label: "Builder prepared request and receipt",
  });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    builderPrivatePayloadUnavailable(
      "Builder execution private blob payload is malformed.",
    );
  }
  return payload as Record<string, unknown>;
}
