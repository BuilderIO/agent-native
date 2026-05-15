import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nowIso,
  serializeCapture,
} from "../server/lib/brain.js";

export default defineAction({
  description: "Mark a raw Brain capture as distilled or ignored.",
  schema: z.object({
    captureId: z.string().min(1),
    status: z.enum(["distilled", "ignored"]).default("distilled"),
  }),
  run: async ({ captureId, status }) => {
    const access = await getAccessibleCapture(captureId);
    if (!access) throw new Error(`No access to capture ${captureId}`);
    await getDb()
      .update(schema.brainRawCaptures)
      .set({
        status,
        distilledAt: status === "distilled" ? nowIso() : null,
        updatedAt: nowIso(),
      })
      .where(eq(schema.brainRawCaptures.id, captureId));
    const updated = await getAccessibleCapture(captureId);
    return { capture: updated ? serializeCapture(updated.capture) : null };
  },
});
