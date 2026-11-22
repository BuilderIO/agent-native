import { createHash, randomUUID } from "node:crypto";

import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

import {
  BigQueryAgentBudgetUnavailableError,
  budgetRefusalFor,
  describeBigQueryAgentBudget,
  formatUsd,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  outsideAgentIdentity,
  readBigQueryAgentBudget,
  usd,
  writeBigQueryAgentExecutionRecord,
} from "./bigquery-agent-budget.js";
import {
  createOutsideAgentBigQueryCall,
  outsideAgentBigQueryReport,
  outsideAgentRefusalReport,
  type OutsideAgentBigQueryCall,
  type OutsideAgentBigQueryReport,
} from "./bigquery-agent-calls.js";
import {
  admissionLapsed,
  conservativeBillableEstimate,
  OutsideAgentBigQueryRefusalError,
  refusalMessage,
  reservationForEstimate,
  type BigQueryBillableEstimate,
  type OutsideAgentBigQueryAdmission,
  type OutsideAgentBigQueryRefusalCode,
} from "./bigquery-agent-context.js";
import {
  BIGQUERY_AGENT_SQL_POLICY_VERSION,
  BigQueryAgentSqlRefusal,
  bigQueryTableKey,
  checkBigQueryAgentSql,
  checkBigQueryAgentTableKind,
  crossCheckBigQueryAgentDryRun,
  type BigQueryAgentTableRef,
} from "./bigquery-agent-sql-policy.js";
import {
  finalizeBigQueryJobUsage,
  newBigQueryJobUsage,
  persistBigQueryJobUsage,
  readBigQueryJobBilling,
  withBigQueryUsageAttribution,
} from "./bigquery-usage.js";
import {
  BigQueryMetadataError,
  createBigQueryAgentReconciler,
  dryRunFrozenQuery,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
  runBoundedBigQueryJob,
  type BoundedBigQueryJobOutcome,
  type FrozenBigQueryAccess,
} from "./bigquery.js";
import {
  credentialCacheScope,
  requireRequestCredentialContext,
  type CredentialContext,
} from "./credentials-context.js";
import { getBigQueryAccess } from "./gcloud.js";

export const BIGQUERY_AGENT_MAX_ROWS = 5_000;
export const BIGQUERY_AGENT_MAX_RESULT_BYTES = 1_000_000;
export const BIGQUERY_AGENT_DEFAULT_DEADLINE_MS = 22_000;
const PLAN_DEADLINE_MS = 10_000;
const MAX_TABLES = 20;
const SETTLEMENT_TIMEOUT_MS = 1_500;
const LEASE_MARGIN_MS = 60_000;
const JOB_LABELS = { agent_native_workload: "outside-agent-query" };

export type BigQueryAgentQueryCode =
  | OutsideAgentBigQueryRefusalCode
  | "ready"
  | "query_statement_not_allowed"
  | "query_table_not_allowed"
  | "query_feature_not_allowed"
  | "query_invalid"
  | "query_bytes_cap_exceeded"
  | "query_timeout"
  | "query_quota_exceeded"
  | "query_failed"
  | "job_outcome_unknown"
  | "execution_record_unavailable";

export type BigQueryAgentFailureCode = Exclude<BigQueryAgentQueryCode, "ready">;

export interface BigQueryAgentQueryCost {
  estimatedBytes: number | null;
  estimatedUsd: number | null;
  reservedBytes: number;
  reservedUsd: number;
  billedBytes: number | null;
  billedUsd: number | null;
  providerCacheHit: boolean | null;
}

type EstimatedCost = Pick<
  BigQueryAgentQueryCost,
  "estimatedBytes" | "estimatedUsd" | "reservedBytes" | "reservedUsd"
>;

