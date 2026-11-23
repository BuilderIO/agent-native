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

export interface OutsideAgentBigQueryReport {
  thisCall: {
    jobsAdmitted: number;
    reservedUsd: number;
    billedUsd: number;
    stillReservedUsd: number;
    cacheHits: number;
  };
  jobs: OutsideAgentBigQueryJobReport[];
  jobsOmitted?: number;
  today: BigQueryAgentBudgetView | null;
  refusal?: { code: string; message: string };
}

export interface OutsideAgentBigQueryJobReport {
  jobId: string;
  estimatedUsd: number | null;
  reservedUsd: number;
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
  askVia?: string;
}

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

export async function reportOutsideAgentBigQueryCall<T extends object>(
  call: OutsideAgentBigQueryCall | null,
  work: () => Promise<T>,
): Promise<T & { bigQueryBudget?: OutsideAgentBigQueryReport }> {
  if (!call) return work();
  let value: T;
  try {
    value = await work();
  } catch (error) {
    await attachCallReport(call, error);
    throw error;
  }
  if (call.gate.summary().jobsAdmitted === 0) return value;
  return { ...value, bigQueryBudget: await call.report() };
}

const callReports = new WeakMap<object, OutsideAgentBigQueryReport>();

export function outsideAgentCallReportOf(
  error: unknown,
): OutsideAgentBigQueryReport | undefined {
  return typeof error === "object" && error !== null
    ? callReports.get(error)
    : undefined;
}

async function attachCallReport(
  call: OutsideAgentBigQueryCall,
  error: unknown,
): Promise<void> {
  if (
    call.gate.summary().jobsAdmitted === 0 ||
    typeof error !== "object" ||
    error === null ||
    callReports.has(error)
  ) {
    return;
  }
  let report: OutsideAgentBigQueryReport;
  try {
    report = await call.report();
  } catch {
    // coercion-ok: the failure itself is what the caller must see; the spend stays recorded in the ledger.
    return;
  }
  callReports.set(error, report);
  appendToMessage(error, describeOutsideAgentBigQueryReport(report));
}

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

export async function runOutsideAgentBigQueryCall<T>(
  options: OutsideAgentBigQueryCallOptions,
  work: () => Promise<T>,
): Promise<{ value: T; report: OutsideAgentBigQueryReport }> {
  const call = createOutsideAgentBigQueryCall(options);
  let value: T;
  try {
    value = await withOutsideAgentBigQueryGate(call.gate, work);
  } catch (error) {
    let failure = error;
    for (let cause: unknown = error; cause; ) {
      if (cause instanceof OutsideAgentBigQueryRefusalError) {
        failure = cause;
        break;
      }
      cause =
        cause instanceof Error
          ? (cause as Error & { cause?: unknown }).cause
          : undefined;
    }
    await attachCallReport(call, failure);
    throw failure;
  }
  return { value, report: await call.report() };
}

export function outsideAgentRefusalReport(
  error: OutsideAgentBigQueryRefusalError,
): OutsideAgentBigQueryReport {
  const spent = outsideAgentCallReportOf(error);
  return {
    thisCall: spent?.thisCall ?? {
      jobsAdmitted: 0,
      reservedUsd: 0,
      billedUsd: 0,
      stillReservedUsd: 0,
      cacheHits: 0,
    },
    jobs: spent?.jobs ?? [],
    ...(spent?.jobsOmitted ? { jobsOmitted: spent.jobsOmitted } : {}),
    today:
      spent?.today ??
      (error.budget ? describeBigQueryAgentBudget(error.budget) : null),
    refusal: { code: error.code, message: error.message },
  };
}

export function failForOutsideAgentRefusal(
  error: OutsideAgentBigQueryRefusalError,
  details?: Record<string, unknown>,
): never {
  return fail(error.message, {
    errorCode: error.code,
    statusCode:
      error.code === "budget_unavailable" ||
      error.code === "estimate_unavailable"
        ? 503
        : error.code === "budget_required"
          ? 403
          : error.code === "over_job_cap"
            ? 422
            : 429,
    ...(details ? { details } : {}),
  });
}
