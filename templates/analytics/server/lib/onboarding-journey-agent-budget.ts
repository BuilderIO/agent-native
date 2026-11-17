import {
  BigQueryAgentBudgetUnavailableError,
  budgetRefusalFor,
  readBigQueryAgentBudget,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import { OutsideAgentBigQueryRefusalError } from "./bigquery-agent-context.js";
import {
  ONBOARDING_EVENTS_MAX_BYTES_BILLED,
  ONBOARDING_EVENTS_OUTSIDE_AGENT_DEFAULT_MAX_TOTAL_BYTES_BILLED,
  ONBOARDING_FOLLOWUP_MAX_BYTES_BILLED,
} from "./onboarding-journey.js";

/**
 * The event-read allowance an outside agent's onboarding journey runs with:
 * what it asked for (125 GB unless it said otherwise), capped at the event
 * pages its remaining budget pays for after the follow-up queries the call
 * will also run. The cost estimate uses the same allowance, so an agent plans
 * with the pages the journey will actually read.
 *
 * When not even one page fits, `refusal` says why, as admission would. The
 * journey still runs with one page, so its refusal comes from admission with
 * the budget it saw; the estimate answers with `refusal` instead.
 */
export async function outsideAgentOnboardingEventBytes(
  identity: OutsideAgentIdentity,
  requestedBytes: number | undefined,
  followUpQueries: number,
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
    budget = await readBigQueryAgentBudget(identity);
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) {
      throw new OutsideAgentBigQueryRefusalError({
        code: "budget_unavailable",
      });
    }
    throw error;
  }
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
