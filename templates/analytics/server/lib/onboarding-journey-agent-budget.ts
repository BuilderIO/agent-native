import {
  BigQueryAgentBudgetUnavailableError,
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
 * will also run. At least one page, so a refusal comes from admission with
 * the budget it saw. The cost estimate uses the same allowance, so an agent
 * plans with the pages the journey will actually read.
 */
export async function outsideAgentOnboardingEventBytes(
  identity: OutsideAgentIdentity,
  requestedBytes: number | undefined,
  followUpQueries: number,
): Promise<{ requested: number; applied: number }> {
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
  const available = Math.min(
    budget.person.remainingBytes,
    budget.org.remainingBytes,
  );
  const pages = Math.max(
    1,
    Math.floor(
      (available - followUpQueries * ONBOARDING_FOLLOWUP_MAX_BYTES_BILLED) /
        ONBOARDING_EVENTS_MAX_BYTES_BILLED,
    ),
  );
  return {
    requested,
    applied: Math.min(requested, pages * ONBOARDING_EVENTS_MAX_BYTES_BILLED),
  };
}
