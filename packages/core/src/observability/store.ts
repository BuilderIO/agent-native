import { z } from "zod";

/**
 * SQL persistence for the agent observability system.
 *
 * Creates and manages tables for traces, feedback, evals, experiments,
 * and satisfaction scores. Follows the same raw-SQL pattern as
 * run-store.ts and usage/store.ts — framework tables use getDbExec()
 * rather than Drizzle ORM (which is for template-level schemas).
 */
import { getDbExec } from "../db/client.js";
import {
  ensureTableExists,
  ensureColumnExists,
  ensureIndexExists,
} from "../db/ddl-guard.js";
import {
  sanitizeToolErrorMessage,
  TOOL_ERROR_CAPTURE_METADATA_KEY,
} from "./trace-error.js";
import { redactSensitiveFields } from "./trace-redaction.js";
import type {
  TraceSpan,
  TraceSummary,
  FeedbackEntry,
  SatisfactionScore,
  EvalResult,
  EvalDataset,
  Experiment,
  ExperimentAssignment,
  ExperimentMetricResult,
  InstructionUpdate,
  HumanReviewSummary,
  ObservabilityReviewThreadScope,
} from "./types.js";
import { observabilityReviewThreadKey } from "./types.js";

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const persistedHumanReviewArtifactSchema = z
  .object({
    appId: z.enum(["design", "slides", "analytics"]),
    artifactId: z.string().min(1).max(200),
    title: z.string().min(1).max(240),
    path: z.string().max(300).optional(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (!artifact.path) return;
    const id = artifact.artifactId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const paths = {
      design: new RegExp(`^/(?:design|present)/${id}$`),
      slides: new RegExp(`^/deck/${id}(?:/present)?$`),
      analytics: new RegExp(
        `^(?:/(?:dashboards|analyses|adhoc)/${id}|/api/media/${id})$`,
      ),
    };
    if (!paths[artifact.appId].test(artifact.path)) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: "Persisted artifact path does not match its app and ID.",
      });
    }
  });

const persistedTimestampSchema = z
  .union([
    z.number().finite().nonnegative(),
    z.string().regex(/^\d+$/).transform(Number),
  ])
  .refine(Number.isFinite);

const persistedHumanReviewSummaryRowSchema = z.object({
  run_id: z.string().min(1),
  org_id: z.string().min(1),
  ask: z.string().min(1).max(2_000),
  outcome: z.string().min(1).max(3_000),
  artifacts: z.string(),
  created_by: z.string().min(1),
  created_at: persistedTimestampSchema,
  updated_at: persistedTimestampSchema,
});

