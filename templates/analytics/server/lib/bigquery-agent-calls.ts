import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  describeBigQueryAgentBudget,
  readBigQueryAgentBudget,
  usd,
  type BigQueryAgentBudgetView,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import {
  createOutsideAgentBigQueryGate,
  OutsideAgentBigQueryRefusalError,
  withOutsideAgentBigQueryGate,
  type OutsideAgentBigQueryCallSummary,
  type OutsideAgentBigQueryGate,
  type OutsideAgentBigQueryJobCost,
} from "./bigquery-agent-context.js";

const budgetScopeSchema = z.object({
  limitUsd: z.number(),
  spentUsd: z.number(),
  reservedUsd: z.number(),
  remainingUsd: z.number(),
  remainingBytes: z.number(),
});

/** The report as an action's output contract, for actions that declare one. */
export const outsideAgentBigQueryReportSchema = z.object({
  thisCall: z.object({
    jobsAdmitted: z.number(),
    reservedUsd: z.number(),
    billedUsd: z.number(),
    stillReservedUsd: z.number(),
    cacheHits: z.number(),
  }),
  jobs: z.array(
    z.object({
      jobId: z.string(),
      estimatedUsd: z.number().nullable(),
      reservedUsd: z.number(),
      billedUsd: z.number().nullable(),
      cacheHit: z.boolean().nullable(),
      state: z.enum(["reserved", "settled", "released"]),
    }),
  ),
  jobsOmitted: z.number().optional(),
  today: z
    .object({
      utcDay: z.string(),
      resetsAt: z.string(),
      pricing: z.string(),
      perJobCap: z.object({ bytes: z.number(), usd: z.number() }),
      person: budgetScopeSchema.extend({
        noAskAllowanceUsd: z.number(),
        ceilingUsd: z.number(),
        approvedToday: z.boolean(),
      }),
      org: budgetScopeSchema,
      limitsSource: z.object({
        person: z.enum(["default", "admin"]),
        org: z.enum(["default", "admin"]),
      }),
    })
    .nullable(),
  refusal: z.object({ code: z.string(), message: z.string() }).optional(),
});

/** What an outside agent's tool call spent, for its response. */
export interface OutsideAgentBigQueryReport {
  thisCall: {
    jobsAdmitted: number;
    /** Reserved before the jobs ran: the estimate, capped by each job's limit. */
    reservedUsd: number;
    /** BigQuery's own billed bytes for the jobs settled so far. */
    billedUsd: number;
    /** Reservations no settlement confirmed yet; they count until one does. */
    stillReservedUsd: number;
    cacheHits: number;
  };
  /** Each job this call admitted: its estimate, reservation, and BigQuery's billed cost once settled. */
  jobs: OutsideAgentBigQueryJobReport[];
  /** Jobs past the listed ones; `thisCall` counts them all. */
  jobsOmitted?: number;
  /** Today's budgets after this call; null when they could not be read. */
  today: BigQueryAgentBudgetView | null;
  /** The job the budget refused, when a call reports a refusal instead of failing. */
  refusal?: { code: string; message: string };
}

export interface OutsideAgentBigQueryJobReport {
  jobId: string;
  /** The dry run's conservative estimate; null for fixed internal SQL reserved at its cap. */
  estimatedUsd: number | null;
  reservedUsd: number;
  /** Null until BigQuery's billed bytes settled the job. */
  billedUsd: number | null;
  cacheHit: boolean | null;
  state: OutsideAgentBigQueryJobCost["state"];
}

const MAX_REPORTED_JOBS = 20;

export function outsideAgentBigQueryReport(
  summary: OutsideAgentBigQueryCallSummary,
  today: BigQueryAgentBudgetView | null,
): OutsideAgentBigQueryReport {
  return {
    thisCall: {
      jobsAdmitted: summary.jobsAdmitted,
      reservedUsd: usd(summary.reservedBytes),
      billedUsd: usd(summary.billedBytes),
      stillReservedUsd: usd(Math.max(0, summary.unsettledBytes)),
      cacheHits: summary.cacheHits,
    },
    jobs: summary.jobs.slice(0, MAX_REPORTED_JOBS).map((job) => ({
      jobId: job.jobId,
      estimatedUsd:
        job.estimatedBytes === null ? null : usd(job.estimatedBytes),
      reservedUsd: usd(job.reservedBytes),
      billedUsd: job.billedBytes === null ? null : usd(job.billedBytes),
      cacheHit: job.cacheHit,
      state: job.state,
    })),
    ...(summary.jobs.length > MAX_REPORTED_JOBS
      ? { jobsOmitted: summary.jobs.length - MAX_REPORTED_JOBS }
      : {}),
    today,
    // A job refused partway, such as a follow-up the call reported as partial.
    ...(summary.refusal
      ? {
          refusal: {
            code: summary.refusal.code,
            message: summary.refusal.message,
          },
        }
      : {}),
  };
}

async function todayView(
  identity: OutsideAgentIdentity,
): Promise<BigQueryAgentBudgetView | null> {
  try {
    return describeBigQueryAgentBudget(await readBigQueryAgentBudget(identity));
  } catch {
    // coercion-ok: the call's own result stands; an unread budget is null, not zero.
    return null;
  }
}

