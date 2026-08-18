import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
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

const LEASE_MS = 15 * 60 * 1000;

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
    const leaseExpiresAt = new Date(Date.parse(now) + LEASE_MS).toISOString();
    const payload = parseJson<Record<string, unknown>>(queue.payloadJson, {});
    const result = await getDbExec().execute({
      sql: `UPDATE brain_ingest_queue
        SET status = ?, attempts = ?, payload_json = ?, error = NULL,
            run_after = NULL, lease_token = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = ? AND updated_at = ?`,
      args: [
        "processing",
        queue.attempts + 1,
        stableJson({ ...payload, claimedAt: now, claimedBy: "brain-agent" }),
        claimToken,
        leaseExpiresAt,
        now,
        queue.id,
        "queued",
        queue.updatedAt,
      ],
    });
    if (result.rowsAffected === 0) return { claimed: false, queueItem: null };

    const [updated] = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(eq(schema.brainIngestQueue.id, queue.id))
      .limit(1);
    const claimed =
      updated?.status === "processing" && updated?.leaseToken === claimToken;

    return {
      claimed,
      queueItem: updated ? serializeDistillationQueue(updated) : null,
      claimToken: claimed ? claimToken : null,
    };
  },
});
