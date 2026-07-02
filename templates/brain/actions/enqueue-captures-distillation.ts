import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getAccessibleCapture,
  nanoid,
  nowIso,
  parseJson,
  readBrainAgentGuidance,
  serializeDistillationQueue,
  stableJson,
} from "../server/lib/brain.js";
import { redactSensitiveText } from "../server/lib/search.js";
import { optionalJsonRecordSchema, stringArrayCliSchema } from "./_schemas.js";

type BrainAgentGuidance = Awaited<
  ReturnType<typeof readBrainAgentGuidance>
>["guidance"];

async function writeDistillationRequest(values: {
  captureId: string;
  queueId: string;
  sourceId: string;
  requestedAt: string;
  instructions?: string | null;
  guidance: BrainAgentGuidance;
}) {
  await writeAppState(`brain-distill-request-${values.captureId}`, {
    kind: "distill-capture",
    captureId: values.captureId,
    queueId: values.queueId,
    sourceId: values.sourceId,
    requestedAt: values.requestedAt,
    instructions: values.instructions ?? null,
    guidance: values.guidance,
    message:
      `Distill Brain capture ${values.captureId} for ${values.guidance.identity.companyName ?? "this workspace"}. ` +
      `Apply the Brain settings guidance in context. Use get-capture with ` +
      `includeRawContent=true when you need exact quote validation, extract ` +
      `only durable company knowledge with exact evidence quotes, ` +
      `call write-knowledge for supported entries or proposals, then call ` +
      `mark-capture-distilled when finished. If the capture is personal or ` +
      `out of scope, call mark-capture-distilled with status ignored.`,
  });
}

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

    const db = getDb();
    const now = nowIso();
    const [existing] = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(
        and(
          eq(schema.brainIngestQueue.captureId, values.captureId),
          eq(schema.brainIngestQueue.operation, "distill"),
          inArray(schema.brainIngestQueue.status, ["queued", "processing"]),
        ),
      )
      .orderBy(desc(schema.brainIngestQueue.updatedAt))
      .limit(1);

    if (existing) {
      if (access.capture.status !== "distilling") {
        await db
          .update(schema.brainRawCaptures)
          .set({ status: "distilling", updatedAt: now })
          .where(eq(schema.brainRawCaptures.id, values.captureId));
      }
      const payload = parseJson<Record<string, unknown>>(
        existing.payloadJson,
        {},
      );
      const existingInstructions =
        typeof payload.instructions === "string"
          ? payload.instructions
          : undefined;
      await writeDistillationRequest({
        captureId: values.captureId,
        queueId: existing.id,
        sourceId: access.capture.sourceId,
        requestedAt: now,
        instructions: values.instructions ?? existingInstructions,
        guidance: values.guidance,
      });
      return {
        captureId: values.captureId,
        sourceId: access.capture.sourceId,
        outcome: "existing" as const,
        existing: true,
        queueItem: serializeDistillationQueue(existing),
      };
    }

    const id = nanoid();
    await db.insert(schema.brainIngestQueue).values({
      id,
      sourceId: access.capture.sourceId,
      captureId: access.capture.id,
      operation: "distill",
      status: "queued",
      priority: values.priority,
      attempts: 0,
      payloadJson: stableJson({
        ...(values.payload ?? {}),
        instructions: values.instructions,
      }),
      error: null,
      runAfter: null,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.brainRawCaptures)
      .set({ status: "distilling", updatedAt: now })
      .where(eq(schema.brainRawCaptures.id, values.captureId));
    await writeDistillationRequest({
      captureId: values.captureId,
      queueId: id,
      sourceId: access.capture.sourceId,
      requestedAt: now,
      instructions: values.instructions ?? null,
      guidance: values.guidance,
    });

    return {
      captureId: values.captureId,
      sourceId: access.capture.sourceId,
      outcome: "queued" as const,
      existing: false,
      queueItem: {
        id,
        sourceId: access.capture.sourceId,
        captureId: values.captureId,
        status: "queued" as const,
        priority: values.priority,
        attempts: 0,
        error: null,
        runAfter: null,
        createdAt: now,
        updatedAt: now,
      },
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
