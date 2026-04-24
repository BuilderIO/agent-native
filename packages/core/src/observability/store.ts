/**
 * SQL persistence for the agent observability system.
 *
 * Creates and manages tables for traces, feedback, evals, experiments,
 * and satisfaction scores. Follows the same raw-SQL pattern as
 * run-store.ts and usage/store.ts — framework tables use getDbExec()
 * rather than Drizzle ORM (which is for template-level schemas).
 */
import { getDbExec, intType, isPostgres } from "../db/client.js";
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
} from "./types.js";

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

let _initPromise: Promise<void> | undefined;

export async function ensureObservabilityTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_trace_spans (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          parent_span_id TEXT,
          span_type TEXT NOT NULL,
          name TEXT NOT NULL,
          input_tokens ${intType()} NOT NULL DEFAULT 0,
          output_tokens ${intType()} NOT NULL DEFAULT 0,
          cache_read_tokens ${intType()} NOT NULL DEFAULT 0,
          cache_write_tokens ${intType()} NOT NULL DEFAULT 0,
          cost_cents_x100 ${intType()} NOT NULL DEFAULT 0,
          duration_ms ${intType()} NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'success',
          error_message TEXT,
          metadata TEXT,
          created_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_trace_summaries (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT,
          total_spans ${intType()} NOT NULL DEFAULT 0,
          llm_calls ${intType()} NOT NULL DEFAULT 0,
          tool_calls ${intType()} NOT NULL DEFAULT 0,
          successful_tools ${intType()} NOT NULL DEFAULT 0,
          failed_tools ${intType()} NOT NULL DEFAULT 0,
          total_duration_ms ${intType()} NOT NULL DEFAULT 0,
          total_cost_cents_x100 ${intType()} NOT NULL DEFAULT 0,
          total_input_tokens ${intType()} NOT NULL DEFAULT 0,
          total_output_tokens ${intType()} NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          created_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_feedback (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          thread_id TEXT,
          message_seq ${intType()},
          feedback_type TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT '',
          user_id TEXT,
          created_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_satisfaction_scores (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          frustration_score REAL NOT NULL DEFAULT 0,
          rephrasing_score REAL NOT NULL DEFAULT 0,
          abandonment_score REAL NOT NULL DEFAULT 0,
          sentiment_score REAL NOT NULL DEFAULT 0,
          length_trend_score REAL NOT NULL DEFAULT 0,
          computed_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_evals (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          eval_type TEXT NOT NULL,
          criteria TEXT NOT NULL,
          score REAL NOT NULL DEFAULT 0,
          reasoning TEXT,
          metadata TEXT,
          created_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_eval_datasets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          entries TEXT NOT NULL DEFAULT '[]',
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_experiments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          variants TEXT NOT NULL DEFAULT '[]',
          metrics TEXT NOT NULL DEFAULT '[]',
          assignment_level TEXT NOT NULL DEFAULT 'user',
          started_at ${intType()},
          ended_at ${intType()},
          created_at ${intType()} NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_experiment_assignments (
          experiment_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          assigned_at ${intType()} NOT NULL,
          PRIMARY KEY (experiment_id, user_id)
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_experiment_results (
          id TEXT PRIMARY KEY,
          experiment_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          sample_size ${intType()} NOT NULL DEFAULT 0,
          confidence_low REAL NOT NULL DEFAULT 0,
          confidence_high REAL NOT NULL DEFAULT 0,
          computed_at ${intType()} NOT NULL
        )
      `);

      // Indexes for common query patterns
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_trace_spans_run ON agent_trace_spans (run_id)`,
        `CREATE INDEX IF NOT EXISTS idx_trace_spans_thread ON agent_trace_spans (thread_id)`,
        `CREATE INDEX IF NOT EXISTS idx_trace_spans_created ON agent_trace_spans (created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_trace_summaries_created ON agent_trace_summaries (created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_feedback_thread ON agent_feedback (thread_id)`,
        `CREATE INDEX IF NOT EXISTS idx_feedback_created ON agent_feedback (created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_satisfaction_thread ON agent_satisfaction_scores (thread_id)`,
        `CREATE INDEX IF NOT EXISTS idx_evals_run ON agent_evals (run_id)`,
        `CREATE INDEX IF NOT EXISTS idx_evals_created ON agent_evals (created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_experiment_results_exp ON agent_experiment_results (experiment_id)`,
      ];
      for (const sql of indexes) {
        try {
          await client.execute(sql);
        } catch {
          // Index might already exist
        }
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
      (id, run_id, thread_id, parent_span_id, span_type, name,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       cost_cents_x100, duration_ms, status, error_message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      span.id,
      span.runId,
      span.threadId,
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
  if (isPostgres()) {
    await client.execute({
      sql: `INSERT INTO agent_trace_summaries
        (run_id, thread_id, total_spans, llm_calls, tool_calls,
         successful_tools, failed_tools, total_duration_ms,
         total_cost_cents_x100, total_input_tokens, total_output_tokens,
         model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  } else {
    await client.execute({
      sql: `INSERT OR REPLACE INTO agent_trace_summaries
        (run_id, thread_id, total_spans, llm_calls, tool_calls,
         successful_tools, failed_tools, total_duration_ms,
         total_cost_cents_x100, total_input_tokens, total_output_tokens,
         model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        summary.runId,
        summary.threadId,
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

export async function getTraceSpansForRun(runId: string): Promise<TraceSpan[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_trace_spans WHERE run_id = ? ORDER BY created_at ASC`,
    args: [runId],
  });
  return (rows as any[]).map(rowToTraceSpan);
}

export async function getTraceSummaries(opts: {
  sinceMs?: number;
  limit?: number;
}): Promise<TraceSummary[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const sinceMs = opts.sinceMs ?? 0;
  const limit = opts.limit ?? 100;
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_trace_summaries
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?`,
    args: [sinceMs, limit],
  });
  return (rows as any[]).map(rowToTraceSummary);
}

export async function getTraceSummary(
  runId: string,
): Promise<TraceSummary | null> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_trace_summaries WHERE run_id = ?`,
    args: [runId],
  });
  if (rows.length === 0) return null;
  return rowToTraceSummary(rows[0] as any);
}

// ─── Feedback CRUD ───────────────────────────────────────────────────

export async function insertFeedback(entry: FeedbackEntry): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO agent_feedback
      (id, run_id, thread_id, message_seq, feedback_type, value, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.id,
      entry.runId,
      entry.threadId,
      entry.messageSeq,
      entry.feedbackType,
      entry.value,
      entry.userId,
      entry.createdAt,
    ],
  });
}

export async function getFeedback(opts: {
  threadId?: string;
  sinceMs?: number;
  limit?: number;
  feedbackType?: string;
}): Promise<FeedbackEntry[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const conditions: string[] = [];
  const args: any[] = [];
  if (opts.threadId) {
    conditions.push("thread_id = ?");
    args.push(opts.threadId);
  }
  if (opts.sinceMs) {
    conditions.push("created_at >= ?");
    args.push(opts.sinceMs);
  }
  if (opts.feedbackType) {
    conditions.push("feedback_type = ?");
    args.push(opts.feedbackType);
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 100;
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_feedback ${where} ORDER BY created_at DESC LIMIT ?`,
    args: [...args, limit],
  });
  return (rows as any[]).map(rowToFeedback);
}

export async function getFeedbackStats(sinceMs: number): Promise<{
  total: number;
  thumbsUp: number;
  thumbsDown: number;
  categories: Record<string, number>;
}> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT feedback_type, value, COUNT(*) as cnt
      FROM agent_feedback WHERE created_at >= ?
      GROUP BY feedback_type, value`,
    args: [sinceMs],
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

// ─── Satisfaction scores CRUD ────────────────────────────────────────

export async function upsertSatisfactionScore(
  score: SatisfactionScore,
): Promise<void> {
  await ensureObservabilityTables();
  const client = getDbExec();
  if (isPostgres()) {
    await client.execute({
      sql: `INSERT INTO agent_satisfaction_scores
        (id, thread_id, frustration_score, rephrasing_score,
         abandonment_score, sentiment_score, length_trend_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        score.frustrationScore,
        score.rephrasingScore,
        score.abandonmentScore,
        score.sentimentScore,
        score.lengthTrendScore,
        score.computedAt,
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT OR REPLACE INTO agent_satisfaction_scores
        (id, thread_id, frustration_score, rephrasing_score,
         abandonment_score, sentiment_score, length_trend_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        score.id,
        score.threadId,
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
      (id, run_id, thread_id, eval_type, criteria, score, reasoning, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      result.id,
      result.runId,
      result.threadId,
      result.evalType,
      result.criteria,
      result.score,
      result.reasoning,
      result.metadata ? JSON.stringify(result.metadata) : null,
      result.createdAt,
    ],
  });
}

export async function getEvalsForRun(runId: string): Promise<EvalResult[]> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM agent_evals WHERE run_id = ? ORDER BY created_at ASC`,
    args: [runId],
  });
  return (rows as any[]).map(rowToEval);
}

export async function getEvalStats(sinceMs: number): Promise<{
  totalEvals: number;
  avgScore: number;
  byCriteria: Array<{ criteria: string; avgScore: number; count: number }>;
}> {
  await ensureObservabilityTables();
  const client = getDbExec();
  const { rows: totalRows } = await client.execute({
    sql: `SELECT COUNT(*) as cnt, AVG(score) as avg_score
      FROM agent_evals WHERE created_at >= ?`,
    args: [sinceMs],
  });
  const t = (totalRows[0] ?? {}) as Record<string, number | null>;

  const { rows: criteriaRows } = await client.execute({
    sql: `SELECT criteria, AVG(score) as avg_score, COUNT(*) as cnt
      FROM agent_evals WHERE created_at >= ?
      GROUP BY criteria ORDER BY cnt DESC`,
    args: [sinceMs],
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
       started_at, ended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      sets.push("started_at = ?");
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
  if (isPostgres()) {
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
  } else {
    await client.execute({
      sql: `INSERT OR REPLACE INTO agent_experiment_assignments
        (experiment_id, user_id, variant_id, assigned_at)
        VALUES (?, ?, ?, ?)`,
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

export async function getObservabilityOverview(sinceMs: number): Promise<{
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

  const [tracesResult, satisfactionResult, feedbackResult, evalsResult] =
    await Promise.all([
      client.execute({
        sql: `SELECT
          COUNT(*) as total_runs,
          COALESCE(SUM(total_cost_cents_x100), 0) as total_cost,
          COALESCE(AVG(total_duration_ms), 0) as avg_duration,
          COALESCE(SUM(successful_tools), 0) as success_tools,
          COALESCE(SUM(tool_calls), 0) as total_tools
          FROM agent_trace_summaries WHERE created_at >= ?`,
        args: [sinceMs],
      }),
      client.execute({
        sql: `SELECT COALESCE(AVG(frustration_score), 0) as avg_frustration
          FROM agent_satisfaction_scores WHERE computed_at >= ?`,
        args: [sinceMs],
      }),
      client.execute({
        sql: `SELECT
          COALESCE(SUM(CASE WHEN feedback_type = 'thumbs_up' THEN 1 ELSE 0 END), 0) as up,
          COALESCE(SUM(CASE WHEN feedback_type IN ('thumbs_up', 'thumbs_down') THEN 1 ELSE 0 END), 0) as total
          FROM agent_feedback WHERE created_at >= ?`,
        args: [sinceMs],
      }),
      client.execute({
        sql: `SELECT COALESCE(AVG(score), 0) as avg_score
          FROM agent_evals WHERE created_at >= ?`,
        args: [sinceMs],
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
  return {
    id: String(row.id),
    runId: String(row.run_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
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
    errorMessage: row.error_message ? String(row.error_message) : null,
    metadata: safeJsonParse(row.metadata, null),
    createdAt: Number(row.created_at),
  };
}

function rowToTraceSummary(row: Record<string, any>): TraceSummary {
  return {
    runId: String(row.run_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
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
    userId: row.user_id ? String(row.user_id) : null,
    createdAt: Number(row.created_at),
  };
}

function rowToSatisfaction(row: Record<string, any>): SatisfactionScore {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
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
