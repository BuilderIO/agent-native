import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
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
  schema: z.object({
    captureId: z.string().min(1),
    status: z.enum(["distilled", "ignored"]).default("distilled"),
  }),
  run: async ({ captureId, status }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access) throw new Error(`No access to capture ${captureId}`);
    const db = getDb();
    const now = nowIso();
    await db
      .update(schema.brainRawCaptures)
      .set({
        status,
        distilledAt: status === "distilled" ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.brainRawCaptures.id, captureId));
    await db
      .update(schema.brainIngestQueue)
      .set({
        status: "done",
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.brainIngestQueue.captureId, captureId),
          eq(schema.brainIngestQueue.operation, "distill"),
          inArray(schema.brainIngestQueue.status, ["queued", "processing"]),
        ),
      );
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
