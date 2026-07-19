import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  BrainCaptureBlockedError,
  createCapture,
  ensureManualSource,
  serializeCapture,
  serializeSource,
} from "../server/lib/brain.js";
import { optionalJsonRecordSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Import a meeting transcript into Brain. Transcript captures are sanitized before storage by default.",
  schema: z.object({
    sourceId: z.string().optional(),
    sourceTitle: z.string().default("Meeting transcripts"),
    externalId: z.string().optional(),
    title: z.string().min(1),
    transcript: z.string().min(1),
    capturedAt: z.string().optional(),
    participants: z.array(z.string()).default([]),
    metadata: optionalJsonRecordSchema,
    sourceUrl: z.string().url().optional(),
    tags: z.array(z.string()).default([]),
    enqueueDistillation: z.coerce.boolean().default(true),
  }),
  run: async (args) => {
    const source = args.sourceId
      ? null
      : await ensureManualSource(args.sourceTitle);
    let capture;
    try {
      capture = await createCapture({
        sourceId: args.sourceId ?? source!.id,
        externalId: args.externalId,
        title: args.title,
        kind: "transcript",
        content: args.transcript,
        capturedAt: args.capturedAt,
        metadata: {
          ...(args.metadata ?? {}),
          participants: args.participants,
          sourceUrl: args.sourceUrl,
          tags: args.tags,
        },
        audience: {
          kind: "meeting",
          memberEmails: args.participants,
          upstreamRefHash: args.externalId,
        },
      });
    } catch (error) {
      if (!(error instanceof BrainCaptureBlockedError)) throw error;
      return {
        source: source ? serializeSource(source) : undefined,
        capture: undefined,
        sensitivityReceipt: error.receipt,
        nextAction: undefined,
      };
    }
    return {
      source: source ? serializeSource(source) : undefined,
      capture: serializeCapture(capture),
      nextAction: args.enqueueDistillation
        ? "Call enqueue-distillation with this captureId."
        : undefined,
    };
  },
});
