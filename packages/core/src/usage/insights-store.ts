import { getDbExec } from "../db/client.js";
import { ensureObservabilityTables } from "../observability/store.js";
import {
  loadRunExchanges,
  numberField,
  resolveScope,
  stringField,
  usageAppScope,
  type UsageMetricsAccessInput,
  type UsageMetricsScope,
} from "./metrics-store.js";
import { calculateCost } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Anthropic's default prompt-cache TTL; a gap longer than this re-writes the prefix.
const CACHE_TTL_MS = 5 * 60 * 1000;
const RUN_LIMIT = 25;
// A restart cheaper than this is provider noise, not something to act on.
const MIN_RESTART_CENTS = 0.5;

/** Spend split by how the provider billed each token, in cents. */
export interface UsageCostBreakdown {
  cacheReadCents: number;
  cacheWriteCents: number;
  uncachedInputCents: number;
  outputCents: number;
  /** Recorded spend for the rows; the category splits above are token-priced estimates. */
  totalCents: number;
  /** The same tokens priced at list rates, so it is comparable to `noCacheCents`. */
  estimatedCents: number;
  /** What the same tokens would have cost with no prompt caching. */
  noCacheCents: number;
}

export interface UsageTokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type UsageScoreSource = "heuristic" | "judge" | "human";

export interface UsageRunScore {
  source: UsageScoreSource;
  criteria: string;
  score: number;
  reasoning: string | null;
}

export interface UsageRunTool {
  name: string;
  calls: number;
  failed: number;
  error: string | null;
}

/**
 * The context was re-sent in full when the cache could have been re-used.
 * `tool-lookup`: new tools were loaded; `prefix-changed`: something else at
 * the start of the prompt changed.
 */
export type UsageRestartCause = "tool-lookup" | "prefix-changed";

export interface UsageRunRestarts {
  count: number;
  cents: number;
  byCause: Record<UsageRestartCause, { count: number; cents: number }>;
}

export interface UsageRunListItem {
  runId: string;
  createdAt: number;
  ownerEmail: string;
  label: string;
  model: string;
  prompt: string | null;
  /** `unknown` when the trace was never written or has been cleaned up. */
  status: "success" | "error" | "unknown";
  tokens: UsageTokenTotals;
  cost: UsageCostBreakdown;
  modelCalls: number;
  tools: UsageRunTool[];
  restarts: UsageRunRestarts;
  /** Tool calls that overlapped another call in the same step, and the time that saved. */
  parallel: { calls: number; savedMs: number };
  /** Failed tool calls in a run that still finished. */
  recoveredErrors: number;
  durationMs: number | null;
  feedback: "up" | "down" | null;
}

export interface UsagePeriodTotals {
  runs: number;
  tokens: UsageTokenTotals;
  cost: UsageCostBreakdown;
}

export interface UsageInsights {
  sinceDays: number;
  current: UsagePeriodTotals;
  previous: UsagePeriodTotals;
  runs: UsageRunListItem[];
}

export interface UsageRunToolCall {
  name: string;
  startedAt: number;
  durationMs: number;
  status: string;
  errorMessage: string | null;
}

/** One model call and the tools it asked for. */
export interface UsageRunTurn {
  index: number;
  model: string;
  durationMs: number;
  tokens: UsageTokenTotals;
  cost: UsageCostBreakdown;
  status: string;
  /** Set only when re-sending the context cost a meaningful amount. */
  restart: { cause: UsageRestartCause; cents: number } | null;
  /** The provider cache had expired after an idle gap; expected, not a fault. */
  cacheExpired: boolean;
  toolCalls: UsageRunToolCall[];
}

export interface UsageRunDetail extends UsageRunListItem {
  reply: string | null;
  turns: UsageRunTurn[];
  scores: UsageRunScore[];
}

interface SpanRow {
  spanType: string;
  name: string;
  status: string;
  errorMessage: string | null;
  durationMs: number;
  createdAt: number;
  tokens: UsageTokenTotals;
}

function costBreakdown(
  tokens: UsageTokenTotals,
  model: string,
): UsageCostBreakdown {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
    tokens;
  const uncached = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );
  const cents = (centicents: number) => centicents / 100;
  const breakdown = {
    cacheReadCents: cents(
      calculateCost(cacheReadTokens, 0, model, cacheReadTokens, 0),
    ),
    cacheWriteCents: cents(
      calculateCost(cacheWriteTokens, 0, model, 0, cacheWriteTokens),
    ),
    uncachedInputCents: cents(calculateCost(uncached, 0, model)),
    outputCents: cents(calculateCost(0, outputTokens, model)),
    noCacheCents: cents(calculateCost(inputTokens, outputTokens, model)),
  };
  const estimatedCents =
    breakdown.cacheReadCents +
    breakdown.cacheWriteCents +
    breakdown.uncachedInputCents +
    breakdown.outputCents;
  return { ...breakdown, estimatedCents, totalCents: estimatedCents };
}

