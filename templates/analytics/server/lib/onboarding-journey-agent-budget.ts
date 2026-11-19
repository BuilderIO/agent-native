import {
  BigQueryAgentBudgetUnavailableError,
  budgetRefusalFor,
  readBigQueryAgentBudget,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import { OutsideAgentBigQueryRefusalError } from "./bigquery-agent-context.js";
import { createRequestBigQueryAgentReconciler } from "./bigquery.js";
import {
  ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_FOLLOWUP_MAX_BYTES_BILLED,
} from "./onboarding-journey.js";

export async function outsideAgentOnboardingEventBytes(
  identity: OutsideAgentIdentity,
  requestedBytes: number | undefined,
  call: {
    followUpMode: "session" | "person";
    experimentId?: string | undefined;
    splitDesignFirstTouch?: boolean | undefined;
  },
  signal?: AbortSignal,
): Promise<{
  requested: number;
  applied: number;
  refusal: OutsideAgentBigQueryRefusalError | null;
}> {
  const requested =
    requestedBytes ??
    ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED;
  let budget;
  try {
    budget = await readBigQueryAgentBudget(identity, {
      reconcile: await createRequestBigQueryAgentReconciler(signal),
    });
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) {
      throw new OutsideAgentBigQueryRefusalError({
        code: "budget_unavailable",
      });
    }
    throw error;
  }
  const followUpQueries =
    call.experimentId || call.splitDesignFirstTouch
      ? 0
      : call.followUpMode === "person"
        ? 2
        : 1;
  const followUpBytes = followUpQueries * ONBOARDING_FOLLOWUP_MAX_BYTES_BILLED;
  const available = Math.min(
    budget.person.remainingBytes,
    budget.org.remainingBytes,
  );
  const pages = Math.floor(
    (available - followUpBytes) / ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  );
  const smallestCall = ONBOARDING_EVENTS_MAX_BYTES_BILLED + followUpBytes;
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
          }),
  };
}