export type BigQueryAgentQueryResult =
  | {
      status: "completed";
      code: "ready";
      jobId: string;
      projectId: string;
      location: string | null;
      executedSql: string;
      referencedTables: string[];
      rows: Record<string, unknown>[];
      schema: { name: string; type: string }[];
      rowCount: number;
      truncated: boolean;
      truncation: "rows" | "bytes" | null;
      bytesProcessed: number | null;
      cost: BigQueryAgentQueryCost;
      report: OutsideAgentBigQueryReport;
    }
  | {
      status: "ready";
      code: "ready";
      executedSql: string;
      referencedTables: string[];
      bytesProcessed: number | null;
      location: string | null;
      schema: { name: string; type: string }[];
      cost: EstimatedCost;
      budgetCheck: {
        code: "approval_required" | "budget_exhausted";
        scope: "person" | "org";
      } | null;
      report: OutsideAgentBigQueryReport;
      message: string;
    }
  | {
      status: "refused";
      code: BigQueryAgentFailureCode;
      message: string;
      report: OutsideAgentBigQueryReport;
      cost?: EstimatedCost;
    }
  | {
      status: "failed";
      code: BigQueryAgentFailureCode;
      message: string;
      jobId: string | null;
      cost: BigQueryAgentQueryCost | null;
      report: OutsideAgentBigQueryReport;
    }
  | {
      status: "uncertain";
      code: "query_timeout" | "job_outcome_unknown";
      message: string;
      jobId: string;
      cost: BigQueryAgentQueryCost;
      report: OutsideAgentBigQueryReport;
    };

export interface BigQueryAgentQueryInput {
  sql: string;
  source: string;
  caller?: string;
  askVia?: string;
  estimateOnly?: boolean;
  deadlineMs?: number;
  signal?: AbortSignal;
  maxRows?: number;
  maxResultBytes?: number;
}

export type BigQueryAgentQueryPlan =
  | { status: "planned"; estimatedBytes: number | null; reservedBytes: number }
  | { status: "refused"; code: BigQueryAgentFailureCode; message: string };

interface FrozenQuery {
  readonly credentialContext: CredentialContext;
  readonly access: FrozenBigQueryAccess;
  readonly credentialScope: string;
  readonly credentialFingerprint: string | null;
  readonly sql: string;
  readonly tables: readonly BigQueryAgentTableRef[];
  readonly schema: { name: string; type: string }[];
  readonly estimate: Exclude<
    BigQueryBillableEstimate,
    { status: "unavailable" }
  >;
  readonly estimatedBytes: number | null;
  readonly dryRunBytes: number | null;
  readonly reservedBytes: number;
}

interface RecordState {
  projectId: string | null;
  location: string | null;
  jobId: string | null;
  bytesProcessed: number | null;
  estimatedBytes: number | null;
  reservedBytes: number | null;
  billedBytes: number | null;
  providerCacheHit: boolean | null;
  rowCount: number | null;
  truncated: boolean;
  cancelled: boolean;
}

class QueryRefusal extends Error {
  readonly code: BigQueryAgentFailureCode;
  constructor(code: BigQueryAgentFailureCode, message: string) {
    super(message);
    this.name = "QueryRefusal";
    this.code = code;
  }
}

function abortError(): Error {
  return new DOMException(
    "BigQuery agent query deadline exceeded",
    "AbortError",
  );
}

function deadlineSignal(deadlineMs: number, signal?: AbortSignal) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)])
    : AbortSignal.timeout(deadlineMs);
}

function estimatedCost(record: {
  estimatedBytes: number | null;
  reservedBytes: number;
}): EstimatedCost {
  return {
    estimatedBytes: record.estimatedBytes,
    estimatedUsd:
      record.estimatedBytes === null ? null : usd(record.estimatedBytes),
    reservedBytes: record.reservedBytes,
    reservedUsd: usd(record.reservedBytes),
  };
}

