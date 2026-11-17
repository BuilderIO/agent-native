import { createHash, randomUUID } from "node:crypto";

import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

import {
  admitBigQueryAgentJob,
  BigQueryAgentBudgetUnavailableError,
  describeBigQueryAgentBudget,
  formatUsd,
  markBigQueryAgentJobSubmission,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  outsideAgentIdentity,
  readBigQueryAgentBudget,
  settleBigQueryAgentJob,
  settlementForFinishedJob,
  usd,
  writeBigQueryAgentExecutionRecord,
  type BigQueryAgentBudgetSnapshot,
  type BigQueryAgentBudgetView,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import {
  admissionLapsed,
  conservativeBillableEstimate,
  OutsideAgentBigQueryRefusalError,
  refusalMessage,
  reservationForEstimate,
  submitByForLease,
} from "./bigquery-agent-context.js";
import {
  BIGQUERY_AGENT_SQL_POLICY_VERSION,
  BigQueryAgentSqlRefusal,
  checkBigQueryAgentSql,
  checkBigQueryAgentTableKind,
  crossCheckBigQueryAgentDryRun,
  type CheckedBigQueryAgentSql,
} from "./bigquery-agent-sql-policy.js";
import { readBigQueryJobBilling } from "./bigquery-usage.js";
import {
  BigQueryMetadataError,
  createBigQueryAgentReconciler,
  dryRunQuerySchema,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
  runBoundedBigQueryJob,
  type BoundedBigQueryJobOutcome,
} from "./bigquery.js";
import { credentialCacheScope } from "./credentials-context.js";
import { getBigQueryAccess } from "./gcloud.js";

/**
 * The bounded runner for arbitrary SQL from an outside agent. One deadline
 * covers credentials, policy checks, the dry run, admission, submission,
 * polling and every result page. Results are never cached by Analytics.
 */
export const BIGQUERY_AGENT_MAX_ROWS = 5_000;
export const BIGQUERY_AGENT_MAX_RESULT_BYTES = 2_000_000;
export const BIGQUERY_AGENT_DEFAULT_DEADLINE_MS = 25_000;
const MAX_TABLES = 20;
const SETTLEMENT_TIMEOUT_MS = 1_500;
const LEASE_MARGIN_MS = 60_000;

export type BigQueryAgentQueryCode =
  | "ready"
  | "approval_required"
  | "budget_exhausted"
  | "over_job_cap"
  | "estimate_unavailable"
  | "query_table_not_allowed"
  | "query_feature_not_allowed"
  | "query_invalid"
  | "query_bytes_cap_exceeded"
  | "query_timeout"
  | "query_quota_exceeded"
  | "query_failed"
  | "job_outcome_unknown"
  | "budget_unavailable"
  | "execution_record_unavailable";

export interface BigQueryAgentQueryCost {
  estimatedBytes: number | null;
  estimatedUsd: number | null;
  reservedBytes: number;
  reservedUsd: number;
  /** BigQuery's own `totalBytesBilled`; null until a settlement confirmed it. */
  billedBytes: number | null;
  billedUsd: number | null;
  providerCacheHit: boolean | null;
}

export type BigQueryAgentQueryResult =
  | {
      status: "completed";
      code: "ready";
      jobId: string;
      rows: Record<string, unknown>[];
      schema: { name: string; type: string }[];
      rowCount: number;
      truncated: boolean;
      truncation: "rows" | "bytes" | null;
      cost: BigQueryAgentQueryCost;
      budget: BigQueryAgentBudgetView | null;
    }
  /** Estimate only: nothing was submitted. */
  | {
      status: "ready";
      code: "ready";
      cost: Pick<
        BigQueryAgentQueryCost,
        "estimatedBytes" | "estimatedUsd" | "reservedBytes" | "reservedUsd"
      >;
      budget: BigQueryAgentBudgetView;
      message: string;
    }
  | {
      status: "refused";
      code: BigQueryAgentQueryCode;
      message: string;
      budget: BigQueryAgentBudgetView | null;
      cost?: Pick<
        BigQueryAgentQueryCost,
        "estimatedBytes" | "estimatedUsd" | "reservedBytes" | "reservedUsd"
      >;
    }
  /** The job ran and failed, or the call could not finish its own bookkeeping. */
  | {
      status: "failed";
      code: BigQueryAgentQueryCode;
      message: string;
      jobId: string | null;
      cost: BigQueryAgentQueryCost | null;
      budget: BigQueryAgentBudgetView | null;
    }
  /** The job may still be running; its reservation stays until a reconciler confirms it. */
  | {
      status: "uncertain";
      code: "query_timeout" | "job_outcome_unknown";
      message: string;
      jobId: string;
      cost: BigQueryAgentQueryCost;
      budget: BigQueryAgentBudgetView | null;
    };

export interface BigQueryAgentQueryInput {
  sql: string;
  /** The tool that called, for the budget ledger and the execution record. */
  source: string;
  /** Estimate and check only; submit nothing. */
  estimateOnly?: boolean;
  deadlineMs?: number;
  signal?: AbortSignal;
  maxRows?: number;
  maxResultBytes?: number;
}

function costFor(
  estimatedBytes: number | null,
  reservedBytes: number,
): BigQueryAgentQueryCost {
  return {
    estimatedBytes,
    estimatedUsd: estimatedBytes === null ? null : usd(estimatedBytes),
    reservedBytes,
    reservedUsd: usd(reservedBytes),
    billedBytes: null,
    billedUsd: null,
    providerCacheHit: null,
  };
}

/** Read through a call: an `await` can abort a signal TypeScript narrowed to unaborted. */
function hasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function abortError(): Error {
  return new DOMException(
    "BigQuery agent query deadline exceeded",
    "AbortError",
  );
}

/**
 * Runs arbitrary SQL for an outside agent under the SQL policy and the daily
 * budget. Every call, refusals included, writes a governed execution record
 * (no rows); when that record can't be written, no rows are returned.
 */
export async function runBigQueryAgentQuery(
  input: BigQueryAgentQueryInput,
): Promise<BigQueryAgentQueryResult> {
  const startedAt = new Date();
  const deadlineMs = Math.min(
    input.deadlineMs ?? BIGQUERY_AGENT_DEFAULT_DEADLINE_MS,
    BIGQUERY_AGENT_DEFAULT_DEADLINE_MS,
  );
  const deadline = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(deadlineMs)])
    : AbortSignal.timeout(deadlineMs);
  const identity = outsideAgentIdentity(
    getRequestUserEmail(),
    getRequestOrgId(),
  );
  const queryHash = createHash("sha256").update(input.sql).digest("hex");
  const record = {
    projectId: null as string | null,
    jobId: null as string | null,
    estimatedBytes: null as number | null,
    reservedBytes: null as number | null,
    billedBytes: null as number | null,
    providerCacheHit: null as boolean | null,
    rowCount: null as number | null,
    truncated: false,
    cancelled: false,
  };
  const finish = async (
    result: BigQueryAgentQueryResult,
  ): Promise<BigQueryAgentQueryResult> => {
    try {
      await writeBigQueryAgentExecutionRecord({
        id: randomUUID(),
        ownerEmail: identity.ownerEmail,
        orgId: identity.orgId,
        caller: "mcp",
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
        budget: result.budget,
      };
    }
    return result;
  };
  const refused = (
    code: BigQueryAgentQueryCode,
    message: string,
    budget: BigQueryAgentBudgetSnapshot | null = null,
  ) =>
    finish({
      status: "refused",
      code,
      message,
      budget: budget ? describeBigQueryAgentBudget(budget) : null,
      ...(record.reservedBytes !== null
        ? {
            cost: {
              estimatedBytes: record.estimatedBytes,
              estimatedUsd:
                record.estimatedBytes === null
                  ? null
                  : usd(record.estimatedBytes),
              reservedBytes: record.reservedBytes,
              reservedUsd: usd(record.reservedBytes),
            },
          }
        : {}),
    });

  let checked: CheckedBigQueryAgentSql;
  let connectionProjectId: string;
  let token: string;
  let credentialScope: string;
  let credentialFingerprint: string | null;
  try {
    connectionProjectId = await getBigQueryProjectId(deadline);
    record.projectId = connectionProjectId;
    checked = checkBigQueryAgentSql(input.sql, connectionProjectId);
    if (checked.tables.length > MAX_TABLES) {
      return refused(
        "query_feature_not_allowed",
        `Queries may read at most ${MAX_TABLES} tables. Split the question into smaller queries.`,
      );
    }
    for (const ref of checked.tables) {
      const metadata = await getBigQueryTableMetadata(ref, deadline);
      checkBigQueryAgentTableKind(ref, metadata.type);
    }
    const dryRun = await dryRunQuerySchema(checked.sql, {
      signal: deadline,
      exactSql: true,
    });
    const status = dryRun.status ?? 0;
    if (dryRun.error !== null) {
      if (
        dryRun.timedOut ||
        status === 401 ||
        status === 429 ||
        status >= 500
      ) {
        return refused(
          "estimate_unavailable",
          "BigQuery could not estimate this query's cost, so nothing ran and nothing was charged. Try again in a few minutes.",
        );
      }
      return refused(
        "query_invalid",
        `BigQuery rejected the SQL: ${dryRun.error.slice(0, 1_000)} Fix the query before running it.`,
      );
    }
    crossCheckBigQueryAgentDryRun(checked, dryRun);
    const estimate = conservativeBillableEstimate(dryRun);
    if (estimate.status === "unavailable") {
      return refused(
        "estimate_unavailable",
        "BigQuery's dry run returned no usable byte estimate, so nothing ran and nothing was charged. Try again in a few minutes, or narrow the query.",
      );
    }
    // A dry run that reads tables but reports zero bytes is not an estimate:
    // the job reserves, and is capped at, the whole per-job limit instead.
    record.estimatedBytes = estimate.status === "ok" ? estimate.bytes : null;
    if (
      record.estimatedBytes !== null &&
      record.estimatedBytes > OUTSIDE_AGENT_JOB_CAP_BYTES
    ) {
      return refused(
        "over_job_cap",
        `This query would bill about ${formatUsd(record.estimatedBytes)}, over the ${formatUsd(OUTSIDE_AGENT_JOB_CAP_BYTES)} (50 GB) per-job limit for outside agents, so it was not run. Narrow the date range or select fewer columns.`,
      );
    }
    record.reservedBytes =
      record.estimatedBytes === null
        ? OUTSIDE_AGENT_JOB_CAP_BYTES
        : reservationForEstimate(
            record.estimatedBytes,
            OUTSIDE_AGENT_JOB_CAP_BYTES,
          );
    // Whose credentials run the job: only they can later prove it absent.
    credentialScope = credentialCacheScope("BIGQUERY_PROJECT_ID");
    ({ token, principal: credentialFingerprint } = await getBigQueryAccess({
      signal: deadline,
    }));
    if (deadline.aborted) throw abortError();
  } catch (error) {
    if (error instanceof BigQueryAgentSqlRefusal) {
      return refused(error.code, error.message);
    }
    if (deadline.aborted) {
      return refused(
        "query_timeout",
        "The query's checks did not finish before its deadline, so nothing ran and nothing was charged. Narrow the query and ask again.",
      );
    }
    if (error instanceof BigQueryMetadataError && error.status === 404) {
      return refused(
        "query_invalid",
        "A table this query names does not exist or is not visible to this connection, so nothing ran. Check the table name.",
      );
    }
    console.error("[bigquery-agent] Query checks failed", {
      errorType: error instanceof Error ? error.name : "non_error",
    });
    return refused(
      "estimate_unavailable",
      "The query's checks could not finish (credentials, table metadata, or the dry run failed), so nothing ran and nothing was charged.",
    );
  }

  const reconciler = createBigQueryAgentReconciler(token, {
    credentialScope,
    credentialFingerprint,
  });
  if (input.estimateOnly) {
    let budget: BigQueryAgentBudgetSnapshot;
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
    return finish({
      status: "ready",
      code: "ready",
      cost: {
        estimatedBytes: record.estimatedBytes,
        estimatedUsd:
          record.estimatedBytes === null ? null : usd(record.estimatedBytes),
        reservedBytes: record.reservedBytes,
        reservedUsd: usd(record.reservedBytes),
      },
      budget: describeBigQueryAgentBudget(budget),
      message: `Estimated ${record.estimatedBytes === null ? `up to ${formatUsd(record.reservedBytes)}` : formatUsd(record.estimatedBytes)}; ${formatUsd(budget.person.remainingBytes)} of your day and ${formatUsd(budget.org.remainingBytes)} of your organization's are left. Nothing ran.`,
    });
  }

  const jobId = `agent_native_mcp_${randomUUID().replace(/-/g, "")}`;
  const projectId = connectionProjectId;
  const admitted = await admit(identity, {
    source: input.source,
    projectId,
    jobId,
    credentialScope,
    credentialFingerprint,
    estimatedBytes: record.estimatedBytes,
    reservedBytes: record.reservedBytes,
    leaseMs: deadlineMs + LEASE_MARGIN_MS,
    reconciler,
  });
  if (admitted instanceof OutsideAgentBigQueryRefusalError) {
    // Approving past the no-ask allowance is not available from an outside
    // agent yet, so that decision is a stop for the day.
    return refused(
      admitted.code === "approval_required" ||
        admitted.code === "budget_required"
        ? "budget_exhausted"
        : admitted.code === "admission_expired"
          ? "budget_unavailable"
          : admitted.code,
      admitted.message,
      admitted.budget,
    );
  }
  // Admission can spend part of the deadline reconciling; a job is never sent
  // after it, or after its committed lease, so a timeout here means nothing ran.
  const submitBy = submitByForLease(admitted.leaseExpiresAt);
  if (hasAborted(deadline) || admissionLapsed({ submitBy })) {
    await settleQuietly(projectId, jobId, { kind: "rejected" });
    return refused(
      "query_timeout",
      "The query's deadline passed before its job was sent, so nothing ran and nothing was charged. Ask again.",
    );
  }
  record.jobId = jobId;
  const cost = costFor(record.estimatedBytes, record.reservedBytes);

  let outcome: BoundedBigQueryJobOutcome;
  try {
    // raw-sql-ok: the agent's own SELECT, run only after the SQL policy, table kinds and dry-run cross-check accepted this exact text.
    outcome = await runBoundedBigQueryJob({
      projectId,
      jobId,
      sql: checked.sql,
      maximumBytesBilled: record.reservedBytes,
      token,
      signal: deadline,
      maxRows: input.maxRows ?? BIGQUERY_AGENT_MAX_ROWS,
      maxResultBytes: input.maxResultBytes ?? BIGQUERY_AGENT_MAX_RESULT_BYTES,
      submitBy,
    });
  } catch {
    // coercion-ok: an unexpected failure mid-job is an unknown outcome, reported as one.
    outcome = {
      status: "uncertain",
      reason: "submission_unknown",
      location: undefined,
      cancelRequested: false,
    };
  }

  if (outcome.status === "rejected") {
    await settleQuietly(projectId, jobId, { kind: "rejected" });
    return finish({
      status: "failed",
      code: outcome.code,
      message: `BigQuery refused the job before it ran, so nothing was charged: ${outcome.message.slice(0, 1_000)}`,
      jobId,
      cost,
      budget: await budgetView(identity),
    });
  }
  if (outcome.status === "uncertain") {
    record.cancelled = outcome.cancelRequested;
    await markQuietly(admitted.requestId, "unknown", outcome.location);
    const message = `BigQuery job ${jobId} may still be running${outcome.cancelRequested ? " (a cancel was requested)" : ""}; up to ${formatUsd(record.reservedBytes)} stays reserved against today's budgets until its outcome is confirmed. Do not resubmit this query.`;
    return finish({
      status: "uncertain",
      code:
        outcome.reason === "timeout" ? "query_timeout" : "job_outcome_unknown",
      message,
      jobId,
      cost,
      budget: await budgetView(identity),
    });
  }

  await markQuietly(admitted.requestId, "accepted", outcome.location);
  await settleFromBigQuery(projectId, jobId, outcome.location, token, cost);
  record.billedBytes = cost.billedBytes;
  record.providerCacheHit =
    cost.providerCacheHit ??
    (outcome.status === "completed" ? outcome.providerCacheHit : null);
  if (outcome.status === "failed") {
    return finish({
      status: "failed",
      code: outcome.code,
      message:
        outcome.code === "query_bytes_cap_exceeded"
          ? `The query needed more than its ${formatUsd(record.reservedBytes)} reservation, so BigQuery stopped it. Narrow the date range or columns before asking again.`
          : `BigQuery job ${jobId} failed: ${outcome.message.slice(0, 1_000)}`,
      jobId,
      cost,
      budget: await budgetView(identity),
    });
  }
  record.rowCount = outcome.rows.length;
  record.truncated = outcome.truncation !== null;
  return finish({
    status: "completed",
    code: "ready",
    jobId,
    rows: outcome.rows,
    schema: outcome.schema,
    rowCount: outcome.rows.length,
    truncated: outcome.truncation !== null,
    truncation: outcome.truncation,
    cost: {
      ...cost,
      providerCacheHit: cost.providerCacheHit ?? outcome.providerCacheHit,
    },
    budget: await budgetView(identity),
  });
}

