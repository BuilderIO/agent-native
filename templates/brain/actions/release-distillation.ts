import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getAccessibleCapture, nowIso } from "../server/lib/brain.js";
import {
  DISTILLATION_HANDOFF_CANCELLED_ERROR,
  DISTILLATION_HANDOFF_DELIVERY_UNKNOWN_ERROR,
} from "../shared/distillation-handoff-errors.js";

export default defineAction({
  description:
    "Record an undelivered or uncertain distillation handoff as failed, fenced by its active claim.",
  agentTool: false,
  schema: z.object({
    captureId: z.string().min(1),
    queueId: z.string().min(1),
    claimToken: z.string().min(1),
    reason: z.enum(["cancelled", "delivery-unknown"]),
  }),
  run: async ({ captureId, queueId, claimToken, reason }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access)
      fail(`No access to capture ${captureId}`, {
        errorCode: "capture_access_denied",
        statusCode: 403,
      });
    const updated = await getDb()
      .update(schema.brainIngestQueue)
      .set({
        status: "failed",
        error:
          reason === "cancelled"
            ? DISTILLATION_HANDOFF_CANCELLED_ERROR
            : DISTILLATION_HANDOFF_DELIVERY_UNKNOWN_ERROR,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: nowIso(),
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
  },
});