async function freezeQuery(
  sql: string,
  deadline: AbortSignal,
  record: RecordState,
): Promise<FrozenQuery> {
  const credentialContext = requireRequestCredentialContext(
    "BIGQUERY_PROJECT_ID",
  );
  const projectId = await getBigQueryProjectId(deadline);
  record.projectId = projectId;
  const checked = checkBigQueryAgentSql(sql, projectId);
  if (checked.tables.length > MAX_TABLES) {
    throw new QueryRefusal(
      "query_feature_not_allowed",
      `Queries may read at most ${MAX_TABLES} tables. Split the question into smaller queries.`,
    );
  }
  const credentialScope = credentialCacheScope(
    "BIGQUERY_PROJECT_ID",
    credentialContext,
  );
  const { token, principal } = await getBigQueryAccess({
    signal: deadline,
    projectId,
  });
  if (deadline.aborted) throw abortError();
  const tables = await Promise.all(
    checked.tables.map(async (ref) => ({
      ref,
      metadata: await getBigQueryTableMetadata(ref, deadline, { token }),
    })),
  );
  let location: string | null = null;
  for (const { ref, metadata } of tables) {
    checkBigQueryAgentTableKind(ref, metadata.type);
    const at = metadata.location;
    if (typeof at !== "string" || !at) {
      throw new QueryRefusal(
        "query_table_not_allowed",
        `BigQuery gave no location for \`${bigQueryTableKey(ref)}\`, so it could not be checked and was not run.`,
      );
    }
    if (location !== null && location.toLowerCase() !== at.toLowerCase()) {
      throw new QueryRefusal(
        "query_invalid",
        `This query reads tables in two BigQuery locations (${location} and ${at}), which one query can't join. Nothing ran.`,
      );
    }
    location ??= at;
  }
  record.location = location;
  const access: FrozenBigQueryAccess = Object.freeze({
    projectId,
    location,
    token,
  });
  const dryRun = await dryRunFrozenQuery(access, checked.sql, deadline);
  if (dryRun.error !== null) {
    const status = dryRun.status ?? 0;
    if (dryRun.timedOut || status === 401 || status === 429 || status >= 500) {
      throw new QueryRefusal(
        "estimate_unavailable",
        "BigQuery could not estimate this query's cost, so nothing ran and nothing was charged. Try again in a few minutes.",
      );
    }
    throw new QueryRefusal(
      "query_invalid",
      `BigQuery rejected the SQL: ${dryRun.error.slice(0, 1_000)} Fix the query before running it.`,
    );
  }
  crossCheckBigQueryAgentDryRun(checked, dryRun);
  const estimate = conservativeBillableEstimate(dryRun);
  if (estimate.status === "unavailable") {
    throw new QueryRefusal(
      "estimate_unavailable",
      "BigQuery's dry run returned no usable byte estimate, so nothing ran and nothing was charged. Try again in a few minutes, or narrow the query.",
    );
  }
  const estimatedBytes = estimate.status === "ok" ? estimate.bytes : null;
  record.estimatedBytes = estimatedBytes;
  if (estimatedBytes !== null && estimatedBytes > OUTSIDE_AGENT_JOB_CAP_BYTES) {
    throw new QueryRefusal(
      "over_job_cap",
      `This query would bill about ${formatUsd(estimatedBytes)}, over the ${formatUsd(OUTSIDE_AGENT_JOB_CAP_BYTES)} (50 GB) per-job limit for outside agents, so it was not run. Narrow the date range or select fewer columns.`,
    );
  }
  const reservedBytes =
    estimatedBytes === null
      ? OUTSIDE_AGENT_JOB_CAP_BYTES
      : reservationForEstimate(estimatedBytes, OUTSIDE_AGENT_JOB_CAP_BYTES);
  record.reservedBytes = reservedBytes;
  const dryRunBytes =
    typeof dryRun.exactBytesProcessed === "number"
      ? dryRun.exactBytesProcessed
      : null;
  // raw-sql-ok: the agent's own SELECT, frozen only after the SQL policy, table kinds and dry-run cross-check accepted this exact text.
  return Object.freeze({
    credentialContext,
    access,
    credentialScope,
    credentialFingerprint: principal,
    sql: checked.sql,
    tables: Object.freeze([...checked.tables]),
    schema: dryRun.schema ?? [],
    estimate,
    estimatedBytes,
    dryRunBytes,
    reservedBytes,
  });
}

