import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  parseJson,
  readBrainAgentGuidance,
  stableJson,
} from "../server/lib/brain.js";

type QueueRow = typeof schema.brainIngestQueue.$inferSelect;
type CaptureRow = typeof schema.brainRawCaptures.$inferSelect;
type SourceRow = typeof schema.brainSources.$inferSelect;

export interface DistillationAgentContext {
  queue: QueueRow;
  capture: CaptureRow;
  source: SourceRow;
  payload: Record<string, unknown>;
}

export type DistillationAgentRunner = (
  context: DistillationAgentContext,
) => Promise<void>;

export interface ProcessBrainIngestQueueOptions {
  limit?: number;
  runDistillation?: boolean;
  distillationRunner?: DistillationAgentRunner;
}

const DISTILLATION_RECHECK_MS = 5 * 60 * 1000;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const HEADLESS_DISTILLATION_TIMEOUT_MS = 5 * 60 * 1000;
const HEADLESS_DISTILLATION_SYSTEM_PROMPT = `You are the Brain distillation worker.

Convert raw company captures into durable, cited institutional knowledge.
Use only Brain actions. Never invent facts. Start by calling get-capture with
includeRawContent=true for the provided capture id when exact quote validation
is needed. Write supported durable entries with write-knowledge;
that action will route uncertain, sensitive, or low-confidence items through
the review queue when needed. Preserve exact short evidence quotes from the
capture. Exclude personal or out-of-scope material. Always finish by calling
mark-capture-distilled with status distilled, or status ignored when the capture
should not become company knowledge.`;

function recheckAt(now: string) {
  return new Date(Date.parse(now) + DISTILLATION_RECHECK_MS).toISOString();
}

function staleProcessingCutoff(now: string) {
  return new Date(Date.parse(now) - STALE_PROCESSING_MS).toISOString();
}

function queueDueCondition(now: string) {
  return or(
    and(
      eq(schema.brainIngestQueue.status, "queued"),
      or(
        isNull(schema.brainIngestQueue.runAfter),
        eq(schema.brainIngestQueue.runAfter, ""),
        lte(schema.brainIngestQueue.runAfter, now),
      ),
    ),
    and(
      eq(schema.brainIngestQueue.status, "processing"),
      lte(schema.brainIngestQueue.updatedAt, staleProcessingCutoff(now)),
    ),
  );
}

async function loadCaptureAndSource(row: QueueRow) {
  const db = getDb();
  if (!row.captureId) return null;
  const [capture] = await db
    .select()
    .from(schema.brainRawCaptures)
    .where(eq(schema.brainRawCaptures.id, row.captureId))
    .limit(1);
  if (!capture) return null;
  const [source] = await db
    .select()
    .from(schema.brainSources)
    // guard:allow-unscoped — background queue worker resolves owner/org from
    // the source row, then re-enters request context before agent execution.
    .where(eq(schema.brainSources.id, capture.sourceId))
    .limit(1);
  if (!source) return null;
  return { capture, source };
}

async function markFailed(row: QueueRow, message: string, payload: object) {
  const now = nowIso();
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "failed",
      payloadJson: stableJson(payload),
      error: message,
      updatedAt: now,
    })
    .where(eq(schema.brainIngestQueue.id, row.id));
}

async function requeueDistillation(
  row: QueueRow,
  message: string,
  payload: object,
) {
  const now = nowIso();
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "queued",
      payloadJson: stableJson(payload),
      error: message,
      runAfter: recheckAt(now),
      updatedAt: now,
    })
    .where(eq(schema.brainIngestQueue.id, row.id));
}

async function claimForHeadlessRunner(row: QueueRow, payload: object) {
  const now = nowIso();
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "processing",
      attempts: row.attempts + 1,
      payloadJson: stableJson(payload),
      error: null,
      runAfter: null,
      updatedAt: now,
    })
    .where(eq(schema.brainIngestQueue.id, row.id));
}

async function latestQueueRow(rowId: string) {
  const [updated] = await getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(eq(schema.brainIngestQueue.id, rowId))
    .limit(1);
  return updated;
}

