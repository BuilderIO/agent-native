import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getAccessibleCapture,
  readBrainAgentGuidance,
} from "../server/lib/brain.js";
import { enqueueCaptureDistillation } from "../server/lib/distillation-queue.js";
import { redactSensitiveText } from "../server/lib/search.js";
import { optionalJsonRecordSchema, stringArrayCliSchema } from "./_schemas.js";

type BrainAgentGuidance = Awaited<
  ReturnType<typeof readBrainAgentGuidance>
>["guidance"];

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message);
}

async function enqueueOneCapture(values: {
  captureId: string;
  priority: number;
  instructions?: string;
  payload?: Record<string, unknown>;
  guidance: BrainAgentGuidance;
}) {
  try {
    const access = await getAccessibleCapture(values.captureId);
    if (!access) {
      return {
        captureId: values.captureId,
        outcome: "error" as const,
        code: "inaccessible",
        error: `No access to capture ${values.captureId}`,
      };
    }

    if (
      access.capture.status === "distilled" ||
      access.capture.status === "ignored"
    ) {
      return {
        captureId: values.captureId,
        sourceId: access.capture.sourceId,
        captureStatus: access.capture.status,
        outcome: "error" as const,
        code: `already-${access.capture.status}`,
        error: `Capture ${values.captureId} is already ${access.capture.status}`,
      };
    }

    const result = await enqueueCaptureDistillation({
      capture: access.capture,
      priority: values.priority,
      instructions: values.instructions,
      payload: values.payload,
      guidance: values.guidance,
    });

    return {
      captureId: values.captureId,
      sourceId: access.capture.sourceId,
      outcome: result.existing ? ("existing" as const) : ("queued" as const),
      existing: result.existing,
      queueItem: result.queueItem,
    };
  } catch (error) {
    return {
      captureId: values.captureId,
      outcome: "error" as const,
      code: "queue-failed",
      error: errorMessage(error),
    };
  }
}

type EnqueueCaptureResult = Awaited<ReturnType<typeof enqueueOneCapture>>;

export default defineAction({
  description:
    "Queue multiple raw Brain captures for distillation without failing the whole batch when individual captures are inaccessible or already terminal.",
  schema: z.object({
    captureIds: stringArrayCliSchema({ min: 1, max: 100 }).describe(
      "Capture IDs selected for distillation.",
    ),
    priority: z.coerce.number().int().min(0).max(100).default(50),
    instructions: z.string().optional(),
    payload: optionalJsonRecordSchema,
  }),
  run: async (args) => {
    const { guidance } = await readBrainAgentGuidance();
    const results: EnqueueCaptureResult[] = [];

    for (const captureId of args.captureIds) {
      results.push(
        await enqueueOneCapture({
          captureId,
          priority: args.priority,
          instructions: args.instructions,
          payload: args.payload,
          guidance,
        }),
      );
    }

    return {
      requested: args.captureIds.length,
      queued: results.filter((result) => result.outcome === "queued").length,
      existing: results.filter((result) => result.outcome === "existing")
        .length,
      errors: results.filter((result) => result.outcome === "error").length,
      results,
      guidance: guidance.distillation,
    };
  },
});