function dollars(value: number): string {
  return value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

/** The report as one sentence, for a failure whose message is all the caller sees. */
export function describeOutsideAgentBigQueryReport(
  report: OutsideAgentBigQueryReport,
): string {
  const call = report.thisCall;
  const today = report.today
    ? ` Left today: ${dollars(report.today.person.remainingUsd)} of your ${dollars(report.today.person.limitUsd)} and ${dollars(report.today.org.remainingUsd)} of your organization's ${dollars(report.today.org.limitUsd)}; it resets at ${report.today.resetsAt} (00:00 UTC).`
    : "";
  return `BigQuery jobs this call ran against your outside-agent budget: ${call.jobsAdmitted}, reserved ${dollars(call.reservedUsd)}, billed ${dollars(call.billedUsd)}, still reserved ${dollars(call.stillReservedUsd)}.${today}`;
}

export interface OutsideAgentBigQueryCallOptions {
  identity: OutsideAgentIdentity;
  source: string;
  reservation: "full-cap" | "dry-run";
  leaseMs: number;
}

/** One call's gate, for work spread over several steps, and its report so far. */
export interface OutsideAgentBigQueryCall {
  readonly gate: OutsideAgentBigQueryGate;
  report(): Promise<OutsideAgentBigQueryReport>;
}

export function createOutsideAgentBigQueryCall(
  options: OutsideAgentBigQueryCallOptions,
): OutsideAgentBigQueryCall {
  const gate = createOutsideAgentBigQueryGate(options);
  return {
    gate,
    report: async () =>
      outsideAgentBigQueryReport(
        gate.summary(),
        await todayView(options.identity),
      ),
  };
}

/**
 * Ends a tool call whose jobs `call` admits, on whichever path it ends. Once
 * it has admitted a job, a result carries the call's `bigQueryBudget`, and a
 * failure keeps its class, status and code but names the spend in its
 * message, which is all an MCP client sees. With no call, or no job admitted,
 * it ends exactly as `work` did.
 */
export async function reportOutsideAgentBigQueryCall<T extends object>(
  call: OutsideAgentBigQueryCall | null,
  work: () => Promise<T>,
): Promise<T & { bigQueryBudget?: OutsideAgentBigQueryReport }> {
  if (!call) return work();
  let value: T;
  try {
    value = await work();
  } catch (error) {
    if (call.gate.summary().jobsAdmitted > 0) {
      appendToMessage(
        error,
        describeOutsideAgentBigQueryReport(await call.report()),
      );
    }
    throw error;
  }
  if (call.gate.summary().jobsAdmitted === 0) return value;
  return { ...value, bigQueryBudget: await call.report() };
}

/** In place, so whatever reads the failure's class or fields still sees them. */
function appendToMessage(error: unknown, sentence: string): void {
  if (!(error instanceof Error)) return;
  const own = Object.getOwnPropertyDescriptor(error, "message");
  if (own ? !own.configurable : !Object.isExtensible(error)) return;
  Object.defineProperty(error, "message", {
    value: `${error.message} ${sentence}`,
    writable: true,
    configurable: true,
  });
}

/**
 * Runs an outside agent's tool call with every BigQuery job it starts
 * admitted against the daily budgets. A refused job surfaces as the refusal,
 * whatever the code under it made of the error.
 */
export async function runOutsideAgentBigQueryCall<T>(
  options: OutsideAgentBigQueryCallOptions,
  work: () => Promise<T>,
): Promise<{ value: T; report: OutsideAgentBigQueryReport }> {
  const call = createOutsideAgentBigQueryCall(options);
  let value: T;
  try {
    value = await withOutsideAgentBigQueryGate(call.gate, work);
  } catch (error) {
    // Only a refusal that caused this failure is reported as one; a refusal
    // the work already handled must not mask a later, unrelated error.
    for (let cause: unknown = error; cause; ) {
      if (cause instanceof OutsideAgentBigQueryRefusalError) throw cause;
      cause =
        cause instanceof Error
          ? (cause as Error & { cause?: unknown }).cause
          : undefined;
    }
    throw error;
  }
  return { value, report: await call.report() };
}

/** A refusal as a report, for a tool whose contract answers with partial data instead of failing. */
export function outsideAgentRefusalReport(
  error: OutsideAgentBigQueryRefusalError,
): OutsideAgentBigQueryReport {
  return {
    thisCall: {
      jobsAdmitted: 0,
      reservedUsd: 0,
      billedUsd: 0,
      stillReservedUsd: 0,
      cacheHits: 0,
    },
    jobs: [],
    today: error.budget ? describeBigQueryAgentBudget(error.budget) : null,
    refusal: { code: error.code, message: error.message },
  };
}

/** A refusal as the action's typed failure: its code, message, and next step. */
export function failForOutsideAgentRefusal(
  error: OutsideAgentBigQueryRefusalError,
): never {
  return fail(error.message, {
    errorCode: error.code,
    statusCode:
      error.code === "budget_unavailable" ||
      error.code === "estimate_unavailable"
        ? 503
        : error.code === "budget_required"
          ? 403
          : 429,
  });
}
