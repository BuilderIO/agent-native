import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  createCapture,
  ensureManualSource,
  serializeCapture,
  serializeSource,
} from "../server/lib/brain.js";
import { captureKindSchema, optionalJsonRecordSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Import a generic capture into Brain. Transcript-kind captures are sanitized before storage by default.",
  schema: z.object({
    sourceId: z.string().optional(),
    sourceTitle: z
      .string()
      .optional()
      .describe("Manual source title to create/use when sourceId is omitted"),
    title: z.string().min(1),
    externalId: z.string().optional(),
    kind: captureKindSchema.default("generic"),
    content: z.string().min(1),
    capturedAt: z.string().optional(),
    metadata: optionalJsonRecordSchema,
    enqueueDistillation: z.coerce.boolean().default(true),
  }),
  run: async (args) => {
    const source = args.sourceId
      ? null
      : await ensureManualSource(args.sourceTitle ?? "Manual imports");
    const sourceId = args.sourceId ?? source!.id;
    const capture = await createCapture({
      sourceId,
      externalId: args.externalId,
      title: args.title,
      kind: args.kind,
      content: args.content,
      capturedAt: args.capturedAt,
      metadata: args.metadata,
    });
    return {
      source: source ? serializeSource(source) : undefined,
      capture: serializeCapture(capture),
      nextAction: args.enqueueDistillation
        ? "Call enqueue-distillation with this captureId."
        : undefined,
    };
  },
});
