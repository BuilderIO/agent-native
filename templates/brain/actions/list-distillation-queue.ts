import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, lte, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { redactSensitiveText } from "../server/lib/search.js";

const queueStatuses = ["queued", "processing", "done", "failed"] as const;
const queueIssues = ["all", "failed", "stale", "retryable"] as const;
const queueStatusSchema = z.enum(queueStatuses);
const queueIssueSchema = z.enum(queueIssues);
const STALE_PROCESSING_MS = 15 * 60 * 1000;

type QueueStatus = (typeof queueStatuses)[number];
type QueueIssue = (typeof queueIssues)[number];

export interface ListDistillationQueueArgs {
  sourceId?: string;
  status?: QueueStatus;
  issue?: QueueIssue;
  staleOnly?: boolean;
  limit?: number;
}

function emptySummary() {
  return {
    total: 0,
    queued: 0,
    processing: 0,
    done: 0,
    failed: 0,
    staleProcessing: 0,
    retryable: 0,
  };
}

export function staleProcessingCutoff(now: string) {
  return new Date(Date.parse(now) - STALE_PROCESSING_MS).toISOString();
}

export function isStaleProcessing(
  status: string,
  updatedAt: string,
  cutoff: string,
) {
  if (status !== "processing") return false;
  const updated = Date.parse(updatedAt);
  const threshold = Date.parse(cutoff);
  return Number.isFinite(updated) && Number.isFinite(threshold)
    ? updated <= threshold
    : updatedAt <= cutoff;
}

function redactOptionalText(value: string | null) {
  return value ? redactSensitiveText(value) : value;
}

function retryBlockedReason(row: { status: string }, staleProcessing: boolean) {
  if (row.status === "failed" || staleProcessing) return null;
  if (row.status === "processing") return "Processing item is not stale yet.";
  if (row.status === "queued") return "Queued item is already waiting.";
  if (row.status === "done") return "Completed items are not retryable.";
  return "Queue item is not retryable.";
}

function stateReason(
  row: {
    status: string;
    attempts: number;
    lastError: string | null;
    runAfter: string | null;
    updatedAt: string;
  },
  staleProcessing: boolean,
) {
  const error = redactOptionalText(row.lastError);
  if (row.status === "failed") {
    return error
      ? `Failed after ${row.attempts} attempt(s): ${error}`
      : `Failed after ${row.attempts} attempt(s) without a recorded error.`;
  }
  if (staleProcessing) {
    return `Processing is stale; last worker update was ${row.updatedAt}.`;
  }
  if (row.status === "processing") {
    return `Processing since ${row.updatedAt}.`;
  }
  if (row.status === "queued") {
    return row.runAfter
      ? `Waiting for next run after ${row.runAfter}.`
      : "Waiting for an agent worker to claim it.";
  }
  if (row.status === "done") return "Distillation completed.";
  return null;
}

function summarizeQueue(
  items: Array<{ status: QueueStatus; staleProcessing: boolean }>,
) {
  const summary = emptySummary();
  summary.total = items.length;
  for (const item of items) {
    summary[item.status] += 1;
    if (item.staleProcessing) summary.staleProcessing += 1;
    if (item.status === "failed" || item.staleProcessing) {
      summary.retryable += 1;
    }
  }
  return summary;
}

