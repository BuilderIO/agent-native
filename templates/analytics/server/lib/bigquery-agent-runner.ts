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
  type BigQueryAgentReconciler,
  type OutsideAgentIdentity,
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
export const BIGQUERY_AGENT_CLEANUP_MS = 4_000;
const RECORD_RESERVE_MS = 1_000;
const DEFAULT_WORK_MS =
  BIGQUERY_AGENT_DEFAULT_DEADLINE_MS - BIGQUERY_AGENT_CLEANUP_MS;
const MAX_TABLES = 20;
const SETTLEMENT_TIMEOUT_MS = 1_500;
const LEASE_MARGIN_MS = 60_000;
const JOB_LABELS = { agent_native_workload: "outside-agent-query" };
const NOT_SENT =
  "The query's job was not sent: its deadline or budget reservation ran out first, so nothing ran and nothing was charged. Ask again.";
const DAY_CHANGED =
  "The query's job was not sent: the UTC day ended after its budget was reserved under that day's allowance, so nothing ran and nothing was charged. Ask again to run it under today's budget.";

export type BigQueryAgentQueryCode =
  | OutsideAgentBigQueryRefusalCode
  | "ready"
  | "query_statement_not_allowed"
  | "query_table_not_allowed"
  | "query_feature_not_allowed"
  | "query_invalid"
  | "query_bytes_cap_exceeded"
  | "query_row_too_large"
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

export interface BigQueryAgentDeadline {
  readonly signal: AbortSignal;
  readonly wrapUp: AbortSignal;
  readonly cleanup: AbortSignal;
  readonly startedAt: Date;
  readonly startedAtMs: number;
  readonly endsAtMs: number;
}

export function startBigQueryAgentDeadline(
  options: { workMs?: number; cleanupMs?: number; signal?: AbortSignal } = {},
): BigQueryAgentDeadline {
  const workMs = options.workMs ?? DEFAULT_WORK_MS;
  const cleanupMs = options.cleanupMs ?? BIGQUERY_AGENT_CLEANUP_MS;
  const recordMs = Math.min(RECORD_RESERVE_MS, Math.floor(cleanupMs / 2));
  const work = AbortSignal.timeout(workMs);
  const startedAtMs = performance.now();
  return Object.freeze({
    signal: options.signal ? AbortSignal.any([options.signal, work]) : work,
    wrapUp: AbortSignal.timeout(workMs + cleanupMs - recordMs),
    cleanup: AbortSignal.timeout(workMs + cleanupMs),
    startedAt: new Date(),
    startedAtMs,
    endsAtMs: startedAtMs + workMs + cleanupMs,
  });
}

function withCallerSignal(
  deadline: BigQueryAgentDeadline,
  signal: AbortSignal | undefined,
): BigQueryAgentDeadline {
  return signal
    ? Object.freeze({
        ...deadline,
        signal: AbortSignal.any([deadline.signal, signal]),
      })
    : deadline;
}

function remainingMs(deadline: BigQueryAgentDeadline): number {
  return Math.floor(deadline.endsAtMs - performance.now());
}

export function withinBigQueryAgentDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return bounded(work, signal);
}