/** Token-priced breakdown for one model's rows, carrying their recorded spend. */
function recordedBreakdown(row: Record<string, unknown>): UsageCostBreakdown {
  return {
    ...costBreakdown(tokensFromRow(row), stringField(row, "model")),
    totalCents: numberField(row, "cost_cents_x100") / 100,
  };
}

function addBreakdown(
  a: UsageCostBreakdown,
  b: UsageCostBreakdown,
): UsageCostBreakdown {
  return {
    cacheReadCents: a.cacheReadCents + b.cacheReadCents,
    cacheWriteCents: a.cacheWriteCents + b.cacheWriteCents,
    uncachedInputCents: a.uncachedInputCents + b.uncachedInputCents,
    outputCents: a.outputCents + b.outputCents,
    totalCents: a.totalCents + b.totalCents,
    estimatedCents: a.estimatedCents + b.estimatedCents,
    noCacheCents: a.noCacheCents + b.noCacheCents,
  };
}

const EMPTY_BREAKDOWN: UsageCostBreakdown = {
  cacheReadCents: 0,
  cacheWriteCents: 0,
  uncachedInputCents: 0,
  outputCents: 0,
  totalCents: 0,
  estimatedCents: 0,
  noCacheCents: 0,
};

function emptyTokens(): UsageTokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function addTokens(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

function tokensFromRow(row: Record<string, unknown>): UsageTokenTotals {
  return {
    inputTokens: numberField(row, "input_tokens"),
    outputTokens: numberField(row, "output_tokens"),
    cacheReadTokens: numberField(row, "cache_read_tokens"),
    cacheWriteTokens: numberField(row, "cache_write_tokens"),
  };
}

const SCORE_SOURCE: Record<string, UsageScoreSource> = {
  automated: "heuristic",
  llm_judge: "judge",
  human: "human",
};

/**
 * Extra spend versus the call re-using the previous call's context from cache.
 * Providers that bill no cache writes (OpenAI) only lose the read discount.
 */
function restartCents(
  model: string,
  tokens: UsageTokenTotals,
  previousInput: number,
): number {
  const reusable = Math.min(previousInput, tokens.inputTokens);
  const writesBilled = tokens.cacheWriteTokens > 0;
  const ifCached = calculateCost(
    tokens.inputTokens,
    0,
    model,
    reusable,
    writesBilled ? tokens.inputTokens - reusable : 0,
  );
  const actual = calculateCost(
    tokens.inputTokens,
    0,
    model,
    tokens.cacheReadTokens,
    tokens.cacheWriteTokens,
  );
  return Math.max(0, actual - ifCached) / 100;
}

function buildTurns(spans: SpanRow[]): UsageRunTurn[] {
  const turns: UsageRunTurn[] = [];
  // A provider that never reports cache tokens has no cache to miss.
  const providerCaches = spans.some(
    (span) =>
      span.spanType === "llm_call" &&
      span.tokens.cacheReadTokens + span.tokens.cacheWriteTokens > 0,
  );
  let previousStartedAt = 0;
  let toolLookupSinceLastTurn = false;
  for (const span of spans) {
    if (span.spanType === "tool_call") {
      if (span.name === "tool-search") toolLookupSinceLastTurn = true;
      turns.at(-1)?.toolCalls.push({
        name: span.name,
        startedAt: span.createdAt,
        durationMs: span.durationMs,
        status: span.status,
        errorMessage: span.errorMessage,
      });
      continue;
    }
    if (span.spanType !== "llm_call") continue;
    const previous = turns.at(-1);
    const missed =
      providerCaches &&
      previous !== undefined &&
      span.tokens.cacheReadTokens < span.tokens.inputTokens / 2;
    const expired = missed && span.createdAt - previousStartedAt > CACHE_TTL_MS;
    let restart: UsageRunTurn["restart"] = null;
    if (missed && !expired) {
      const cents = restartCents(
        span.name,
        span.tokens,
        previous.tokens.inputTokens,
      );
      if (cents >= MIN_RESTART_CENTS) {
        restart = {
          cause: toolLookupSinceLastTurn ? "tool-lookup" : "prefix-changed",
          cents,
        };
      }
    }
    turns.push({
      index: turns.length + 1,
      model: span.name,
      durationMs: span.durationMs,
      tokens: span.tokens,
      cost: costBreakdown(span.tokens, span.name),
      status: span.status,
      restart,
      cacheExpired: expired,
      toolCalls: [],
    });
    previousStartedAt = span.createdAt;
    toolLookupSinceLastTurn = false;
  }
  return turns;
}

function parallelSavings(turns: UsageRunTurn[]): {
  calls: number;
  savedMs: number;
} {
  let calls = 0;
  let savedMs = 0;
  for (const { toolCalls } of turns) {
    if (toolCalls.length < 2) continue;
    const start = Math.min(...toolCalls.map((call) => call.startedAt));
    const end = Math.max(
      ...toolCalls.map((call) => call.startedAt + call.durationMs),
    );
    const sequential = toolCalls.reduce(
      (sum, call) => sum + call.durationMs,
      0,
    );
    if (sequential - (end - start) <= 0) continue;
    savedMs += sequential - (end - start);
    calls += toolCalls.filter((call) =>
      toolCalls.some(
        (other) =>
          other !== call &&
          other.startedAt < call.startedAt + call.durationMs &&
          call.startedAt < other.startedAt + other.durationMs,
      ),
    ).length;
  }
  return { calls, savedMs };
}

function summarizeTurns(turns: UsageRunTurn[]): {
  tools: UsageRunTool[];
  restarts: UsageRunRestarts;
} {
  const tools = new Map<string, UsageRunTool>();
  const restarts: UsageRunRestarts = {
    count: 0,
    cents: 0,
    byCause: {
      "tool-lookup": { count: 0, cents: 0 },
      "prefix-changed": { count: 0, cents: 0 },
    },
  };
  for (const turn of turns) {
    if (turn.restart) {
      restarts.count += 1;
      restarts.cents += turn.restart.cents;
      restarts.byCause[turn.restart.cause].count += 1;
      restarts.byCause[turn.restart.cause].cents += turn.restart.cents;
    }
    for (const call of turn.toolCalls) {
      const tool = tools.get(call.name) ?? {
        name: call.name,
        calls: 0,
        failed: 0,
        error: null,
      };
      tool.calls += 1;
      if (call.status === "error") {
        tool.failed += 1;
        tool.error ??= call.errorMessage;
      }
      tools.set(call.name, tool);
    }
  }
  return {
    tools: [...tools.values()].sort((a, b) => b.calls - a.calls),
    restarts,
  };
}

interface RunTrace {
  status: UsageRunListItem["status"];
  durationMs: number | null;
  turns: UsageRunTurn[];
}

async function tracesByRun(runIds: string[]): Promise<Map<string, RunTrace>> {
  const traces = new Map<string, RunTrace>();
  if (runIds.length === 0) return traces;
  await ensureObservabilityTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, span_type, name, status, error_message, duration_ms,
        created_at, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens
      FROM agent_trace_spans
      WHERE run_id IN (${runIds.map(() => "?").join(", ")})
      ORDER BY created_at ASC`,
    args: runIds,
  });
  const spansByRun = new Map<string, SpanRow[]>();
  const runSpans = new Map<string, { status: string; durationMs: number }>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const runId = String(row.run_id);
    if (row.span_type === "agent_run") {
      runSpans.set(runId, {
        status: String(row.status),
        durationMs: numberField(row, "duration_ms"),
      });
      continue;
    }
    const spans = spansByRun.get(runId) ?? [];
    spans.push({
      spanType: String(row.span_type),
      name: String(row.name),
      status: String(row.status),
      errorMessage:
        typeof row.error_message === "string" ? row.error_message : null,
      durationMs: numberField(row, "duration_ms"),
      createdAt: numberField(row, "created_at"),
      tokens: tokensFromRow(row),
    });
    spansByRun.set(runId, spans);
  }
  for (const runId of runIds) {
    const run = runSpans.get(runId);
    traces.set(runId, {
      status: !run ? "unknown" : run.status === "error" ? "error" : "success",
      durationMs: run?.durationMs || null,
      turns: buildTurns(spansByRun.get(runId) ?? []),
    });
  }
  return traces;
}

async function scoresByRun(
  runIds: string[],
): Promise<Map<string, UsageRunScore[]>> {
  const scores = new Map<string, UsageRunScore[]>();
  if (runIds.length === 0) return scores;
  await ensureObservabilityTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, eval_type, criteria, score, reasoning FROM agent_evals
      WHERE run_id IN (${runIds.map(() => "?").join(", ")})
      ORDER BY created_at ASC`,
    args: runIds,
  });
  for (const row of rows as Array<Record<string, unknown>>) {
    const runId = String(row.run_id);
    const list = scores.get(runId) ?? [];
    list.push({
      source: SCORE_SOURCE[String(row.eval_type)] ?? "heuristic",
      criteria: String(row.criteria),
      score: numberField(row, "score"),
      reasoning: typeof row.reasoning === "string" ? row.reasoning : null,
    });
    scores.set(runId, list);
  }
  return scores;
}

