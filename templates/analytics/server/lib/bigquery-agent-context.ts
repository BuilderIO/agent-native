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

// Time left on a lease when a job may no longer be sent under it.
const LEASE_SUBMIT_MARGIN_MS = 15_000;

/**
 * An outside agent is an MCP client calling Analytics' tools. Its caller is set
 * by core's MCP dispatcher, never by anything the tool call sends. MCP App
 * widgets (`mcp-widget*`) are a person clicking in a rendered Analytics view
 * and keep the in-app behavior.
 */
export function isOutsideAgentCaller(
  caller: ActionCaller | undefined,
): boolean {
  return caller === "mcp";
}

export type OutsideAgentBigQueryRefusalCode =
  | BigQueryAgentRefusalCode
  | "budget_required"
  | "budget_unavailable"
  | "admission_expired";

/** A job an outside agent asked for was not started. */
export class OutsideAgentBigQueryRefusalError extends Error {
  readonly code: OutsideAgentBigQueryRefusalCode;
  readonly scope: "job" | "person" | "org" | null;
  readonly reservedBytes: number | null;
  readonly budget: BigQueryAgentBudgetSnapshot | null;

  constructor(input: {
    code: OutsideAgentBigQueryRefusalCode;
    scope?: "job" | "person" | "org" | null;
    reservedBytes?: number | null;
    budget?: BigQueryAgentBudgetSnapshot | null;
  }) {
    super(refusalMessage(input));
    this.name = "OutsideAgentBigQueryRefusalError";
    this.code = input.code;
    this.scope = input.scope ?? null;
    this.reservedBytes = input.reservedBytes ?? null;
    this.budget = input.budget ?? null;
  }
}

function untilReset(budget: BigQueryAgentBudgetSnapshot | null | undefined) {
  return budget ? ` It resets at ${budget.resetsAt} (00:00 UTC).` : "";
}

/** Each refusal names the next step and when it resets, and never invites the same call again. */
export function refusalMessage(input: {
  code: OutsideAgentBigQueryRefusalCode;
  scope?: "job" | "person" | "org" | null;
  reservedBytes?: number | null;
  budget?: BigQueryAgentBudgetSnapshot | null;
}): string {
  const { budget } = input;
  const job =
    input.reservedBytes === null || input.reservedBytes === undefined
      ? "This BigQuery job"
      : `This BigQuery job (up to ${formatUsd(input.reservedBytes)})`;
  switch (input.code) {
    case "over_job_cap":
      return `${job} is over the ${formatUsd(OUTSIDE_AGENT_JOB_CAP_BYTES)} (50 GB) per-job limit for outside agents, so it was not started. Narrow the date range or select fewer columns, then ask again.`;
    case "approval_required":
      return `${job} would take you past your ${formatUsd(budget?.person.baseAllowanceBytes ?? 0)} no-ask BigQuery allowance for today (spent ${formatUsd(budget?.person.settledBytes ?? 0)}, reserved ${formatUsd(budget?.person.reservedBytes ?? 0)}). Approving more from an outside agent is not available yet, so this is a stop for today; an Analytics organization admin can raise your daily allowance. Do not retry this call today.${untilReset(budget)}`;
    case "budget_exhausted":
      return input.scope === "org"
        ? `${job} would take your organization past its ${formatUsd(budget?.org.limitBytes ?? 0)} daily BigQuery limit for outside agents (spent ${formatUsd(budget?.org.settledBytes ?? 0)}, reserved ${formatUsd(budget?.org.reservedBytes ?? 0)}), so it was not started. An Analytics organization admin can raise the limit. Do not retry this call today.${untilReset(budget)}`
        : `${job} would take you past your ${formatUsd(budget?.person.limitBytes ?? 0)} daily BigQuery limit for outside agents (spent ${formatUsd(budget?.person.settledBytes ?? 0)}, reserved ${formatUsd(budget?.person.reservedBytes ?? 0)}), so it was not started. An Analytics organization admin can raise it. Do not retry this call today.${untilReset(budget)}`;
    case "budget_required":
      return "This tool cannot start BigQuery jobs for outside agents yet, so nothing ran. Use a tool whose description mentions the outside-agent BigQuery budget, or ask in the Analytics app.";
    case "budget_unavailable":
      return "The outside-agent BigQuery budget could not be read, so no job was started and nothing was charged. Try again in a few minutes.";
    case "admission_expired":
      return "The BigQuery job was not sent before its budget reservation lapsed, so it was not started and nothing was charged. Ask again.";
  }
}

export interface OutsideAgentBigQueryAdmission {
  requestId: string;
  projectId: string;
  jobId: string;
  reservedBytes: number;
  estimatedBytes: number | null;
  /** This call created the reservation; false when it reuses an earlier admission of the job. */
  created: boolean;
  /** Epoch ms after which the job must not be sent: a reconciler may release it by then. */
  submitBy: number;
}

/** What one tool call's jobs reserved and billed, for its response. */
export interface OutsideAgentBigQueryCallSummary {
  source: string;
  jobsAdmitted: number;
  reservedBytes: number;
  billedBytes: number;
  /** Reservations no settlement confirmed before the response: they stay reserved. */
  unsettledBytes: number;
  cacheHits: number;
  refusal: OutsideAgentBigQueryRefusalError | null;
  budget: BigQueryAgentBudgetSnapshot | null;
}