function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) {
      work.catch(() => undefined);
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export interface BigQueryAgentQueryInput {
  sql: string;
  source: string;
  caller?: string;
  askVia?: string;
  estimateOnly?: boolean;
  deadlineMs?: number;
  deadline?: BigQueryAgentDeadline;
  decided?: BigQueryAgentDecision;
  beforeAdmission?: () => Promise<void>;
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
  cancelRequested: boolean;
  cancelConfirmed: boolean;
}

interface DecisionBase {
  readonly deadline: BigQueryAgentDeadline;
  readonly identity: OutsideAgentIdentity;
  readonly call: OutsideAgentBigQueryCall;
  readonly record: RecordState;
}

export type BigQueryAgentDecision =
  | (DecisionBase & {
      readonly status: "admitted";
      readonly needsApproval: false;
      readonly frozen: FrozenQuery;
      readonly admission: OutsideAgentBigQueryAdmission;
    })
  | (DecisionBase & {
      readonly status: "ask";
      readonly needsApproval: true;
      readonly frozen: FrozenQuery;
      readonly reservedBytes: number;
    })
  | (DecisionBase & {
      readonly status: "refused";
      readonly needsApproval: false;
      readonly code: BigQueryAgentFailureCode;
      readonly message: string;
      readonly report?: OutsideAgentBigQueryReport;
    });

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
  const { token, principal } = await bounded(
    getBigQueryAccess({ signal: deadline, projectId }),
    deadline,
  );
  const tables = await Promise.all(
    checked.tables.map(async (ref) => ({
      ref,
      metadata: await bounded(
        getBigQueryTableMetadata(ref, deadline, { token }),
        deadline,
      ),
    })),
  );
  let location: string | null = null;
  for (const { ref, metadata } of tables) {
    checkBigQueryAgentTableKind(ref, metadata);
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
    if (
      status === 429 ||
      dryRun.reason === "quotaExceeded" ||
      dryRun.reason === "rateLimitExceeded" ||
      dryRun.reason === "jobRateLimitExceeded"
    ) {
      throw new QueryRefusal(
        "query_quota_exceeded",
        "BigQuery's own quota or rate limit refused this query's dry run, so nothing ran and nothing was charged. Wait a minute before asking again.",
      );
    }
    if (dryRun.timedOut || status === 401 || status >= 500) {
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
    cancelRequested: false,
    cancelConfirmed: false,
  };
}

function newCall(
  input: { source: string; askVia?: string },
  identity: OutsideAgentIdentity,
  deadline: BigQueryAgentDeadline,
): OutsideAgentBigQueryCall {
  return createOutsideAgentBigQueryCall({
    identity,
    source: input.source,
    reservation: "dry-run",
    leaseMs: Math.max(0, remainingMs(deadline)) + LEASE_MARGIN_MS,
    ...(input.askVia ? { askVia: input.askVia } : {}),
  });
}

function reconcilerFor(frozen: FrozenQuery): BigQueryAgentReconciler {
  return createBigQueryAgentReconciler(frozen.access.token, {
    credentialScope: frozen.credentialScope,
    credentialFingerprint: frozen.credentialFingerprint,
  });
}

function admit(
  call: OutsideAgentBigQueryCall,
  frozen: FrozenQuery,
  deadline: BigQueryAgentDeadline,
): Promise<OutsideAgentBigQueryAdmission> {
  return bounded(
    call.gate.admit({
      projectId: frozen.access.projectId,
      jobId: `agent_native_mcp_${randomUUID().replace(/-/g, "")}`,
      credentialScope: frozen.credentialScope,
      credentialFingerprint: frozen.credentialFingerprint,
      exclusive: true,
      capBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
      estimate: async () => frozen.estimate,
      reconciler: reconcilerFor(frozen),
      location: frozen.access.location,
    }),
    deadline.wrapUp,
  );
}

function admissionRefusal(
  error: unknown,
  deadline: BigQueryAgentDeadline,
): {
  code: BigQueryAgentFailureCode;
  message: string;
  report?: OutsideAgentBigQueryReport;
} {
  if (error instanceof OutsideAgentBigQueryRefusalError) {
    return {
      code: error.code,
      message: error.message,
      report: outsideAgentRefusalReport(error),
    };
  }
  if (deadline.signal.aborted || deadline.wrapUp.aborted) {
    return {
      code: "query_timeout",
      message:
        "The query's budget check did not finish before its deadline, so nothing ran and nothing was charged. Ask again.",
    };
  }
  console.error("[bigquery-agent] Admission failed", {
    errorType: error instanceof Error ? error.name : "non_error",
  });
  return {
    code: "budget_unavailable",
    message: refusalMessage({ code: "budget_unavailable" }),
  };
}

export async function decideBigQueryAgentQuery(input: {
  sql: string;
  source: string;
  caller?: string;
  askVia?: string;
  deadline: BigQueryAgentDeadline;
}): Promise<BigQueryAgentDecision> {
  const { deadline } = input;
  const identity = outsideAgentIdentity(
    getRequestUserEmail(),
    getRequestOrgId(),
  );
  const base: DecisionBase = {
    deadline,
    identity,
    call: newCall(input, identity, deadline),
    record: emptyRecord(),
  };
  let frozen: FrozenQuery;
  try {
    frozen = await freezeQuery(input.sql, deadline.signal, base.record);
  } catch (error) {
    return {
      ...base,
      status: "refused",
      needsApproval: false,
      ...refusalOf(error, deadline.signal),
    };
  }
  try {
    const admission = await admit(base.call, frozen, deadline);
    if (deadline.signal.aborted) {
      await bounded(base.call.gate.rejected(admission), deadline.wrapUp).catch(
        () => undefined,
      );
      return {
        ...base,
        status: "refused",
        needsApproval: false,
        code: "query_timeout",
        message: NOT_SENT,
      };
    }
    return {
      ...base,
      status: "admitted",
      needsApproval: false,
      frozen,
      admission,
    };
  } catch (error) {
    if (
      input.askVia &&
      error instanceof OutsideAgentBigQueryRefusalError &&
      error.code === "approval_required"
    ) {
      return {
        ...base,
        status: "ask",
        needsApproval: true,
        frozen,
        reservedBytes: frozen.reservedBytes,
      };
    }
    return {
      ...base,
      status: "refused",
      needsApproval: false,
      ...admissionRefusal(error, deadline),
    };
  }
}

export async function releaseBigQueryAgentDecision(
  decision: BigQueryAgentDecision,
): Promise<void> {
  if (decision.status !== "admitted") return;
  await bounded(
    decision.call.gate.rejected(decision.admission),
    decision.deadline.wrapUp,
  ).catch(() => undefined);
}

export async function planBigQueryAgentQuery(
  sql: string,
  options: { deadline?: BigQueryAgentDeadline } = {},
): Promise<BigQueryAgentQueryPlan> {
  const deadline = options.deadline ?? startBigQueryAgentDeadline();
  try {
    const frozen = await freezeQuery(sql, deadline.signal, emptyRecord());
    return {
      status: "planned",
      estimatedBytes: frozen.estimatedBytes,
      reservedBytes: frozen.reservedBytes,
    };
  } catch (error) {
    return { status: "refused", ...refusalOf(error, deadline.signal) };
  }
}

export async function runBigQueryAgentQuery(
  input: BigQueryAgentQueryInput,
): Promise<BigQueryAgentQueryResult> {
  const currentIdentity = outsideAgentIdentity(
    getRequestUserEmail(),
    getRequestOrgId(),
  );
  const decided =
    input.decided &&
    input.decided.identity.ownerEmail === currentIdentity.ownerEmail &&
    input.decided.identity.orgId === currentIdentity.orgId
      ? input.decided
      : undefined;
  const deadline = withCallerSignal(
    decided?.deadline ??
      input.deadline ??
      startBigQueryAgentDeadline({
        workMs: Math.min(input.deadlineMs ?? DEFAULT_WORK_MS, DEFAULT_WORK_MS),
      }),
    input.signal,
  );
  const identity = decided?.identity ?? currentIdentity;
  const call = decided?.call ?? newCall(input, identity, deadline);
  const record = decided?.record ?? emptyRecord();
  const executionId = randomUUID();
  const queryHash = createHash("sha256").update(input.sql).digest("hex");
  let submission: "not_run" | "unknown" | "accepted" = "not_run";
  const report = async (): Promise<OutsideAgentBigQueryReport> => {
    try {
      return await bounded(call.report(), deadline.wrapUp);
    } catch {
      // coercion-ok: a budget that could not be read in time is reported as unread (today: null), never as zero.
      return outsideAgentBigQueryReport(call.gate.summary(), null);
    }
  };
  const writeRecord = (
    status: string,
    code: string | null,
    signal: AbortSignal = deadline.cleanup,
  ) =>
    bounded(
      writeBigQueryAgentExecutionRecord(
        {
          id: executionId,
          ownerEmail: identity.ownerEmail,
          orgId: identity.orgId,
          caller: input.caller ?? "mcp",
          source: input.source,
          policyVersion: BIGQUERY_AGENT_SQL_POLICY_VERSION,
          queryHash,
          ...record,
          status,
          code,
          startedAt: deadline.startedAt.toISOString(),
          durationMs: Math.max(
            0,
            Math.round(performance.now() - deadline.startedAtMs),
          ),
        },
        { timeoutMs: remainingMs(deadline) },
      ),
      signal,
    );
  const finish = async (
    result: BigQueryAgentQueryResult,
  ): Promise<BigQueryAgentQueryResult> => {
    try {
      await writeRecord(result.status, result.code);
    } catch {
      // coercion-ok: an ungoverned run returns no rows; this typed failure says why.
      console.error("[bigquery-agent] Execution record not written", {
        source: input.source,
        jobId: record.jobId,
      });
      const jobId = submission === "not_run" ? null : record.jobId;
      return {
        status: "failed",
        code: "execution_record_unavailable",
        message:
          "The query's governance record could not be saved, so its results are withheld. " +
          (jobId === null
            ? "Nothing ran. Try again later."
            : `BigQuery job ${jobId} ${submission === "unknown" ? "may have run" : "ran"}; do not resubmit it. Try a new query later.`),
        jobId,
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
    refusalReport?: OutsideAgentBigQueryReport,
  ) =>
    finish({
      status: "refused",
      code,
      message,
      report: refusalReport ?? (await report()),
      ...(record.reservedBytes !== null
        ? {
            cost: estimatedCost({
              estimatedBytes: record.estimatedBytes,
              reservedBytes: record.reservedBytes,
            }),
          }
        : {}),
    });

  if (decided?.status === "refused") {
    return refused(decided.code, decided.message, decided.report);
  }
  let frozen: FrozenQuery;
  if (decided) {
    frozen = decided.frozen;
  } else {
    try {
      frozen = await freezeQuery(input.sql, deadline.signal, record);
    } catch (error) {
      const refusal = refusalOf(error, deadline.signal);
      return refused(refusal.code, refusal.message);
    }
  }
  const { projectId, location, token } = frozen.access;
  const executed = {
    executedSql: frozen.sql,
    referencedTables: frozen.tables.map(bigQueryTableKey),
  };

  if (input.estimateOnly) {
    let budget;
    try {
      budget = await bounded(
        readBigQueryAgentBudget(identity, { reconcile: reconcilerFor(frozen) }),
        deadline.signal,
      );
    } catch (error) {
      if (deadline.signal.aborted) {
        return refused(
          "query_timeout",
          "The budget read for this estimate did not finish before its deadline. Nothing ran and nothing was charged.",
        );
      }
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

  let admission: OutsideAgentBigQueryAdmission;
  if (decided?.status === "admitted") {
    admission = decided.admission;
  } else {
    if (input.beforeAdmission) {
      try {
        await bounded(input.beforeAdmission(), deadline.signal);
      } catch (error) {
        const refusal = admissionRefusal(error, deadline);
        return refused(refusal.code, refusal.message);
      }
    }
    if (deadline.signal.aborted) return refused("query_timeout", NOT_SENT);
    try {
      admission = await admit(call, frozen, deadline);
    } catch (error) {
      const refusal = admissionRefusal(error, deadline);
      return refused(refusal.code, refusal.message, refusal.report);
    }
  }
  const { jobId } = admission;
  const release = () =>
    bounded(call.gate.rejected(admission), deadline.wrapUp).catch(
      () => undefined,
    );
  record.reservedBytes = admission.reservedBytes;
  if (deadline.signal.aborted || admissionLapsed(admission)) {
    await release();
    return refused("query_timeout", NOT_SENT);
  }
  record.jobId = jobId;
  try {
    await writeRecord("submitting", null, deadline.signal);
  } catch {
    // coercion-ok: no durable record means no job; the reservation is released and the typed failure says nothing ran.
    record.jobId = null;
    await release();
    return finish({
      status: "failed",
      code: "execution_record_unavailable",
      message:
        "The query's governance record could not be saved before its job was sent, so nothing ran. Try again later.",
      jobId: null,
      cost: null,
      report: await report(),
    });
  }

  const usage = withBigQueryUsageAttribution(
    { workload: "outside-agent-query" },
    () => newBigQueryJobUsage(projectId, jobId, frozen.credentialContext),
  );
  usage.location = location ?? undefined;
  const usageRecorded = await bounded(
    persistBigQueryJobUsage(usage),
    deadline.signal,
    // coercion-ok: false is persistBigQueryJobUsage's own "usage not recorded" answer, which finalization reports as unavailable.
  ).catch(() => false);

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
      signal: deadline.signal,
      cleanupSignal: deadline.wrapUp,
      maxRows: input.maxRows ?? BIGQUERY_AGENT_MAX_ROWS,
      maxResultBytes: input.maxResultBytes ?? BIGQUERY_AGENT_MAX_RESULT_BYTES,
      submitBy: admission.submitBy,
      admittedOnUtcDay: admission.utcDay,
      labels: JOB_LABELS,
    });
  } catch {
    // coercion-ok: an unexpected failure mid-job is an unknown outcome, reported as one.
    outcome = {
      status: "uncertain",
      reason: "submission_unknown",
      location: location ?? undefined,
      cancelRequested: false,
      cancelConfirmed: false,
    };
  }
  const jobLocation =
    (outcome.status === "rejected" || outcome.status === "not_submitted"
      ? undefined
      : outcome.location) ??
    location ??
    undefined;
  record.location = jobLocation ?? null;
  usage.location = jobLocation;
  const acceptedButUnread =
    outcome.status === "uncertain" && outcome.reason === "poll_unreadable";
  submission =
    outcome.status === "rejected" || outcome.status === "not_submitted"
      ? "not_run"
      : outcome.status === "uncertain" && !acceptedButUnread
        ? "unknown"
        : "accepted";
  usage.submissionState = submission === "not_run" ? "rejected" : submission;
  await bounded(
    finalizeBigQueryJobUsage(usage, token, usageRecorded, deadline.wrapUp),
    deadline.wrapUp,
  ).catch(() => undefined);

  if (outcome.status === "not_submitted") {
    await release();
    return outcome.reason === "day_changed"
      ? refused("admission_expired", DAY_CHANGED)
      : refused("query_timeout", NOT_SENT);
  }
  if (outcome.status === "rejected") {
    await release();
    return finish({
      status: "failed",
      code: outcome.code,
      message:
        outcome.code === "query_quota_exceeded"
          ? `BigQuery's own quota or rate limit refused the job before it ran, so nothing was charged: ${outcome.message.slice(0, 1_000)} Wait a minute before asking again.`
          : `BigQuery refused the job before it ran, so nothing was charged: ${outcome.message.slice(0, 1_000)}`,
      jobId,
      cost: jobCost(call, frozen, admission),
      report: await report(),
    });
  }
  if (outcome.status === "uncertain") {
    record.cancelRequested = outcome.cancelRequested;
    record.cancelConfirmed = outcome.cancelConfirmed;
    await bounded(
      call.gate.submitted(
        admission,
        acceptedButUnread ? "accepted" : "unknown",
        jobLocation,
      ),
      deadline.wrapUp,
    ).catch(() => undefined);
    return finish({
      status: "uncertain",
      code:
        outcome.reason === "timeout" ? "query_timeout" : "job_outcome_unknown",
      message: `BigQuery job ${jobId} may still be running${outcome.cancelConfirmed ? " (BigQuery accepted a cancel request)" : outcome.cancelRequested ? " (a cancel was requested but not confirmed)" : ""}; up to ${formatUsd(admission.reservedBytes)} stays reserved against today's budgets until its outcome is confirmed. Do not resubmit this query.`,
      jobId,
      cost: jobCost(call, frozen, admission),
      report: await report(),
    });
  }

  await bounded(
    call.gate.submitted(admission, "accepted", jobLocation),
    deadline.wrapUp,
  ).catch(() => undefined);
  await bounded(
    call.gate.settle(admission, () =>
      readBigQueryJobBilling(
        { projectId, jobId, location: jobLocation ?? null },
        token,
        AbortSignal.any([
          AbortSignal.timeout(SETTLEMENT_TIMEOUT_MS),
          deadline.wrapUp,
        ]),
      ),
    ),
    deadline.wrapUp,
  ).catch(() => undefined);
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
          : outcome.code === "query_quota_exceeded"
            ? `BigQuery job ${jobId} hit BigQuery's own quota or rate limit: ${outcome.message.slice(0, 1_000)} Wait a minute before asking again.`
            : `BigQuery job ${jobId} failed: ${outcome.message.slice(0, 1_000)}`,
      jobId,
      cost,
      report: await report(),
    });
  }
  record.rowCount = outcome.rows.length;
  record.truncated = outcome.truncation !== null;
  record.bytesProcessed = outcome.bytesProcessed;
  if (outcome.rows.length === 0 && outcome.truncation === "bytes") {
    return finish({
      status: "failed",
      code: "query_row_too_large",
      message: `BigQuery job ${jobId} ran, but its first row alone is larger than the ${Math.round((input.maxResultBytes ?? BIGQUERY_AGENT_MAX_RESULT_BYTES) / 1_000).toLocaleString("en-US")} KB result limit, so no rows are returned. Select fewer or smaller columns (drop long text, JSON or array columns) or aggregate, then ask again.`,
      jobId,
      cost,
      report: await report(),
    });
  }
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
    report: await report(),
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