function parseHumanReviewSummaryRow(
  row: Record<string, unknown>,
): HumanReviewSummary {
  const parsed = persistedHumanReviewSummaryRowSchema.parse(row);
  let artifactsJson: unknown;
  try {
    artifactsJson = JSON.parse(parsed.artifacts);
  } catch (error) {
    throw new Error("Invalid persisted human-review summary artifacts JSON", {
      cause: error,
    });
  }
  const artifacts = z
    .array(persistedHumanReviewArtifactSchema)
    .max(12)
    .parse(artifactsJson);
  return {
    runId: parsed.run_id,
    orgId: parsed.org_id,
    ask: parsed.ask,
    outcome: parsed.outcome,
    artifacts,
    createdBy: parsed.created_by,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

// Tables whose rows are owned by an end user — drives the boot-time
// user_id ALTER loop and the per-user composite indexes below. Every
// new user-owned observability table must be added here so the upgrade
// path and the per-user query plan stay in sync.
const USER_SCOPED_TABLES = [
  "agent_trace_spans",
  "agent_trace_summaries",
  "agent_satisfaction_scores",
  "agent_evals",
  "agent_feedback",
  "agent_instruction_updates",
] as const;

const MAX_REVIEW_THREAD_BYTES = 1_000_000;
export const MAX_REVIEW_TOOL_SPANS = 20;
const MAX_REVIEW_TOOL_METADATA_BYTES = 100_000;

/**
 * Append an `AND user_id = ?` clause when a userId filter is requested.
 * Returns the fully-bound WHERE clause + args ready to splice into the
 * caller's SQL. Centralizes the pattern so tests can assert one shape.
 */
function withUserFilter(
  baseWhere: string,
  baseArgs: any[],
  userId: string | undefined,
  orgId?: string,
): { where: string; args: any[] } {
  const conditions = [baseWhere];
  const args = [...baseArgs];
  if (userId != null) {
    conditions.push("user_id = ?");
    args.push(userId);
  }
  if (orgId != null) {
    conditions.push("org_id = ?");
    args.push(orgId);
  }
  return { where: conditions.join(" AND "), args };
}

let _initPromise: Promise<void> | undefined;

export async function ensureObservabilityTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const traceSpansCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_trace_spans (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          user_id TEXT,
          org_id TEXT,
          parent_span_id TEXT,
          span_type TEXT NOT NULL,
          name TEXT NOT NULL,
          input_tokens BIGINT NOT NULL DEFAULT 0,
          output_tokens BIGINT NOT NULL DEFAULT 0,
          cache_read_tokens BIGINT NOT NULL DEFAULT 0,
          cache_write_tokens BIGINT NOT NULL DEFAULT 0,
          cost_cents_x100 BIGINT NOT NULL DEFAULT 0,
          duration_ms BIGINT NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'success',
          error_message TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL
        )
      `;

      const traceSummariesCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_trace_summaries (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT,
          user_id TEXT,
          org_id TEXT,
          total_spans BIGINT NOT NULL DEFAULT 0,
          llm_calls BIGINT NOT NULL DEFAULT 0,
          tool_calls BIGINT NOT NULL DEFAULT 0,
          successful_tools BIGINT NOT NULL DEFAULT 0,
          failed_tools BIGINT NOT NULL DEFAULT 0,
          total_duration_ms BIGINT NOT NULL DEFAULT 0,
          total_cost_cents_x100 BIGINT NOT NULL DEFAULT 0,
          total_input_tokens BIGINT NOT NULL DEFAULT 0,
          total_output_tokens BIGINT NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          created_at BIGINT NOT NULL
        )
      `;

      const feedbackCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_feedback (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          thread_id TEXT,
          message_seq BIGINT,
          feedback_type TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT '',
          idempotency_key TEXT,
          user_id TEXT,
          org_id TEXT,
          source TEXT NOT NULL DEFAULT 'chat',
          created_at BIGINT NOT NULL
        )
      `;

      const instructionUpdatesCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_instruction_updates (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          target TEXT NOT NULL,
          instruction TEXT NOT NULL,
          feedback TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          user_id TEXT NOT NULL,
          org_id TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `;

      const humanReviewSummariesCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_human_review_summaries (
          run_id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          ask TEXT NOT NULL,
          outcome TEXT NOT NULL,
          artifacts TEXT NOT NULL DEFAULT '[]',
          created_by TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `;

      const satisfactionScoresCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_satisfaction_scores (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          user_id TEXT,
          frustration_score REAL NOT NULL DEFAULT 0,
          rephrasing_score REAL NOT NULL DEFAULT 0,
          abandonment_score REAL NOT NULL DEFAULT 0,
          sentiment_score REAL NOT NULL DEFAULT 0,
          length_trend_score REAL NOT NULL DEFAULT 0,
          computed_at BIGINT NOT NULL
        )
      `;

      const evalsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_evals (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          user_id TEXT,
          eval_type TEXT NOT NULL,
          criteria TEXT NOT NULL,
          score REAL NOT NULL DEFAULT 0,
          reasoning TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL
        )
      `;

      const evalDatasetsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_eval_datasets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          entries TEXT NOT NULL DEFAULT '[]',
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `;

      const experimentsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_experiments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          variants TEXT NOT NULL DEFAULT '[]',
          metrics TEXT NOT NULL DEFAULT '[]',
          assignment_level TEXT NOT NULL DEFAULT 'user',
          started_at BIGINT,
          ended_at BIGINT,
          created_at BIGINT NOT NULL,
          owner_email TEXT
        )
      `;

      const experimentAssignmentsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_experiment_assignments (
          experiment_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          assigned_at BIGINT NOT NULL,
          PRIMARY KEY (experiment_id, user_id)
        )
      `;

      const experimentResultsCreateSql = `
        CREATE TABLE IF NOT EXISTS agent_experiment_results (
          id TEXT PRIMARY KEY,
          experiment_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          sample_size BIGINT NOT NULL DEFAULT 0,
          confidence_low REAL NOT NULL DEFAULT 0,
          confidence_high REAL NOT NULL DEFAULT 0,
          computed_at BIGINT NOT NULL
        )
      `;

      {
        // PG guard: probe → guarded DDL → re-probe; skips lock on already-migrated path
        await ensureTableExists("agent_trace_spans", traceSpansCreateSql);
        await ensureTableExists(
          "agent_trace_summaries",
          traceSummariesCreateSql,
        );
        await ensureTableExists("agent_feedback", feedbackCreateSql);
        await ensureTableExists(
          "agent_instruction_updates",
          instructionUpdatesCreateSql,
        );
        await ensureTableExists(
          "agent_human_review_summaries",
          humanReviewSummariesCreateSql,
        );
        await ensureTableExists(
          "agent_satisfaction_scores",
          satisfactionScoresCreateSql,
        );
        await ensureTableExists("agent_evals", evalsCreateSql);
        await ensureTableExists("agent_eval_datasets", evalDatasetsCreateSql);
        await ensureTableExists("agent_experiments", experimentsCreateSql);
        await ensureTableExists(
          "agent_experiment_assignments",
          experimentAssignmentsCreateSql,
        );
        await ensureTableExists(
          "agent_experiment_results",
          experimentResultsCreateSql,
        );
        await ensureColumnExists(
          "agent_experiments",
          "owner_email",
          `ALTER TABLE agent_experiments ADD COLUMN IF NOT EXISTS owner_email TEXT`,
        );
        for (const table of USER_SCOPED_TABLES) {
          await ensureColumnExists(
            table,
            "user_id",
            `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
          );
        }
        for (const table of [
          "agent_trace_spans",
          "agent_trace_summaries",
          "agent_feedback",
          "agent_instruction_updates",
        ]) {
          await ensureColumnExists(
            table,
            "org_id",
            `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS org_id TEXT`,
          );
        }
        await ensureColumnExists(
          "agent_feedback",
          "source",
          `ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat'`,
        );
        await ensureColumnExists(
          "agent_feedback",
          "idempotency_key",
          `ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
        );
        await ensureIndexExists(
          "idx_trace_spans_run",
          `CREATE INDEX IF NOT EXISTS idx_trace_spans_run ON agent_trace_spans (run_id)`,
        );
        await ensureIndexExists(
          "idx_trace_spans_thread",
          `CREATE INDEX IF NOT EXISTS idx_trace_spans_thread ON agent_trace_spans (thread_id)`,
        );
        await ensureIndexExists(
          "idx_trace_spans_created",
          `CREATE INDEX IF NOT EXISTS idx_trace_spans_created ON agent_trace_spans (created_at)`,
        );
        await ensureIndexExists(
          "idx_trace_spans_type_name_run_id",
          `CREATE INDEX IF NOT EXISTS idx_trace_spans_type_name_run_id ON agent_trace_spans (span_type, name, run_id)`,
        );
        await ensureIndexExists(
          "idx_trace_summaries_created",
          `CREATE INDEX IF NOT EXISTS idx_trace_summaries_created ON agent_trace_summaries (created_at)`,
        );
        await ensureIndexExists(
          "idx_trace_summaries_org_created",
          `CREATE INDEX IF NOT EXISTS idx_trace_summaries_org_created ON agent_trace_summaries (org_id, created_at DESC)`,
        );
        await ensureIndexExists(
          "idx_trace_summaries_user",
          `CREATE INDEX IF NOT EXISTS idx_trace_summaries_user ON agent_trace_summaries (user_id, created_at)`,
        );
        await ensureIndexExists(
          "idx_trace_summaries_thread_user_created",
          `CREATE INDEX IF NOT EXISTS idx_trace_summaries_thread_user_created ON agent_trace_summaries (thread_id, user_id, created_at)`,
        );
        await ensureIndexExists(
          "idx_trace_spans_user",
          `CREATE INDEX IF NOT EXISTS idx_trace_spans_user ON agent_trace_spans (user_id)`,
        );
        await ensureIndexExists(
          "idx_feedback_thread",
          `CREATE INDEX IF NOT EXISTS idx_feedback_thread ON agent_feedback (thread_id)`,
        );
        await ensureIndexExists(
          "idx_feedback_created",
          `CREATE INDEX IF NOT EXISTS idx_feedback_created ON agent_feedback (created_at)`,
        );
        await ensureIndexExists(
          "idx_feedback_org_source_created",
          `CREATE INDEX IF NOT EXISTS idx_feedback_org_source_created ON agent_feedback (org_id, source, created_at DESC)`,
        );
        await ensureIndexExists(
          "idx_feedback_org_run_created",
          `CREATE INDEX IF NOT EXISTS idx_feedback_org_run_created ON agent_feedback (org_id, run_id, created_at DESC)`,
        );
        await ensureIndexExists(
          "idx_feedback_user",
          `CREATE INDEX IF NOT EXISTS idx_feedback_user ON agent_feedback (user_id, created_at)`,
        );
        await ensureIndexExists(
          "idx_feedback_type_created",
          `CREATE INDEX IF NOT EXISTS idx_feedback_type_created ON agent_feedback (feedback_type, created_at)`,
        );
        await ensureIndexExists(
          "idx_feedback_idempotency",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_idempotency ON agent_feedback (user_id, idempotency_key)`,
        );
        await ensureIndexExists(
          "idx_instruction_updates_run_user",
          `CREATE INDEX IF NOT EXISTS idx_instruction_updates_run_user ON agent_instruction_updates (run_id, user_id, updated_at)`,
        );
        await ensureIndexExists(
          "idx_satisfaction_thread",
          `CREATE INDEX IF NOT EXISTS idx_satisfaction_thread ON agent_satisfaction_scores (thread_id)`,
        );
        await ensureIndexExists(
          "idx_satisfaction_user",
          `CREATE INDEX IF NOT EXISTS idx_satisfaction_user ON agent_satisfaction_scores (user_id, computed_at)`,
        );
        await ensureIndexExists(
          "idx_evals_run",
          `CREATE INDEX IF NOT EXISTS idx_evals_run ON agent_evals (run_id)`,
        );
        await ensureIndexExists(
          "idx_evals_created",
          `CREATE INDEX IF NOT EXISTS idx_evals_created ON agent_evals (created_at)`,
        );
        await ensureIndexExists(
          "idx_evals_user",
          `CREATE INDEX IF NOT EXISTS idx_evals_user ON agent_evals (user_id, created_at)`,
        );
        await ensureIndexExists(
          "idx_experiment_results_exp",
          `CREATE INDEX IF NOT EXISTS idx_experiment_results_exp ON agent_experiment_results (experiment_id)`,
        );
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

// ─── Trace span CRUD ─────────────────────────────────────────────────

export async function insertTraceSpan(span: TraceSpan): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_trace_spans
      (id, run_id, thread_id, user_id, org_id, parent_span_id, span_type, name,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       cost_cents_x100, duration_ms, status, error_message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      span.id,
      span.runId,
      span.threadId,
      span.userId,
      span.orgId ?? null,
      span.parentSpanId,
      span.spanType,
      span.name,
      span.inputTokens,
      span.outputTokens,
      span.cacheReadTokens,
      span.cacheWriteTokens,
      span.costCentsX100,
      span.durationMs,
      span.status,
      span.errorMessage,
      span.metadata ? JSON.stringify(span.metadata) : null,
      span.createdAt,
    ],
  });
}

export async function upsertTraceSummary(summary: TraceSummary): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  // user_id and org_id are intentionally NOT updated on conflict — once a run's
  // owner is recorded it shouldn't change under us.
  {
    await client.execute({
      sql: `INSERT INTO agent_trace_summaries
        (run_id, thread_id, user_id, org_id, total_spans, llm_calls, tool_calls,
         successful_tools, failed_tools, total_duration_ms,
         total_cost_cents_x100, total_input_tokens, total_output_tokens,
         model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id) DO UPDATE SET
          total_spans = EXCLUDED.total_spans,
          llm_calls = EXCLUDED.llm_calls,
          tool_calls = EXCLUDED.tool_calls,
          successful_tools = EXCLUDED.successful_tools,
          failed_tools = EXCLUDED.failed_tools,
          total_duration_ms = EXCLUDED.total_duration_ms,
          total_cost_cents_x100 = EXCLUDED.total_cost_cents_x100,
          total_input_tokens = EXCLUDED.total_input_tokens,
          total_output_tokens = EXCLUDED.total_output_tokens,
          model = EXCLUDED.model`,
      args: [
        summary.runId,
        summary.threadId,
        summary.userId,
        summary.orgId ?? null,
        summary.totalSpans,
        summary.llmCalls,
        summary.toolCalls,
        summary.successfulTools,
        summary.failedTools,
        summary.totalDurationMs,
        summary.totalCostCentsX100,
        summary.totalInputTokens,
        summary.totalOutputTokens,
        summary.model,
        summary.createdAt,
      ],
    });
  }
}

