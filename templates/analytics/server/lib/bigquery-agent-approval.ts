import {
  currentActionApproval,
  currentActionApprovalAskedAt,
  type ActionRunContext,
} from "@agent-native/core/action";

import {
  approveBigQueryAgentDailyAllowance,
  BigQueryAgentBudgetUnavailableError,
  budgetRefusalFor,
  formatUsd,
  outsideAgentIdentity,
  readBigQueryAgentBudget,
  utcDay,
  type BigQueryAgentBudgetSnapshot,
  type OutsideAgentIdentity,
} from "./bigquery-agent-budget.js";
import { OutsideAgentBigQueryRefusalError } from "./bigquery-agent-context.js";
import { getFirstPartyAnalyticsBackend } from "./first-party-analytics-backend.js";

export const ALLOWANCE_APPROVED_VIA = "mcp-review-page";

export function needsAllowanceApproval(
  budget: BigQueryAgentBudgetSnapshot,
  bytes: number,
): boolean {
  return budgetRefusalFor(budget, bytes)?.code === "approval_required";
}

export async function firstPartyQueriesRunOnBigQuery(
  identity: OutsideAgentIdentity,
): Promise<boolean> {
  const backend = await getFirstPartyAnalyticsBackend({
    userEmail: identity.ownerEmail,
    orgId: identity.orgId,
  });
  return backend.sink === "bigquery";
}

export function allowanceApprovalNotice(
  budget: BigQueryAgentBudgetSnapshot,
  callBytes: number,
): string {
  const { person, org } = budget;
  const ceiling = formatUsd(person.ceilingBytes);
  return [
    `Allow up to ${ceiling} of BigQuery today?`,
    `This call can bill up to ${formatUsd(callBytes)}. Today you have spent ${formatUsd(person.settledBytes)} and reserved ${formatUsd(person.reservedBytes)} of your ${formatUsd(person.baseAllowanceBytes)} no-ask allowance.`,
    `Approving lets your outside agents spend up to ${ceiling} in total today, a hard stop. Your organization's ${formatUsd(org.limitBytes)} daily limit for outside agents still applies; it has spent ${formatUsd(org.settledBytes)} and reserved ${formatUsd(org.reservedBytes)}.`,
    `The approval expires at 00:00 UTC (${budget.resetsAt}).`,
  ].join("\n");
}

export async function allowanceBudget(
  ctx: ActionRunContext | undefined,
  now?: Date,
): Promise<{
  identity: OutsideAgentIdentity;
  budget: BigQueryAgentBudgetSnapshot;
} | null> {
  try {
    const identity = outsideAgentIdentity(ctx?.userEmail, ctx?.orgId);
    return {
      identity,
      budget: await readBigQueryAgentBudget(identity, now ? { now } : {}),
    };
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) return null;
    throw error;
  }
}

export async function recordReviewedAllowance(
  identity: OutsideAgentIdentity,
  now: Date = new Date(),
): Promise<void> {
  if (currentActionApproval() !== "mcp-review-page") return;
  const askedAt = currentActionApprovalAskedAt();
  if (askedAt === undefined || utcDay(new Date(askedAt)) !== utcDay(now)) {
    return;
  }
  try {
    await approveBigQueryAgentDailyAllowance(
      identity,
      ALLOWANCE_APPROVED_VIA,
      now,
    );
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) {
      throw new OutsideAgentBigQueryRefusalError({
        code: "budget_unavailable",
      });
    }
    throw error;
  }
}
