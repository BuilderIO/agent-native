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
  /** Today's budgets after this call; null when they could not be read. */
  today: BigQueryAgentBudgetView | null;
  /** The job the budget refused, when a call reports a refusal instead of failing. */
  refusal?: { code: string; message: string };
}

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

/**
 * Runs an outside agent's tool call with every BigQuery job it starts
 * admitted against the daily budgets. A refused job surfaces as the refusal,
 * whatever the code under it made of the error.
 */
export async function runOutsideAgentBigQueryCall<T>(
  options: {
    identity: OutsideAgentIdentity;
    source: string;
    reservation: "full-cap" | "dry-run";
    leaseMs: number;
  },
  work: () => Promise<T>,
): Promise<{ value: T; report: OutsideAgentBigQueryReport }> {
  const gate = createOutsideAgentBigQueryGate(options);
  let value: T;
  try {
    value = await withOutsideAgentBigQueryGate(gate, work);
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
  return {
    value,
    report: outsideAgentBigQueryReport(
      gate.summary(),
      await todayView(options.identity),
    ),
  };
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
      error.code === "budget_unavailable"
        ? 503
        : error.code === "budget_required"
          ? 403
          : 429,
  });
}