async function feedbackByRun(
  runIds: string[],
): Promise<Map<string, "up" | "down">> {
  const feedback = new Map<string, "up" | "down">();
  if (runIds.length === 0) return feedback;
  await ensureObservabilityTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, feedback_type FROM agent_feedback
      WHERE run_id IN (${runIds.map(() => "?").join(", ")})
        AND feedback_type IN ('thumbs_up', 'thumbs_down')
      ORDER BY created_at ASC`,
    args: runIds,
  });
  // Ordered oldest first, so the latest vote wins.
  for (const row of rows as Array<Record<string, unknown>>) {
    feedback.set(
      String(row.run_id),
      row.feedback_type === "thumbs_up" ? "up" : "down",
    );
  }
  return feedback;
}

const RUN_COLUMNS = `MIN(id) AS id, MIN(created_at) AS created_at,
  MAX(owner_email) AS owner_email, MAX(app) AS app, MAX(label) AS label,
  MAX(model) AS model, MAX(thread_id) AS thread_id,
  SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
  SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_write_tokens) AS cache_write_tokens,
  SUM(cost_cents_x100) AS cost_cents_x100`;

function runListItem(
  row: Record<string, unknown>,
  cost: UsageCostBreakdown,
  trace: RunTrace | undefined,
  prompt: string | null,
  feedback: "up" | "down" | null,
): UsageRunListItem {
  const tokens = tokensFromRow(row);
  const turns = trace?.turns ?? [];
  const { tools, restarts } = summarizeTurns(turns);
  const status = trace?.status ?? "unknown";
  return {
    runId: String(row.run_id),
    createdAt: numberField(row, "created_at"),
    ownerEmail: stringField(row, "owner_email"),
    label: stringField(row, "label") || "chat",
    model: stringField(row, "model") || "unknown",
    prompt,
    status,
    tokens,
    cost,
    modelCalls: turns.length,
    tools,
    restarts,
    parallel: parallelSavings(turns),
    recoveredErrors:
      status === "success"
        ? tools.reduce((sum, tool) => sum + tool.failed, 0)
        : 0,
    durationMs: trace?.durationMs ?? null,
    feedback,
  };
}

/** Per-run spend, pricing each model's tokens at that model's rate. */
async function costsByRun(
  runIds: string[],
  scope: { where: string; args: unknown[] },
): Promise<Map<string, UsageCostBreakdown>> {
  const costs = new Map<string, UsageCostBreakdown>();
  if (runIds.length === 0) return costs;
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, model, SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(cost_cents_x100) AS cost_cents_x100
      FROM token_usage
      WHERE run_id IN (${runIds.map(() => "?").join(", ")}) AND ${scope.where}
      GROUP BY run_id, model`,
    args: [...runIds, ...scope.args],
  });
  for (const row of rows as Array<Record<string, unknown>>) {
    const runId = String(row.run_id);
    costs.set(
      runId,
      addBreakdown(costs.get(runId) ?? EMPTY_BREAKDOWN, recordedBreakdown(row)),
    );
  }
  return costs;
}

