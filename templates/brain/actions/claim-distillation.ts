import { defineAction } from "@agent-native/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nanoid,
  nowIso,
  parseJson,
  serializeDistillationQueue,
  stableJson,
} from "../server/lib/brain.js";

export default defineAction({
  description:
    "Claim a queued Brain capture distillation item before handing it to an agent worker.",
  schema: z.object({
    captureId: z.string().min(1),
    queueId: z.string().min(1).optional(),
  }),
  run: async ({ captureId, queueId }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access) throw new Error(`No access to capture ${captureId}`);

    const db = getDb();
    const clauses = [
      eq(schema.brainIngestQueue.captureId, captureId),
      eq(schema.brainIngestQueue.operation, "distill"),
      eq(schema.brainIngestQueue.status, "queued"),
    ];
    if (queueId) clauses.push(eq(schema.brainIngestQueue.id, queueId));

    const [queue] = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(and(...clauses))
      .orderBy(desc(schema.brainIngestQueue.updatedAt))
      .limit(1);
    if (!queue) return { claimed: false, queueItem: null };

    const now = nowIso();
    const claimToken = nanoid(16);
    const payload = parseJson<Record<string, unknown>>(queue.payloadJson, {});
    await db
      .update(schema.brainIngestQueue)
      .set({
        status: "processing",
        attempts: queue.attempts + 1,
        payloadJson: stableJson({
          ...payload,
          claimToken,
          claimedAt: now,
          claimedBy: "brain-agent",
        }),
        error: null,
        runAfter: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.brainIngestQueue.id, queue.id),
          eq(schema.brainIngestQueue.status, "queued"),
        ),
      );

    const [updated] = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(eq(schema.brainIngestQueue.id, queue.id))
      .limit(1);
    const updatedPayload = parseJson<Record<string, unknown>>(
      updated?.payloadJson,
      {},
    );
    const claimed =
      updated?.status === "processing" &&
      updatedPayload.claimToken === claimToken;

    return {
      claimed,
      queueItem: updated ? serializeDistillationQueue(updated) : null,
    };
  },
});