export async function readDistillationQueue(
  args: ListDistillationQueueArgs = {},
) {
  const db = getDb();
  const now = new Date().toISOString();
  const staleCutoff = staleProcessingCutoff(now);
  const issue = args.staleOnly ? "stale" : (args.issue ?? "all");
  const limit = args.limit ?? 100;
  const baseClauses = [
    eq(schema.brainIngestQueue.operation, "distill"),
    accessFilter(schema.brainSources, schema.brainSourceShares),
  ];
  if (args.sourceId) {
    baseClauses.push(eq(schema.brainSources.id, args.sourceId));
  }

  const summaryRows = await db
    .select({
      status: schema.brainIngestQueue.status,
      updatedAt: schema.brainIngestQueue.updatedAt,
    })
    .from(schema.brainIngestQueue)
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainIngestQueue.captureId, schema.brainRawCaptures.id),
    )
    .innerJoin(
      schema.brainSources,
      eq(schema.brainRawCaptures.sourceId, schema.brainSources.id),
    )
    .where(and(...baseClauses));

  const clauses = [...baseClauses];
  if (args.status) {
    clauses.push(eq(schema.brainIngestQueue.status, args.status));
  }

  const staleClause = and(
    eq(schema.brainIngestQueue.status, "processing"),
    lte(schema.brainIngestQueue.updatedAt, staleCutoff),
  )!;
  if (issue === "failed") {
    clauses.push(eq(schema.brainIngestQueue.status, "failed"));
  }
  if (issue === "stale") {
    clauses.push(staleClause);
  }
  if (issue === "retryable") {
    clauses.push(
      or(eq(schema.brainIngestQueue.status, "failed"), staleClause)!,
    );
  }

  const rows = await db
    .select({
      id: schema.brainIngestQueue.id,
      sourceId: schema.brainIngestQueue.sourceId,
      captureId: schema.brainIngestQueue.captureId,
      status: schema.brainIngestQueue.status,
      priority: schema.brainIngestQueue.priority,
      attempts: schema.brainIngestQueue.attempts,
      lastError: schema.brainIngestQueue.error,
      runAfter: schema.brainIngestQueue.runAfter,
      createdAt: schema.brainIngestQueue.createdAt,
      updatedAt: schema.brainIngestQueue.updatedAt,
      sourceTableId: schema.brainSources.id,
      captureTitle: schema.brainRawCaptures.title,
      captureStatus: schema.brainRawCaptures.status,
      sourceTitle: schema.brainSources.title,
      sourceProvider: schema.brainSources.provider,
      sourceStatus: schema.brainSources.status,
    })
    .from(schema.brainIngestQueue)
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainIngestQueue.captureId, schema.brainRawCaptures.id),
    )
    .innerJoin(
      schema.brainSources,
      eq(schema.brainRawCaptures.sourceId, schema.brainSources.id),
    )
    .where(and(...clauses))
    .orderBy(desc(schema.brainIngestQueue.updatedAt))
    .limit(limit);

  const items = rows.map((row) => {
    const staleProcessing = isStaleProcessing(
      row.status,
      row.updatedAt,
      staleCutoff,
    );
    const retryable = row.status === "failed" || staleProcessing;
    return {
      id: row.id,
      sourceId: row.sourceTableId,
      captureId: row.captureId ?? null,
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      lastError: redactOptionalText(row.lastError),
      runAfter: row.runAfter,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      staleProcessing,
      retryable,
      reason: stateReason(row, staleProcessing),
      retryBlockedReason: retryBlockedReason(row, staleProcessing),
      source: {
        id: row.sourceTableId,
        title: redactSensitiveText(row.sourceTitle),
        provider: row.sourceProvider,
        status: row.sourceStatus,
      },
      capture: {
        id: row.captureId,
        title: redactSensitiveText(row.captureTitle),
        status: row.captureStatus,
      },
    };
  });

  const summary = summarizeQueue(
    summaryRows.map((row) => ({
      status: row.status,
      staleProcessing: isStaleProcessing(
        row.status,
        row.updatedAt,
        staleCutoff,
      ),
    })),
  );
  const visibleSummary = summarizeQueue(items);

  return {
    count: items.length,
    staleProcessingCutoff: staleCutoff,
    summary,
    visibleSummary,
    filters: {
      sourceId: args.sourceId ?? null,
      status: args.status ?? null,
      issue,
      limit,
    },
    items,
  };
}

export default defineAction({
  description:
    "List Brain distillation queue items for accessible sources, including retry state and stale processing detection.",
  schema: z.object({
    sourceId: z.string().min(1).optional(),
    status: queueStatusSchema.optional(),
    issue: queueIssueSchema.default("all"),
    staleOnly: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: readDistillationQueue,
});