/**
 * Purge trace spans, summaries, and eval results older than `cutoffMs`
 * (a Unix epoch in milliseconds — rows with `created_at < cutoffMs` are
 * deleted). Returns the per-table deletion counts. Satisfies the span
 * retention TTL noted in /tmp/security-audit/12-mcp-a2a-agent.md
 * (MEDIUM #14): trace metadata can hold sensitive tool inputs, so we
 * cap the storage horizon. Feedback rows are retained — they're
 * intentionally durable for product analytics. Experiments and
 * datasets are also retained because they are user-authored
 * configuration, not call telemetry.
 */
export async function deleteOldTraceData(cutoffMs: number): Promise<{
  spans: number;
  summaries: number;
  evals: number;
}> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const cutoff = Math.floor(cutoffMs);

  const [spansResult, summariesResult, evalsResult] = await Promise.all([
    client.execute({
      sql: `DELETE FROM agent_trace_spans WHERE created_at < ?`,
      args: [cutoff],
    }),
    client.execute({
      sql: `DELETE FROM agent_trace_summaries WHERE created_at < ?`,
      args: [cutoff],
    }),
    client.execute({
      sql: `DELETE FROM agent_evals WHERE created_at < ?`,
      args: [cutoff],
    }),
  ]);

  return {
    spans: Number(spansResult.rowsAffected ?? 0),
    summaries: Number(summariesResult.rowsAffected ?? 0),
    evals: Number(evalsResult.rowsAffected ?? 0),
  };
}

export async function getTraceSpansForRun(
  runId: string,
  opts: { userId?: string; orgId?: string } = {},
): Promise<TraceSpan[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { where, args } = withUserFilter(
    "run_id = ?",
    [runId],
    opts.userId,
    opts.orgId,
  );
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_trace_spans WHERE ${where} ORDER BY created_at ASC`,
    args,
  });
  return (rows as any[]).map(rowToTraceSpan);
}

export async function getSuccessfulToolSpansForReview(
  runId: string,
  orgId: string,
  limit: number,
): Promise<Array<{ name: string; metadata: Record<string, unknown> | null }>> {
  const boundedLimit = Math.min(
    Math.max(Math.trunc(limit), 0),
    MAX_REVIEW_TOOL_SPANS,
  );
  if (!orgId || boundedLimit === 0) return [];
  await ensureObservabilityTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT name,
      CASE WHEN OCTET_LENGTH(metadata) <= ? THEN metadata ELSE NULL END AS metadata
      FROM agent_trace_spans
      WHERE run_id = ? AND org_id = ?
        AND span_type = 'tool_call' AND status = 'success'
      ORDER BY created_at ASC
      LIMIT ?`,
    args: [MAX_REVIEW_TOOL_METADATA_BYTES, runId, orgId, boundedLimit],
  });
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const metadata = safeJsonParse<unknown>(row.metadata, null);
    return {
      name: String(row.name),
      metadata:
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : null,
    };
  });
}

export async function getTraceSummaries(opts: {
  sinceMs?: number;
  limit?: number;
  userId?: string;
  orgId?: string;
  excludeSpanName?: string;
  requireReviewContext?: boolean;
}): Promise<TraceSummary[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const sinceMs = opts.sinceMs ?? 0;
  const limit = opts.limit ?? 100;
  const { where, args } = withUserFilter(
    "created_at >= ?",
    [sinceMs],
    opts.userId,
    opts.orgId,
  );
  const exclude = opts.excludeSpanName
    ? `AND run_id NOT IN (
        SELECT run_id FROM agent_trace_spans
        WHERE span_type = 'agent_run' AND name = ?
          ${opts.orgId ? "AND org_id = ?" : opts.userId ? "AND user_id = ?" : ""}
      )`
    : "";
  const reviewContext = opts.requireReviewContext
    ? `AND thread_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM chat_threads review_thread
          WHERE review_thread.id = agent_trace_summaries.thread_id
            AND review_thread.org_id = agent_trace_summaries.org_id
            AND LOWER(review_thread.owner_email) = LOWER(agent_trace_summaries.user_id)
            AND LENGTH(TRIM(review_thread.title)) > 0
        )
        OR EXISTS (
          SELECT 1 FROM agent_human_review_summaries review_summary
          WHERE review_summary.run_id = agent_trace_summaries.run_id
            AND review_summary.org_id = agent_trace_summaries.org_id
        )
      )`
    : "";
  const select = opts.requireReviewContext
    ? `SELECT * FROM (
        SELECT agent_trace_summaries.*,
          COUNT(*) OVER (PARTITION BY org_id, thread_id) AS run_count,
          ROW_NUMBER() OVER (
            PARTITION BY org_id, thread_id ORDER BY created_at DESC, run_id DESC
          ) AS review_row_number
        FROM agent_trace_summaries
        WHERE ${where}
        ${exclude}
        ${reviewContext}
      ) AS review_rollups
      WHERE review_row_number = 1
      ORDER BY created_at DESC
      LIMIT ?`
    : `SELECT * FROM agent_trace_summaries
      WHERE ${where}
      ${exclude}
      ${reviewContext}
      ORDER BY created_at DESC
      LIMIT ?`;
  const { rows } = await client.execute({
    sql: select,
    args: [
      ...args,
      ...(opts.excludeSpanName
        ? [
            opts.excludeSpanName,
            ...(opts.orgId ? [opts.orgId] : opts.userId ? [opts.userId] : []),
          ]
        : []),
      limit,
    ],
  });
  return (rows as any[]).map(rowToTraceSummary);
}