export async function getUsageInsights(
  input: {
    sinceDays?: number;
    scope?: UsageMetricsScope;
    userEmail?: string | null;
  },
  accessInput: UsageMetricsAccessInput,
): Promise<UsageInsights> {
  const sinceDays = Math.max(1, Math.min(365, input.sinceDays ?? 30));
  const sinceMs = Date.now() - sinceDays * DAY_MS;
  const previousSinceMs = sinceMs - sinceDays * DAY_MS;
  const appScope = usageAppScope(accessInput.app.trim());
  const resolved = await resolveScope(
    accessInput,
    input.scope === "workspace" ? "workspace" : "me",
    input.userEmail,
  );
  const scopeWhere = `${appScope.where} AND ${resolved.ownerScope.where}`;
  const scopeArgs = [...appScope.args, ...resolved.ownerScope.args];

  // Only prompt-linked usage, so "spent on N prompts" divides like with like.
  const period = "CASE WHEN created_at >= ? THEN 'current' ELSE 'previous' END";
  const periodWhere = `${scopeWhere} AND created_at >= ? AND run_id IS NOT NULL`;
  const periodArgs = [sinceMs, ...scopeArgs, previousSinceMs];
  const [periodRows, periodRunRows, runRows] = await Promise.all([
    getDbExec().execute({
      sql: `SELECT ${period} AS period, model,
          SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
          SUM(cache_read_tokens) AS cache_read_tokens,
          SUM(cache_write_tokens) AS cache_write_tokens,
          SUM(cost_cents_x100) AS cost_cents_x100
        FROM token_usage WHERE ${periodWhere}
        GROUP BY 1, 2`,
      args: periodArgs,
    }),
    getDbExec().execute({
      sql: `SELECT ${period} AS period, COUNT(DISTINCT run_id) AS runs
        FROM token_usage WHERE ${periodWhere}
        GROUP BY 1`,
      args: periodArgs,
    }),
    getDbExec().execute({
      sql: `SELECT run_id, ${RUN_COLUMNS}
        FROM token_usage
        WHERE ${scopeWhere} AND created_at >= ? AND run_id IS NOT NULL
        GROUP BY run_id
        ORDER BY MIN(created_at) DESC
        LIMIT ${RUN_LIMIT}`,
      args: [...scopeArgs, sinceMs],
    }),
  ]);

  const periods: Record<"current" | "previous", UsagePeriodTotals> = {
    current: { runs: 0, tokens: emptyTokens(), cost: EMPTY_BREAKDOWN },
    previous: { runs: 0, tokens: emptyTokens(), cost: EMPTY_BREAKDOWN },
  };
  for (const row of periodRows.rows as Array<Record<string, unknown>>) {
    const totals = periods[row.period === "current" ? "current" : "previous"];
    totals.tokens = addTokens(totals.tokens, tokensFromRow(row));
    totals.cost = addBreakdown(totals.cost, recordedBreakdown(row));
  }
  for (const row of periodRunRows.rows as Array<Record<string, unknown>>) {
    periods[row.period === "current" ? "current" : "previous"].runs =
      numberField(row, "runs");
  }

  const rawRuns = runRows.rows as Array<Record<string, unknown>>;
  const runIds = rawRuns.map((row) => String(row.run_id));
  const [exchanges, traces, feedback, costs] = await Promise.all([
    loadRunExchanges(rawRuns),
    tracesByRun(runIds),
    feedbackByRun(runIds),
    costsByRun(runIds, { where: scopeWhere, args: scopeArgs }),
  ]);

  return {
    sinceDays,
    current: periods.current,
    previous: periods.previous,
    runs: rawRuns.map((row) => {
      const runId = String(row.run_id);
      return runListItem(
        row,
        costs.get(runId) ?? recordedBreakdown(row),
        traces.get(runId),
        exchanges.get(runId)?.prompt ?? null,
        feedback.get(runId) ?? null,
      );
    }),
  };
}

