import { writeAppState } from "@agent-native/core/application-state";
import { and, desc, eq, inArray } from "drizzle-orm";

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
      `only durable company knowledge with exact evidence quotes, ` +
      `call write-knowledge for supported entries or proposals, then call ` +
      `mark-capture-distilled when finished. If the capture is personal or ` +
      `out of scope, call mark-capture-distilled with status ignored.`,
  });
}

export async function enqueueCaptureDistillation(values: {
  capture: CaptureRow;
  priority?: number;
  instructions?: string;
  payload?: Record<string, unknown>;
  guidance?: BrainAgentGuidance;
}) {
  const guidance = values.guidance ?? (await readBrainAgentGuidance()).guidance;
  const db = getDb();
  const now = nowIso();
  const [existing] = await db
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
    .limit(1);

  if (existing) {
    if (values.capture.status !== "distilling") {
      await db
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
      instructions: values.instructions ?? existingInstructions,
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
  await db.insert(schema.brainIngestQueue).values({
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
  await db
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
}
