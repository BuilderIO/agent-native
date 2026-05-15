import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nanoid,
  nowIso,
  stableJson,
} from "../server/lib/brain.js";
import { optionalJsonRecordSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Queue a raw capture for distillation into durable Brain knowledge.",
  schema: z.object({
    captureId: z.string().min(1),
    priority: z.coerce.number().int().min(0).max(100).default(50),
    instructions: z.string().optional(),
    payload: optionalJsonRecordSchema,
  }),
  run: async (args) => {
    const access = await getAccessibleCapture(args.captureId);
    if (!access) throw new Error(`No access to capture ${args.captureId}`);
    const now = nowIso();
    const id = nanoid();
    await getDb()
      .insert(schema.brainIngestQueue)
      .values({
        id,
        sourceId: access.capture.sourceId,
        captureId: access.capture.id,
        operation: "distill",
        status: "queued",
        priority: args.priority,
        attempts: 0,
        payloadJson: stableJson({
          ...(args.payload ?? {}),
          instructions: args.instructions,
        }),
        error: null,
        runAfter: null,
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .update(schema.brainRawCaptures)
      .set({ status: "distilling", updatedAt: now })
      .where(eq(schema.brainRawCaptures.id, args.captureId));
    return { queueItem: { id, captureId: args.captureId, status: "queued" } };
  },
});
