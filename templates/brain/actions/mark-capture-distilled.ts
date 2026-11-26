import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nowIso,
  serializeCapture,
} from "../server/lib/brain.js";
import {
  redactSensitiveText,
  redactSensitiveValue,
} from "../server/lib/search.js";

export default defineAction({
  description: "Mark a raw Brain capture as distilled or ignored.",
  schema: z
    .object({
      captureId: z.string().min(1),
      status: z.enum(["distilled", "ignored"]).default("distilled"),
      queueId: z.string().min(1).optional(),
      claimToken: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (Boolean(value.queueId) !== Boolean(value.claimToken)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "queueId and claimToken must be supplied together.",
        });
      }
    }),
  mcpTool: false,
  run: async ({ captureId, status, queueId, claimToken }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access) throw new Error(`No access to capture ${captureId}`);
    await assertAccess("brain-source", access.capture.sourceId, "editor");
    const now = nowIso();

    await getDb().transaction(async (tx) => {
      await tx
        .select({ id: schema.brainRawCaptures.id })
        .from(schema.brainRawCaptures)
        .where(eq(schema.brainRawCaptures.id, captureId))
        .limit(1)
        .for("update");
      if (queueId && claimToken) {
        const completed = await tx
          .update(schema.brainIngestQueue)
          .set({
            status: "done",
            error: null,
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
        if (completed.length === 0) {
          fail(
            "The distillation claim is no longer active; do not complete a newer worker's queue item.",
            { errorCode: "distillation_claim_inactive", statusCode: 409 },
          );
        }
      } else {
        await tx
          .update(schema.brainIngestQueue)
          .set({
            status: "done",
            error: null,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.brainIngestQueue.captureId, captureId),
              eq(schema.brainIngestQueue.operation, "distill"),
              eq(schema.brainIngestQueue.status, "queued"),
            ),
          );
        const processing = await tx
          .select({ id: schema.brainIngestQueue.id })
          .from(schema.brainIngestQueue)
          .where(
            and(
              eq(schema.brainIngestQueue.captureId, captureId),
              eq(schema.brainIngestQueue.operation, "distill"),
              eq(schema.brainIngestQueue.status, "processing"),
            ),
          )
          .orderBy(desc(schema.brainIngestQueue.updatedAt))
          .limit(1);
        if (processing.length > 0) {
          fail(
            "This capture has an active distillation claim. Supply its queueId and claimToken to complete it.",
            { errorCode: "distillation_claim_active", statusCode: 409 },
          );
        }
      }
      await tx
        .update(schema.brainRawCaptures)
        .set({
          status,
          distilledAt: status === "distilled" ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.brainRawCaptures.id, captureId));
    });
    const updated = await getAccessibleCapture(captureId);
    if (!updated) return { capture: null };
    const capture = serializeCapture(updated.capture);
    return {
      capture: {
        ...capture,
        externalId: capture.externalId
          ? redactSensitiveText(capture.externalId)
          : capture.externalId,
        title: redactSensitiveText(capture.title),
        content: redactSensitiveText(capture.content),
        metadata: redactSensitiveValue(capture.metadata),
        importedBy: capture.importedBy
          ? redactSensitiveText(capture.importedBy)
          : capture.importedBy,
        contentRedacted: true,
      },
    };
  },
});