export async function getRecentReviewRunsForThreads(opts: {
  threadScopes: readonly ObservabilityReviewThreadScope[];
  sinceMs: number;
  perThreadLimit?: number;
}): Promise<TraceSummary[]> {
  const scopes = [
    ...new Map(
      opts.threadScopes
        .filter(({ orgId, threadId }) => orgId && threadId)
        .map((scope) => [
          observabilityReviewThreadKey(scope.orgId, scope.threadId),
          scope,
        ]),
    ).values(),
  ].slice(0, 100);
  if (scopes.length === 0) return [];
  await ensureObservabilityTables();
  const limit = Math.max(1, Math.min(opts.perThreadLimit ?? 6, 12));
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM (
      SELECT summary.*,
        ROW_NUMBER() OVER (
          PARTITION BY summary.org_id, summary.thread_id
          ORDER BY summary.created_at DESC, summary.run_id DESC
        ) AS review_run_number
      FROM agent_trace_summaries summary
      INNER JOIN chat_threads thread
        ON thread.id = summary.thread_id AND thread.org_id = summary.org_id
          AND LOWER(thread.owner_email) = LOWER(summary.user_id)
      WHERE summary.created_at >= ? AND (${scopes
        .map(() => "(summary.org_id = ? AND summary.thread_id = ?)")
        .join(" OR ")})
        AND NOT EXISTS (
          SELECT 1 FROM agent_trace_spans review_span
          WHERE review_span.run_id = summary.run_id
            AND review_span.org_id = summary.org_id
            AND review_span.span_type = 'agent_run'
            AND review_span.name = 'agent_run:observability:human-review-summary'
        )
    ) AS review_runs
    WHERE review_run_number <= ?
    ORDER BY thread_id, created_at DESC, run_id DESC`,
    args: [
      opts.sinceMs,
      ...scopes.flatMap(({ orgId, threadId }) => [orgId, threadId]),
      limit,
    ],
  });
  return (rows as Array<Record<string, unknown>>).map(rowToTraceSummary);
}

export async function getTraceSummary(
  runId: string,
  opts: { userId?: string; orgId?: string } = {},
): Promise<TraceSummary | null> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { where, args } = withUserFilter(
    "run_id = ?",
    [runId],
    opts.userId,
    opts.orgId,
  );
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_trace_summaries WHERE ${where}`,
    args,
  });
  if (rows.length === 0) return null;
  return rowToTraceSummary(rows[0] as any);
}

export async function getOrgScopedThreadData(
  orgId: string,
  ownerEmail: string,
  threadIds: readonly string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (!orgId || !ownerEmail || ids.length === 0) return new Map();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_data FROM chat_threads
      WHERE org_id = ? AND LOWER(owner_email) = LOWER(?)
        AND id IN (${ids.map(() => "?").join(", ")})`,
    args: [orgId, ownerEmail, ...ids],
  });
  return new Map(
    (rows as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      typeof row.thread_data === "string" ? row.thread_data : null,
    ]),
  );
}

export async function getOrgScopedThreadTitles(
  orgId: string,
  ownerEmail: string,
  threadIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (!orgId || !ownerEmail || ids.length === 0) return new Map();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, title FROM chat_threads
      WHERE org_id = ? AND LOWER(owner_email) = LOWER(?)
        AND id IN (${ids.map(() => "?").join(", ")})`,
    args: [orgId, ownerEmail, ...ids],
  });
  return new Map(
    (rows as Array<Record<string, unknown>>)
      .filter((row) => typeof row.title === "string" && row.title.trim())
      .map((row) => [String(row.id), String(row.title).slice(0, 240)]),
  );
}

export async function getOrgScopedReviewThreads(
  requested: readonly (ObservabilityReviewThreadScope & {
    ownerEmail: string;
  })[],
): Promise<
  Map<
    string,
    {
      ownerEmail: string;
      threadData: string | null;
      title: string | null;
      scopeType: string | null;
      scopeId: string | null;
      scopeLabel: string | null;
    }
  >
> {
  const keys = [
    ...new Map(
      requested
        .filter(
          ({ orgId, ownerEmail, threadId }) => orgId && ownerEmail && threadId,
        )
        .map((key) => [
          `${observabilityReviewThreadKey(key.orgId, key.threadId)}\0${key.ownerEmail.toLowerCase()}`,
          key,
        ]),
    ).values(),
  ].slice(0, 100);
  if (keys.length === 0) return new Map();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, owner_email, org_id,
      CASE WHEN OCTET_LENGTH(thread_data) <= ? THEN thread_data ELSE NULL END AS thread_data,
      title, scope_type, scope_id, scope_label FROM chat_threads
      WHERE (${keys
        .map(() => "(org_id = ? AND LOWER(owner_email) = LOWER(?) AND id = ?)")
        .join(" OR ")})`,
    args: [
      MAX_REVIEW_THREAD_BYTES,
      ...keys.flatMap(({ orgId, ownerEmail, threadId }) => [
        orgId,
        ownerEmail,
        threadId,
      ]),
    ],
  });
  return new Map(
    (rows as Array<Record<string, unknown>>).map((row) => [
      observabilityReviewThreadKey(String(row.org_id), String(row.id)),
      {
        ownerEmail: String(row.owner_email),
        threadData:
          typeof row.thread_data === "string" ? row.thread_data : null,
        title: typeof row.title === "string" ? row.title.slice(0, 240) : null,
        scopeType: typeof row.scope_type === "string" ? row.scope_type : null,
        scopeId: typeof row.scope_id === "string" ? row.scope_id : null,
        scopeLabel:
          typeof row.scope_label === "string"
            ? row.scope_label.slice(0, 240)
            : null,
      },
    ]),
  );
}

export async function getHumanReviewSummaries(
  orgId: string,
  runIds?: readonly string[],
): Promise<Map<string, HumanReviewSummary>> {
  await ensureObservabilityTables();
  if (!orgId) return new Map();
  const ids = runIds ? [...new Set(runIds.filter(Boolean))] : undefined;
  if (ids && ids.length === 0) return new Map();
  const client = getDbExec();
  const idFilter = ids
    ? `AND run_id IN (${ids.map(() => "?").join(", ")})`
    : "";
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_human_review_summaries WHERE org_id = ? ${idFilter}`,
    args: [orgId, ...(ids ?? [])],
  });
  return new Map(
    (rows as Array<Record<string, unknown>>).map((row) => {
      const summary = parseHumanReviewSummaryRow(row);
      return [summary.runId, summary];
    }),
  );
}

