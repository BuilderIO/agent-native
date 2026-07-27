import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  nowIso,
  nanoid,
  parseJson,
  readBrainAgentGuidance,
  stableJson,
} from "../server/lib/brain.js";

type QueueRow = typeof schema.brainIngestQueue.$inferSelect;
type CaptureRow = typeof schema.brainRawCaptures.$inferSelect;
type SourceRow = typeof schema.brainSources.$inferSelect;

export interface DistillationAgentContext {
  queue: QueueRow;
  claimToken: string;
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

function claimedRowCondition(row: QueueRow, claimToken?: string) {
  return claimToken
    ? and(
        eq(schema.brainIngestQueue.id, row.id),
        eq(schema.brainIngestQueue.status, "processing"),
        eq(schema.brainIngestQueue.leaseToken, claimToken),
      )
    : and(
        eq(schema.brainIngestQueue.id, row.id),
        eq(schema.brainIngestQueue.status, row.status),
        eq(schema.brainIngestQueue.updatedAt, row.updatedAt),
      );
}

async function markFailed(
  row: QueueRow,
  message: string,
  payload: object,
  claimToken?: string,
) {
  const now = nowIso();
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "failed",
      payloadJson: stableJson(payload),
      error: message,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(claimedRowCondition(row, claimToken));
}

async function requeueDistillation(
  row: QueueRow,
  message: string,
  payload: object,
  claimToken: string,
) {
  const now = nowIso();
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "queued",
      payloadJson: stableJson(payload),
      error: message,
      runAfter: recheckAt(now),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(claimedRowCondition(row, claimToken));
}

export async function claimForHeadlessRunner(row: QueueRow, payload: object) {
  const now = nowIso();
  const claimToken = nanoid(16);
  const leaseExpiresAt = new Date(
    Date.parse(now) + STALE_PROCESSING_MS,
  ).toISOString();
  const result = await getDbExec().execute({
    sql: `UPDATE brain_ingest_queue
      SET status = ?, attempts = ?, payload_json = ?, error = NULL,
          run_after = NULL, lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = ? AND updated_at = ?`,
    args: [
      "processing",
      row.attempts + 1,
      stableJson(payload),
      claimToken,
      leaseExpiresAt,
      now,
      row.id,
      row.status,
      row.updatedAt,
    ],
  });
  return result.rowsAffected > 0 ? claimToken : null;
}

async function runDeterministicOperation(
  row: QueueRow,
  context: NonNullable<Awaited<ReturnType<typeof loadCaptureAndSource>>>,
) {
  if (row.operation === "search-index") {
    const { indexBrainCapture } = await import("../server/lib/search-index.js");
    await indexBrainCapture(context.capture.id);
    return;
  }
  if (row.operation === "search-unindex") {
    const { unindexBrainCapture } =
      await import("../server/lib/search-index.js");
    await unindexBrainCapture(context.capture.id);
    return;
  }
  if (row.operation === "slack-thread-refresh") {
    const { refreshSlackThreadCapture } =
      await import("../server/lib/connectors.js");
    await refreshSlackThreadCapture(context.source, row.payloadJson);
    return;
  }
  throw new Error(`Unsupported ingest queue operation: ${row.operation}`);
}

async function latestQueueRow(rowId: string) {
  const [updated] = await getDb()
    .select()
    .from(schema.brainIngestQueue)
    .where(eq(schema.brainIngestQueue.id, rowId))
    .limit(1);
  return updated;
}

async function markOperationDone(row: QueueRow, claimToken: string) {
  await getDb()
    .update(schema.brainIngestQueue)
    .set({
      status: "done",
      leaseToken: null,
      leaseExpiresAt: null,
      error: null,
      updatedAt: nowIso(),
    })
    .where(claimedRowCondition(row, claimToken));
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
    `4. Call mark-capture-distilled with captureId=${context.capture.id}, queueId=${context.queue.id}, and claimToken=${context.claimToken} when finished, or mark ignored if excluded.`,
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
          const claimToken = await claimForHeadlessRunner(row, payload);
          if (!claimToken) continue;
          await requeueDistillation(
            row,
            "Distillation is still queued; no distillation worker completed this item.",
            { ...payload, lastDistillationCheckAt: now },
            claimToken,
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
        const claimToken = await claimForHeadlessRunner(row, nextPayload);
        if (!claimToken) continue;

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
                queue: {
                  ...row,
                  attempts: row.attempts + 1,
                  payloadJson: stableJson(nextPayload),
                  status: "processing",
                  leaseToken: claimToken,
                },
                claimToken,
                capture: contextRows.capture,
                source: contextRows.source,
                payload: nextPayload,
              }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const failedPermanently = row.attempts + 1 >= MAX_ATTEMPTS;
          if (failedPermanently) {
            await markFailed(
              row,
              message,
              { ...nextPayload, failedAt: nowIso() },
              claimToken,
            );
            failed.push(row.id);
          } else {
            await requeueDistillation(
              row,
              message,
              {
                ...nextPayload,
                lastHeadlessDistillationErrorAt: nowIso(),
              },
              claimToken,
            );
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
            claimToken,
          );
          failed.push(row.id);
        } else {
          await requeueDistillation(
            row,
            "Headless distillation agent did not mark this capture distilled or ignored.",
            { ...nextPayload, lastHeadlessDistillationAt: nowIso() },
            claimToken,
          );
          deferred.push(row.id);
        }
        continue;
      }
      if (row.operation === "search-unindex") {
        if (!row.captureId) {
          await markFailed(row, "Search unindex operation had no capture id.", {
            ...payload,
            failedAt: now,
          });
          failed.push(row.id);
          continue;
        }
        const claimToken = await claimForHeadlessRunner(row, payload);
        if (!claimToken) continue;
        try {
          const { unindexBrainCapture } =
            await import("../server/lib/search-index.js");
          await unindexBrainCapture(row.captureId);
          await markOperationDone(row, claimToken);
          processed.push(row.id);
        } catch (error) {
          await markFailed(
            row,
            error instanceof Error ? error.message : String(error),
            { ...payload, failedAt: nowIso() },
            claimToken,
          );
          failed.push(row.id);
        }
        continue;
      }
      if (row.operation === "slack-thread-refresh") {
        const [source] = row.sourceId
          ? await db
              .select()
              .from(schema.brainSources)
              .where(eq(schema.brainSources.id, row.sourceId))
              .limit(1)
          : [];
        if (!source) {
          await markFailed(row, "Slack refresh source was missing.", {
            ...payload,
            failedAt: now,
          });
          failed.push(row.id);
          continue;
        }
        const claimToken = await claimForHeadlessRunner(row, payload);
        if (!claimToken) continue;
        try {
          const { refreshSlackThreadCapture } =
            await import("../server/lib/connectors.js");
          await runWithRequestContext(
            {
              userEmail: source.ownerEmail,
              orgId: source.orgId ?? undefined,
            },
            () => refreshSlackThreadCapture(source, row.payloadJson),
          );
          await markOperationDone(row, claimToken);
          processed.push(row.id);
        } catch (error) {
          await markFailed(
            row,
            error instanceof Error ? error.message : String(error),
            { ...payload, failedAt: nowIso() },
            claimToken,
          );
          failed.push(row.id);
        }
        continue;
      }
      if (row.operation === "sync") {
        const [source] = row.sourceId
          ? await db
              .select()
              .from(schema.brainSources)
              .where(eq(schema.brainSources.id, row.sourceId))
              .limit(1)
          : [];
        if (!source) {
          await markFailed(row, "Source sync operation had no source.", {
            ...payload,
            failedAt: now,
          });
          failed.push(row.id);
          continue;
        }
        const claimToken = await claimForHeadlessRunner(row, payload);
        if (!claimToken) continue;
        try {
          const { runConnectorSync } =
            await import("../server/lib/connectors.js");
          await runWithRequestContext(
            {
              userEmail: source.ownerEmail,
              orgId: source.orgId ?? undefined,
            },
            () => runConnectorSync(source),
          );
          await markOperationDone(row, claimToken);
          processed.push(row.id);
        } catch (error) {
          await markFailed(
            row,
            error instanceof Error ? error.message : String(error),
            { ...payload, failedAt: nowIso() },
            claimToken,
          );
          failed.push(row.id);
        }
        continue;
      }
      const contextRows = await loadCaptureAndSource(row);
      if (!contextRows) {
        await markFailed(row, "Queue capture or source was missing.", {
          ...payload,
          failedAt: now,
        });
        failed.push(row.id);
        continue;
      }
      const claimToken = await claimForHeadlessRunner(row, payload);
      if (!claimToken) continue;
      try {
        await runWithRequestContext(
          {
            userEmail: contextRows.source.ownerEmail,
            orgId: contextRows.source.orgId ?? undefined,
          },
          () => runDeterministicOperation(row, contextRows),
        );
        await markOperationDone(row, claimToken);
        processed.push(row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          await markFailed(
            row,
            message,
            { ...payload, failedAt: nowIso() },
            claimToken,
          );
          failed.push(row.id);
        } else {
          await requeueDistillation(
            row,
            message,
            { ...payload, lastOperationErrorAt: nowIso() },
            claimToken,
          );
          deferred.push(row.id);
        }
      }
    }

    return { processed, deferred, failed };
  });
}
