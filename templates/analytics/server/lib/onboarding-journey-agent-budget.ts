import {
  BigQueryAgentBudgetUnavailableError,
  budgetRefusalFor,
  readBigQueryAgentBudget,
  type BigQueryAgentBudgetSnapshot,
  type BigQueryAgentReconciler,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import { OutsideAgentBigQueryRefusalError } from "./bigquery-agent-context.js";
import { createRequestBigQueryAgentReconciler } from "./bigquery.js";
import {
  ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_FOLLOWUP_MAX_BYTES_BILLED,
} from "./onboarding-journey.js";

export interface OutsideAgentOnboardingCall {
  followUpMode: "session" | "person";
  experimentId?: string | undefined;
  splitDesignFirstTouch?: boolean | undefined;
}

export interface OutsideAgentOnboardingBytes {
  requested: number;
  applied: number;
  refusal: OutsideAgentBigQueryRefusalError | null;
}

async function requestReconciler(
  signal: AbortSignal | undefined,
): Promise<BigQueryAgentReconciler | null> {
  try {
    return await createRequestBigQueryAgentReconciler(signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(
      "[onboarding-journey] BigQuery access unavailable for budget reconciliation",
      { errorType: error instanceof Error ? error.name : "non_error" },
    );
    // coercion-ok: without BigQuery access the journey's own read reports the credential failure.
    return null;
  }
}

export function onboardingFollowUpBytes(
  call: OutsideAgentOnboardingCall,
): number {
  const followUpQueries =
    call.experimentId || call.splitDesignFirstTouch
      ? 0
      : call.followUpMode === "person"
        ? 2
        : 1;
  return followUpQueries * ONBOARDING_FOLLOWUP_MAX_BYTES_BILLED;
}

export function smallestOutsideAgentOnboardingCall(
  call: OutsideAgentOnboardingCall,
): number {
  return ONBOARDING_EVENTS_MAX_BYTES_BILLED + onboardingFollowUpBytes(call);
}

export function planOutsideAgentOnboardingBytes(
  budget: BigQueryAgentBudgetSnapshot,
  requestedBytes: number | undefined,
  call: OutsideAgentOnboardingCall,
  askVia?: string,
): OutsideAgentOnboardingBytes {
  const requested =
    requestedBytes ??
    ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED;
  const followUpBytes = onboardingFollowUpBytes(call);
  const available = Math.min(
    budget.person.remainingBytes,
    budget.org.remainingBytes,
  );
  const pages = Math.floor(
    (available - followUpBytes) / ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  );
  const smallestCall = smallestOutsideAgentOnboardingCall(call);
  return {
    requested,
    applied: Math.min(
      requested,
      Math.max(1, pages) * ONBOARDING_EVENTS_MAX_BYTES_BILLED,
    ),
    refusal:
      pages >= 1
        ? null
        : new OutsideAgentBigQueryRefusalError({
            ...(budgetRefusalFor(budget, smallestCall) ?? {
              code: "budget_exhausted",
              scope: "person",
            }),
            reservedBytes: smallestCall,
            budget,
            askVia: askVia ?? null,
          }),
  };
}

export function approvedOutsideAgentOnboardingBound(
  budget: BigQueryAgentBudgetSnapshot,
  requestedBytes: number | undefined,
  call: OutsideAgentOnboardingCall,
): number {
  const unspent: BigQueryAgentBudgetSnapshot = {
    ...budget,
    person: { ...budget.person, remainingBytes: budget.person.ceilingBytes },
    org: { ...budget.org, remainingBytes: budget.org.limitBytes },
  };
  const plan = planOutsideAgentOnboardingBytes(unspent, requestedBytes, call);
  return plan.refusal
    ? smallestOutsideAgentOnboardingCall(call)
    : plan.applied + onboardingFollowUpBytes(call);
}

export async function outsideAgentOnboardingEventBytes(
  identity: OutsideAgentIdentity,
  requestedBytes: number | undefined,
  call: OutsideAgentOnboardingCall,
  signal?: AbortSignal,
  askVia?: string,
): Promise<OutsideAgentOnboardingBytes> {
  let budget;
  let reconciled = false;
  try {
    const reconcile = await requestReconciler(signal);
    reconciled = reconcile !== null;
    budget = await readBigQueryAgentBudget(
      identity,
      reconcile ? { reconcile } : {},
    );
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) {
      throw new OutsideAgentBigQueryRefusalError({
        code: "budget_unavailable",
      });
    }
    throw error;
  }
  const plan = planOutsideAgentOnboardingBytes(
    budget,
    requestedBytes,
    call,
    askVia,
  );
  const mayCountFinishedJobs =
    !reconciled &&
    (budget.person.reservedBytes > 0 || budget.org.reservedBytes > 0);
  return plan.refusal && mayCountFinishedJobs
    ? {
        ...plan,
        refusal: new OutsideAgentBigQueryRefusalError({
          code: "budget_unavailable",
        }),
      }
    : plan;
}