export async function getHumanReviewSummariesForThreads(
  scopes: readonly ObservabilityReviewThreadScope[],
): Promise<Map<string, HumanReviewSummary>> {
  const uniqueScopes = [
    ...new Map(
      scopes
        .filter(({ orgId, threadId }) => orgId && threadId)
        .map((scope) => [
          observabilityReviewThreadKey(scope.orgId, scope.threadId),
          scope,
        ]),
    ).values(),
  ].slice(0, 100);
  if (uniqueScopes.length === 0) return new Map();
  await ensureObservabilityTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT review.*, trace.thread_id AS review_thread_id
      FROM agent_human_review_summaries review
      INNER JOIN agent_trace_summaries trace
        ON trace.run_id = review.run_id AND trace.org_id = review.org_id
      INNER JOIN chat_threads thread
        ON thread.id = trace.thread_id AND thread.org_id = trace.org_id
          AND LOWER(thread.owner_email) = LOWER(trace.user_id)
      WHERE (${uniqueScopes
        .map(() => "(review.org_id = ? AND trace.thread_id = ?)")
        .join(" OR ")})
      ORDER BY review.updated_at DESC, review.run_id DESC`,
    args: uniqueScopes.flatMap(({ orgId, threadId }) => [orgId, threadId]),
  });
  const summaries = new Map<string, HumanReviewSummary>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const threadId = String(row.review_thread_id ?? "");
    const orgId = String(row.org_id ?? "");
    const key = observabilityReviewThreadKey(orgId, threadId);
    if (threadId && orgId && !summaries.has(key)) {
      summaries.set(key, parseHumanReviewSummaryRow(row));
    }
  }
  return summaries;
}

export async function upsertHumanReviewSummary(
  summary: HumanReviewSummary,
): Promise<boolean> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const result = await client.execute({
    sql: `INSERT INTO agent_human_review_summaries
      (run_id, org_id, ask, outcome, artifacts, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id) DO UPDATE SET ask = EXCLUDED.ask,
        outcome = EXCLUDED.outcome, artifacts = EXCLUDED.artifacts,
        created_by = EXCLUDED.created_by, updated_at = EXCLUDED.updated_at
      WHERE agent_human_review_summaries.org_id = EXCLUDED.org_id`,
    args: [
      summary.runId,
      summary.orgId,
      summary.ask,
      summary.outcome,
      JSON.stringify(summary.artifacts),
      summary.createdBy,
      summary.createdAt,
      summary.updatedAt,
    ],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

/** Latest completed response in a thread, always scoped to its owner. */
export async function getLatestTraceSummaryForThread(
  threadId: string,
  opts: { userId: string; excludeRunId: string },
): Promise<TraceSummary | null> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_trace_summaries
      WHERE thread_id = ? AND user_id = ? AND run_id <> ?
      ORDER BY created_at DESC
      LIMIT 1`,
    args: [threadId, opts.userId, opts.excludeRunId],
  });
  if (rows.length === 0) return null;
  return rowToTraceSummary(rows[0] as any);
}

// ─── Feedback CRUD ───────────────────────────────────────────────────

