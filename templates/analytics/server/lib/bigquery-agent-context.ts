import { AsyncLocalStorage } from "node:async_hooks";

import {
  currentActionOriginCaller,
  type ActionCaller,
} from "@agent-native/core/action";

import {
  admitBigQueryAgentJob,
  BigQueryAgentBudgetUnavailableError,
  formatUsd,
  markBigQueryAgentJobSubmission,
  OUTSIDE_AGENT_JOB_CAP_BYTES,
  settleBigQueryAgentJob,
  settlementForFinishedJob,
  type BigQueryAgentBudgetSnapshot,
  type BigQueryAgentReconciler,
  type BigQueryAgentRefusalCode,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import { MIN_BILLED_BYTES_PER_QUERY } from "./bigquery-pricing.js";
import type { BigQueryJobBilling } from "./bigquery-usage.js";

const LEASE_SUBMIT_MARGIN_MS = 15_000;

export function isOutsideAgentCaller(
  caller: ActionCaller | undefined,
): boolean {
  return caller === "mcp" || caller === "a2a";
}

export type OutsideAgentBigQueryRefusalCode =
  | BigQueryAgentRefusalCode
  | "budget_required"
  | "budget_unavailable"
  | "admission_expired"
  | "estimate_unavailable";

export type BigQueryEstimateUnavailableReason =
  | "missing_statistics"
  | "malformed_statistics"
  | "dry_run_failed"
  | "no_dry_run";

export class OutsideAgentBigQueryRefusalError extends Error {
  readonly code: OutsideAgentBigQueryRefusalCode;
  readonly scope: "job" | "person" | "org" | null;
  readonly reservedBytes: number | null;
  readonly budget: BigQueryAgentBudgetSnapshot | null;
  readonly estimateReason: BigQueryEstimateUnavailableReason | null;

  constructor(input: RefusalInput) {
    super(refusalMessage(input));
    this.name = "OutsideAgentBigQueryRefusalError";
    this.code = input.code;
    this.scope = input.scope ?? null;
    this.reservedBytes = input.reservedBytes ?? null;
    this.budget = input.budget ?? null;
    this.estimateReason = input.estimateReason ?? null;
  }
}

const ESTIMATE_REASONS: Record<BigQueryEstimateUnavailableReason, string> = {
  missing_statistics: "it reported no bytes",
  malformed_statistics: "its byte count was unreadable",
  dry_run_failed: "the dry run failed",
  no_dry_run: "no dry run was made",
};

function untilReset(budget: BigQueryAgentBudgetSnapshot | null | undefined) {
  return budget ? ` It resets at ${budget.resetsAt} (00:00 UTC).` : "";
}

interface RefusalInput {
  code: OutsideAgentBigQueryRefusalCode;
  scope?: "job" | "person" | "org" | null;
  reservedBytes?: number | null;
  budget?: BigQueryAgentBudgetSnapshot | null;
  estimateReason?: BigQueryEstimateUnavailableReason | null;
  askVia?: string | null;
}

function approvalRequiredMessage(input: RefusalInput, job: string): string {
  const { budget } = input;
  const past = `${job} would take you past your ${formatUsd(budget?.person.baseAllowanceBytes ?? 0)} no-ask BigQuery allowance for today (spent ${formatUsd(budget?.person.settledBytes ?? 0)}, reserved ${formatUsd(budget?.person.reservedBytes ?? 0)}), so it was not started.`;
  const ceiling = formatUsd(budget?.person.ceilingBytes ?? 0);
  return input.askVia
    ? `${past} Calling ${input.askVia} with the same arguments asks you once to allow up to ${ceiling} of BigQuery today, until 00:00 UTC.`
    : `${past} Allowing up to ${ceiling} today needs your approval on Analytics' review page, which this call can't ask for. Analytics asks once over MCP, when a get-onboarding-journey, get-first-party-analytics-health or query-warehouse call needs more, and that approval covers all your outside agents until 00:00 UTC; an Analytics organization admin can also raise your daily allowance. Until then, do not retry this call today.${untilReset(budget)}`;
}

export function refusalMessage(input: RefusalInput): string {
  const { budget } = input;
  const job =
    input.reservedBytes === null || input.reservedBytes === undefined
      ? "This BigQuery job"
      : `This BigQuery job (up to ${formatUsd(input.reservedBytes)})`;
  switch (input.code) {
    case "over_job_cap":
      return `${job} is over the ${formatUsd(OUTSIDE_AGENT_JOB_CAP_BYTES)} (50 GB) per-job limit for outside agents, so it was not started. Narrow the date range or select fewer columns, then ask again.`;
    case "approval_required":
      return approvalRequiredMessage(input, job);
    case "budget_exhausted":
      return input.scope === "org"
        ? `${job} would take your organization past its ${formatUsd(budget?.org.limitBytes ?? 0)} daily BigQuery limit for outside agents (spent ${formatUsd(budget?.org.settledBytes ?? 0)}, reserved ${formatUsd(budget?.org.reservedBytes ?? 0)}), so it was not started. An Analytics organization admin can raise the limit. Do not retry this call today.${untilReset(budget)}`
        : `${job} would take you past your ${formatUsd(budget?.person.limitBytes ?? 0)} daily BigQuery limit for outside agents (spent ${formatUsd(budget?.person.settledBytes ?? 0)}, reserved ${formatUsd(budget?.person.reservedBytes ?? 0)}), so it was not started. An Analytics organization admin can raise it. Do not retry this call today.${untilReset(budget)}`;
    case "budget_required":
      return "This tool cannot start BigQuery jobs for outside agents yet, so nothing ran. Use a tool whose description mentions the outside-agent BigQuery budget, or ask in the Analytics app.";
    case "budget_unavailable":
      return "The outside-agent BigQuery budget could not be read, so no job was started and nothing was charged. Try again in a few minutes.";
    case "admission_expired":
      return "The BigQuery job was not sent before its budget reservation lapsed, so it was not started. Its reservation is returned once BigQuery confirms the job does not exist; nothing is billed for it. Ask again.";
    case "estimate_unavailable":
      return `BigQuery's dry run gave no usable cost estimate for this job (${ESTIMATE_REASONS[input.estimateReason ?? "dry_run_failed"]}), so it was not started and nothing was charged. Try again in a few minutes.`;
  }
}

export interface OutsideAgentBigQueryAdmission {
  requestId: string;
  projectId: string;
  jobId: string;
  reservedBytes: number;
  estimatedBytes: number | null;
  created: boolean;
  exclusive: boolean;
  submitBy: number;
  utcDay: string;
}

export function submitByForLease(leaseExpiresAt: string): number {
  return Date.parse(leaseExpiresAt) - LEASE_SUBMIT_MARGIN_MS;
}

export function admissionLapsed(
  admission: Pick<OutsideAgentBigQueryAdmission, "submitBy">,
  now: number = Date.now(),
): boolean {
  return !(now <= admission.submitBy);
}

export interface OutsideAgentBigQueryJobCost {
  jobId: string;
  estimatedBytes: number | null;
  reservedBytes: number;
  billedBytes: number | null;
  cacheHit: boolean | null;
  state: "reserved" | "settled" | "released";
}

export interface OutsideAgentBigQueryCallSummary {
  source: string;
  jobsAdmitted: number;
  reservedBytes: number;
  billedBytes: number;
  unsettledBytes: number;
  cacheHits: number;
  jobs: OutsideAgentBigQueryJobCost[];
  refusal: OutsideAgentBigQueryRefusalError | null;
  budget: BigQueryAgentBudgetSnapshot | null;
}

export interface OutsideAgentBigQueryGate {
  readonly identity: OutsideAgentIdentity;
  readonly source: string;
  jobCapFor(requestedBytes: number): number;
  admit(input: {
    projectId: string;
    jobId: string;
    credentialScope: string;
    credentialFingerprint: string | null;
    exclusive: boolean;
    capBytes: number;
    estimate?: () => Promise<BigQueryBillableEstimate>;
    reconciler?: BigQueryAgentReconciler;
    location?: string | null;
  }): Promise<OutsideAgentBigQueryAdmission>;
  submitted(
    admission: OutsideAgentBigQueryAdmission,
    state: "accepted" | "unknown",
    location?: string,
  ): Promise<void>;
  rejected(admission: OutsideAgentBigQueryAdmission): Promise<void>;
  settle(
    admission: OutsideAgentBigQueryAdmission,
    observe: () => Promise<BigQueryJobBilling>,
  ): Promise<void>;
  summary(): OutsideAgentBigQueryCallSummary;
}

export type BigQueryBillableEstimate =
  | { status: "ok"; bytes: number }
  | { status: "zero_with_tables" }
  | {
      status: "unavailable";
      reason: BigQueryEstimateUnavailableReason;
    };

export function conservativeBillableEstimate(stats: {
  exactBytesProcessed?: number | "malformed";
  referencedTables?: readonly unknown[] | "malformed";
}): BigQueryBillableEstimate {
  if (stats.exactBytesProcessed === undefined) {
    return { status: "unavailable", reason: "missing_statistics" };
  }
  if (
    stats.exactBytesProcessed === "malformed" ||
    stats.referencedTables === "malformed"
  ) {
    return { status: "unavailable", reason: "malformed_statistics" };
  }
  const tables = stats.referencedTables?.length ?? 0;
  const bytes = stats.exactBytesProcessed;
  if (bytes === 0) {
    return tables > 0
      ? { status: "zero_with_tables" }
      : { status: "ok", bytes: 0 };
  }
  const mib = 1024 ** 2;
  return {
    status: "ok",
    bytes: Math.max(
      Math.ceil(bytes / mib) * mib,
      MIN_BILLED_BYTES_PER_QUERY * Math.max(1, tables),
    ),
  };
}

export function reservationForEstimate(estimate: number, cap: number): number {
  const mib = 1024 ** 2;
  const padded = Math.ceil((estimate + Math.ceil(estimate / 10)) / mib) * mib;
  return Math.min(cap, Math.max(MIN_BILLED_BYTES_PER_QUERY, padded));
}

export function createOutsideAgentBigQueryGate(options: {
  identity: OutsideAgentIdentity;
  source: string;
  reservation: "full-cap" | "dry-run";
  leaseMs: number;
  askVia?: string;
  now?: () => Date;
}): OutsideAgentBigQueryGate {
  const now = options.now ?? (() => new Date());
  const state: OutsideAgentBigQueryCallSummary = {
    source: options.source,
    jobsAdmitted: 0,
    reservedBytes: 0,
    billedBytes: 0,
    unsettledBytes: 0,
    cacheHits: 0,
    jobs: [],
    refusal: null,
    budget: null,
  };
  const open = new Map<string, OutsideAgentBigQueryAdmission>();
  const jobCosts = new Map<string, OutsideAgentBigQueryJobCost>();
  const close = (
    admission: OutsideAgentBigQueryAdmission,
    outcome: Pick<OutsideAgentBigQueryJobCost, "state"> &
      Partial<Pick<OutsideAgentBigQueryJobCost, "billedBytes" | "cacheHit">>,
  ) => {
    if (open.delete(admission.requestId) && admission.created) {
      state.unsettledBytes -= admission.reservedBytes;
      const cost = jobCosts.get(admission.requestId);
      if (cost) Object.assign(cost, outcome);
    }
  };
  const refuse = (error: OutsideAgentBigQueryRefusalError): never => {
    state.refusal ??= error;
    if (error.budget) state.budget = error.budget;
    throw error;
  };

  return {
    identity: options.identity,
    source: options.source,
    jobCapFor: (requestedBytes) =>
      Math.min(requestedBytes, OUTSIDE_AGENT_JOB_CAP_BYTES),
    async admit(input) {
      let estimatedBytes: number | null = null;
      if (options.reservation === "dry-run") {
        const estimate: BigQueryBillableEstimate = input.estimate
          ? await input.estimate()
          : { status: "unavailable", reason: "no_dry_run" };
        if (estimate.status === "unavailable") {
          refuse(
            new OutsideAgentBigQueryRefusalError({
              code: "estimate_unavailable",
              estimateReason: estimate.reason,
              budget: state.budget,
            }),
          );
        }
        estimatedBytes = estimate.status === "ok" ? estimate.bytes : null;
      }
      if (
        estimatedBytes !== null &&
        estimatedBytes > OUTSIDE_AGENT_JOB_CAP_BYTES
      ) {
        refuse(
          new OutsideAgentBigQueryRefusalError({
            code: "over_job_cap",
            scope: "job",
            reservedBytes: estimatedBytes,
            budget: state.budget,
          }),
        );
      }
      const reservedBytes =
        estimatedBytes === null
          ? input.capBytes
          : reservationForEstimate(estimatedBytes, input.capBytes);
      let result: Awaited<ReturnType<typeof admitBigQueryAgentJob>>;
      try {
        result = await admitBigQueryAgentJob(
          options.identity,
          {
            source: options.source,
            projectId: input.projectId,
            jobId: input.jobId,
            credentialScope: input.credentialScope,
            credentialFingerprint: input.credentialFingerprint,
            estimatedBytes:
              estimatedBytes === null
                ? null
                : Math.min(estimatedBytes, reservedBytes),
            reservedBytes,
            leaseMs: options.leaseMs,
            ...(input.location ? { location: input.location } : {}),
          },
          {
            now: now(),
            clock: now,
            ...(input.reconciler ? { reconcile: input.reconciler } : {}),
          },
        );
      } catch (error) {
        if (error instanceof BigQueryAgentBudgetUnavailableError) {
          return refuse(
            new OutsideAgentBigQueryRefusalError({
              code: "budget_unavailable",
            }),
          );
        }
        throw error;
      }
      state.budget = result.budget;
      if (result.status === "refused") {
        return refuse(
          new OutsideAgentBigQueryRefusalError({
            code: result.code,
            scope: result.scope,
            reservedBytes: result.reservedBytes,
            budget: result.budget,
            askVia: options.askVia ?? null,
          }),
        );
      }
      const submitBy = submitByForLease(result.leaseExpiresAt);
      if (!Number.isFinite(submitBy)) {
        return refuse(
          new OutsideAgentBigQueryRefusalError({ code: "budget_unavailable" }),
        );
      }
      const admission: OutsideAgentBigQueryAdmission = {
        submitBy,
        utcDay: result.utcDay,
        requestId: result.requestId,
        projectId: input.projectId,
        jobId: input.jobId,
        reservedBytes: result.reservedBytes,
        estimatedBytes,
        created: result.created,
        exclusive: input.exclusive && result.created,
      };
      open.set(admission.requestId, admission);
      if (admission.created) {
        state.jobsAdmitted += 1;
        state.reservedBytes += admission.reservedBytes;
        state.unsettledBytes += admission.reservedBytes;
        jobCosts.set(admission.requestId, {
          jobId: admission.jobId,
          estimatedBytes:
            estimatedBytes === null
              ? null
              : Math.min(estimatedBytes, admission.reservedBytes),
          reservedBytes: admission.reservedBytes,
          billedBytes: null,
          cacheHit: null,
          state: "reserved",
        });
      }
      return admission;
    },
    async submitted(admission, submissionState, location) {
      try {
        await markBigQueryAgentJobSubmission(
          admission.requestId,
          submissionState,
          location,
        );
      } catch {
        // coercion-ok: the row stays pending with its reservation, which is the safe state.
        console.warn("[bigquery-agent-budget] Submission state not recorded", {
          projectId: admission.projectId,
          jobId: admission.jobId,
        });
      }
    },
    async rejected(admission) {
      if (!admission.exclusive) return;
      try {
        await settleBigQueryAgentJob(
          admission.projectId,
          admission.jobId,
          { kind: "rejected" },
          now(),
        );
        close(admission, { state: "released" });
      } catch {
        // coercion-ok: an unreleased reservation stays counted until a reconciler confirms the job is absent.
        console.warn("[bigquery-agent-budget] Release failed; stays reserved", {
          projectId: admission.projectId,
          jobId: admission.jobId,
        });
      }
    },
    async settle(admission, observe) {
      if (!open.has(admission.requestId)) return;
      let observation: BigQueryJobBilling;
      try {
        observation = await observe();
      } catch {
        // coercion-ok: an unread job stays reserved for the reconciler.
        return;
      }
      if (observation.kind !== "found") return;
      const settlement = settlementForFinishedJob(observation);
      if (settlement?.kind !== "billed") return;
      try {
        await settleBigQueryAgentJob(
          admission.projectId,
          admission.jobId,
          settlement,
          now(),
        );
      } catch {
        // coercion-ok: a settlement that failed leaves the reservation counted until a reconciler settles it.
        return;
      }
      if (admission.created) state.billedBytes += settlement.billedBytes;
      if (settlement.cacheHit === true) state.cacheHits += 1;
      close(admission, {
        state: "settled",
        billedBytes: settlement.billedBytes,
        cacheHit: settlement.cacheHit,
      });
    },
    summary: () => ({
      ...state,
      jobs: [...jobCosts.values()].map((cost) => ({ ...cost })),
    }),
  };
}

export function childOutsideAgentBigQueryGate(
  parent: OutsideAgentBigQueryGate,
): OutsideAgentBigQueryGate {
  let refusal: OutsideAgentBigQueryRefusalError | null = null;
  return {
    identity: parent.identity,
    source: parent.source,
    jobCapFor: (bytes) => parent.jobCapFor(bytes),
    async admit(input) {
      try {
        return await parent.admit(input);
      } catch (error) {
        if (error instanceof OutsideAgentBigQueryRefusalError)
          refusal ??= error;
        throw error;
      }
    },
    submitted: (admission, state, location) =>
      parent.submitted(admission, state, location),
    rejected: (admission) => parent.rejected(admission),
    settle: (admission, observe) => parent.settle(admission, observe),
    summary: () => ({ ...parent.summary(), refusal }),
  };
}

const gates = new AsyncLocalStorage<OutsideAgentBigQueryGate>();

export function currentOutsideAgentBigQueryGate():
  | OutsideAgentBigQueryGate
  | undefined {
  return gates.getStore();
}

export function withOutsideAgentBigQueryGate<T>(
  gate: OutsideAgentBigQueryGate,
  work: () => Promise<T>,
): Promise<T> {
  return gates.run(gate, work);
}

export function bigQueryJobGate(): OutsideAgentBigQueryGate | undefined {
  const gate = gates.getStore();
  if (gate) return gate;
  if (isOutsideAgentCaller(currentActionOriginCaller())) {
    throw new OutsideAgentBigQueryRefusalError({ code: "budget_required" });
  }
  return undefined;
}
