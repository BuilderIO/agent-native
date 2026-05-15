import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, lte, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nowIso,
  parseJson,
  serializeDistillationQueue,
  stableJson,
} from "../server/lib/brain.js";
import { redactSensitiveText } from "../server/lib/search.js";

const STALE_PROCESSING_MS = 15 * 60 * 1000;

function staleProcessingCutoff(now: string) {
  return new Date(Date.parse(now) - STALE_PROCESSING_MS).toISOString();
}

function isStaleProcessing(
  row: typeof schema.brainIngestQueue.$inferSelect,
  cutoff: string,
) {
  if (row.status !== "processing") return false;
  const updated = Date.parse(row.updatedAt);
  const threshold = Date.parse(cutoff);
  return Number.isFinite(updated) && Number.isFinite(threshold)
    ? updated <= threshold
    : row.updatedAt <= cutoff;
}

async function writeDistillationRequest(values: {
  captureId: string;
  queueId: string;
  sourceId: string;
  requestedAt: string;
  instructions?: string | null;
}) {
  await writeAppState(`brain-distill-request-${values.captureId}`, {
    kind: "distill-capture",
    captureId: values.captureId,
    queueId: values.queueId,
    sourceId: values.sourceId,
    requestedAt: values.requestedAt,
    instructions: values.instructions ?? null,
    message:
      `Retry Brain distillation for capture ${values.captureId}. Use ` +
      `get-capture with includeRawContent=true when you need exact quote ` +
      `validation, extract only durable company knowledge with exact ` +
      `evidence quotes, call write-knowledge for supported entries or ` +
      `proposals, then call mark-capture-distilled when finished. If the ` +
      `capture is personal or out of scope, call mark-capture-distilled with ` +
      `status ignored.`,
  });
}

const retrySchema = z
  .object({
    queueId: z.string().min(1).optional(),
    captureId: z.string().min(1).optional(),
    priority: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe("Optional replacement priority for the retried queue item."),
  })
  .refine((value) => value.queueId || value.captureId, {
    message: "Provide queueId or captureId.",
  });

export default defineAction({
  description:
    "Retry a failed or stale Brain distillation queue item after checking access to its capture source.",
  schema: retrySchema,
  run: async (args) => {
    const db = getDb();
    const now = nowIso();
    const cutoff = staleProcessingCutoff(now);

    let queue: typeof schema.brainIngestQueue.$inferSelect | undefined;
    if (args.queueId) {
      [queue] = await db
        .select()
        .from(schema.brainIngestQueue)
        .where(
          and(
            eq(schema.brainIngestQueue.id, args.queueId),
            eq(schema.brainIngestQueue.operation, "distill"),
          ),
        )
        .limit(1);
    } else if (args.captureId) {
      const access = await getAccessibleCapture(args.captureId);
      if (!access) throw new Error(`No access to capture ${args.captureId}`);
      await assertAccess("brain-source", access.capture.sourceId, "editor");
      [queue] = await db
        .select()
        .from(schema.brainIngestQueue)
        .where(
          and(
            eq(schema.brainIngestQueue.captureId, args.captureId),
            eq(schema.brainIngestQueue.operation, "distill"),
            or(
              eq(schema.brainIngestQueue.status, "failed"),
              and(
                eq(schema.brainIngestQueue.status, "processing"),
                lte(schema.brainIngestQueue.updatedAt, cutoff),
              ),
            ),
          ),
        )
        .orderBy(desc(schema.brainIngestQueue.updatedAt))
        .limit(1);
    }

    if (!queue) {
      throw new Error("No failed or stale distillation queue item was found.");
    }
    if (args.captureId && queue.captureId !== args.captureId) {
      throw new Error("Queue item does not belong to the requested capture.");
    }
    if (!queue.captureId) {
      throw new Error("Queue item has no capture to retry.");
    }

    const access = await getAccessibleCapture(queue.captureId);
    if (!access) throw new Error(`No access to capture ${queue.captureId}`);
    await assertAccess("brain-source", access.capture.sourceId, "editor");

    const staleProcessing = isStaleProcessing(queue, cutoff);
    if (queue.status !== "failed" && !staleProcessing) {
      throw new Error(
        `Queue item ${queue.id} is ${queue.status} and is not stale.`,
      );
    }

    const payload = parseJson<Record<string, unknown>>(queue.payloadJson, {});
    await db
      .update(schema.brainIngestQueue)
      .set({
        status: "queued",
        priority: args.priority ?? queue.priority,
        payloadJson: stableJson({
          ...payload,
          manuallyRetriedAt: now,
        }),
        error: null,
        runAfter: null,
        updatedAt: now,
      })
      .where(eq(schema.brainIngestQueue.id, queue.id));
    await db
      .update(schema.brainRawCaptures)
      .set({
        status: "distilling",
        distilledAt: null,
        updatedAt: now,
      })
      .where(eq(schema.brainRawCaptures.id, queue.captureId));

    const instructions =
      typeof payload.instructions === "string" ? payload.instructions : null;
    await writeDistillationRequest({
      captureId: queue.captureId,
      queueId: queue.id,
      sourceId: access.capture.sourceId,
      requestedAt: now,
      instructions,
    });

    const [updated] = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(eq(schema.brainIngestQueue.id, queue.id))
      .limit(1);

    return {
      retried: true,
      staleProcessing,
      queueItem: updated ? serializeDistillationQueue(updated) : null,
      capture: {
        id: access.capture.id,
        sourceId: access.capture.sourceId,
        title: redactSensitiveText(access.capture.title),
        status: "distilling",
      },
    };
  },
});