export async function insertFeedback(entry: FeedbackEntry): Promise<boolean> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const result = await client.execute({
    sql: `INSERT INTO agent_feedback
      (id, run_id, thread_id, message_seq, feedback_type, value, idempotency_key, user_id, org_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    args: [
      entry.id,
      entry.runId,
      entry.threadId,
      entry.messageSeq,
      entry.feedbackType,
      entry.value,
      entry.idempotencyKey,
      entry.userId,
      entry.orgId ?? null,
      entry.source ?? "chat",
      entry.createdAt,
    ],
  });
  return result.rowsAffected > 0;
}

export async function getFeedback(opts: {
  threadId?: string;
  sinceMs?: number;
  limit?: number;
  feedbackType?: string;
  userId?: string;
  orgId?: string;
  source?: FeedbackEntry["source"];
  runIds?: readonly string[];
  threadIds?: readonly string[];
  threadScopes?: readonly ObservabilityReviewThreadScope[];
  perThreadLimit?: number;
}): Promise<FeedbackEntry[]> {
  const runIds = opts.runIds
    ? [...new Set(opts.runIds.filter(Boolean))]
    : undefined;
  if (runIds?.length === 0) return [];
  const threadIds = opts.threadIds
    ? [...new Set(opts.threadIds.filter(Boolean))]
    : undefined;
  if (threadIds?.length === 0) return [];
  const threadScopes = opts.threadScopes
    ? [
        ...new Map(
          opts.threadScopes
            .filter(({ orgId, threadId }) => orgId && threadId)
            .map((scope) => [
              observabilityReviewThreadKey(scope.orgId, scope.threadId),
              scope,
            ]),
        ).values(),
      ].slice(0, 100)
    : undefined;
  if (threadScopes?.length === 0) return [];
  await ensureObservabilityTables();
  const client = getDbExec();
  const conditions: string[] = [];
  const args: any[] = [];
  if (opts.threadId) {
    conditions.push("thread_id = ?");
    args.push(opts.threadId);
  }
  if (runIds) {
    conditions.push(`run_id IN (${runIds.map(() => "?").join(", ")})`);
    args.push(...runIds);
  }
  if (threadScopes) {
    conditions.push(
      `(${threadScopes
        .map(() => "(org_id = ? AND thread_id = ?)")
        .join(" OR ")})`,
    );
    args.push(
      ...threadScopes.flatMap(({ orgId, threadId }) => [orgId, threadId]),
    );
  } else if (threadIds) {
    conditions.push(`thread_id IN (${threadIds.map(() => "?").join(", ")})`);
    args.push(...threadIds);
  }
  if (opts.sinceMs) {
    conditions.push("created_at >= ?");
    args.push(opts.sinceMs);
  }
  if (opts.feedbackType) {
    conditions.push("feedback_type = ?");
    args.push(opts.feedbackType);
  }
  if (opts.userId) {
    conditions.push("user_id = ?");
    args.push(opts.userId);
  }
  if (opts.orgId != null) {
    conditions.push("org_id = ?");
    args.push(opts.orgId);
  }
  if (opts.source) {
    conditions.push("source = ?");
    args.push(opts.source);
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const perThreadLimit = Math.max(1, Math.min(opts.perThreadLimit ?? 6, 12));
  const { rows } = await client.execute({
    sql: threadScopes
      ? `SELECT * FROM (
        SELECT agent_feedback.*,
          ROW_NUMBER() OVER (
            PARTITION BY org_id, thread_id ORDER BY created_at DESC, id DESC
          ) AS feedback_row_number
        FROM agent_feedback ${where}
      ) AS review_feedback
      WHERE feedback_row_number <= ?
      ORDER BY created_at DESC, id DESC`
      : threadIds
        ? `SELECT * FROM (
        SELECT agent_feedback.*,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id ORDER BY created_at DESC, id DESC
          ) AS feedback_row_number
        FROM agent_feedback ${where}
      ) AS review_feedback
      WHERE feedback_row_number <= ?
      ORDER BY created_at DESC, id DESC`
        : `SELECT * FROM agent_feedback ${where}
      ORDER BY created_at DESC LIMIT ?`,
    args: [
      ...args,
      threadScopes || threadIds ? perThreadLimit : (opts.limit ?? 100),
    ],
  });
  return (rows as any[]).map(rowToFeedback);
}

export async function getFeedbackStats(
  sinceMs: number,
  opts: { userId?: string; orgId?: string } = {},
): Promise<{
  total: number;
  thumbsUp: number;
  thumbsDown: number;
  categories: Record<string, number>;
}> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { where, args } = withUserFilter(
    "created_at >= ?",
    [sinceMs],
    opts.userId,
    opts.orgId,
  );
  const { rows } = await client.execute({
    sql: `SELECT feedback_type, value, COUNT(*) as cnt
      FROM agent_feedback WHERE ${where} AND source = 'chat'
      GROUP BY feedback_type, value`,
    args,
  });
  let total = 0;
  let thumbsUp = 0;
  let thumbsDown = 0;
  const categories: Record<string, number> = {};
  for (const row of rows as any[]) {
    const cnt = Number(row.cnt);
    total += cnt;
    if (row.feedback_type === "thumbs_up") thumbsUp += cnt;
    else if (row.feedback_type === "thumbs_down") thumbsDown += cnt;
    else if (row.feedback_type === "category")
      categories[String(row.value)] = cnt;
  }
  return { total, thumbsUp, thumbsDown, categories };
}

export async function insertInstructionUpdate(
  update: InstructionUpdate,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_instruction_updates
      (id, run_id, thread_id, target, instruction, feedback, status, user_id, org_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      update.id,
      update.runId,
      update.threadId,
      update.target,
      update.instruction,
      update.feedback,
      update.status,
      update.userId,
      update.orgId ?? null,
      update.createdAt,
      update.updatedAt,
    ],
  });
}

export async function getInstructionUpdates(opts: {
  runId?: string;
  runIds?: readonly string[];
  sinceMs?: number;
  limit?: number;
  userId?: string;
  orgId?: string;
  threadIds?: readonly string[];
  threadScopes?: readonly ObservabilityReviewThreadScope[];
  perThreadLimit?: number;
}): Promise<InstructionUpdate[]> {
  const runIds = opts.runIds
    ? [...new Set(opts.runIds.filter(Boolean))]
    : undefined;
  if (runIds?.length === 0) return [];
  const threadIds = opts.threadIds
    ? [...new Set(opts.threadIds.filter(Boolean))]
    : undefined;
  if (threadIds?.length === 0) return [];
  const threadScopes = opts.threadScopes
    ? [
        ...new Map(
          opts.threadScopes
            .filter(({ orgId, threadId }) => orgId && threadId)
            .map((scope) => [
              observabilityReviewThreadKey(scope.orgId, scope.threadId),
              scope,
            ]),
        ).values(),
      ].slice(0, 100)
    : undefined;
  if (threadScopes?.length === 0) return [];
  await ensureObservabilityTables();
  const client = getDbExec();
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (opts.runId) {
    conditions.push("run_id = ?");
    args.push(opts.runId);
  }
  if (runIds) {
    conditions.push(`run_id IN (${runIds.map(() => "?").join(", ")})`);
    args.push(...runIds);
  }
  if (threadScopes) {
    conditions.push(
      `(${threadScopes
        .map(() => "(org_id = ? AND thread_id = ?)")
        .join(" OR ")})`,
    );
    args.push(
      ...threadScopes.flatMap(({ orgId, threadId }) => [orgId, threadId]),
    );
  } else if (threadIds) {
    conditions.push(`thread_id IN (${threadIds.map(() => "?").join(", ")})`);
    args.push(...threadIds);
  }
  if (opts.sinceMs) {
    conditions.push("updated_at >= ?");
    args.push(opts.sinceMs);
  }
  if (opts.userId) {
    conditions.push("user_id = ?");
    args.push(opts.userId);
  }
  if (opts.orgId != null) {
    conditions.push("org_id = ?");
    args.push(opts.orgId);
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const perThreadLimit = Math.max(1, Math.min(opts.perThreadLimit ?? 1, 12));
  const { rows } = await client.execute({
    sql: threadScopes
      ? `SELECT * FROM (
        SELECT agent_instruction_updates.*,
          ROW_NUMBER() OVER (
            PARTITION BY org_id, thread_id ORDER BY updated_at DESC, id DESC
          ) AS update_row_number
        FROM agent_instruction_updates ${where}
      ) AS review_updates
      WHERE update_row_number <= ?
      ORDER BY updated_at DESC, id DESC`
      : threadIds
        ? `SELECT * FROM (
        SELECT agent_instruction_updates.*,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id ORDER BY updated_at DESC, id DESC
          ) AS update_row_number
        FROM agent_instruction_updates ${where}
      ) AS review_updates
      WHERE update_row_number <= ?
      ORDER BY updated_at DESC, id DESC`
        : `SELECT * FROM agent_instruction_updates ${where}
      ORDER BY updated_at DESC LIMIT ?`,
    args: [
      ...args,
      threadScopes || threadIds ? perThreadLimit : (opts.limit ?? 500),
    ],
  });
  return (rows as any[]).map(rowToInstructionUpdate);
}

// ─── Satisfaction scores CRUD ────────────────────────────────────────

export async function upsertSatisfactionScore(
  score: SatisfactionScore,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  {
    await client.execute({
      sql: `INSERT INTO agent_satisfaction_scores
        (id, thread_id, user_id, frustration_score, rephrasing_score,
         abandonment_score, sentiment_score, length_trend_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          frustration_score = EXCLUDED.frustration_score,
          rephrasing_score = EXCLUDED.rephrasing_score,
          abandonment_score = EXCLUDED.abandonment_score,
          sentiment_score = EXCLUDED.sentiment_score,
          length_trend_score = EXCLUDED.length_trend_score,
          computed_at = EXCLUDED.computed_at`,
      args: [
        score.id,
        score.threadId,
        score.userId,
        score.frustrationScore,
        score.rephrasingScore,
        score.abandonmentScore,
        score.sentimentScore,
        score.lengthTrendScore,
        score.computedAt,
      ],
    });
  }
}

export async function getSatisfactionScores(opts: {
  sinceMs?: number;
  limit?: number;
  minFrustration?: number;
  userId?: string;
}): Promise<SatisfactionScore[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const conditions: string[] = [];
  const args: any[] = [];
  if (opts.sinceMs) {
    conditions.push("computed_at >= ?");
    args.push(opts.sinceMs);
  }
  if (opts.minFrustration != null) {
    conditions.push("frustration_score >= ?");
    args.push(opts.minFrustration);
  }
  if (opts.userId) {
    conditions.push("user_id = ?");
    args.push(opts.userId);
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_satisfaction_scores ${where}
      ORDER BY computed_at DESC LIMIT ?`,
    args: [...args, opts.limit ?? 100],
  });
  return (rows as any[]).map(rowToSatisfaction);
}

// ─── Evals CRUD ──────────────────────────────────────────────────────

export async function insertEvalResult(result: EvalResult): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_evals
      (id, run_id, thread_id, user_id, eval_type, criteria, score, reasoning, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      result.id,
      result.runId,
      result.threadId,
      result.userId,
      result.evalType,
      result.criteria,
      result.score,
      result.reasoning,
      result.metadata ? JSON.stringify(result.metadata) : null,
      result.createdAt,
    ],
  });
}