function refusalOf(
  error: unknown,
  deadline: AbortSignal,
): { code: BigQueryAgentFailureCode; message: string } {
  if (
    error instanceof QueryRefusal ||
    error instanceof BigQueryAgentSqlRefusal
  ) {
    return { code: error.code, message: error.message };
  }
  if (deadline.aborted) {
    return {
      code: "query_timeout",
      message:
        "The query's checks did not finish before its deadline, so nothing ran and nothing was charged. Narrow the query and ask again.",
    };
  }
  if (
    error instanceof BigQueryMetadataError &&
    (error.status === 403 || error.status === 404)
  ) {
    return {
      code: "query_invalid",
      message:
        "A table this query names does not exist or is not visible to this connection, so nothing ran. Check the table name with search-warehouse-schema.",
    };
  }
  console.error("[bigquery-agent] Query checks failed", {
    errorType: error instanceof Error ? error.name : "non_error",
  });
  return {
    code: "estimate_unavailable",
    message:
      "The query's checks could not finish (credentials, table metadata, or the dry run failed), so nothing ran and nothing was charged.",
  };
}

function emptyRecord(): RecordState {
  return {
    projectId: null,
    location: null,
    jobId: null,
    bytesProcessed: null,
    estimatedBytes: null,
    reservedBytes: null,
    billedBytes: null,
    providerCacheHit: null,
    rowCount: null,
    truncated: false,
    cancelled: false,
  };
}

export async function planBigQueryAgentQuery(
  sql: string,
  options: { signal?: AbortSignal; deadlineMs?: number } = {},
): Promise<BigQueryAgentQueryPlan> {
  const deadline = deadlineSignal(
    options.deadlineMs ?? PLAN_DEADLINE_MS,
    options.signal,
  );
  try {
    const frozen = await freezeQuery(sql, deadline, emptyRecord());
    return {
      status: "planned",
      estimatedBytes: frozen.estimatedBytes,
      reservedBytes: frozen.reservedBytes,
    };
  } catch (error) {
    return { status: "refused", ...refusalOf(error, deadline) };
  }
}

