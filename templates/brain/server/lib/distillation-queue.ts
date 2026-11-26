import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray } from "drizzle-orm";

import {
  intelligenceDistillationInstructions,
  KNOWLEDGE_UPDATE_INSTRUCTIONS,
} from "../../shared/intelligence-distillation.js";
import { getDb, schema } from "../db/index.js";
import {
  nanoid,
  nowIso,
  parseJson,
  readBrainAgentGuidance,
  serializeDistillationQueue,
  stableJson,
} from "./brain.js";

type CaptureRow = typeof schema.brainRawCaptures.$inferSelect;
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
      `durable company knowledge, including brief dated launch announcements, ` +
      `with exact evidence quotes. Keep launch plans distinct from confirmed ` +
      `launches. ` +
      intelligenceDistillationInstructions(values.captureId) +
      `Call write-knowledge for other supported durable entries. ` +
      KNOWLEDGE_UPDATE_INSTRUCTIONS +
      `Call mark-capture-distilled when finished. Ignore only when no company-relevant ` +
      `fact remains after privacy filtering.`,
  });
}

export async function enqueueCaptureDistillation(values: {
  capture: CaptureRow;
  priority?: number;
  instructions?: string;
  payload?: Record<string, unknown>;
  guidance?: BrainAgentGuidance;
  reconsiderIgnored?: boolean;
}) {
  await assertAccess("brain-source", values.capture.sourceId, "editor");
  const guidance = values.guidance ?? (await readBrainAgentGuidance()).guidance;
  const now = nowIso();

  return getDb().transaction(async (tx) => {
    const current = (
      await tx
        .select({
          id: schema.brainRawCaptures.id,
          status: schema.brainRawCaptures.status,
        })
        .from(schema.brainRawCaptures)
        .where(eq(schema.brainRawCaptures.id, values.capture.id))
        .limit(1)
        .for("update")
    ).find((row) => row.id === values.capture.id);
    if (!current) throw new Error(`Capture ${values.capture.id} not found`);
    if (
      current.status === "distilled" ||
      (current.status === "ignored" && !values.reconsiderIgnored)
    ) {
      throw new Error(
        `Capture ${values.capture.id} is already ${current.status}`,
      );
    }

    const existing = (
      await tx
        .select()
        .from(schema.brainIngestQueue)
        .where(
          and(
            eq(schema.brainIngestQueue.captureId, values.capture.id),
            eq(schema.brainIngestQueue.operation, "distill"),
            inArray(schema.brainIngestQueue.status, ["queued", "processing"]),
          ),
        )
        .orderBy(desc(schema.brainIngestQueue.updatedAt))
        .limit(1)
    ).find((row) => row.captureId === values.capture.id);

    if (existing) {
      if (current.status !== "distilling") {
        await tx
          .update(schema.brainRawCaptures)
          .set({ status: "distilling", updatedAt: now })
          .where(eq(schema.brainRawCaptures.id, values.capture.id));
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
        captureId: values.capture.id,
        queueId: existing.id,
        sourceId: values.capture.sourceId,
        requestedAt: now,
        instructions: values.instructions ?? existingInstructions ?? null,
        guidance,
      });
      return {
        queueItem: serializeDistillationQueue(existing),
        existing: true,
        guidance: guidance.distillation,
      };
    }

    const id = nanoid();
    const priority = values.priority ?? 50;
    await tx.insert(schema.brainIngestQueue).values({
      id,
      sourceId: values.capture.sourceId,
      captureId: values.capture.id,
      operation: "distill",
      status: "queued",
      priority,
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
    await tx
      .update(schema.brainRawCaptures)
      .set({ status: "distilling", updatedAt: now })
      .where(eq(schema.brainRawCaptures.id, values.capture.id));
    await writeDistillationRequest({
      captureId: values.capture.id,
      queueId: id,
      sourceId: values.capture.sourceId,
      requestedAt: now,
      instructions: values.instructions ?? null,
      guidance,
    });

    return {
      queueItem: {
        id,
        sourceId: values.capture.sourceId,
        captureId: values.capture.id,
        status: "queued" as const,
        priority,
        attempts: 0,
        error: null,
        runAfter: null,
        createdAt: now,
        updatedAt: now,
      },
      existing: false,
      guidance: guidance.distillation,
    };
  });
}