export async function getEvalsForRun(
  runId: string,
  opts: { userId?: string } = {},
): Promise<EvalResult[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { where, args } = withUserFilter("run_id = ?", [runId], opts.userId);
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_evals WHERE ${where} ORDER BY created_at ASC`,
    args,
  });
  return (rows as any[]).map(rowToEval);
}

export async function getEvalStats(
  sinceMs: number,
  opts: { userId?: string } = {},
): Promise<{
  totalEvals: number;
  avgScore: number;
  byCriteria: Array<{ criteria: string; avgScore: number; count: number }>;
}> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { where, args } = withUserFilter(
    "created_at >= ?",
    [sinceMs],
    opts.userId,
  );
  const { rows: totalRows } = await client.execute({
    sql: `SELECT COUNT(*) as cnt, AVG(score) as avg_score
      FROM agent_evals WHERE ${where}`,
    args,
  });
  const t = (totalRows[0] ?? {}) as Record<string, number | null>;

  const { rows: criteriaRows } = await client.execute({
    sql: `SELECT criteria, AVG(score) as avg_score, COUNT(*) as cnt
      FROM agent_evals WHERE ${where}
      GROUP BY criteria ORDER BY cnt DESC`,
    args,
  });

  return {
    totalEvals: Number(t.cnt ?? 0),
    avgScore: Number(t.avg_score ?? 0),
    byCriteria: (criteriaRows as any[]).map((r) => ({
      criteria: String(r.criteria),
      avgScore: Number(r.avg_score ?? 0),
      count: Number(r.cnt ?? 0),
    })),
  };
}

// ─── Eval datasets CRUD ──────────────────────────────────────────────

export async function insertEvalDataset(dataset: EvalDataset): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_eval_datasets
      (id, name, description, entries, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      dataset.id,
      dataset.name,
      dataset.description,
      JSON.stringify(dataset.entries),
      dataset.createdAt,
      dataset.updatedAt,
    ],
  });
}

export async function listEvalDatasets(): Promise<EvalDataset[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute(
    `SELECT * FROM agent_eval_datasets ORDER BY updated_at DESC`,
  );
  return (rows as any[]).map(rowToDataset);
}

export async function getEvalDataset(id: string): Promise<EvalDataset | null> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_eval_datasets WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToDataset(rows[0] as any);
}

export async function updateEvalDataset(
  id: string,
  updates: Partial<Pick<EvalDataset, "name" | "description" | "entries">>,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const sets: string[] = [];
  const args: any[] = [];
  if (updates.name !== undefined) {
    sets.push("name = ?");
    args.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    args.push(updates.description);
  }
  if (updates.entries !== undefined) {
    sets.push("entries = ?");
    args.push(JSON.stringify(updates.entries));
  }
  sets.push("updated_at = ?");
  args.push(Date.now());
  args.push(id);
  await client.execute({
    sql: `UPDATE agent_eval_datasets SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

// ─── Experiments CRUD ────────────────────────────────────────────────

export async function insertExperiment(exp: Experiment): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_experiments
      (id, name, status, variants, metrics, assignment_level,
       started_at, ended_at, created_at, owner_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      exp.id,
      exp.name,
      exp.status,
      JSON.stringify(exp.variants),
      JSON.stringify(exp.metrics),
      exp.assignmentLevel,
      exp.startedAt,
      exp.endedAt,
      exp.createdAt,
      exp.ownerEmail ?? null,
    ],
  });
}

export async function updateExperiment(
  id: string,
  updates: Partial<
    Pick<Experiment, "name" | "status" | "variants" | "metrics" | "endedAt">
  >,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const sets: string[] = [];
  const args: any[] = [];
  if (updates.name !== undefined) {
    sets.push("name = ?");
    args.push(updates.name);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    args.push(updates.status);
    if (updates.status === "running" && !updates.endedAt) {
      // Preserve the original exposure window when a paused experiment
      // resumes; resetting it would silently discard the first run period from
      // the results.
      sets.push("started_at = COALESCE(started_at, ?)");
      args.push(Date.now());
    }
  }
  if (updates.variants !== undefined) {
    sets.push("variants = ?");
    args.push(JSON.stringify(updates.variants));
  }
  if (updates.metrics !== undefined) {
    sets.push("metrics = ?");
    args.push(JSON.stringify(updates.metrics));
  }
  if (updates.endedAt !== undefined) {
    sets.push("ended_at = ?");
    args.push(updates.endedAt);
  }
  if (sets.length === 0) return;
  args.push(id);
  await client.execute({
    sql: `UPDATE agent_experiments SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function listExperiments(): Promise<Experiment[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute(
    `SELECT * FROM agent_experiments ORDER BY created_at DESC`,
  );
  return (rows as any[]).map(rowToExperiment);
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_experiments WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return null;
  return rowToExperiment(rows[0] as any);
}

// ─── Experiment assignments CRUD ────────────────────────────────────

export async function upsertAssignment(
  assignment: ExperimentAssignment,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  {
    await client.execute({
      sql: `INSERT INTO agent_experiment_assignments
        (experiment_id, user_id, variant_id, assigned_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (experiment_id, user_id) DO UPDATE SET
          variant_id = EXCLUDED.variant_id,
          assigned_at = EXCLUDED.assigned_at`,
      args: [
        assignment.experimentId,
        assignment.userId,
        assignment.variantId,
        assignment.assignedAt,
      ],
    });
  }
}

export async function getAssignment(
  experimentId: string,
  userId: string,
): Promise<ExperimentAssignment | null> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_experiment_assignments
      WHERE experiment_id = ? AND user_id = ?`,
    args: [experimentId, userId],
  });
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  return {
    experimentId: r.experiment_id,
    userId: r.user_id,
    variantId: r.variant_id,
    assignedAt: Number(r.assigned_at),
  };
}

// ─── Experiment results CRUD ─────────────────────────────────────────

export async function insertExperimentResult(
  result: ExperimentMetricResult,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_experiment_results
      (id, experiment_id, variant_id, metric, value,
       sample_size, confidence_low, confidence_high, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      result.id,
      result.experimentId,
      result.variantId,
      result.metric,
      result.value,
      result.sampleSize,
      result.confidenceLow,
      result.confidenceHigh,
      result.computedAt,
    ],
  });
}

