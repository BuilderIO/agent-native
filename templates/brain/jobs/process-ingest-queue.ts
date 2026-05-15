import { and, asc, eq, isNull, or } from "drizzle-orm";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stableJson } from "../server/lib/brain.js";

export interface ProcessBrainIngestQueueOptions {
  limit?: number;
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
          ),
        ),
      )
      .orderBy(asc(schema.brainIngestQueue.priority))
      .limit(options.limit ?? 10);

    const processed = [];
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
      await db
        .update(schema.brainIngestQueue)
        .set({
          status: "done",
          payloadJson: stableJson({ ...payload, processedAt: now }),
          updatedAt: now,
        })
        .where(eq(schema.brainIngestQueue.id, row.id));
      processed.push(row.id);
    }

    return { processed };
  });
}
