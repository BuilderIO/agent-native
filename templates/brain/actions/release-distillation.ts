import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getAccessibleCapture, nowIso } from "../server/lib/brain.js";
import {
  DISTILLATION_HANDOFF_CANCELLED_ERROR,
  DISTILLATION_HANDOFF_DELIVERY_UNKNOWN_ERROR,
} from "../shared/distillation-handoff-errors.js";

const READ_UNAVAILABLE_BASE_BACKOFF_MS = 10_000;
const READ_UNAVAILABLE_MAX_BACKOFF_MS = 300_000;

export default defineAction({
  description:
    "Record an undelivered or uncertain distillation handoff as failed, fenced by its active claim.",
  agentTool: false,
  outputSchema: z.object({ released: z.boolean() }),
  schema: z.object({
    captureId: z.string().min(1),
    queueId: z.string().min(1),
    claimToken: z.string().min(1),
    reason: z.enum(["cancelled", "delivery-unknown", "read-unavailable"]),
  }),
  run: async ({ captureId, queueId, claimToken, reason }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access)
      fail(`No access to capture ${captureId}`, {
        errorCode: "capture_access_denied",
        statusCode: 403,
      });
    await assertAccess("brain-source", access.capture.sourceId, "editor");
    const now = nowIso();
    return getDb().transaction(async (tx) => {
      await tx
        .select({ id: schema.brainRawCaptures.id })
        .from(schema.brainRawCaptures)
        .where(eq(schema.brainRawCaptures.id, captureId))
        .limit(1)
        .for("update");
      let runAfter: string | null = null;
      if (reason === "read-unavailable") {
        const currentRows = await tx
          .select({ attempts: schema.brainIngestQueue.attempts })
          .from(schema.brainIngestQueue)
          .where(eq(schema.brainIngestQueue.id, queueId))
          .limit(1);
        const attempts = Math.max(
          currentRows.find((row) => row.attempts)?.attempts ?? 1,
          1,
        );
        runAfter = new Date(
          Date.parse(now) +
            Math.min(
              READ_UNAVAILABLE_BASE_BACKOFF_MS * 2 ** (attempts - 1),
              READ_UNAVAILABLE_MAX_BACKOFF_MS,
            ),
        ).toISOString();
      }
      const updated = await tx
        .update(schema.brainIngestQueue)
        .set({
          status: reason === "read-unavailable" ? "queued" : "failed",
          error:
            reason === "read-unavailable"
              ? null
              : reason === "cancelled"
                ? DISTILLATION_HANDOFF_CANCELLED_ERROR
                : DISTILLATION_HANDOFF_DELIVERY_UNKNOWN_ERROR,
          runAfter,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.brainIngestQueue.id, queueId),
            eq(schema.brainIngestQueue.captureId, captureId),
            eq(schema.brainIngestQueue.operation, "distill"),
            eq(schema.brainIngestQueue.status, "processing"),
            eq(schema.brainIngestQueue.leaseToken, claimToken),
          ),
        )
        .returning({ id: schema.brainIngestQueue.id });
      return { released: updated.length === 1 };
    });
  },
});
