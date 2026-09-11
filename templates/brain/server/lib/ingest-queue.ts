import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nanoid, nowIso, stableJson } from "./brain.js";
import type {
  BrainCaptureInvalidation,
  BrainIngestOperation,
} from "./search-index-contracts.js";

export async function enqueueBrainOperation(input: {
  operation: BrainIngestOperation;
  dedupeKey: string;
  sourceId?: string | null;
  captureId?: string | null;
  priority?: number;
  runAfter?: string | null;
  payload?: Record<string, unknown>;
}) {
  const db = getDb();
  const now = nowIso();
  const id = nanoid();
  await db
    .insert(schema.brainIngestQueue)
    .values({
      id,
      sourceId: input.sourceId ?? null,
      captureId: input.captureId ?? null,
      operation: input.operation,
      status: "queued",
      priority: input.priority ?? 50,
      attempts: 0,
      payloadJson: stableJson(input.payload ?? {}),
      dedupeKey: input.dedupeKey,
      leaseToken: null,
      leaseExpiresAt: null,
      error: null,
      runAfter: input.runAfter ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.brainIngestQueue.dedupeKey,
      set: {
        sourceId: input.sourceId ?? null,
        captureId: input.captureId ?? null,
        operation: input.operation,
        status: "queued",
        priority: input.priority ?? 50,
        payloadJson: stableJson(input.payload ?? {}),
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
        runAfter: input.runAfter ?? null,
        updatedAt: now,
      },
      setWhere: or(
        ne(schema.brainIngestQueue.status, "processing"),
        isNull(schema.brainIngestQueue.leaseExpiresAt),
        lt(schema.brainIngestQueue.leaseExpiresAt, now),
      ),
    });
  const [row] = await db
    .select()
    .from(schema.brainIngestQueue)
    .where(eq(schema.brainIngestQueue.dedupeKey, input.dedupeKey))
    .limit(1);
  return row;
}

export async function enqueueCaptureInvalidation(
  invalidation: BrainCaptureInvalidation,
) {
  const version =
    invalidation.next?.contentHash ??
    invalidation.previous?.contentHash ??
    "deleted";
  const operation = invalidation.next ? "search-index" : "search-unindex";
  return enqueueBrainOperation({
    operation,
    dedupeKey: `${operation}:${invalidation.captureId}:${version}`,
    sourceId: invalidation.sourceId,
    captureId: invalidation.captureId,
    priority: operation === "search-unindex" ? 10 : 40,
    payload: { invalidation },
  });
}

export async function markBrainOperationDone(id: string, leaseToken: string) {
  return getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "done",
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: nowIso(),
    })
    .where(
      and(
        eq(schema.brainIngestQueue.id, id),
        eq(schema.brainIngestQueue.status, "processing"),
        eq(schema.brainIngestQueue.leaseToken, leaseToken),
      ),
    );
}
