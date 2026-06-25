import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nowIso,
  parseJson,
  readBrainAgentGuidance,
  serializeDistillationQueue,
  stableJson,
} from "../server/lib/brain.js";
import { redactSensitiveText } from "../server/lib/search.js";
import { stringArrayCliSchema } from "./_schemas.js";

const STALE_PROCESSING_MS = 15 * 60 * 1000;

type QueueRow = typeof schema.brainIngestQueue.$inferSelect;
type BrainAgentGuidance = Awaited<
  ReturnType<typeof readBrainAgentGuidance>
>["guidance"];

function staleProcessingCutoff(now: string) {
  return new Date(Date.parse(now) - STALE_PROCESSING_MS).toISOString();
}

function isStaleProcessing(row: QueueRow, cutoff: string) {
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
  guidance: BrainAgentGuidance;
}) {
  await writeAppState(`brain-distill-request-${values.captureId}`, {
    kind: "distill-capture",
    captureId: values.captureId,
    queueId: values.queueId,
    sourceId: values.sourceId,
    requestedAt: values.requestedAt,
    instructions: values.instructions ?? null,
    guidance: values.guidance,
    message:
      `Retry Brain distillation for capture ${values.captureId} for ` +
      `${values.guidance.identity.companyName ?? "this workspace"}. ` +
      `Apply the Brain settings guidance in context. Use ` +
      `get-capture with includeRawContent=true when you need exact quote ` +
      `validation, extract only durable company knowledge with exact ` +
      `evidence quotes, call write-knowledge for supported entries or ` +
      `proposals, then call mark-capture-distilled when finished. If the ` +
      `capture is personal or out of scope, call mark-capture-distilled with ` +
      `status ignored.`,
  });
}

function retryableQueueClause(cutoff: string) {
  return or(
    eq(schema.brainIngestQueue.status, "failed"),
    and(
      eq(schema.brainIngestQueue.status, "processing"),
      lte(schema.brainIngestQueue.updatedAt, cutoff),
    )!,
  )!;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message);
}

function dedupeQueues(rows: QueueRow[]) {
  const seen = new Set<string>();
  const deduped: QueueRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return deduped;
}

async function findQueueById(queueId: string) {
  const [queue] = await getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(
      and(
        eq(schema.brainIngestQueue.id, queueId),
        eq(schema.brainIngestQueue.operation, "distill"),
      ),
    )
    .limit(1);
  return queue;
}

async function findRetryableQueueForCapture(captureId: string, cutoff: string) {
  const access = await getAccessibleCapture(captureId);
  if (!access) throw new Error(`No access to capture ${captureId}`);
  await assertAccess("brain-source", access.capture.sourceId, "editor");
  const [queue] = await getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(
      and(
        eq(schema.brainIngestQueue.captureId, captureId),
        eq(schema.brainIngestQueue.operation, "distill"),
        retryableQueueClause(cutoff),
      ),
    )
    .orderBy(desc(schema.brainIngestQueue.updatedAt))
    .limit(1);
  return queue;
}

async function findQueuesByIds(queueIds: string[]) {
  if (!queueIds.length) return [];
  return getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(
      and(
        inArray(schema.brainIngestQueue.id, queueIds),
        eq(schema.brainIngestQueue.operation, "distill"),
      ),
    )
    .orderBy(desc(schema.brainIngestQueue.updatedAt));
}

async function findAllRetryableQueues(args: {
  cutoff: string;
  sourceId?: string;
  limit: number;
}) {
  const clauses = [
    eq(schema.brainIngestQueue.operation, "distill"),
    retryableQueueClause(args.cutoff),
    accessFilter(schema.brainSources, schema.brainSourceShares),
  ];
  if (args.sourceId) clauses.push(eq(schema.brainSources.id, args.sourceId));

  const rows = await getDb()
    .select({
      id: schema.brainIngestQueue.id,
      sourceId: schema.brainIngestQueue.sourceId,
      captureId: schema.brainIngestQueue.captureId,
      operation: schema.brainIngestQueue.operation,
      status: schema.brainIngestQueue.status,
      priority: schema.brainIngestQueue.priority,
      attempts: schema.brainIngestQueue.attempts,
      payloadJson: schema.brainIngestQueue.payloadJson,
      error: schema.brainIngestQueue.error,
      runAfter: schema.brainIngestQueue.runAfter,
      createdAt: schema.brainIngestQueue.createdAt,
      updatedAt: schema.brainIngestQueue.updatedAt,
    })
    .from(schema.brainIngestQueue)
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainIngestQueue.captureId, schema.brainRawCaptures.id),
    )
    .innerJoin(
      schema.brainSources,
      eq(schema.brainRawCaptures.sourceId, schema.brainSources.id),
    )
    .where(and(...clauses))
    .orderBy(desc(schema.brainIngestQueue.updatedAt))
    .limit(args.limit);

  return rows as QueueRow[];
}

