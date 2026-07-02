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
import { optionalJsonRecordSchema } from "./_schemas.js";

async function writeDistillationRequest(values: {
  captureId: string;
  queueId: string;
  sourceId: string;
  requestedAt: string;
  instructions?: string | null;
  guidance: Awaited<ReturnType<typeof readBrainAgentGuidance>>["guidance"];
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
    const { guidance } = await readBrainAgentGuidance();
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
    const db = getDb();
    const now = nowIso();
    const [existing] = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(
        and(
          eq(schema.brainIngestQueue.captureId, args.captureId),
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
          .where(eq(schema.brainRawCaptures.id, args.captureId));
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
        captureId: args.captureId,
        queueId: existing.id,
        sourceId: access.capture.sourceId,
        requestedAt: now,
        instructions: args.instructions ?? existingInstructions,
        guidance,
      });
      return {
        queueItem: serializeDistillationQueue(existing),
        existing: true,
        guidance: guidance.distillation,
      };
    }
    const id = nanoid();
    await db.insert(schema.brainIngestQueue).values({
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
    await db
      .update(schema.brainRawCaptures)
      .set({ status: "distilling", updatedAt: now })
      .where(eq(schema.brainRawCaptures.id, args.captureId));
    await writeDistillationRequest({
      captureId: args.captureId,
      queueId: id,
      sourceId: access.capture.sourceId,
      requestedAt: now,
      instructions: args.instructions ?? null,
      guidance,
    });
    return {
      queueItem: {
        id,
        sourceId: access.capture.sourceId,
        captureId: args.captureId,
        status: "queued",
        priority: args.priority,
        attempts: 0,
        error: null,
        runAfter: null,
        createdAt: now,
        updatedAt: now,
      },
      existing: false,
      guidance: guidance.distillation,
    };
  },
});
