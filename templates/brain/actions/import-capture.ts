import { defineAction, isOutsideAgentCall } from "@agent-native/core/action";
import { z } from "zod";

import {
  BrainCaptureBlockedError,
  createCaptureWithWarnings,
  ensureManualSource,
  serializeCapture,
  serializeSource,
} from "../server/lib/brain.js";
import { importReplacesCapture } from "../server/lib/capture-replacement.js";
import { enqueueCaptureDistillation } from "../server/lib/distillation-queue.js";
import { rethrowManualImportError } from "./_manual-import-errors.js";
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
  needsApproval: async (args, ctx) =>
    isOutsideAgentCall(ctx) &&
    (await importReplacesCapture(args.externalId ? [args.externalId] : [], {
      sourceId: args.sourceId,
      sourceTitle: args.sourceTitle,
    })),
  mcpTool: "search",
  run: async (args) => {
    const source = args.sourceId
      ? null
      : await ensureManualSource(args.sourceTitle ?? "Manual imports");
    const sourceId = args.sourceId ?? source!.id;
    let written;
    try {
      written = await createCaptureWithWarnings({
        sourceId,
        externalId: args.externalId,
        title: args.title,
        kind: args.kind,
        content: args.content,
        capturedAt: args.capturedAt,
        metadata: args.metadata,
      });
    } catch (error) {
      if (!(error instanceof BrainCaptureBlockedError)) {
        rethrowManualImportError(error);
      }
      return {
        source: source ? serializeSource(source) : undefined,
        capture: undefined,
        sensitivityReceipt: error.receipt,
        distillation: undefined,
      };
    }
    const { capture, ...warnings } = written;
    const distillation =
      args.enqueueDistillation &&
      capture.status !== "distilled" &&
      capture.status !== "ignored"
        ? await enqueueCaptureDistillation({ capture })
        : undefined;
    const serializedCapture = serializeCapture(capture);
    return {
      source: source ? serializeSource(source) : undefined,
      capture: distillation
        ? {
            ...serializedCapture,
            status: "distilling",
            updatedAt: distillation.queueItem.updatedAt,
          }
        : serializedCapture,
      distillation,
      ...warnings,
    };
  },
});
