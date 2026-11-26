import {
  defineAction,
  defineActionErrors,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  allowanceApprovalNotice,
  allowanceToAskAbout,
  recordReviewedAllowance,
} from "../server/lib/bigquery-agent-approval.js";
import {
  outsideAgentIdentity,
  type OutsideAgentIdentity,
} from "../server/lib/bigquery-agent-budget.js";
import {
  outsideAgentBigQueryReportSchema,
  type OutsideAgentBigQueryReport,
} from "../server/lib/bigquery-agent-calls.js";
import {
  BIGQUERY_AGENT_MAX_ROWS,
  decideBigQueryAgentQuery,
  planBigQueryAgentQuery,
  releaseBigQueryAgentDecision,
  runBigQueryAgentQuery,
  startBigQueryAgentDeadline,
  withinBigQueryAgentDeadline,
  type BigQueryAgentDecision,
  type BigQueryAgentFailureCode,
} from "../server/lib/bigquery-agent-runner.js";
import { BIGQUERY_AGENT_SQL_POLICY_VERSION } from "../server/lib/bigquery-agent-sql-policy.js";

const NAME = "query-warehouse";
const SQL_MAX_CHARS = 100_000;

const errors = defineActionErrors(
  "query_statement_not_allowed",
  "query_table_not_allowed",
  "query_feature_not_allowed",
  "query_invalid",
  "query_bytes_cap_exceeded",
  "query_row_too_large",
  "query_timeout",
  "query_quota_exceeded",
  "query_failed",
  "job_outcome_unknown",
  "execution_record_unavailable",
  "approval_required",
  "budget_exhausted",
  "budget_required",
  "budget_unavailable",
  "admission_expired",
  "over_job_cap",
  "estimate_unavailable",
  "unauthenticated",
);

const STATUS_FOR: Record<BigQueryAgentFailureCode, number> = {
  query_statement_not_allowed: 422,
  query_table_not_allowed: 403,
  query_feature_not_allowed: 422,
  query_invalid: 400,
  query_bytes_cap_exceeded: 422,
  query_row_too_large: 422,
  query_timeout: 504,
  query_quota_exceeded: 429,
  query_failed: 502,
  job_outcome_unknown: 502,
  execution_record_unavailable: 503,
  approval_required: 429,
  budget_exhausted: 429,
  budget_required: 403,
  budget_unavailable: 503,
  admission_expired: 503,
  over_job_cap: 422,
  estimate_unavailable: 503,
};

const columnSchema = z.object({ name: z.string(), type: z.string() });

const resultFields = {
  executedSql: z.string(),
  referencedTables: z.array(z.string()),
  bytesProcessed: z.number().nullable(),
  rowCount: z.number(),
  truncated: z.boolean(),
  truncation: z.enum(["rows", "bytes"]).nullable(),
  columns: z.array(columnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  location: z.string().nullable(),
  policyVersion: z.string(),
  bigQueryBudget: outsideAgentBigQueryReportSchema,
};

const outputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["ok", "empty"]),
    ...resultFields,
    jobId: z.string(),
  }),
  z.object({
    status: z.literal("estimated"),
    ...resultFields,
    jobId: z.null(),
    estimate: z.object({
      estimatedUsd: z.number().nullable(),
      reservedUsd: z.number(),
      budgetCheck: z
        .object({
          code: z.enum(["approval_required", "budget_exhausted"]),
          scope: z.enum(["person", "org"]),
        })
        .nullable(),
    }),
  }),
]);

interface HeldDecision {
  readonly decision: BigQueryAgentDecision;
  readonly statement: string;
  taken: boolean;
  released: boolean;
}

const held = new WeakMap<object, HeldDecision>();

function requestIdentity(): OutsideAgentIdentity | null {
  const userEmail = getRequestUserEmail();
  return userEmail ? outsideAgentIdentity(userEmail, getRequestOrgId()) : null;
}

function release(entry: HeldDecision): void {
  if (entry.taken || entry.released) return;
  entry.released = true;
  void releaseBigQueryAgentDecision(entry.decision);
}

function hold(statement: string, decision: BigQueryAgentDecision): void {
  const invocation = getRequestContext();
  const entry: HeldDecision = {
    decision,
    statement,
    taken: false,
    released: false,
  };
  if (!invocation) {
    release(entry);
    return;
  }
  const previous = held.get(invocation);
  if (previous) release(previous);
  held.set(invocation, entry);
  if (decision.deadline.signal.aborted) release(entry);
  else {
    decision.deadline.signal.addEventListener("abort", () => release(entry), {
      once: true,
    });
  }
}

