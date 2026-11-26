import { defineAction, isOutsideAgentCall } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
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
  needsApproval: async (args, ctx) =>
    isOutsideAgentCall(ctx) &&
    (await importReplacesCapture(args.externalId ? [args.externalId] : [], {
      sourceId: args.sourceId,
      sourceTitle: args.sourceTitle,
    })),
  mcpTool: "search",
  run: async (args) => {
    const importerEmail = getRequestUserEmail()?.trim().toLowerCase();
    let participants = args.participants;
    if (!participants.length) {
      if (!importerEmail) {
        throw new Error(
          "Importing a transcript without participants requires an authenticated importer.",
        );
      }
      participants = [importerEmail];
    }
    const source = args.sourceId
      ? null
      : await ensureManualSource(args.sourceTitle);
    let written;
    try {
      written = await createCaptureWithWarnings({
        sourceId: args.sourceId ?? source!.id,
        externalId: args.externalId,
        title: args.title,
        kind: "transcript",
        content: args.transcript,
        capturedAt: args.capturedAt,
        metadata: {
          ...(args.metadata ?? {}),
          participants,
          sourceUrl: args.sourceUrl,
          tags: args.tags,
        },
        audience: {
          kind: "meeting",
          memberEmails: participants,
          upstreamRefHash: args.externalId,
        },
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
