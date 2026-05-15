import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stableJson } from "../server/lib/brain.js";

export interface ProcessBrainIngestQueueOptions {
  limit?: number;
}

const DISTILLATION_RECHECK_MS = 5 * 60 * 1000;

function recheckAt(now: string) {
  return new Date(Date.parse(now) + DISTILLATION_RECHECK_MS).toISOString();
}

export async function processBrainIngestQueueOnce(
  options: ProcessBrainIngestQueueOptions = {},
) {
  return runWithRequestContext({}, async () => {
    const db = getDb();
    const now = nowIso();
    const rows = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(
        and(
          eq(schema.brainIngestQueue.status, "queued"),
          or(
            isNull(schema.brainIngestQueue.runAfter),
            eq(schema.brainIngestQueue.runAfter, ""),
            lte(schema.brainIngestQueue.runAfter, now),
          ),
        ),
      )
      .orderBy(asc(schema.brainIngestQueue.priority))
      .limit(options.limit ?? 10);

    const processed: string[] = [];
    const deferred: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      await db
        .update(schema.brainIngestQueue)
        .set({
          status: "processing",
          attempts: row.attempts + 1,
          updatedAt: now,
        })
        .where(eq(schema.brainIngestQueue.id, row.id));

      const payload = parseJson<Record<string, unknown>>(row.payloadJson, {});
      if (row.operation === "distill") {
        await db
          .update(schema.brainIngestQueue)
          .set({
            status: "queued",
            payloadJson: stableJson({
              ...payload,
              lastDistillationCheckAt: now,
            }),
            error:
              "Distillation is still queued; no distillation worker completed this item.",
            runAfter: recheckAt(now),
            updatedAt: now,
          })
          .where(eq(schema.brainIngestQueue.id, row.id));
        deferred.push(row.id);
        continue;
      }

      await db
        .update(schema.brainIngestQueue)
        .set({
          status: "failed",
          payloadJson: stableJson({ ...payload, failedAt: now }),
          error: `Unsupported ingest queue operation: ${row.operation}`,
          updatedAt: now,
        })
        .where(eq(schema.brainIngestQueue.id, row.id));
      failed.push(row.id);
    }

    return { processed, deferred, failed };
  });
}