async function retryQueue(
  queue: QueueRow,
  args: {
    cutoff: string;
    now: string;
    requestedCaptureId?: string;
    priority?: number;
    guidance: BrainAgentGuidance;
  },
) {
  if (args.requestedCaptureId && queue.captureId !== args.requestedCaptureId) {
    throw new Error("Queue item does not belong to the requested capture.");
  }
  if (!queue.captureId) {
    throw new Error("Queue item has no capture to retry.");
  }

  const access = await getAccessibleCapture(queue.captureId);
  if (!access) throw new Error(`No access to capture ${queue.captureId}`);
  await assertAccess("brain-source", access.capture.sourceId, "editor");

  const staleProcessing = isStaleProcessing(queue, args.cutoff);
  if (queue.status !== "failed" && !staleProcessing) {
    throw new Error(
      `Queue item ${queue.id} is ${queue.status} and is not stale.`,
    );
  }

  const payload = parseJson<Record<string, unknown>>(queue.payloadJson, {});
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "queued",
      priority: args.priority ?? queue.priority,
      payloadJson: stableJson({
        ...payload,
        manuallyRetriedAt: args.now,
        retryPreviousStatus: queue.status,
        retryReason: staleProcessing ? "stale-processing" : "failed",
      }),
      error: null,
      runAfter: null,
      updatedAt: args.now,
    })
    .where(eq(schema.brainIngestQueue.id, queue.id));
  await getDb()
    .update(schema.brainRawCaptures)
    .set({
      status: "distilling",
      distilledAt: null,
      updatedAt: args.now,
    })
    .where(eq(schema.brainRawCaptures.id, queue.captureId));

  const instructions =
    typeof payload.instructions === "string" ? payload.instructions : null;
  await writeDistillationRequest({
    captureId: queue.captureId,
    queueId: queue.id,
    sourceId: access.capture.sourceId,
    requestedAt: args.now,
    instructions,
    guidance: args.guidance,
  });

  const [updated] = await getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(eq(schema.brainIngestQueue.id, queue.id))
    .limit(1);

  return {
    queueId: queue.id,
    captureId: queue.captureId,
    sourceId: access.capture.sourceId,
    outcome: "retried" as const,
    retried: true,
    staleProcessing,
    previousStatus: queue.status,
    previousError: queue.error ? redactSensitiveText(queue.error) : null,
    queueItem: updated ? serializeDistillationQueue(updated) : null,
    capture: {
      id: access.capture.id,
      sourceId: access.capture.sourceId,
      title: redactSensitiveText(access.capture.title),
      status: "distilling" as const,
    },
  };
}