function take(statement: string): BigQueryAgentDecision | undefined {
  const invocation = getRequestContext();
  const entry = invocation ? held.get(invocation) : undefined;
  if (!invocation || !entry || entry.taken) return undefined;
  held.delete(invocation);
  if (entry.statement !== statement) {
    release(entry);
    return undefined;
  }
  entry.taken = true;
  return entry.decision;
}

function failWith(
  code: BigQueryAgentFailureCode,
  message: string,
  report: OutsideAgentBigQueryReport | undefined,
  jobId: string | null,
): never {
  return errors.fail(message, code, {
    statusCode: STATUS_FOR[code],
    details: {
      ...(report ? { bigQueryBudget: report } : {}),
      policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
      ...(jobId ? { jobId } : {}),
    },
  });
}

// raw-sql-ok: the agent writes this SELECT; the bounded runner's lexer policy and dry run decide what it may read.
const inputSchema = z.object({
  sql: z
    .string()
    .min(1)
    .max(SQL_MAX_CHARS)
    .describe(
      "Exactly one BigQuery Standard SQL SELECT (WITH allowed) over fully qualified project.dataset.table names; quote a dashed project in backticks or write @project.",
    ),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Validate and estimate the cost without running the query or billing anything.",
    ),
  maxRows: z.coerce
    .number()
    .int()
    .min(1)
    .max(BIGQUERY_AGENT_MAX_ROWS)
    .optional()
    .describe(
      `Fewest rows you need, at most ${BIGQUERY_AGENT_MAX_ROWS.toLocaleString("en-US")} (the default).`,
    ),
});

