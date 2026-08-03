import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getAccessibleCapture } from "../server/lib/brain.js";
import { enqueueCaptureDistillation } from "../server/lib/distillation-queue.js";
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
    if (
      access.capture.status === "distilled" ||
      access.capture.status === "ignored"
    ) {
      throw new Error(
        `Capture ${args.captureId} is already ${access.capture.status}`,
      );
    }
    return enqueueCaptureDistillation({
      capture: access.capture,
      priority: args.priority,
      instructions: args.instructions,
      payload: args.payload,
    });
  },
});