export async function runBigQueryAgentQuery(
  input: BigQueryAgentQueryInput,
): Promise<BigQueryAgentQueryResult> {
  const startedAt = new Date();
  const deadlineMs = Math.min(
    input.deadlineMs ?? BIGQUERY_AGENT_DEFAULT_DEADLINE_MS,
    BIGQUERY_AGENT_DEFAULT_DEADLINE_MS,
  );
  const deadline = deadlineSignal(deadlineMs, input.signal);
  const identity = outsideAgentIdentity(
    getRequestUserEmail(),
    getRequestOrgId(),
  );
  const call = createOutsideAgentBigQueryCall({
    identity,
    source: input.source,
    reservation: "dry-run",
    leaseMs: deadlineMs + LEASE_MARGIN_MS,
    ...(input.askVia ? { askVia: input.askVia } : {}),
  });
  const queryHash = createHash("sha256").update(input.sql).digest("hex");
  const record = emptyRecord();
  const finish = async (
    result: BigQueryAgentQueryResult,
  ): Promise<BigQueryAgentQueryResult> => {
    try {
      await writeBigQueryAgentExecutionRecord({
        id: randomUUID(),
        ownerEmail: identity.ownerEmail,
        orgId: identity.orgId,
        caller: input.caller ?? "mcp",
        source: input.source,
        policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
        queryHash,
        ...record,
        status: result.status,
        code: result.code,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      });
    } catch {
      // coercion-ok: an ungoverned run returns no rows; this typed failure says why.
      console.error("[bigquery-agent] Execution record not written", {
        source: input.source,
        jobId: record.jobId,
      });
      return {
        status: "failed",
        code: "execution_record_unavailable",
        message:
          "The query's governance record could not be saved, so its results are withheld. " +
          (record.jobId
            ? `BigQuery job ${record.jobId} ran; do not resubmit it. Try a new query later.`
            : "Nothing ran. Try again later."),
        jobId: record.jobId,
        cost:
          "cost" in result && result.cost && "billedBytes" in result.cost
            ? result.cost
            : null,
        report: result.report,
      };
    }
    return result;
  };
  const refused = async (
    code: BigQueryAgentFailureCode,
    message: string,
    report?: OutsideAgentBigQueryReport,
  ) =>
    finish({
      status: "refused",
      code,
      message,
      report: report ?? (await call.report()),
      ...(record.reservedBytes !== null
        ? {
            cost: estimatedCost({
              estimatedBytes: record.estimatedBytes,
              reservedBytes: record.reservedBytes,
            }),
          }
        : {}),
    });

  let frozen: FrozenQuery;
  try {
    frozen = await freezeQuery(input.sql, deadline, record);
  } catch (error) {
    const refusal = refusalOf(error, deadline);
    return refused(refusal.code, refusal.message);
  }
  const { projectId, location, token } = frozen.access;
  const reconciler = createBigQueryAgentReconciler(token, {
    credentialScope: frozen.credentialScope,
    credentialFingerprint: frozen.credentialFingerprint,
  });
  const executed = {
    executedSql: frozen.sql,
    referencedTables: frozen.tables.map(bigQueryTableKey),
  };

  if (input.estimateOnly) {
    let budget;
    try {
      budget = await readBigQueryAgentBudget(identity, {
        reconcile: reconciler,
      });
    } catch (error) {
      if (error instanceof BigQueryAgentBudgetUnavailableError) {
        return refused(
          "budget_unavailable",
          refusalMessage({ code: "budget_unavailable" }),
        );
      }
      throw error;
    }
    const check = budgetRefusalFor(budget, frozen.reservedBytes);
    return finish({
      status: "ready",
      code: "ready",
      ...executed,
      bytesProcessed: frozen.dryRunBytes,
      location,
      schema: frozen.schema,
      cost: estimatedCost(frozen),
      budgetCheck:
        check && check.code !== "over_job_cap"
          ? { code: check.code, scope: check.scope }
          : null,
      report: outsideAgentBigQueryReport(
        call.gate.summary(),
        describeBigQueryAgentBudget(budget),
      ),
      message: `Estimated ${frozen.estimatedBytes === null ? `up to ${formatUsd(frozen.reservedBytes)}` : formatUsd(frozen.estimatedBytes)}; ${formatUsd(budget.person.remainingBytes)} of your day and ${formatUsd(budget.org.remainingBytes)} of your organization's are left. Nothing ran.`,
    });
  }

  const jobId = `agent_native_mcp_${randomUUID().replace(/-/g, "")}`;
  let admission: OutsideAgentBigQueryAdmission;
  try {
    admission = await call.gate.admit({
      projectId,
      jobId,
      credentialScope: frozen.credentialScope,
      credentialFingerprint: frozen.credentialFingerprint,
      exclusive: true,
      capBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
      estimate: async () => frozen.estimate,
      reconciler,
    });
  } catch (error) {
    if (error instanceof OutsideAgentBigQueryRefusalError) {
      return refused(
        error.code,
        error.message,
        outsideAgentRefusalReport(error),
      );
    }
    throw error;
  }
  record.reservedBytes = admission.reservedBytes;
  if (deadline.aborted || admissionLapsed(admission)) {
    await call.gate.rejected(admission);
    return refused(
      "query_timeout",
      "The query's deadline passed before its job was sent, so nothing ran and nothing was charged. Ask again.",
    );
  }
  record.jobId = jobId;

  const usage = withBigQueryUsageAttribution(
    { workload: "outside-agent-query" },
    () => newBigQueryJobUsage(projectId, jobId, frozen.credentialContext),
  );
  usage.location = location ?? undefined;
  const usageRecorded = await persistBigQueryJobUsage(usage);

  let outcome: BoundedBigQueryJobOutcome;
  try {
    // raw-sql-ok: the agent's own SELECT, run only after the SQL policy, table kinds and dry-run cross-check accepted this exact text.
    outcome = await runBoundedBigQueryJob({
      projectId,
      jobId,
      location,
      sql: frozen.sql,
      maximumBytesBilled: admission.reservedBytes,
      token,
      signal: deadline,
      maxRows: input.maxRows ?? BIGQUERY_AGENT_MAX_ROWS,
      maxResultBytes: input.maxResultBytes ?? BIGQUERY_AGENT_MAX_RESULT_BYTES,
      submitBy: admission.submitBy,
      labels: JOB_LABELS,
    });
  } catch {
    // coercion-ok: an unexpected failure mid-job is an unknown outcome, reported as one.
    outcome = {
      status: "uncertain",
      reason: "submission_unknown",
      location: location ?? undefined,
      cancelRequested: false,
    };
  }
  const jobLocation =
    (outcome.status !== "rejected" ? outcome.location : undefined) ??
    location ??
    undefined;
  record.location = jobLocation ?? null;
  usage.location = jobLocation;
  usage.submissionState =
    outcome.status === "rejected"
      ? "rejected"
      : outcome.status === "uncertain"
        ? "unknown"
        : "accepted";
  await finalizeBigQueryJobUsage(usage, token, usageRecorded);

  if (outcome.status === "rejected") {
    await call.gate.rejected(admission);
    return finish({
      status: "failed",
      code: outcome.code,
      message: `BigQuery refused the job before it ran, so nothing was charged: ${outcome.message.slice(0, 1_000)}`,
      jobId,
      cost: jobCost(call, frozen, admission),
      report: await call.report(),
    });
  }
  if (outcome.status === "uncertain") {
    record.cancelled = outcome.cancelRequested;
    await call.gate.submitted(admission, "unknown", jobLocation);
    return finish({
      status: "uncertain",
      code:
        outcome.reason === "timeout" ? "query_timeout" : "job_outcome_unknown",
      message: `BigQuery job ${jobId} may still be running${outcome.cancelRequested ? " (a cancel was requested)" : ""}; up to ${formatUsd(admission.reservedBytes)} stays reserved against today's budgets until its outcome is confirmed. Do not resubmit this query.`,
      jobId,
      cost: jobCost(call, frozen, admission),
      report: await call.report(),
    });
  }

  await call.gate.submitted(admission, "accepted", jobLocation);
  await call.gate.settle(admission, () =>
    readBigQueryJobBilling(
      { projectId, jobId, location: jobLocation ?? null },
      token,
      AbortSignal.timeout(SETTLEMENT_TIMEOUT_MS),
    ),
  );
  const cost = jobCost(call, frozen, admission);
  if (outcome.status === "completed" && cost.providerCacheHit === null) {
    cost.providerCacheHit = outcome.providerCacheHit;
  }
  record.billedBytes = cost.billedBytes;
  record.providerCacheHit = cost.providerCacheHit;
  if (outcome.status === "failed") {
    return finish({
      status: "failed",
      code: outcome.code,
      message:
        outcome.code === "query_bytes_cap_exceeded"
          ? `The query needed more than its ${formatUsd(admission.reservedBytes)} reservation, so BigQuery stopped it. Narrow the date range or columns before asking again.`
          : `BigQuery job ${jobId} failed: ${outcome.message.slice(0, 1_000)}`,
      jobId,
      cost,
      report: await call.report(),
    });
  }
  record.rowCount = outcome.rows.length;
  record.truncated = outcome.truncation !== null;
  record.bytesProcessed = outcome.bytesProcessed;
  return finish({
    status: "completed",
    code: "ready",
    jobId,
    projectId,
    location: jobLocation ?? null,
    ...executed,
    rows: outcome.rows,
    schema: outcome.schema,
    rowCount: outcome.rows.length,
    truncated: outcome.truncation !== null,
    truncation: outcome.truncation,
    bytesProcessed: outcome.bytesProcessed,
    cost,
    report: await call.report(),
  });
}

function jobCost(
  call: OutsideAgentBigQueryCall,
  frozen: FrozenQuery,
  admission: OutsideAgentBigQueryAdmission,
): BigQueryAgentQueryCost {
  const job = call.gate
    .summary()
    .jobs.find((entry) => entry.jobId === admission.jobId);
  const billedBytes = job?.billedBytes ?? null;
  return {
    ...estimatedCost({
      estimatedBytes: frozen.estimatedBytes,
      reservedBytes: admission.reservedBytes,
    }),
    billedBytes,
    billedUsd: billedBytes === null ? null : usd(billedBytes),
    providerCacheHit: job?.cacheHit ?? null,
  };
}