export default defineAction({
  description: `Run one read-only BigQuery SELECT you write against Analytics' reviewed warehouse datasets, and get its rows. Prefer saved definitions and dashboards first, and use search-warehouse-schema for exact table and column names. Write an aggregate (GROUP BY, COUNT, SUM) rather than pulling raw rows: results stop at ${BIGQUERY_AGENT_MAX_ROWS.toLocaleString("en-US")} rows or about 1 MB, and truncated says when they did; a first row bigger than 1 MB fails with query_row_too_large. Name every table as project.dataset.table: a project with a dash needs backticks (\`builder-3b0a2.dbt_mart.users\` or \`builder-3b0a2\`.dbt_mart.users) or @project, this connection's project (@project.dbt_mart.users); a bare builder-3b0a2.dbt_mart.users is refused. INFORMATION_SCHEMA, wildcard tables, TABLESAMPLE, external and BigLake tables, unreviewed views, scripts, DML, DDL, parameters and user-defined, remote, ML, AI, OBJ, KEYS, AEAD, APPENDS and CHANGES functions are refused. Numbers: an INT64 is a JSON number only within ±9007199254740991 (2^53−1); a NUMERIC or BIGNUMERIC is a JSON number only when that number's shortest text is exactly BigQuery's decimal text and, if whole, within the same range; anything else comes back as its exact decimal string. FLOAT64 is a number, except NaN and ±Infinity, which come back as strings. dryRun: true validates and estimates the cost without running or billing. Each run is one BigQuery job capped at 50 GB and counted against your daily outside-agent BigQuery budget, by default $1 a person without asking, a $5 person ceiling and $50 an organization per UTC day; an Analytics admin can change these, and bigQueryBudget.today shows the limits in effect for you (noAskAllowanceUsd, ceilingUsd, org.limitUsd, limitsSource). Past the no-ask allowance the call asks you once. status is "ok" with rows, "empty" when the query matched nothing, or "estimated" for a dry run; bigQueryBudget reports this call's cost and what is left today. Refusals and failures throw a typed code (query_statement_not_allowed, query_table_not_allowed, query_feature_not_allowed, query_invalid, query_bytes_cap_exceeded, query_row_too_large, query_timeout, query_quota_exceeded, or a budget code such as approval_required or budget_exhausted) and never return partial rows; on query_timeout or job_outcome_unknown the job may still finish, so do not resend the same query unless the message says the job was not sent.`,
  schema: inputSchema,
  outputSchema,
  errors,
  mcpOutputSchema: true,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: {
    expose: false,
    readOnly: true,
    requiresAuth: true,
    allowRawQueryInput: true,
  },
  mcpNeedsApproval: async (args) => {
    if (args.dryRun) return false;
    if (!requestIdentity()) return false;
    try {
      // raw-sql-ok: the caller's SELECT goes only to the bounded runner, whose lexer policy and dry run decide what it may read.
      const decision = await decideBigQueryAgentQuery({
        sql: args.sql,
        source: NAME,
        caller: "mcp",
        askVia: NAME,
        deadline: startBigQueryAgentDeadline(),
      });
      hold(args.sql, decision);
      return decision.needsApproval;
    } catch {
      // coercion-ok: a throw would ask; run decides again and refuses with its own typed code.
      return false;
    }
  },
  approvalNotice: async (args, ctx) => {
    const decision = take(args.sql);
    if (decision?.status === "refused") {
      return failWith(decision.code, decision.message, decision.report, null);
    }
    if (decision?.status === "admitted") {
      await releaseBigQueryAgentDecision(decision);
    }
    const deadline = decision?.deadline ?? startBigQueryAgentDeadline();
    let reservedBytes: number;
    if (decision?.status === "ask") {
      reservedBytes = decision.reservedBytes;
    } else {
      const plan = await planBigQueryAgentQuery(args.sql, { deadline });
      if (plan.status === "refused") {
        return failWith(plan.code, plan.message, undefined, null);
      }
      reservedBytes = plan.reservedBytes;
    }
    let budget;
    try {
      budget = await withinBigQueryAgentDeadline(
        allowanceToAskAbout(ctx, reservedBytes, async () => true),
        deadline.signal,
      );
    } catch (error) {
      if (!deadline.signal.aborted) throw error;
      return failWith(
        "query_timeout",
        "The budget read for this approval question did not finish before the call's deadline, so nothing was asked, nothing ran and nothing was charged. Ask again.",
        undefined,
        null,
      );
    }
    return allowanceApprovalNotice(budget, reservedBytes);
  },
  approvalProof: "review-page",
  run: async (args, context?: ActionRunContext) => {
    const identity = requestIdentity();
    if (!identity) {
      return errors.fail("Sign in to use this action.", "unauthenticated", {
        statusCode: 401,
      });
    }
    const caller = context?.caller ?? "unknown";
    const decided = args.dryRun ? undefined : take(args.sql);
    // raw-sql-ok: the caller's SELECT goes only to the bounded runner, whose lexer policy and dry run decide what it may read.
    const result = await runBigQueryAgentQuery({
      sql: args.sql,
      source: NAME,
      caller,
      ...(caller === "mcp" ? { askVia: NAME } : {}),
      estimateOnly: args.dryRun,
      ...(decided ? { decided } : {}),
      ...(args.dryRun
        ? {}
        : { beforeAdmission: () => recordReviewedAllowance(identity) }),
      ...(args.maxRows !== undefined ? { maxRows: args.maxRows } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    switch (result.status) {
      case "completed":
        return {
          status: result.rowCount === 0 ? ("empty" as const) : ("ok" as const),
          executedSql: result.executedSql,
          referencedTables: result.referencedTables,
          bytesProcessed: result.bytesProcessed,
          rowCount: result.rowCount,
          truncated: result.truncated,
          truncation: result.truncation,
          columns: result.schema,
          rows: result.rows,
          jobId: result.jobId,
          location: result.location,
          policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
          bigQueryBudget: result.report,
        };
      case "ready":
        return {
          status: "estimated" as const,
          executedSql: result.executedSql,
          referencedTables: result.referencedTables,
          bytesProcessed: result.bytesProcessed,
          rowCount: 0,
          truncated: false,
          truncation: null,
          columns: result.schema,
          rows: [],
          jobId: null,
          location: result.location,
          policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
          bigQueryBudget: result.report,
          estimate: {
            estimatedUsd: result.cost.estimatedUsd,
            reservedUsd: result.cost.reservedUsd,
            budgetCheck: result.budgetCheck,
          },
        };
      case "refused":
        return failWith(result.code, result.message, result.report, null);
      case "failed":
      case "uncertain":
        return failWith(
          result.code,
          result.message,
          result.report,
          result.jobId,
        );
    }
  },
});
