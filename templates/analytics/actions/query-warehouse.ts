import {
  defineAction,
  defineActionErrors,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  allowanceApprovalNotice,
  allowanceBudget,
  allowanceToAskAbout,
  needsAllowanceApprovalWithin,
  recordReviewedAllowance,
} from "../server/lib/bigquery-agent-approval.js";
import {
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  outsideAgentIdentity,
} from "../server/lib/bigquery-agent-budget.js";
import {
  outsideAgentBigQueryReportSchema,
  type OutsideAgentBigQueryReport,
} from "../server/lib/bigquery-agent-calls.js";
import {
  BIGQUERY_AGENT_MAX_ROWS,
  planBigQueryAgentQuery,
  runBigQueryAgentQuery,
  type BigQueryAgentFailureCode,
} from "../server/lib/bigquery-agent-runner.js";
import { BIGQUERY_AGENT_SQL_POLICY_VERSION } from "../server/lib/bigquery-agent-sql-policy.js";
import { MIN_BILLED_BYTES_PER_QUERY } from "../server/lib/bigquery-pricing.js";

const NAME = "query-warehouse";
const SQL_MAX_CHARS = 100_000;

const errors = defineActionErrors(
  "query_statement_not_allowed",
  "query_table_not_allowed",
  "query_feature_not_allowed",
  "query_invalid",
  "query_bytes_cap_exceeded",
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

async function plannedReservation(sql: string): Promise<number | null> {
  const plan = await planBigQueryAgentQuery(sql, {
    signal: AbortSignal.timeout(10_000),
  });
  return plan.status === "planned" ? plan.reservedBytes : null;
}

function failWith(
  code: BigQueryAgentFailureCode,
  message: string,
  report: OutsideAgentBigQueryReport,
  jobId: string | null,
): never {
  return errors.fail(message, code, {
    statusCode: STATUS_FOR[code],
    details: {
      bigQueryBudget: report,
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
      "Exactly one BigQuery Standard SQL SELECT (WITH allowed) over fully qualified project.dataset.table names.",
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
  description: `Run one read-only BigQuery SELECT you write against Analytics' reviewed warehouse datasets, and get its rows. Prefer saved definitions and dashboards first, and use search-warehouse-schema for exact table and column names. Write an aggregate (GROUP BY, COUNT, SUM) rather than pulling raw rows: results stop at ${BIGQUERY_AGENT_MAX_ROWS.toLocaleString("en-US")} rows or about 1 MB, and truncated says when they did. Name every table as project.dataset.table (@project is this connection's project, e.g. @project.dbt_mart.users); INFORMATION_SCHEMA, wildcard tables, external tables, unreviewed views, scripts, DML, DDL, parameters and user-defined, remote, ML, APPENDS and CHANGES functions are refused. dryRun: true validates and estimates the cost without running or billing. Each run is one BigQuery job capped at 50 GB and counted against your daily outside-agent BigQuery budget ($1 a person without asking, a $5 person ceiling, $50 an organization, per UTC day); past $1 the call asks you once. status is "ok" with rows, "empty" when the query matched nothing, or "estimated" for a dry run; bigQueryBudget reports this call's cost and what is left today. Refusals and failures throw a typed code (query_statement_not_allowed, query_table_not_allowed, query_feature_not_allowed, query_invalid, query_bytes_cap_exceeded, query_timeout, query_quota_exceeded, or a budget code such as approval_required or budget_exhausted) and never return partial rows; on query_timeout or job_outcome_unknown the job may still finish, so do not resend the same query.`,
  schema: inputSchema,
  outputSchema,
  errors,
  mcpOutputSchema: true,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    allowRawQueryInput: true,
  },
  mcpNeedsApproval: async (args, ctx) => {
    if (args.dryRun) return false;
    const read = await allowanceBudget(ctx);
    return (
      read !== null &&
      (await needsAllowanceApprovalWithin(
        read.budget,
        {
          minBytes: MIN_BILLED_BYTES_PER_QUERY,
          maxBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
        },
        () => plannedReservation(args.sql),
      ))
    );
  },
  approvalNotice: async (args, ctx) => {
    const planned = await plannedReservation(args.sql);
    const budget = await allowanceToAskAbout(
      ctx,
      planned ?? MIN_BILLED_BYTES_PER_QUERY,
      async () => true,
    );
    return allowanceApprovalNotice(
      budget,
      planned ?? OUTSIDE_AGENT_JOB_CAP_BYTES,
    );
  },
  approvalProof: "review-page",
  run: async (args, context?: ActionRunContext) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      return errors.fail("Sign in to use this action.", "unauthenticated", {
        statusCode: 401,
      });
    }
    const identity = outsideAgentIdentity(userEmail, getRequestOrgId());
    if (!args.dryRun) await recordReviewedAllowance(identity);
    const caller = context?.caller ?? "unknown";
    // raw-sql-ok: the caller's SELECT goes only to the bounded runner, whose lexer policy and dry run decide what it may read.
    const result = await runBigQueryAgentQuery({
      sql: args.sql,
      source: NAME,
      caller,
      ...(caller === "mcp" ? { askVia: NAME } : {}),
      estimateOnly: args.dryRun,
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
