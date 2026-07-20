import { defineAction } from "@agent-native/core";
import { getDbExec } from "@agent-native/core/db";
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
  run: async ({ captureId, status, queueId, claimToken }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access) throw new Error(`No access to capture ${captureId}`);
    const db = getDb();
    const now = nowIso();

    if (queueId && claimToken) {
      const result = await getDbExec().execute({
        sql: `UPDATE brain_ingest_queue
          SET status = ?, error = NULL, lease_token = NULL,
              lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND capture_id = ? AND operation = 'distill'
            AND status = 'processing' AND lease_token = ?`,
        args: ["done", now, queueId, captureId, claimToken],
      });
      if (result.rowsAffected === 0) {
        throw new Error(
          "The distillation claim is no longer active; do not complete a newer worker's queue item.",
        );
      }
    } else {
      const [processing] = await db
        .select()
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
      if (processing) {
        throw new Error(
          "This capture has an active distillation claim. Supply its queueId and claimToken to complete it.",
        );
      }
      await db
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
    }
    await db
      .update(schema.brainRawCaptures)
      .set({
        status,
        distilledAt: status === "distilled" ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.brainRawCaptures.id, captureId));
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