async function admit(
  identity: OutsideAgentIdentity,
  request: {
    source: string;
    /** The connection's project: the job runs, and bills, there. */
    projectId: string;
    jobId: string;
    credentialScope: string;
    credentialFingerprint: string | null;
    estimatedBytes: number | null;
    reservedBytes: number;
    leaseMs: number;
    reconciler: ReturnType<typeof createBigQueryAgentReconciler>;
  },
) {
  try {
    const result = await admitBigQueryAgentJob(
      identity,
      {
        source: request.source,
        projectId: request.projectId,
        jobId: request.jobId,
        credentialScope: request.credentialScope,
        credentialFingerprint: request.credentialFingerprint,
        estimatedBytes: request.estimatedBytes,
        reservedBytes: request.reservedBytes,
        leaseMs: request.leaseMs,
      },
      { reconcile: request.reconciler },
    );
    if (result.status === "refused") {
      return new OutsideAgentBigQueryRefusalError({
        code: result.code,
        scope: result.scope,
        reservedBytes: result.reservedBytes,
        budget: result.budget,
      });
    }
    return result;
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) {
      return new OutsideAgentBigQueryRefusalError({
        code: "budget_unavailable",
      });
    }
    throw error;
  }
}

async function settleFromBigQuery(
  projectId: string,
  jobId: string,
  location: string | undefined,
  token: string,
  cost: BigQueryAgentQueryCost,
): Promise<void> {
  const read = await readBigQueryJobBilling(
    { projectId, jobId, location: location ?? null },
    token,
    AbortSignal.timeout(SETTLEMENT_TIMEOUT_MS),
  );
  if (read.kind !== "found") return;
  cost.providerCacheHit = read.cacheHit;
  const settlement = settlementForFinishedJob(read);
  if (settlement?.kind !== "billed") return;
  if (await settleQuietly(projectId, jobId, settlement)) {
    cost.billedBytes = settlement.billedBytes;
    cost.billedUsd = usd(settlement.billedBytes);
  }
}

async function settleQuietly(
  projectId: string,
  jobId: string,
  settlement: Parameters<typeof settleBigQueryAgentJob>[2],
): Promise<boolean> {
  try {
    return await settleBigQueryAgentJob(projectId, jobId, settlement);
  } catch {
    // coercion-ok: an unsettled job stays reserved until a reconciler settles it.
    return false;
  }
}

async function markQuietly(
  requestId: string,
  state: "accepted" | "unknown",
  location: string | undefined,
) {
  try {
    await markBigQueryAgentJobSubmission(requestId, state, location);
  } catch {
    // coercion-ok: the row is already pending with its full reservation.
  }
}

async function budgetView(
  identity: OutsideAgentIdentity,
): Promise<BigQueryAgentBudgetView | null> {
  try {
    return describeBigQueryAgentBudget(await readBigQueryAgentBudget(identity));
  } catch {
    // coercion-ok: the run's own result stands; the budget view is null, not zero.
    return null;
  }
}