const retrySchema = z
  .object({
    queueId: z.string().min(1).optional(),
    queueIds: stringArrayCliSchema({ min: 1, max: 100 })
      .optional()
      .describe("Queue IDs selected for retry."),
    captureId: z.string().min(1).optional(),
    retryAllRetryable: z.coerce
      .boolean()
      .default(false)
      .describe("Retry every accessible failed or stale processing item."),
    sourceId: z
      .string()
      .min(1)
      .optional()
      .describe("Limit retryAllRetryable to one source."),
    priority: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe("Optional replacement priority for the retried queue item."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(100)
      .describe(
        "Maximum retryable items to retry when retryAllRetryable=true.",
      ),
  })
  .refine(
    (value) =>
      value.queueId ||
      value.captureId ||
      value.retryAllRetryable ||
      (Array.isArray(value.queueIds) && value.queueIds.length > 0),
    {
      message:
        "Provide queueId, captureId, queueIds, or retryAllRetryable=true.",
    },
  );

function summarizeResults(
  results: Array<
    | Awaited<ReturnType<typeof retryQueue>>
    | {
        queueId: string;
        captureId: string | null;
        outcome: "error";
        retried: false;
        error: string;
      }
  >,
) {
  const retriedCount = results.filter(
    (result) => result.outcome === "retried",
  ).length;
  return {
    retriedCount,
    errorCount: results.length - retriedCount,
    results,
  };
}

function errorResult(queue: QueueRow, error: unknown) {
  return {
    queueId: queue.id,
    captureId: queue.captureId,
    outcome: "error" as const,
    retried: false as const,
    error: errorMessage(error),
  };
}

async function retryMany(
  queues: QueueRow[],
  args: {
    cutoff: string;
    now: string;
    priority?: number;
    guidance: BrainAgentGuidance;
  },
) {
  const results: Array<
    Awaited<ReturnType<typeof retryQueue>> | ReturnType<typeof errorResult>
  > = [];
  for (const queue of dedupeQueues(queues)) {
    try {
      results.push(await retryQueue(queue, args));
    } catch (error) {
      results.push(errorResult(queue, error));
    }
  }
  return summarizeResults(results);
}

function firstRetried(results: ReturnType<typeof summarizeResults>["results"]) {
  return results.find((result) => result.outcome === "retried");
}

async function resolveRequestedQueues(
  args: z.infer<typeof retrySchema> & {
    cutoff: string;
  },
) {
  if (args.retryAllRetryable) {
    return findAllRetryableQueues({
      cutoff: args.cutoff,
      sourceId: args.sourceId,
      limit: args.limit,
    });
  }
  if (args.queueIds?.length) {
    return findQueuesByIds(args.queueIds);
  }
  if (args.queueId) {
    const queue = await findQueueById(args.queueId);
    return queue ? [queue] : [];
  }
  if (args.captureId) {
    const queue = await findRetryableQueueForCapture(
      args.captureId,
      args.cutoff,
    );
    return queue ? [queue] : [];
  }
  return [];
}

function isBatchMode(args: z.infer<typeof retrySchema>) {
  return args.retryAllRetryable || Boolean(args.queueIds?.length);
}

function noQueueMessage(args: z.infer<typeof retrySchema>) {
  if (args.retryAllRetryable) return "No retryable distillation queue items.";
  if (args.queueIds?.length) {
    return "No selected distillation queue items were found.";
  }
  return "No failed or stale distillation queue item was found.";
}

function singleResponse(
  result: Awaited<ReturnType<typeof retryQueue>>,
  summary: ReturnType<typeof summarizeResults>,
) {
  return {
    retried: true,
    staleProcessing: result.staleProcessing,
    queueItem: result.queueItem,
    capture: result.capture,
    requested: summary.results.length,
    ...summary,
  };
}

function batchResponse(
  summary: ReturnType<typeof summarizeResults>,
  message?: string,
) {
  const first = firstRetried(summary.results);
  return {
    retried: summary.retriedCount > 0,
    staleProcessing: first?.staleProcessing ?? false,
    queueItem: first?.queueItem ?? null,
    capture: first?.capture ?? null,
    requested: summary.results.length,
    message,
    ...summary,
  };
}

export default defineAction({
  description:
    "Retry failed or stale Brain distillation queue items after checking access to each capture source. Supports one item, selected queue IDs, or all retryable items.",
  schema: retrySchema,
  run: async (args) => {
    const now = nowIso();
    const cutoff = staleProcessingCutoff(now);
    const { guidance } = await readBrainAgentGuidance();
    const queues = await resolveRequestedQueues({ ...args, cutoff });

    if (!queues.length) {
      if (isBatchMode(args)) {
        return batchResponse(summarizeResults([]), noQueueMessage(args));
      }
      throw new Error(noQueueMessage(args));
    }

    if (isBatchMode(args)) {
      const summary = await retryMany(queues, {
        cutoff,
        now,
        priority: args.priority,
        guidance,
      });
      return batchResponse(summary);
    }

    const [queue] = queues;
    try {
      const result = await retryQueue(queue, {
        cutoff,
        now,
        requestedCaptureId: args.captureId,
        priority: args.priority,
        guidance,
      });
      return singleResponse(result, summarizeResults([result]));
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  },
});