export async function getUsageRun(
  input: {
    runId: string;
    scope?: UsageMetricsScope;
    userEmail?: string | null;
  },
  accessInput: UsageMetricsAccessInput,
): Promise<UsageRunDetail | null> {
  const appScope = usageAppScope(accessInput.app.trim());
  const resolved = await resolveScope(
    accessInput,
    input.scope === "workspace" ? "workspace" : "me",
    input.userEmail,
  );
  const { rows } = await getDbExec().execute({
    sql: `SELECT run_id, ${RUN_COLUMNS}, COUNT(*) AS row_count
      FROM token_usage
      WHERE run_id = ? AND ${appScope.where} AND ${resolved.ownerScope.where}
      GROUP BY run_id`,
    args: [input.runId, ...appScope.args, ...resolved.ownerScope.args],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  // The usage row is the access check: spans are only read for a run the
  // caller's scope can already see.
  if (!row || numberField(row, "row_count") === 0) return null;

  const runScope = {
    where: `${appScope.where} AND ${resolved.ownerScope.where}`,
    args: [...appScope.args, ...resolved.ownerScope.args],
  };
  const [exchanges, traces, scores, feedback, costs] = await Promise.all([
    loadRunExchanges([row]),
    tracesByRun([input.runId]),
    scoresByRun([input.runId]),
    feedbackByRun([input.runId]),
    costsByRun([input.runId], runScope),
  ]);
  const exchange = exchanges.get(input.runId);
  const trace = traces.get(input.runId);
  return {
    ...runListItem(
      row,
      costs.get(input.runId) ?? recordedBreakdown(row),
      trace,
      exchange?.prompt ?? null,
      feedback.get(input.runId) ?? null,
    ),
    reply: exchange?.reply ?? null,
    turns: trace?.turns ?? [],
    scores: scores.get(input.runId) ?? [],
  };
}
