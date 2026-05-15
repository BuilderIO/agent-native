import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { redactSensitiveText } from "../server/lib/search.js";

const queueStatusSchema = z.enum(["queued", "processing", "done", "failed"]);
const STALE_PROCESSING_MS = 15 * 60 * 1000;

function staleProcessingCutoff(now: string) {
  return new Date(Date.parse(now) - STALE_PROCESSING_MS).toISOString();
}

function isStaleProcessing(status: string, updatedAt: string, cutoff: string) {
  if (status !== "processing") return false;
  const updated = Date.parse(updatedAt);
  const threshold = Date.parse(cutoff);
  return Number.isFinite(updated) && Number.isFinite(threshold)
    ? updated <= threshold
    : updatedAt <= cutoff;
}

function redactOptionalText(value: string | null) {
  return value ? redactSensitiveText(value) : value;
}

export default defineAction({
  description:
    "List Brain distillation queue items for accessible sources, including retry state and stale processing detection.",
  schema: z.object({
    sourceId: z.string().min(1).optional(),
    status: queueStatusSchema.optional(),
    staleOnly: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const now = new Date().toISOString();
    const staleCutoff = staleProcessingCutoff(now);
    const clauses = [
      eq(schema.brainIngestQueue.operation, "distill"),
      accessFilter(schema.brainSources, schema.brainSourceShares),
    ];
    if (args.sourceId) {
      clauses.push(eq(schema.brainSources.id, args.sourceId));
    }
    if (args.status) {
      clauses.push(eq(schema.brainIngestQueue.status, args.status));
    }
    if (args.staleOnly) {
      clauses.push(eq(schema.brainIngestQueue.status, "processing"));
      clauses.push(lte(schema.brainIngestQueue.updatedAt, staleCutoff));
    }

    const rows = await db
      .select({
        id: schema.brainIngestQueue.id,
        sourceId: schema.brainIngestQueue.sourceId,
        captureId: schema.brainIngestQueue.captureId,
        status: schema.brainIngestQueue.status,
        priority: schema.brainIngestQueue.priority,
        attempts: schema.brainIngestQueue.attempts,
        lastError: schema.brainIngestQueue.error,
        runAfter: schema.brainIngestQueue.runAfter,
        createdAt: schema.brainIngestQueue.createdAt,
        updatedAt: schema.brainIngestQueue.updatedAt,
        sourceTableId: schema.brainSources.id,
        captureTitle: schema.brainRawCaptures.title,
        captureStatus: schema.brainRawCaptures.status,
        sourceTitle: schema.brainSources.title,
        sourceProvider: schema.brainSources.provider,
        sourceStatus: schema.brainSources.status,
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

    const items = rows.map((row) => {
      const staleProcessing = isStaleProcessing(
        row.status,
        row.updatedAt,
        staleCutoff,
      );
      return {
        id: row.id,
        sourceId: row.sourceTableId,
        captureId: row.captureId ?? null,
        status: row.status,
        priority: row.priority,
        attempts: row.attempts,
        lastError: redactOptionalText(row.lastError),
        runAfter: row.runAfter,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        staleProcessing,
        retryable: row.status === "failed" || staleProcessing,
        source: {
          id: row.sourceTableId,
          title: redactSensitiveText(row.sourceTitle),
          provider: row.sourceProvider,
          status: row.sourceStatus,
        },
        capture: {
          id: row.captureId,
          title: redactSensitiveText(row.captureTitle),
          status: row.captureStatus,
        },
      };
    });

    const summary = {
      total: items.length,
      queued: 0,
      processing: 0,
      done: 0,
      failed: 0,
      staleProcessing: 0,
      retryable: 0,
    };
    for (const item of items) {
      summary[item.status] += 1;
      if (item.staleProcessing) summary.staleProcessing += 1;
      if (item.retryable) summary.retryable += 1;
    }

    return {
      count: items.length,
      staleProcessingCutoff: staleCutoff,
      summary,
      items,
    };
  },
});