function buildDistillationMessage(
  context: DistillationAgentContext,
  guidance: Awaited<ReturnType<typeof readBrainAgentGuidance>>["guidance"],
) {
  const instructions =
    typeof context.payload.instructions === "string"
      ? `\nAdditional extraction instructions:\n${context.payload.instructions}\n`
      : "";
  return [
    `Distill Brain capture ${context.capture.id}: ${context.capture.title}`,
    `Queue item: ${context.queue.id}`,
    `Source: ${context.source.title} (${context.source.provider})`,
    `Assistant: ${guidance.identity.assistantName}`,
    guidance.identity.companyName
      ? `Company/workspace: ${guidance.identity.companyName}`
      : "",
    `Tone: ${guidance.response.toneInstruction}`,
    `Citation policy: ${guidance.response.citationInstruction}`,
    `Default publish tier: ${guidance.distillation.defaultPublishTier}`,
    `Review policy: ${
      guidance.distillation.requireApprovalForCompanyKnowledge
        ? "company-tier knowledge normally requires review"
        : "company-tier knowledge can publish directly when write-knowledge allows it"
    }`,
    `Workspace distillation instructions: ${guidance.distillation.instructions}`,
    instructions,
    "Required workflow:",
    "1. Call get-capture with includeRawContent=true for this capture id when exact quote validation is needed.",
    "2. Extract only durable company knowledge with exact source quotes.",
    "3. Call write-knowledge for supported entries or proposals.",
    "4. Call mark-capture-distilled when finished, or mark ignored if excluded.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function defaultDistillationRunner(context: DistillationAgentContext) {
  const { guidance } = await readBrainAgentGuidance();
  const core = await import("@agent-native/core/server");
  const registry = await import("../.generated/actions-registry.js");
  const actions = core.loadActionsFromStaticRegistry(
    ((registry as { default?: unknown }).default ?? registry) as Record<
      string,
      unknown
    >,
  );
  const tools = core.actionsToEngineTools(actions);
  const userApiKey = await core.getOwnerActiveApiKey(context.source.ownerEmail);
  const engine = await core.resolveEngine({
    apiKey: userApiKey ?? process.env.ANTHROPIC_API_KEY,
    appId: "brain",
  });
  const model =
    (await core.getStoredModelForEngine(engine, { appId: "brain" })) ??
    engine.defaultModel;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    HEADLESS_DISTILLATION_TIMEOUT_MS,
  );
  try {
    await core.runAgentLoop({
      engine,
      model,
      systemPrompt: [
        HEADLESS_DISTILLATION_SYSTEM_PROMPT,
        guidance.response.toneInstruction,
        guidance.response.citationInstruction,
        ...guidance.distillation.rules,
      ].join("\n"),
      tools,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildDistillationMessage(context, guidance),
            },
          ],
        },
      ],
      actions,
      send: () => {},
      signal: controller.signal,
      ownerEmail: context.source.ownerEmail,
      orgId: context.source.orgId,
      maxIterations: 12,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function processBrainIngestQueueOnce(
  options: ProcessBrainIngestQueueOptions = {},
) {
  return runWithRequestContext({}, async () => {
    const db = getDb();
    const now = nowIso();
    const rows = await db
      .select()
      .from(schema.brainIngestQueue)
      .where(queueDueCondition(now))
      .orderBy(asc(schema.brainIngestQueue.priority))
      .limit(options.limit ?? 10);

    const processed: string[] = [];
    const deferred: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      const payload = parseJson<Record<string, unknown>>(row.payloadJson, {});
      if (row.operation === "distill") {
        if (!options.runDistillation) {
          await claimForHeadlessRunner(row, payload);
          await requeueDistillation(
            row,
            "Distillation is still queued; no distillation worker completed this item.",
            { ...payload, lastDistillationCheckAt: now },
          );
          deferred.push(row.id);
          continue;
        }

        const contextRows = await loadCaptureAndSource(row);
        if (!contextRows) {
          await markFailed(row, "Distillation capture or source was missing.", {
            ...payload,
            failedAt: now,
          });
          failed.push(row.id);
          continue;
        }

        const nextPayload = {
          ...payload,
          headlessClaimedAt: now,
          headlessClaimCount:
            typeof payload.headlessClaimCount === "number"
              ? payload.headlessClaimCount + 1
              : 1,
        };
        await claimForHeadlessRunner(row, nextPayload);

        try {
          const runner =
            options.distillationRunner ?? defaultDistillationRunner;
          await runWithRequestContext(
            {
              userEmail: contextRows.source.ownerEmail,
              orgId: contextRows.source.orgId ?? undefined,
            },
            () =>
              runner({
                queue: row,
                capture: contextRows.capture,
                source: contextRows.source,
                payload: nextPayload,
              }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const failedPermanently = row.attempts + 1 >= MAX_ATTEMPTS;
          if (failedPermanently) {
            await markFailed(row, message, {
              ...nextPayload,
              failedAt: nowIso(),
            });
            failed.push(row.id);
          } else {
            await requeueDistillation(row, message, {
              ...nextPayload,
              lastHeadlessDistillationErrorAt: nowIso(),
            });
            deferred.push(row.id);
          }
          continue;
        }

        const latest = await latestQueueRow(row.id);
        if (latest?.status === "done") {
          processed.push(row.id);
        } else if (row.attempts + 1 >= MAX_ATTEMPTS) {
          await markFailed(
            row,
            "Headless distillation agent did not mark this capture distilled or ignored.",
            { ...nextPayload, failedAt: nowIso() },
          );
          failed.push(row.id);
        } else {
          await requeueDistillation(
            row,
            "Headless distillation agent did not mark this capture distilled or ignored.",
            { ...nextPayload, lastHeadlessDistillationAt: nowIso() },
          );
          deferred.push(row.id);
        }
        continue;
      }

      await claimForHeadlessRunner(row, payload);
      await markFailed(
        row,
        `Unsupported ingest queue operation: ${row.operation}`,
        {
          ...payload,
          failedAt: now,
        },
      );
      failed.push(row.id);
    }

    return { processed, deferred, failed };
  });
}
