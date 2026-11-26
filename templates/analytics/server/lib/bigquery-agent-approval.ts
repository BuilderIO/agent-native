import {
  currentActionApproval,
  currentActionApprovalAskedAt,
  fail,
  type ActionApprovalNoticeContext,
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
import { failForOutsideAgentRefusal } from "./bigquery-agent-calls.js";
import { OutsideAgentBigQueryRefusalError } from "./bigquery-agent-context.js";
import { usdForBilledBytes } from "./bigquery-pricing.js";
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

function formatUsdUpTo(bytes: number): string {
  const cents = Math.ceil(Number((usdForBilledBytes(bytes) * 100).toFixed(6)));
  return `$${(cents / 100).toFixed(2)}`;
}

export function allowanceApprovalNotice(
  budget: BigQueryAgentBudgetSnapshot,
  callBytes: number,
): string {
  const { person, org } = budget;
  const ceiling = formatUsdUpTo(person.ceilingBytes);
  return [
    `Allow up to ${ceiling} of BigQuery today?`,
    `At today's limits, this call can bill up to ${formatUsdUpTo(callBytes)}. Today you have spent ${formatUsd(person.settledBytes)} and reserved ${formatUsd(person.reservedBytes)} of your ${formatUsd(person.baseAllowanceBytes)} no-ask allowance.`,
    `Approving lets your outside agents spend up to ${ceiling} in total today (UTC), a hard stop. Your organization's ${formatUsd(org.limitBytes)} daily limit for outside agents is also a hard stop; it has spent ${formatUsd(org.settledBytes)} and reserved ${formatUsd(org.reservedBytes)}.`,
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

export async function allowanceToAskAbout(
  ctx: ActionApprovalNoticeContext,
  askBytes: number,
  runsOnBigQuery: (
    identity: OutsideAgentIdentity,
  ) => Promise<boolean> = firstPartyQueriesRunOnBigQuery,
): Promise<BigQueryAgentBudgetSnapshot> {
  const read = await allowanceBudget(ctx, new Date(ctx.askedAt));
  if (read === null) {
    failForOutsideAgentRefusal(
      new OutsideAgentBigQueryRefusalError({ code: "budget_unavailable" }),
    );
  }
  const onBigQuery = await runsOnBigQuery(read.identity).catch(() =>
    fail(
      "Analytics could not read where its first-party queries run, so it asked nothing about BigQuery spend and nothing ran. Try again in a few minutes.",
      { errorCode: "first_party_backend_unavailable", statusCode: 503 },
    ),
  );
  if (!onBigQuery || !needsAllowanceApproval(read.budget, askBytes)) {
    fail(
      `This call doesn't need your approval for BigQuery spend now, so Analytics asked nothing and nothing ran. Call ${ctx.actionName ?? "it"} again with the same arguments.`,
      { errorCode: "approval_not_needed", statusCode: 409 },
    );
  }
  return read.budget;
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