export interface OutsideAgentBigQueryGate {
  readonly identity: OutsideAgentIdentity;
  readonly source: string;
  /** The per-job cap a job runs under: the caller's, never more than 50 GB. */
  jobCapFor(requestedBytes: number): number;
  admit(input: {
    projectId: string;
    jobId: string;
    credentialScope: string;
    capBytes: number;
    /** Conservative billable bytes from a dry run, or null when it gave none. */
    estimate?: () => Promise<number | null>;
    reconciler?: BigQueryAgentReconciler;
  }): Promise<OutsideAgentBigQueryAdmission>;
  submitted(
    admission: OutsideAgentBigQueryAdmission,
    state: "accepted" | "unknown",
    location?: string,
  ): Promise<void>;
  /** BigQuery refused to create this call's job: nothing ran. */
  rejected(admission: OutsideAgentBigQueryAdmission): Promise<void>;
  settle(
    admission: OutsideAgentBigQueryAdmission,
    observe: () => Promise<BigQueryJobBilling>,
  ): Promise<void>;
  summary(): OutsideAgentBigQueryCallSummary;
}

export type BigQueryBillableEstimate =
  | { status: "ok"; bytes: number }
  /** Tables are read but the dry run reports zero bytes, so it is not an estimate. */
  | { status: "zero_with_tables" }
  | {
      status: "unavailable";
      reason: "missing_statistics" | "malformed_statistics";
    };

/**
 * The most a dry-run statement can bill on demand: processed bytes rounded up
 * to a whole MiB, and at least 10 MiB per referenced table (and per query that
 * reads one). Missing or malformed statistics are never zero.
 */
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

/** Reservation for a dry-run estimate: a tenth more, whole MiB, at least the 10 MiB minimum. */
export function reservationForEstimate(estimate: number, cap: number): number {
  const mib = 1024 ** 2;
  const padded = Math.ceil((estimate + Math.ceil(estimate / 10)) / mib) * mib;
  return Math.min(cap, Math.max(MIN_BILLED_BYTES_PER_QUERY, padded));
}

export function createOutsideAgentBigQueryGate(options: {
  identity: OutsideAgentIdentity;
  source: string;
  /**
   * `full-cap` reserves the whole per-job cap for fixed internal SQL;
   * `dry-run` reserves from the job's own dry run, and the whole cap when the
   * dry run gives no usable estimate.
   */
  reservation: "full-cap" | "dry-run";
  leaseMs: number;
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
    refusal: null,
    budget: null,
  };
  const open = new Map<string, OutsideAgentBigQueryAdmission>();
  const close = (admission: OutsideAgentBigQueryAdmission) => {
    if (open.delete(admission.requestId) && admission.created) {
      state.unsettledBytes -= admission.reservedBytes;
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
      if (options.reservation === "dry-run" && input.estimate) {
        estimatedBytes = await input.estimate();
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
            estimatedBytes:
              estimatedBytes === null
                ? null
                : Math.min(estimatedBytes, reservedBytes),
            reservedBytes,
            leaseMs: options.leaseMs,
          },
          {
            now: now(),
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
          }),
        );
      }
      const admission: OutsideAgentBigQueryAdmission = {
        submitBy: now().getTime() + options.leaseMs - LEASE_SUBMIT_MARGIN_MS,
        requestId: result.requestId,
        projectId: input.projectId,
        jobId: input.jobId,
        reservedBytes: result.reservedBytes,
        estimatedBytes,
        created: result.created,
      };
      open.set(admission.requestId, admission);
      if (admission.created) {
        state.jobsAdmitted += 1;
        state.reservedBytes += admission.reservedBytes;
        state.unsettledBytes += admission.reservedBytes;
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
      if (!admission.created) return;
      try {
        await settleBigQueryAgentJob(
          admission.projectId,
          admission.jobId,
          { kind: "rejected" },
          now(),
        );
        close(admission);
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
      close(admission);
    },
    summary: () => ({ ...state }),
  };
}

/**
 * A view of `parent` for one unit of work inside a call, such as one panel:
 * it admits through the parent's budget and remembers only its own refusal,
 * so concurrent units can tell which of them was refused.
 */
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

/** Runs `work` with every BigQuery job it starts admitted through `gate`. */
export function withOutsideAgentBigQueryGate<T>(
  gate: OutsideAgentBigQueryGate,
  work: () => Promise<T>,
): Promise<T> {
  return gates.run(gate, work);
}

/**
 * The gate a BigQuery job about to start must go through. Without one, a job
 * an outside agent's tool call started is refused: a path that forgot its
 * budget fails closed instead of running unbounded.
 */
export function bigQueryJobGate(): OutsideAgentBigQueryGate | undefined {
  const gate = gates.getStore();
  if (gate) return gate;
  if (isOutsideAgentCaller(currentActionOriginCaller())) {
    throw new OutsideAgentBigQueryRefusalError({ code: "budget_required" });
  }
  return undefined;
}