export async function getExperimentResults(
  experimentId: string,
): Promise<ExperimentMetricResult[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_experiment_results
      WHERE experiment_id = ?
      ORDER BY computed_at DESC`,
    args: [experimentId],
  });
  return (rows as any[]).map(rowToExperimentResult);
}

// ─── Aggregate queries for dashboard ─────────────────────────────────

export async function getObservabilityOverview(
  sinceMs: number,
  opts: { userId?: string } = {},
): Promise<{
  totalRuns: number;
  totalCostCents: number;
  avgDurationMs: number;
  toolSuccessRate: number;
  avgFrustrationScore: number;
  thumbsUpRate: number;
  avgEvalScore: number;
}> {
  await ensureObservabilityTables();
  const client = getDbExec();

  // Three of the four sub-queries time-key on `created_at`; satisfaction
  // uses `computed_at`. Each gets its own `withUserFilter` invocation so
  // the args array isn't aliased across calls (some drivers mutate args
  // for prepared-statement caching).
  const created = withUserFilter("created_at >= ?", [sinceMs], opts.userId);
  const computed = withUserFilter("computed_at >= ?", [sinceMs], opts.userId);

  const [tracesResult, satisfactionResult, feedbackResult, evalsResult] =
    await Promise.all([
      client.execute({
        sql: `SELECT
          COUNT(*) as total_runs,
          COALESCE(SUM(total_cost_cents_x100), 0) as total_cost,
          COALESCE(AVG(total_duration_ms), 0) as avg_duration,
          COALESCE(SUM(successful_tools), 0) as success_tools,
          COALESCE(SUM(tool_calls), 0) as total_tools
          FROM agent_trace_summaries WHERE ${created.where}`,
        args: created.args,
      }),
      client.execute({
        sql: `SELECT COALESCE(AVG(frustration_score), 0) as avg_frustration
          FROM agent_satisfaction_scores WHERE ${computed.where}`,
        args: computed.args,
      }),
      client.execute({
        sql: `SELECT
          COALESCE(SUM(CASE WHEN feedback_type = 'thumbs_up' THEN 1 ELSE 0 END), 0) as up,
          COALESCE(SUM(CASE WHEN feedback_type IN ('thumbs_up', 'thumbs_down') THEN 1 ELSE 0 END), 0) as total
          FROM agent_feedback WHERE ${created.where} AND source = 'chat'`,
        args: created.args,
      }),
      client.execute({
        sql: `SELECT COALESCE(AVG(score), 0) as avg_score
          FROM agent_evals WHERE ${created.where}`,
        args: created.args,
      }),
    ]);

  const t = (tracesResult.rows[0] ?? {}) as Record<string, number | null>;
  const s = (satisfactionResult.rows[0] ?? {}) as Record<string, number | null>;
  const f = (feedbackResult.rows[0] ?? {}) as Record<string, number | null>;
  const e = (evalsResult.rows[0] ?? {}) as Record<string, number | null>;

  const totalTools = Number(t.total_tools ?? 0);
  const successTools = Number(t.success_tools ?? 0);
  const feedbackTotal = Number(f.total ?? 0);
  const feedbackUp = Number(f.up ?? 0);

  return {
    totalRuns: Number(t.total_runs ?? 0),
    totalCostCents: Number(t.total_cost ?? 0) / 100,
    avgDurationMs: Number(t.avg_duration ?? 0),
    toolSuccessRate: totalTools > 0 ? successTools / totalTools : 1,
    avgFrustrationScore: Number(s.avg_frustration ?? 0),
    thumbsUpRate: feedbackTotal > 0 ? feedbackUp / feedbackTotal : 0,
    avgEvalScore: Number(e.avg_score ?? 0),
  };
}

// ─── Row mappers ─────────────────────────────────────────────────────

function rowToTraceSpan(row: Record<string, any>): TraceSpan {
  const storedMetadata = safeJsonParse<Record<string, unknown> | null>(
    row.metadata,
    null,
  );
  const metadata = storedMetadata ? { ...storedMetadata } : null;
  const hasCapturedToolError =
    metadata?.[TOOL_ERROR_CAPTURE_METADATA_KEY] === 1;
  if (metadata && metadata.input !== undefined) {
    metadata.input = redactSensitiveFields(metadata.input);
  }
  if (metadata) delete metadata[TOOL_ERROR_CAPTURE_METADATA_KEY];
  const errorMessage = row.error_message ? String(row.error_message) : null;

  return {
    id: String(row.id),
    runId: String(row.run_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    userId: row.user_id ? String(row.user_id) : null,
    orgId: row.org_id ? String(row.org_id) : null,
    parentSpanId: row.parent_span_id ? String(row.parent_span_id) : null,
    spanType: row.span_type as TraceSpan["spanType"],
    name: String(row.name),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
    costCentsX100: Number(row.cost_cents_x100 ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    status: row.status as TraceSpan["status"],
    errorMessage:
      row.span_type === "tool_call" && !hasCapturedToolError
        ? null
        : errorMessage
          ? sanitizeToolErrorMessage(errorMessage)
          : null,
    metadata,
    createdAt: Number(row.created_at),
  };
}

function rowToTraceSummary(row: Record<string, any>): TraceSummary {
  return {
    runId: String(row.run_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    userId: row.user_id ? String(row.user_id) : null,
    orgId: row.org_id ? String(row.org_id) : null,
    totalSpans: Number(row.total_spans ?? 0),
    llmCalls: Number(row.llm_calls ?? 0),
    toolCalls: Number(row.tool_calls ?? 0),
    successfulTools: Number(row.successful_tools ?? 0),
    failedTools: Number(row.failed_tools ?? 0),
    totalDurationMs: Number(row.total_duration_ms ?? 0),
    totalCostCentsX100: Number(row.total_cost_cents_x100 ?? 0),
    totalInputTokens: Number(row.total_input_tokens ?? 0),
    totalOutputTokens: Number(row.total_output_tokens ?? 0),
    model: String(row.model ?? ""),
    createdAt: Number(row.created_at),
    ...(row.run_count == null ? {} : { runCount: Number(row.run_count) }),
  };
}

function rowToFeedback(row: Record<string, any>): FeedbackEntry {
  return {
    id: String(row.id),
    runId: row.run_id ? String(row.run_id) : null,
    threadId: row.thread_id ? String(row.thread_id) : null,
    messageSeq: row.message_seq != null ? Number(row.message_seq) : null,
    feedbackType: row.feedback_type as FeedbackEntry["feedbackType"],
    value: String(row.value ?? ""),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    userId: row.user_id ? String(row.user_id) : null,
    orgId: row.org_id ? String(row.org_id) : null,
    source: row.source === "human_review" ? "human_review" : "chat",
    createdAt: Number(row.created_at),
  };
}

function rowToInstructionUpdate(row: Record<string, any>): InstructionUpdate {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    target: row.target as InstructionUpdate["target"],
    instruction: String(row.instruction),
    feedback: String(row.feedback ?? ""),
    status: row.status as InstructionUpdate["status"],
    userId: String(row.user_id),
    orgId: row.org_id ? String(row.org_id) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToSatisfaction(row: Record<string, any>): SatisfactionScore {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    userId: row.user_id ? String(row.user_id) : null,
    frustrationScore: Number(row.frustration_score ?? 0),
    rephrasingScore: Number(row.rephrasing_score ?? 0),
    abandonmentScore: Number(row.abandonment_score ?? 0),
    sentimentScore: Number(row.sentiment_score ?? 0),
    lengthTrendScore: Number(row.length_trend_score ?? 0),
    computedAt: Number(row.computed_at),
  };
}

function rowToEval(row: Record<string, any>): EvalResult {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    userId: row.user_id ? String(row.user_id) : null,
    evalType: row.eval_type as EvalResult["evalType"],
    criteria: String(row.criteria),
    score: Number(row.score ?? 0),
    reasoning: row.reasoning ? String(row.reasoning) : null,
    metadata: safeJsonParse(row.metadata, null),
    createdAt: Number(row.created_at),
  };
}

function rowToDataset(row: Record<string, any>): EvalDataset {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    entries: safeJsonParse(row.entries, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToExperiment(row: Record<string, any>): Experiment {
  return {
    id: String(row.id),
    name: String(row.name),
    status: row.status as Experiment["status"],
    variants: safeJsonParse(row.variants, []),
    metrics: safeJsonParse(row.metrics, []),
    assignmentLevel: (row.assignment_level as "user" | "session") ?? "user",
    startedAt: row.started_at ? Number(row.started_at) : null,
    endedAt: row.ended_at ? Number(row.ended_at) : null,
    createdAt: Number(row.created_at),
    ownerEmail:
      typeof row.owner_email === "string" && row.owner_email
        ? row.owner_email
        : null,
  };
}

function rowToExperimentResult(
  row: Record<string, any>,
): ExperimentMetricResult {
  return {
    id: String(row.id),
    experimentId: String(row.experiment_id),
    variantId: String(row.variant_id),
    metric: String(row.metric),
    value: Number(row.value ?? 0),
    sampleSize: Number(row.sample_size ?? 0),
    confidenceLow: Number(row.confidence_low ?? 0),
    confidenceHigh: Number(row.confidence_high ?? 0),
    computedAt: Number(row.computed_at),
  };
}
